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

async function AppointmentListContent({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const params = searchParams ? await searchParams : {};
  const isSuccess = params.success === '1';
  const startTime = typeof params.startTime === 'string' ? params.startTime : undefined;
  const customerId = typeof params.customerId === 'string' ? params.customerId : undefined;
  const vehicleId = typeof params.vehicleId === 'string' ? params.vehicleId : undefined;
  const dealershipId = typeof params.dealershipId === 'string' ? params.dealershipId : undefined;
  const serviceTypeId = typeof params.serviceTypeId === 'string' ? params.serviceTypeId : undefined;
  const technicianId = typeof params.technicianId === 'string' ? params.technicianId : undefined;

  try {
    const [appointments, customers, dealerships, vehicles, serviceTypes, bays, technicians] = await Promise.all([
      get<Appointment[]>('appointments'),
      get<Customer[]>('customers'),
      get<Dealership[]>('dealerships'),
      get<Vehicle[]>('vehicles'),
      get<ServiceType[]>('serviceTypes'),
      get<ServiceBay[]>('bays'),
      get<Technician[]>('technicians'),
    ]);

    const confirmed = [...appointments]
      .filter((appointment) => appointment.status === 'CONFIRMED')
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

    const successCustomer = customerId ? customers.find((entry) => entry.id === customerId) : undefined;
    const successVehicle = vehicleId ? vehicles.find((entry) => entry.id === vehicleId) : undefined;
    const successDealership = dealershipId ? dealerships.find((entry) => entry.id === dealershipId) : undefined;
    const successServiceType = serviceTypeId ? serviceTypes.find((entry) => entry.id === serviceTypeId) : undefined;
    const successTechnician = technicianId ? technicians.find((entry) => entry.id === technicianId) : undefined;
    const successOffset = successDealership?.utcOffsetMinutes ?? 0;
    const successEndTime = startTime && successServiceType ? new Date(Date.parse(startTime) + successServiceType.durationMinutes * 60 * 1000).toISOString() : undefined;

    return (
      <AppShell title="Your appointment" activeNav="appointments">
        {isSuccess && startTime && successCustomer && successVehicle && successDealership && successServiceType && successTechnician && successEndTime && (
          <section className="card" style={{ marginBottom: '1.5rem', borderLeft: '6px solid #1d8a57', background: '#f3faf6' }} aria-live="polite">
            <dl>
              <dt>Customer</dt><dd>{successCustomer.name}</dd>
              <dt>Vehicle</dt><dd>{successVehicle.make} {successVehicle.model} ({successVehicle.registration})</dd>
              <dt>Service</dt><dd>{successServiceType.name}</dd>
              <dt>When</dt><dd>{dateLabel(startTime, successOffset)}, {timeLabel(startTime, successOffset)} to {timeLabel(successEndTime, successOffset)}</dd>
              <dt>Where</dt><dd>{successDealership.name}, {bays.find((entry) => entry.dealershipId === successDealership.id)?.name ?? 'Service bay'}</dd>
              <dt>Technician</dt><dd>{successTechnician.name}</dd>
              <dt>Reference</dt><dd>Appointment confirmed</dd>
            </dl>
          </section>
        )}

        {confirmed.length === 0 ? (
          <section className="card">
            <p className="empty">You do not have any appointment yet.</p>
          </section>
        ) : (
          <section className="card" aria-live="polite">
            <h2>All bookings</h2>
            <div className="appointments-list">
              {confirmed.map((appointment) => {
                const customer = customers.find((entry) => entry.id === appointment.customerId)!;
                const vehicle = vehicles.find((entry) => entry.id === appointment.vehicleId)!;
                const dealership = dealerships.find((entry) => entry.id === appointment.dealershipId)!;
                const serviceType = serviceTypes.find((entry) => entry.id === appointment.serviceTypeId)!;
                const bay = bays.find((entry) => entry.id === appointment.bayId)!;
                const technician = technicians.find((entry) => entry.id === appointment.technicianId)!;
                const offset = dealership.utcOffsetMinutes;

                return (
                  <div key={appointment.id} className="receipt" style={{ marginBottom: '1rem' }}>
                    <dl>
                      <dt>Customer</dt><dd>{customer.name}</dd>
                      <dt>Vehicle</dt><dd>{vehicle.make} {vehicle.model} ({vehicle.registration})</dd>
                      <dt>Service</dt><dd>{serviceType.name}</dd>
                      <dt>When</dt><dd>{dateLabel(appointment.startTime, offset)}, {timeLabel(appointment.startTime, offset)} to {timeLabel(appointment.endTime, offset)}</dd>
                      <dt>Where</dt><dd>{dealership.name}, {bay.name}</dd>
                      <dt>Technician</dt><dd>{technician.name}</dd>
                      <dt>Reference</dt><dd>Appointment confirmed</dd>
                    </dl>
                  </div>
                );
              })}
            </div>
            <div className="actions">
              <a className="btn ghost" href="/">Back to home</a>
            </div>
          </section>
        )}
      </AppShell>
    );
  } catch {
    return (
      <AppShell title="Your appointment" activeNav="appointments">
        <section className="card">
          <p className="empty">The scheduling service did not respond.</p>
        </section>
      </AppShell>
    );
  }
}

export default async function AppointmentListPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  return <AppointmentListContent searchParams={searchParams} />;
}
