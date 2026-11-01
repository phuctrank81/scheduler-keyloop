import type { ReactNode } from 'react';

export type NavItem = {
  label: string;
  href?: string;
  disabled?: boolean;
  current?: boolean;
};

const defaultNavItems: NavItem[] = [
  { label: 'Dashboard', href: '/', current: true },
  { label: 'Your appointment', href: '/appointments' },
  { label: 'Vehicles', disabled: true },
  { label: 'Profile', disabled: true },
  { label: 'Settings', disabled: true },
  { label: 'Sign out', disabled: true },
];

export function buildNavItems(active: 'dashboard' | 'appointments'): NavItem[] {
  return defaultNavItems.map((item) => {
    if (item.label === 'Dashboard') return { ...item, current: active === 'dashboard', href: '/' };
    if (item.label === 'Your appointment') return { ...item, current: active === 'appointments', href: '/appointments' };
    return { ...item, current: false, href: undefined };
  });
}

export default function AppShell({
  title,
  activeNav,
  children,
  headerRight,
  showPromo = false,
}: {
  title: string;
  activeNav: 'dashboard' | 'appointments';
  children: ReactNode;
  headerRight?: ReactNode;
  showPromo?: boolean;
}) {
  return (
    <div className="app">
      <aside className="side">
        <div className="logo" aria-label="Keyloop logo"><img src="/Keyloop-Logo.png" alt="Keyloop logo" /></div>
        <nav aria-label="Main menu">
          {buildNavItems(activeNav).map(({ label, href, disabled, current }) => {
            if (disabled) return <span key={label} className="nav" aria-disabled="true">{label}</span>;
            if (href) {
              return <a key={label} className={`nav${current ? ' on' : ''}`} href={href} aria-current={current ? 'page' : undefined}>{label}</a>;
            }
            return <span key={label} className="nav" aria-disabled="true">{label}</span>;
          })}
        </nav>
        {showPromo && (
          <div className="promo">
            <p className="promo-t">Time for a service?</p>
            <p>Book now to keep your vehicle road-safe.</p>
            <a className="promo-b" href="#book">Book now</a>
          </div>
        )}
      </aside>

      <div className="content">
        <header className="top">
          <h1>{title}</h1>
          {headerRight}
        </header>
        {children}
      </div>
    </div>
  );
}
