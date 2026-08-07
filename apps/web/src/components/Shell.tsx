import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import type { TenantMeta } from '../api';

const links = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/board', label: 'Facility board' },
  { to: '/calendar', label: 'Calendar' },
  { to: '/clients', label: 'Clients & pets' },
];

export function Shell({ tenant, children }: { tenant: TenantMeta; children: ReactNode }) {
  return (
    <div className="shell">
      <aside className="side">
        <div className="logo">
          <span className="mark">{tenant.theme.logoInitials}</span>
          <b>{tenant.theme.appName}</b>
        </div>
        <nav>
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} className={({ isActive }) => (isActive ? 'on' : '')}>
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="spacer" />
        <div className="whoami">
          <span className="av">RK</span>
          <span>
            <b>Rosa Kim</b>
            <small>Owner · {tenant.name}</small>
          </span>
        </div>
      </aside>
      <div className="main">{children}</div>
    </div>
  );
}
