// Core business logic. Pure functions only: no I/O, no clock, no randomness
// (callers pass `now` and `id`), so everything here is deterministic and testable.

export interface Hours { open: string; close: string }
export interface Dealership { id: string; name: string; region?: string; utcOffsetMinutes: number; openingHours: Record<string, Hours> }
export interface Customer { id: string; name: string }
export interface Vehicle { id: string; customerId: string; registration: string; make: string; model: string }
export interface ServiceType { id: string; name: string; durationMinutes: number; requiredSkill: string; requiredBayType: string }
export interface ServiceBay { id: string; dealershipId: string; name: string; bayType: string }
export interface Shift { days: number[]; start: string; end: string }
export interface Technician { id: string; dealershipId: string; name: string; skills: string[]; shifts: Shift[] }
export interface Appointment {
  id: string; customerId: string; vehicleId: string; dealershipId: string; serviceTypeId: string;
  technicianId: string; bayId: string; startTime: string; endTime: string;
  status: 'CONFIRMED' | 'CANCELLED'; createdAt: string; correlationId?: string; idempotencyKey?: string;
}
export interface Db {
  dealerships: Dealership[]; customers: Customer[]; vehicles: Vehicle[]; serviceTypes: ServiceType[];
  bays: ServiceBay[]; technicians: Technician[]; appointments: Appointment[];
}

export type UnavailableReason =
  | 'UNKNOWN_REFERENCE' | 'INVALID_TIME' | 'OUTSIDE_HOURS'
  | 'NO_BAY' | 'NO_TECHNICIAN' | 'NO_BAY_AND_TECHNICIAN';

export interface SlotRequest { dealershipId: string; serviceTypeId: string; startTime: string }
export interface AvailabilityResult {
  available: boolean; reason?: UnavailableReason; endTime?: string; bayIds: string[]; technicianIds: string[];
}
export interface BookingRequest extends SlotRequest {
  customerId: string; vehicleId: string; technicianId?: string; idempotencyKey?: string; correlationId?: string;
}
export type BookingResult =
  | { ok: true; created: boolean; appointment: Appointment }
  | { ok: false; code: 'INVALID_REQUEST' | 'UNKNOWN_REFERENCE' | 'VEHICLE_NOT_OWNED' | 'PAST_TIME' | 'OUTSIDE_HOURS' | 'SLOT_UNAVAILABLE';
      reason?: UnavailableReason; alternatives?: string[] };

const MINUTE = 60_000;

/** Half-open interval overlap: back-to-back intervals (A ends when B starts) do NOT overlap. */
export const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number): boolean =>
  aStart < bEnd && bStart < aEnd;

const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** Wall-clock view of a UTC instant at a dealership (fixed UTC offset). */
function localParts(ms: number, offsetMinutes: number) {
  const d = new Date(ms + offsetMinutes * MINUTE);
  return { weekday: d.getUTCDay(), minutes: d.getUTCHours() * 60 + d.getUTCMinutes(), dateKey: d.toISOString().slice(0, 10) };
}

/** True if [start, end) lies inside one local day and within [open, close] for that weekday. */
function withinOpeningHours(d: Dealership, startMs: number, endMs: number): boolean {
  const s = localParts(startMs, d.utcOffsetMinutes);
  const e = localParts(endMs, d.utcOffsetMinutes);
  const hours = d.openingHours[String(s.weekday)];
  if (!hours || s.dateKey !== e.dateKey) return false;
  return s.minutes >= toMinutes(hours.open) && e.minutes <= toMinutes(hours.close);
}

function shiftCovers(t: Technician, offset: number, startMs: number, endMs: number): boolean {
  const s = localParts(startMs, offset);
  const e = localParts(endMs, offset);
  if (s.dateKey !== e.dateKey) return false;
  return t.shifts.some(
    (sh) => sh.days.includes(s.weekday) && s.minutes >= toMinutes(sh.start) && e.minutes <= toMinutes(sh.end),
  );
}

const isBusy = (a: Appointment, startMs: number, endMs: number) =>
  a.status === 'CONFIRMED' && overlaps(Date.parse(a.startTime), Date.parse(a.endTime), startMs, endMs);

/** Real-time availability: needs a free bay of the right type AND a free, qualified technician for the whole duration. */
export function checkAvailability(db: Db, req: SlotRequest): AvailabilityResult {
  const none = { bayIds: [] as string[], technicianIds: [] as string[] };
  const dealership = db.dealerships.find((d) => d.id === req.dealershipId);
  const service = db.serviceTypes.find((s) => s.id === req.serviceTypeId);
  if (!dealership || !service) return { available: false, reason: 'UNKNOWN_REFERENCE', ...none };

  const startMs = Date.parse(req.startTime);
  if (Number.isNaN(startMs)) return { available: false, reason: 'INVALID_TIME', ...none };
  const endMs = startMs + service.durationMinutes * MINUTE;
  const endTime = new Date(endMs).toISOString();
  if (!withinOpeningHours(dealership, startMs, endMs)) return { available: false, reason: 'OUTSIDE_HOURS', endTime, ...none };

  const busyAppointments = db.appointments.filter((a) => a.dealershipId === dealership.id && a.status === 'CONFIRMED' && isBusy(a, startMs, endMs));
  const busyBayIds = new Set(busyAppointments.map((a) => a.bayId));
  const busyTechnicianIds = new Set(busyAppointments.map((a) => a.technicianId));

  const bayIds = db.bays
    .filter((b) => b.dealershipId === dealership.id && b.bayType === service.requiredBayType)
    .filter((b) => !busyBayIds.has(b.id))
    .map((b) => b.id)
    .sort();

  const technicianIds = db.technicians
    .filter((t) => t.dealershipId === dealership.id && t.skills.includes(service.requiredSkill))
    .filter((t) => shiftCovers(t, dealership.utcOffsetMinutes, startMs, endMs))
    .filter((t) => !busyTechnicianIds.has(t.id))
    .map((t) => t.id)
    .sort();

  if (bayIds.length && technicianIds.length) return { available: true, endTime, bayIds, technicianIds };
  const reason: UnavailableReason = !bayIds.length && !technicianIds.length ? 'NO_BAY_AND_TECHNICIAN' : !bayIds.length ? 'NO_BAY' : 'NO_TECHNICIAN';
  return { available: false, reason, endTime, bayIds, technicianIds };
}

/** Next free start times (30-minute grid) within the following 48 hours. */
export function suggestAlternatives(db: Db, req: SlotRequest, count = 3, stepMinutes = 30): string[] {
  const startMs = Date.parse(req.startTime);
  if (Number.isNaN(startMs)) return [];
  const found: string[] = [];
  for (let k = 1; k <= (48 * 60) / stepMinutes && found.length < count; k++) {
    const candidate = new Date(startMs + k * stepMinutes * MINUTE).toISOString();
    if (checkAvailability(db, { ...req, startTime: candidate }).available) found.push(candidate);
  }
  return found;
}

/**
 * Validates, re-checks availability and builds the Appointment. Does not mutate `db`;
 * the caller persists `appointment` when `created` is true. Pass the same idempotencyKey
 * on a retry and the original appointment is returned instead of a duplicate.
 */
export function bookAppointment(db: Db, req: BookingRequest, now: Date, id: string): BookingResult {
  if (req.idempotencyKey) {
    const existing = db.appointments.find((a) => a.idempotencyKey === req.idempotencyKey);
    if (existing) return { ok: true, created: false, appointment: existing };
  }

  const { customerId, vehicleId, dealershipId, serviceTypeId, startTime, technicianId } = req;
  if (!customerId || !vehicleId || !dealershipId || !serviceTypeId || !startTime) return { ok: false, code: 'INVALID_REQUEST' };

  const service = db.serviceTypes.find((s) => s.id === serviceTypeId);
  if (!service) return { ok: false, code: 'UNKNOWN_REFERENCE' };

  const customer = db.customers.find((c) => c.id === customerId);
  const vehicle = db.vehicles.find((v) => v.id === vehicleId);
  if (!customer || !vehicle) return { ok: false, code: 'UNKNOWN_REFERENCE' };
  if (vehicle.customerId !== customer.id) return { ok: false, code: 'VEHICLE_NOT_OWNED' };

  const startMs = Date.parse(startTime);
  if (Number.isNaN(startMs)) return { ok: false, code: 'INVALID_REQUEST' };
  if (startMs <= now.getTime()) return { ok: false, code: 'PAST_TIME' };

  const slot: SlotRequest = { dealershipId, serviceTypeId, startTime };
  const check = checkAvailability(db, slot);
  if (!check.available) {
    if (check.reason === 'UNKNOWN_REFERENCE') return { ok: false, code: 'UNKNOWN_REFERENCE' };
    if (check.reason === 'OUTSIDE_HOURS') return { ok: false, code: 'OUTSIDE_HOURS', reason: check.reason };
    return { ok: false, code: 'SLOT_UNAVAILABLE', reason: check.reason, alternatives: suggestAlternatives(db, slot) };
  }

  const dealership = db.dealerships.find((d) => d.id === dealershipId)!;
  const dayKey = localParts(startMs, dealership.utcOffsetMinutes).dateKey;
  const loadsByTechnician = new Map<string, number>();

  for (const appointment of db.appointments) {
    if (appointment.status !== 'CONFIRMED') continue;
    if (appointment.technicianId === undefined) continue;
    if (localParts(Date.parse(appointment.startTime), dealership.utcOffsetMinutes).dateKey !== dayKey) continue;
    loadsByTechnician.set(appointment.technicianId, (loadsByTechnician.get(appointment.technicianId) ?? 0) + 1);
  }

  const resolvedTechnicianId = technicianId ?? [...check.technicianIds].sort((a, b) =>
    (loadsByTechnician.get(a) ?? 0) - (loadsByTechnician.get(b) ?? 0) || a.localeCompare(b),
  )[0];

  if (resolvedTechnicianId && !check.technicianIds.includes(resolvedTechnicianId)) {
    return { ok: false, code: 'SLOT_UNAVAILABLE', reason: 'NO_TECHNICIAN', alternatives: suggestAlternatives(db, slot) };
  }

  if (resolvedTechnicianId) {
    const tech = db.technicians.find((t) => t.id === resolvedTechnicianId && t.dealershipId === dealershipId);
    const endMs = startMs + service.durationMinutes * MINUTE;
    if (!tech || !tech.skills.includes(service.requiredSkill) || !shiftCovers(tech, dealership.utcOffsetMinutes, startMs, endMs) || !check.technicianIds.includes(resolvedTechnicianId)) {
      return { ok: false, code: 'SLOT_UNAVAILABLE', reason: 'NO_TECHNICIAN', alternatives: suggestAlternatives(db, slot) };
    }
  }

  const bayId = check.bayIds[0];

  return {
    ok: true, created: true,
    appointment: {
      id, customerId, vehicleId, dealershipId, serviceTypeId, technicianId: resolvedTechnicianId,
      bayId, startTime: new Date(startMs).toISOString(), endTime: check.endTime!, status: 'CONFIRMED',
      createdAt: now.toISOString(), correlationId: req.correlationId, idempotencyKey: req.idempotencyKey,
    },
  };
}

export interface DaySlot { startTime: string; available: boolean }

/**
 * Every bookable start time (30-minute grid) on a local calendar day, flagged free or not.
 * Slots that would end after closing are omitted; slots at or before `now` are flagged unavailable.
 */
export function daySlots(db: Db, req: { dealershipId: string; serviceTypeId: string; date: string }, now: Date, stepMinutes = 30): DaySlot[] {
  const dealership = db.dealerships.find((d) => d.id === req.dealershipId);
  const service = db.serviceTypes.find((s) => s.id === req.serviceTypeId);
  const dayStart = Date.parse(`${req.date}T00:00:00Z`);
  if (!dealership || !service || Number.isNaN(dayStart)) return [];
  const hours = dealership.openingHours[String(new Date(dayStart).getUTCDay())];
  if (!hours) return [];
  const localMidnightUtc = dayStart - dealership.utcOffsetMinutes * MINUTE;
  const slots: DaySlot[] = [];
  for (let m = toMinutes(hours.open); m + service.durationMinutes <= toMinutes(hours.close); m += stepMinutes) {
    const startMs = localMidnightUtc + m * MINUTE;
    const startTime = new Date(startMs).toISOString();
    slots.push({ startTime, available: startMs > now.getTime() && checkAvailability(db, { ...req, startTime }).available });
  }
  return slots;
}
