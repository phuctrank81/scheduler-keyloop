'use client';
import { useState } from 'react';

interface Props { value: string; onChange: (dateKey: string) => void; isDisabled: (dateKey: string) => boolean }
const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const key = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);

export default function Calendar({ value, onChange, isDisabled }: Props) {
  const today = new Date();
  const [view, setView] = useState({ y: today.getFullYear(), m: today.getMonth() });
  const lead = new Date(Date.UTC(view.y, view.m, 1)).getUTCDay();
  const cells = Array.from({ length: 42 }, (_, i) => new Date(Date.UTC(view.y, view.m, 1 - lead + i)));
  const label = new Date(Date.UTC(view.y, view.m, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const move = (n: number) => setView(({ y, m }) => { const d = new Date(Date.UTC(y, m + n, 1)); return { y: d.getUTCFullYear(), m: d.getUTCMonth() }; });

  return (
    <div className="cal">
      <div className="cal-head">
        <button type="button" className="icon" onClick={() => move(-1)} aria-label="Previous month">‹</button>
        <span aria-live="polite">{label}</span>
        <button type="button" className="icon" onClick={() => move(1)} aria-label="Next month">›</button>
      </div>
      <div className="cal-grid" role="grid">
        {DOW.map((d) => <span key={d} className="dow">{d}</span>)}
        {cells.map((c) => {
          const k = key(c.getUTCFullYear(), c.getUTCMonth(), c.getUTCDate());
          const other = c.getUTCMonth() !== view.m;
          const off = other || isDisabled(k);
          return (
            <button key={k} type="button" className={`day${k === value ? ' sel' : ''}${other ? ' other' : ''}`}
              disabled={off} aria-pressed={k === value} onClick={() => onChange(k)}>{c.getUTCDate()}</button>
          );
        })}
      </div>
    </div>
  );
}
