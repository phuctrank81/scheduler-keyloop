import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { BACKEND_URL } from '@/lib/proxy';
import type { Appointment, Customer, Dealership, ServiceBay, ServiceType, Technician, Vehicle } from '@/lib/scheduling';
import AppShell from '@/components/AppShell';

const get = async <T,>(path: string): Promise<T> => {
  const response = await fetch(`${BACKEND_URL}/${path}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(path);
  return response.json();
};

const timeLabel = (iso: string, offset: number) =>
  new Date(Date.parse(iso) + offset * 60000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
const dateLabel = (iso: string, offset: number) =>
  new Date(Date.parse(iso) + offset * 60000).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

async function AppointmentDetailContent({ id }: { id: string }) {
  try {
    const [appointment, customers, dealerships, vehicles, serviceTypes, bays, technicians] = await Promise.all([
      get<Appointment>(`appointments/${encodeURIComponent(id)}`),
      get<Customer[]>('customers'),
      get<Dealership[]>('dealerships'),
      get<Vehicle[]>('vehicles'),
      get<ServiceType[]>('serviceTypes'),
      get<ServiceBay[]>('bays'),
      get<Technician[]>('technicians'),
    ]);

    const customer = customers.find((entry) => entry.id === appointment.customerId);
    const vehicle = vehicles.find((entry) => entry.id === appointment.vehicleId);
    const dealership = dealerships.find((entry) => entry.id === appointment.dealershipId);
    const serviceType = serviceTypes.find((entry) => entry.id === appointment.serviceTypeId);
    const bay = bays.find((entry) => entry.id === appointment.bayId);
    const technician = technicians.find((entry) => entry.id === appointment.technicianId);

    if (!customer || !vehicle || !dealership || !serviceType || !bay || !technician) {
      notFound();
    }

    const offset = dealership.utcOffsetMinutes;

    return (
      <AppShell title="Your appointment" activeNav="appointments">
        <section className="card" aria-live="polite">
          <h2>Booking confirmed</h2>
          <dl>
            <dt>Customer</dt><dd>{customer.name}</dd>
            <dt>Vehicle</dt><dd>{vehicle.make} {vehicle.model} ({vehicle.registration})</dd>
            <dt>Service</dt><dd>{serviceType.name}</dd>
            <dt>When</dt><dd>{dateLabel(appointment.startTime, offset)}, {timeLabel(appointment.startTime, offset)} to {timeLabel(appointment.endTime, offset)}</dd>
            <dt>Where</dt><dd>{dealership.name}, {bay.name}</dd>
            <dt>Technician</dt><dd>{technician.name}</dd>
            <dt>Reference</dt><dd>{appointment.id}</dd>
          </dl>

          <div className="actions">
            <a className="btn ghost" href="/">Back to home</a>
          </div>
        </section>
      </AppShell>
    );
  } catch {
    notFound();
  }
}

export default function AppointmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={
      <AppShell title="Your appointment" activeNav="appointments">
        <section className="card">
          <p className="empty">Loading appointment…</p>
        </section>
      </AppShell>
    }>
      <AppointmentDetailPageInner params={params} />
    </Suspense>
  );
}

async function AppointmentDetailPageInner({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AppointmentDetailContent id={id} />;
}
