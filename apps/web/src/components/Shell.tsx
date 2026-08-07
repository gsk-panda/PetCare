import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import type { TenantMeta } from '../api';
import { Icon, type IconName } from './Icon';

const links: Array<{ to: string; label: string; icon: IconName }> = [
  { to: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
  { to: '/board', label: 'Facility board', icon: 'board' },
  { to: '/care', label: 'Care rounds', icon: 'care' },
  { to: '/calendar/boarding', label: 'Boarding', icon: 'calendar' },
  { to: '/calendar/daycare', label: 'Daycare', icon: 'daycare' },
  { to: '/clients', label: 'Clients & pets', icon: 'clients' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
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
              <Icon name={l.icon} />
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
