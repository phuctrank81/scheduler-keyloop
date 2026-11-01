import { Suspense } from 'react';
import { BACKEND_URL } from '@/lib/proxy';
import type { Customer, Dealership, ServiceBay, ServiceType, Technician, Vehicle } from '@/lib/scheduling';
import AppShell from '@/components/AppShell';
import BookingForm from '@/components/BookingForm';

const get = async <T,>(path: string): Promise<T> => {
  const response = await fetch(`${BACKEND_URL}/${path}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(path);
  return response.json();
};

type PageData = {
  dealerships: Dealership[];
  customer: Customer;
  vehicles: Vehicle[];
  serviceTypes: ServiceType[];
  bays: ServiceBay[];
  technicians: Technician[];
};

const getCustomerInitials = (name: string): string =>
  name.split(' ').filter(Boolean).map((word) => word[0]).join('').slice(0, 2);

async function BookingPageContent() {
  let data: PageData | null = null;

  try {
    const [dealerships, customers, vehicles, serviceTypes, bays, technicians] = await Promise.all([
      get<Dealership[]>('dealerships'),
      get<Customer[]>('customers'),
      get<Vehicle[]>('vehicles'),
      get<ServiceType[]>('serviceTypes'),
      get<ServiceBay[]>('bays'),
      get<Technician[]>('technicians'),
    ]);

    data = { dealerships, customer: customers[0], vehicles, serviceTypes, bays, technicians };
  } catch {
    data = null;
  }

  return (
    <AppShell title="Appointment Booking" activeNav="dashboard" showPromo headerRight={data ? (
      <div className="who">
        <span className="avatar" aria-hidden>{getCustomerInitials(data.customer.name)}</span>
        {data.customer.name}
      </div>
    ) : undefined}>
      <section className="card" id="book" aria-labelledby="book-h">
        <h2 id="book-h">Book appointment</h2>
        {data ? <BookingForm {...data} /> : (
          <p className="empty">The scheduling service did not respond. Start it with <code>npm run mock</code> and refresh.</p>
        )}
      </section>
    </AppShell>
  );
}

export default function Page() {
  return (
    <Suspense fallback={
      <AppShell title="Appointment Booking" activeNav="dashboard" showPromo>
        <section className="card" id="book" aria-labelledby="book-h">
          <h2 id="book-h">Book appointment</h2>
          <p className="empty">Loading appointment data…</p>
        </section>
      </AppShell>
    }>
      <BookingPageContent />
    </Suspense>
  );
}
