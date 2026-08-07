import { NavLink } from 'react-router-dom';

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

/** Monday-start week containing `d`. */
export function weekStart(d: Date): Date {
  const out = new Date(d);
  const dow = out.getDay();
  out.setDate(out.getDate() - (dow === 0 ? 6 : dow - 1));
  out.setHours(12, 0, 0, 0);
  return out;
}

/**
 * Boarding and daycare are scheduled differently — multi-night stays against
 * kennel capacity versus single days against group capacity — so they get
 * separate views rather than one calendar trying to say both at once.
 */
export function CalendarSwitch({ active }: { active: 'boarding' | 'daycare' }) {
  return (
    <div className="calswitch" role="tablist" aria-label="Calendar type">
      <NavLink
        to="/calendar/boarding"
        role="tab"
        aria-selected={active === 'boarding'}
        className={active === 'boarding' ? 'on' : ''}
      >
        Boarding
      </NavLink>
      <NavLink
        to="/calendar/daycare"
        role="tab"
        aria-selected={active === 'daycare'}
        className={active === 'daycare' ? 'on' : ''}
      >
        Daycare
      </NavLink>
    </div>
  );
}
