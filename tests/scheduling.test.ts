import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  overlaps, checkAvailability, suggestAlternatives, bookAppointment, daySlots,
  type Db, type Appointment, type BookingRequest,
} from '../lib/scheduling';

// Mon 2 Nov 2026. Helper builds UTC times on that day (dealership offset = 0).
const at = (h: number, m = 0, day = '2026-11-02') =>
  `${day}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`;
const NOW = new Date('2026-10-31T00:00:00.000Z');

const weekdays = { open: '08:00', close: '17:00' };
function makeDb(): Db {
  return {
    dealerships: [{ id: 'd1', name: 'Test', utcOffsetMinutes: 0,
      openingHours: { '1': weekdays, '2': weekdays, '3': weekdays, '4': weekdays, '5': weekdays } }],
    customers: [{ id: 'c1', name: 'A' }, { id: 'c2', name: 'B' }],
    vehicles: [
      { id: 'v1', customerId: 'c1', registration: 'R1', make: 'M', model: 'X' },
      { id: 'v2', customerId: 'c2', registration: 'R2', make: 'M', model: 'Y' },
    ],
    serviceTypes: [
      { id: 's1', name: 'Interim', durationMinutes: 60, requiredSkill: 'service', requiredBayType: 'general' },
      { id: 's2', name: 'Brakes', durationMinutes: 90, requiredSkill: 'brakes', requiredBayType: 'lift' },
    ],
    bays: [
      { id: 'b1', dealershipId: 'd1', name: 'B1', bayType: 'general' },
      { id: 'b2', dealershipId: 'd1', name: 'B2', bayType: 'lift' },
    ],
    technicians: [
      { id: 't1', dealershipId: 'd1', name: 'T1', skills: ['service', 'brakes'],
        shifts: [{ days: [1, 2, 3, 4, 5], start: '08:00', end: '17:00' }] },
      { id: 't2', dealershipId: 'd1', name: 'T2', skills: ['service'],
        shifts: [{ days: [1, 2, 3, 4, 5], start: '08:00', end: '15:00' }] },
    ],
    appointments: [],
  };
}
const appt = (p: Partial<Appointment>): Appointment => ({
  id: 'x', customerId: 'c1', vehicleId: 'v1', dealershipId: 'd1', serviceTypeId: 's1',
  technicianId: 't1', bayId: 'b1', startTime: at(10), endTime: at(11), status: 'CONFIRMED',
  createdAt: NOW.toISOString(), ...p,
});
const slot = (startTime: string, serviceTypeId = 's1') => ({ dealershipId: 'd1', serviceTypeId, startTime });
const book = (db: Db, over: Partial<BookingRequest> = {}, id = 'apt-1') =>
  bookAppointment(db, { customerId: 'c1', vehicleId: 'v1', ...slot(at(9)), ...over }, NOW, id);

describe('overlaps', () => {
  it('treats back-to-back intervals as non-overlapping', () => expect(overlaps(0, 60, 60, 120)).toBe(false));
  it('detects partial overlap', () => expect(overlaps(0, 60, 30, 90)).toBe(true));
  it('detects containment', () => expect(overlaps(0, 120, 30, 60)).toBe(true));
});

describe('checkAvailability', () => {
  it('is available when everything is free, with end = start + duration', () => {
    const r = checkAvailability(makeDb(), slot(at(9)));
    expect(r).toMatchObject({ available: true, endTime: at(10), bayIds: ['b1'], technicianIds: ['t1', 't2'] });
  });
  it('rejects a start before opening, an end after closing, and a closed day', () => {
    const db = makeDb();
    expect(checkAvailability(db, slot(at(7, 30))).reason).toBe('OUTSIDE_HOURS');
    expect(checkAvailability(db, slot(at(16, 30))).reason).toBe('OUTSIDE_HOURS');
    expect(checkAvailability(db, slot(at(10, 0, '2026-11-01'))).reason).toBe('OUTSIDE_HOURS'); // Sunday
  });
  it('allows a service that ends exactly at closing time', () =>
    expect(checkAvailability(makeDb(), slot(at(16))).available).toBe(true));
  it('excludes a technician whose shift ends before the service does', () => {
    const r = checkAvailability(makeDb(), slot(at(14, 30))); // ends 15:30, t2 leaves at 15:00
    expect(r.technicianIds).toEqual(['t1']);
  });
  it('reports NO_TECHNICIAN when nobody holds the required skill', () => {
    const db = makeDb(); db.technicians[0].skills = ['service'];
    expect(checkAvailability(db, slot(at(9), 's2')).reason).toBe('NO_TECHNICIAN');
  });
  it('reports NO_BAY when no bay of the required type exists', () => {
    const db = makeDb(); db.bays = db.bays.filter((b) => b.bayType !== 'lift');
    expect(checkAvailability(db, slot(at(9), 's2')).reason).toBe('NO_BAY');
  });
  it('reports NO_BAY_AND_TECHNICIAN when both are missing', () => {
    const db = makeDb(); db.bays = []; db.technicians = [];
    expect(checkAvailability(db, slot(at(9))).reason).toBe('NO_BAY_AND_TECHNICIAN');
  });
  it('blocks an overlapping slot but allows back-to-back before and after', () => {
    const db = makeDb(); db.appointments = [appt({ startTime: at(10), endTime: at(11) })];
    expect(checkAvailability(db, slot(at(10, 30))).reason).toBe('NO_BAY'); // t2 still free, bay taken
    expect(checkAvailability(db, slot(at(9))).available).toBe(true);       // ends 10:00
    expect(checkAvailability(db, slot(at(11))).available).toBe(true);      // starts 11:00
  });
  it('reports NO_TECHNICIAN when the only qualified technician is busy', () => {
    const db = makeDb(); db.appointments = [appt({ serviceTypeId: 's2', technicianId: 't1', bayId: 'b2', startTime: at(9), endTime: at(10, 30) })];
    expect(checkAvailability(db, slot(at(9, 30), 's2')).reason).toBe('NO_BAY_AND_TECHNICIAN');
    expect(checkAvailability(db, slot(at(9, 30))).available).toBe(true); // general bay + t2 are free
  });
  it('ignores cancelled appointments', () => {
    const db = makeDb(); db.appointments = [appt({ status: 'CANCELLED' })];
    expect(checkAvailability(db, slot(at(10))).available).toBe(true);
  });
  it('flags unknown ids and invalid times', () => {
    expect(checkAvailability(makeDb(), { ...slot(at(9)), dealershipId: 'nope' }).reason).toBe('UNKNOWN_REFERENCE');
    expect(checkAvailability(makeDb(), slot('not-a-date')).reason).toBe('INVALID_TIME');
  });
  it('respects the dealership time zone offset', () => {
    const db = makeDb(); db.dealerships[0].utcOffsetMinutes = 120; // local = UTC+2
    expect(checkAvailability(db, slot(at(6))).available).toBe(true);   // 08:00 local
    expect(checkAvailability(db, slot(at(5))).reason).toBe('OUTSIDE_HOURS'); // 07:00 local
  });
});

describe('bookAppointment', () => {
  it('creates a confirmed appointment linking customer, vehicle, technician and bay', () => {
    const r = book(makeDb());
    expect(r.ok && r.created).toBe(true);
    if (r.ok) expect(r.appointment).toMatchObject({
      id: 'apt-1', customerId: 'c1', vehicleId: 'v1', dealershipId: 'd1', serviceTypeId: 's1',
      bayId: 'b1', technicianId: 't1', startTime: at(9), endTime: at(10), status: 'CONFIRMED',
    });
  });
  it('prevents double booking of a bay and suggests free alternatives', () => {
    const db = makeDb();
    const first = book(db);
    if (!first.ok) throw new Error('first booking should succeed');
    db.appointments.push(first.appointment);
    const second = book(db, { customerId: 'c2', vehicleId: 'v2' }, 'apt-2');
    expect(second).toMatchObject({ ok: false, code: 'SLOT_UNAVAILABLE', reason: 'NO_BAY' });
    if (!second.ok) {
      expect(second.alternatives?.[0]).toBe(at(10));
      for (const alt of second.alternatives ?? []) expect(checkAvailability(db, slot(alt)).available).toBe(true);
    }
  });
  it('picks the least-loaded technician that day, ties broken by id', () => {
    const db = makeDb(); db.appointments = [appt({ technicianId: 't1', startTime: at(8), endTime: at(9) })];
    const r = book(db, slot(at(10)));
    expect(r.ok && r.appointment.technicianId).toBe('t2');
    const fresh = book(makeDb(), slot(at(10)));
    expect(fresh.ok && fresh.appointment.technicianId).toBe('t1'); // tie -> lowest id
  });
  it('is idempotent: a retry with the same key returns the original appointment', () => {
    const db = makeDb();
    const first = book(db, { idempotencyKey: 'k1' });
    if (!first.ok) throw new Error('should succeed');
    db.appointments.push(first.appointment);
    const retry = book(db, { idempotencyKey: 'k1' }, 'apt-2');
    expect(retry).toMatchObject({ ok: true, created: false });
    if (retry.ok) expect(retry.appointment.id).toBe('apt-1');
  });
  it('rejects a vehicle that belongs to another customer', () =>
    expect(book(makeDb(), { vehicleId: 'v2' })).toMatchObject({ ok: false, code: 'VEHICLE_NOT_OWNED' }));
  it('rejects unknown customers and incomplete requests', () => {
    expect(book(makeDb(), { customerId: 'zzz' })).toMatchObject({ ok: false, code: 'UNKNOWN_REFERENCE' });
    expect(book(makeDb(), { serviceTypeId: '' })).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
  });
  it('rejects times in the past', () =>
    expect(bookAppointment(makeDb(), { customerId: 'c1', vehicleId: 'v1', ...slot(at(9)) }, new Date(at(9)), 'a'))
      .toMatchObject({ ok: false, code: 'PAST_TIME' }));
  it('rejects outside opening hours without suggesting alternatives', () =>
    expect(book(makeDb(), { startTime: at(18) })).toMatchObject({ ok: false, code: 'OUTSIDE_HOURS' }));
  it('frees the slot again once the appointment is cancelled', () => {
    const db = makeDb(); const first = book(db);
    if (!first.ok) throw new Error('should succeed');
    db.appointments.push({ ...first.appointment, status: 'CANCELLED' });
    expect(book(db, { customerId: 'c2', vehicleId: 'v2' }, 'apt-2').ok).toBe(true);
  });
});

describe('suggestAlternatives', () => {
  it('returns up to three increasing, genuinely free start times', () => {
    const db = makeDb(); db.appointments = [appt({ startTime: at(9), endTime: at(10) })];
    const alts = suggestAlternatives(db, slot(at(9)));
    expect(alts).toHaveLength(3);
    expect([...alts].sort()).toEqual(alts);
    expect(alts[0]).toBe(at(10));
  });
});

describe('daySlots', () => {
  const req = { dealershipId: 'd1', serviceTypeId: 's1', date: '2026-11-02' };
  it('lists a 30-minute grid from opening until the last start that ends by closing', () => {
    const slots = daySlots(makeDb(), req, NOW);
    expect(slots[0].startTime).toBe(at(8));
    expect(slots.at(-1)!.startTime).toBe(at(16));
    expect(slots).toHaveLength(17);
  });
  it('flags slots that clash with an existing appointment, but not back-to-back ones', () => {
    const db = makeDb(); db.appointments = [appt({ startTime: at(10), endTime: at(11) })];
    const free = (t: string) => daySlots(db, req, NOW).find((s) => s.startTime === t)!.available;
    expect([free(at(9)), free(at(9, 30)), free(at(10)), free(at(10, 30)), free(at(11))]).toEqual([true, false, false, false, true]);
  });
  it('returns nothing on a closed day and marks past slots unavailable', () => {
    expect(daySlots(makeDb(), { ...req, date: '2026-11-01' }, NOW)).toEqual([]);
    const slots = daySlots(makeDb(), req, new Date(at(9, 15)));
    expect(slots.filter((s) => !s.available).map((s) => s.startTime)).toEqual(expect.arrayContaining([at(8), at(9)]));
    expect(slots.find((s) => s.startTime === at(9, 30))!.available).toBe(true);
  });
});

describe('seed data (db.json)', () => {
  const seed = JSON.parse(readFileSync(new URL('../db.json', import.meta.url), 'utf8')) as Db;
  it('has consistent references and bookable demo slots', () => {
    expect(seed.vehicles.every((v) => seed.customers.some((c) => c.id === v.customerId))).toBe(true);
    expect(seed.bays.every((b) => seed.dealerships.some((d) => d.id === b.dealershipId))).toBe(true);
    expect(checkAvailability(seed, { dealershipId: 'd1', serviceTypeId: 's1', startTime: at(9) }).available).toBe(true);
  });
});
