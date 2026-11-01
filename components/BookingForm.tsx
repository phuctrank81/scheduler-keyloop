'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Appointment, Customer, DaySlot, Dealership, ServiceBay, ServiceType, Technician, Vehicle } from '@/lib/scheduling';
import Calendar from './Calendar';

interface Props {
  customer: Customer; dealerships: Dealership[]; vehicles: Vehicle[]; serviceTypes: ServiceType[]; bays: ServiceBay[]; technicians: Technician[];
}
const COLOURS = ['#7d8aa3', '#1f3fae', '#1f9d55', '#9acd1b', '#b0412e'];
const MESSAGES: Record<string, string> = {
  OUTSIDE_HOURS: 'That time is outside opening hours.', PAST_TIME: 'That time has already passed.',
  VEHICLE_NOT_OWNED: 'That vehicle is not on your account.',
};
const timeLabel = (iso: string, offset: number) =>
  new Date(Date.parse(iso) + offset * 60000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
const dateLabel = (iso: string, offset: number) =>
  new Date(Date.parse(iso) + offset * 60000).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

function CarIcon({ colour }: { colour: string }) {
  return (
    <svg viewBox="0 0 120 52" width="112" height="48" aria-hidden>
      <path d="M8 38 L13 26 Q18 16 32 15 L54 13 Q66 5 84 13 L101 18 Q113 22 114 35 L114 40 L8 40 Z" fill={colour} />
      <path d="M40 16 L56 14 Q64 10 76 14 L84 20 L38 21 Z" fill="#fff" opacity=".35" />
      <circle cx="34" cy="40" r="8" fill="#16252b" /><circle cx="92" cy="40" r="8" fill="#16252b" />
      <circle cx="34" cy="40" r="3" fill="#cfd6dc" /><circle cx="92" cy="40" r="3" fill="#cfd6dc" />
    </svg>
  );
}

export default function BookingForm({ customer, dealerships, vehicles, serviceTypes, bays, technicians }: Props) {
  const router = useRouter();
  const mine = vehicles.filter((v) => v.customerId === customer.id);
  const regions = [...new Set(dealerships.map((d) => d.region ?? 'All'))];
  const [vehicleId, setVehicleId] = useState(mine[0]?.id ?? '');
  const [serviceTypeId, setServiceTypeId] = useState('');
  const [region, setRegion] = useState('');
  const [dealershipId, setDealershipId] = useState('');
  const [date, setDate] = useState('');
  const [slot, setSlot] = useState('');
  const [selectedTechnicianId, setSelectedTechnicianId] = useState('');
  const [availableTechnicians, setAvailableTechnicians] = useState<Technician[]>([]);
  const [slots, setSlots] = useState<DaySlot[] | null>(null);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [correlationId] = useState(() => crypto.randomUUID());
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const dealership = dealerships.find((d) => d.id === dealershipId);
  const offset = dealership?.utcOffsetMinutes ?? 0;
  const headers = { 'content-type': 'application/json', 'x-correlation-id': correlationId };
  const todayKey = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    if (!dealershipId || !serviceTypeId || !date) { setSlots(null); return; }
    let alive = true; setSlots(null);
    fetch('/api/slots', { method: 'POST', headers, body: JSON.stringify({ dealershipId, serviceTypeId, date }) })
      .then((r) => r.json()).then((b) => alive && setSlots(b.slots ?? []))
      .catch(() => alive && setError('Could not load times. Try again.'));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealershipId, serviceTypeId, date, reload]);

  useEffect(() => {
    if (!slot || !dealershipId || !serviceTypeId) {
      setAvailableTechnicians([]); setSelectedTechnicianId(''); return;
    }
    let alive = true;
    fetch('/api/availability', { method: 'POST', headers, body: JSON.stringify({ dealershipId, serviceTypeId, startTime: slot }) })
      .then((r) => r.json())
      .then((b) => {
        if (!alive) return;
        const ids = new Set((b.technicianIds ?? []) as string[]);
        const techs = technicians.filter((t) => t.dealershipId === dealershipId && ids.has(t.id));
        setAvailableTechnicians(techs);
        setSelectedTechnicianId((current) => {
          if (techs.some((t) => t.id === current)) return current;
          return techs[0]?.id ?? '';
        });
      })
      .catch(() => alive && setError('Could not load technicians. Try again.'));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slot, dealershipId, serviceTypeId, technicians]);

  const reset = () => { setServiceTypeId(''); setRegion(''); setDealershipId(''); setDate(''); setSlot(''); setSelectedTechnicianId(''); setAvailableTechnicians([]); setError(''); };

  async function book() {
    setBusy(true); setError('');
    const nextIdempotencyKey = crypto.randomUUID();
    setIdempotencyKey(nextIdempotencyKey);
    try {
      const r = await fetch('/api/appointments', {
        method: 'POST',
        headers: { ...headers, 'idempotency-key': nextIdempotencyKey },
        body: JSON.stringify({ customerId: customer.id, vehicleId, dealershipId, serviceTypeId, startTime: slot, technicianId: selectedTechnicianId || undefined })
      });
      const body = await r.json();
      if (r.ok) {
        const params = new URLSearchParams({
          success: '1',
          customerId: customer.id,
          vehicleId,
          dealershipId,
          serviceTypeId,
          startTime: slot,
          technicianId: selectedTechnicianId || '',
        });
        router.push(`/appointments?${params.toString()}`);
        return;
      }
      if (r.status === 409) { setError('Someone just took that time. Pick another slot.'); setSlot(''); setReload((n) => n + 1); }
      else setError(MESSAGES[body.code] ?? 'We could not book that. Check your choices and try again.');
    } catch { setError('Could not reach the booking service. Try again.'); }
    finally { setBusy(false); }
  }

  return (
    <>
      <h3 className="sub">Choose the vehicle you want to book</h3>
      <div className="vehicles" role="radiogroup" aria-label="Vehicle">
        {mine.map((v, i) => (
          <button key={v.id} type="button" role="radio" aria-checked={v.id === vehicleId}
            className={`vcard${v.id === vehicleId ? ' on' : ''}`} onClick={() => setVehicleId(v.id)}>
            <CarIcon colour={COLOURS[i % COLOURS.length]} />
            <strong>{v.make} {v.model}</strong><small>{v.registration}</small>
          </button>
        ))}
      </div>

      <h3 className="sub">Choose your service and location</h3>
      <div className="selects">
        <label>Service type
          <select value={serviceTypeId} onChange={(e) => { setServiceTypeId(e.target.value); setSlot(''); }}>
            <option value="">Choose service type</option>
            {serviceTypes.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.durationMinutes} min)</option>)}
          </select></label>
        <label>Region
          <select value={region} onChange={(e) => {
            const r = e.target.value; setRegion(r); setSlot('');
            const list = dealerships.filter((d) => (d.region ?? 'All') === r);
            setDealershipId(list.length === 1 ? list[0].id : '');
          }}>
            <option value="">Region</option>
            {regions.map((r) => <option key={r} value={r}>{r}</option>)}
          </select></label>
        <label>Service centre
          <select value={dealershipId} disabled={!region} onChange={(e) => { setDealershipId(e.target.value); setSlot(''); }}>
            <option value="">Choose service centre</option>
            {dealerships.filter((d) => (d.region ?? 'All') === region).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select></label>
        <label>Technician
          <select value={selectedTechnicianId} disabled={!slot || availableTechnicians.length === 0} onChange={(e) => setSelectedTechnicianId(e.target.value)}>
            <option value="">{slot ? 'Choose technician' : 'Select a time first'}</option>
            {availableTechnicians.map((tech) => <option key={tech.id} value={tech.id}>{tech.name}</option>)}
          </select>
        </label>
      </div>

      <div className="pick">
        <div>
          <h3 className="sub">Select date</h3>
          <Calendar value={date} onChange={(d) => { setDate(d); setSlot(''); }}
            isDisabled={(k) => {
              const day = new Date(`${k}T00:00:00Z`).getUTCDay();
              return k < todayKey || day === 0 || day === 6 || (!!dealership && !dealership.openingHours[String(day)]);
            }} />
        </div>
        <div className="slots-col">
          <h3 className="sub">Select time</h3>
          {!dealershipId || !serviceTypeId || !date ? <p className="hint">Choose a service, a centre and a date to see free times.</p>
            : slots === null ? <p className="hint">Checking bays and technicians…</p>
            : slots.length === 0 ? <p className="hint">This centre is closed that day.</p>
            : <div className="slots" role="radiogroup" aria-label="Start time">
                {slots.map((s) => (
                  <button key={s.startTime} type="button" role="radio" aria-checked={s.startTime === slot}
                    className={`chip${s.startTime === slot ? ' on' : ''}`} disabled={!s.available} onClick={() => setSlot(s.startTime)}
                    title={s.available ? undefined : 'No free bay and qualified technician'}>{timeLabel(s.startTime, offset)}</button>))}
              </div>}
          {slots && slots.length > 0 && slots.every((s) => !s.available) && <p className="hint">Fully booked that day. Try another date.</p>}
          {error && <p className="error" role="alert">{error}</p>}
          <div className="actions">
            <button type="button" className="btn ghost" onClick={reset}>Cancel</button>
            <button type="button" className="btn" onClick={book} disabled={!slot || !vehicleId || !selectedTechnicianId || busy}>Book appointment</button>
          </div>
        </div>
      </div>
    </>
  );
}
