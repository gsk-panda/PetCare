import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { ROLE_LABEL, staffLogout, type StaffUser, type TenantMeta } from '../api';
import { Icon, type IconName } from './Icon';

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  /** Omitted means every signed-in role sees it. */
  roles?: StaffUser['role'][];
}

const links: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
  { to: '/board', label: 'Facility board', icon: 'board' },
  { to: '/care', label: 'Care rounds', icon: 'care' },
  { to: '/calendar/boarding', label: 'Boarding', icon: 'calendar' },
  { to: '/calendar/daycare', label: 'Daycare', icon: 'daycare' },
  { to: '/clients', label: 'Clients & pets', icon: 'clients' },
  // Reading settings is fine for anyone; the API refuses writes from
  // non-managers, and hiding the link keeps the nav honest about that.
  { to: '/settings', label: 'Settings', icon: 'settings', roles: ['owner', 'manager'] },
];

function initials(staff: StaffUser): string {
  return `${staff.firstName[0] ?? ''}${staff.lastName[0] ?? ''}`.toUpperCase();
}

export function Shell({
  tenant,
  staff,
  onSignedOut,
  children,
}: {
  tenant: TenantMeta;
  staff: StaffUser;
  onSignedOut: () => void;
  children: ReactNode;
}) {
  const visible = links.filter((l) => !l.roles || l.roles.includes(staff.role));

  const signOut = async () => {
    await staffLogout();
    onSignedOut();
  };

  return (
    <div className="shell">
      <aside className="side">
        <div className="logo">
          <span className="mark">{tenant.theme.logoInitials}</span>
          <b>{tenant.theme.appName}</b>
        </div>
        <nav>
          {visible.map((l) => (
            <NavLink key={l.to} to={l.to} className={({ isActive }) => (isActive ? 'on' : '')}>
              <Icon name={l.icon} />
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="spacer" />
        <div className="whoami">
          <span className="av">{initials(staff)}</span>
          <span className="whoami-who">
            <b>{staff.name}</b>
            <small>{ROLE_LABEL[staff.role]}</small>
          </span>
          <button className="signout" onClick={signOut} title="Sign out" aria-label="Sign out">
            <Icon name="signout" size={15} />
          </button>
        </div>
      </aside>
      <div className="main">{children}</div>
    </div>
  );
}
