// Mock backend: json-server for reference data + custom routes that enforce the scheduling rules.
import jsonServer from 'json-server';
import pino from 'pino';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { bookAppointment, checkAvailability, daySlots, suggestAlternatives, type Db } from '../lib/scheduling';

const logger = pino({ name: 'mock-backend' });
const server = jsonServer.create();
const router = jsonServer.router(path.join(__dirname, '..', 'db.json'));
const state = () => router.db.getState() as Db;

server.use(jsonServer.defaults());
server.use(jsonServer.bodyParser);

// Correlation ID + one structured log line per request.
server.use((req: any, res: any, next: any) => {
  const correlationId = req.header('x-correlation-id') ?? randomUUID();
  req.correlationId = correlationId;
  res.setHeader('x-correlation-id', correlationId);
  const t0 = Date.now();
  res.on('finish', () => logger.info({ event: 'http.request', method: req.method, path: req.path, status: res.statusCode, durationMs: Date.now() - t0, correlationId }));
  next();
});

server.post('/api/availability', (req: any, res: any) => {
  const { dealershipId, serviceTypeId, startTime } = req.body ?? {};
  const slot = { dealershipId, serviceTypeId, startTime };
  const result = checkAvailability(state(), slot);
  const alternatives = result.available || result.reason === 'OUTSIDE_HOURS' ? [] : suggestAlternatives(state(), slot);
  logger.info({ event: result.available ? 'availability.checked' : 'availability.unavailable', reason: result.reason, correlationId: req.correlationId });
  res.json({ ...result, alternatives });
});

server.post('/api/slots', (req: any, res: any) => {
  const { dealershipId, serviceTypeId, date } = req.body ?? {};
  const slots = daySlots(state(), { dealershipId, serviceTypeId, date }, new Date());
  logger.info({ event: 'slots.listed', total: slots.length, free: slots.filter((s) => s.available).length, correlationId: req.correlationId });
  res.json({ slots });
});

const STATUS = { INVALID_REQUEST: 400, UNKNOWN_REFERENCE: 404, VEHICLE_NOT_OWNED: 422, PAST_TIME: 422, OUTSIDE_HOURS: 422, SLOT_UNAVAILABLE: 409 } as const;

server.post('/api/appointments', (req: any, res: any) => {
  const result = bookAppointment(state(), { ...req.body, idempotencyKey: req.header('idempotency-key'), correlationId: req.correlationId }, new Date(), randomUUID());
  if (!result.ok) {
    logger.warn({ event: result.code === 'SLOT_UNAVAILABLE' ? 'appointment.conflict' : 'appointment.rejected', code: result.code, reason: result.reason, correlationId: req.correlationId });
    return res.status(STATUS[result.code]).json(result);
  }
  if (result.created) router.db.get('appointments').push(result.appointment).write();
  logger.info({ event: 'appointment.created', appointmentId: result.appointment.id, created: result.created, correlationId: req.correlationId });
  res.status(result.created ? 201 : 200).json(result.appointment);
});

server.delete('/api/appointments/:id', (req: any, res: any) => {
  const found = router.db.get('appointments').find({ id: req.params.id });
  if (!found.value()) return res.status(404).json({ code: 'NOT_FOUND' });
  const updated = found.assign({ status: 'CANCELLED' }).write();
  logger.info({ event: 'appointment.cancelled', appointmentId: req.params.id, correlationId: req.correlationId });
  res.json(updated);
});

server.use(router);
const port = Number(process.env.MOCK_PORT ?? 3001);
server.listen(port, () => logger.info({ event: 'server.started', port }));
