import { useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
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

/**
 * What goes in the phone's bottom bar. The board and the care rounds are what
 * staff hold in one hand while holding a dog in the other; everything else can
 * live one tap deeper.
 */
const PHONE_PRIMARY: Array<[string, string]> = [
  ['/board', 'Board'],
  ['/care', 'Rounds'],
  ['/dashboard', 'Today'],
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
  const [moreOpen, setMoreOpen] = useState(false);
  const location = useLocation();

  const primary = PHONE_PRIMARY.map(([to, short]) => {
    const link = visible.find((l) => l.to === to);
    return link ? { ...link, short } : null;
  }).filter((l): l is NavItem & { short: string } => Boolean(l));
  const primaryPaths = PHONE_PRIMARY.map(([to]) => to);
  const secondary = visible.filter((l) => !primaryPaths.includes(l.to));
  const inSecondary = secondary.some((l) => location.pathname.startsWith(l.to));

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

      {/* Phone navigation. Hidden above the breakpoint, where the sidebar is
          already the better answer. */}
      <nav className="phonenav" aria-label="Sections">
        {primary.map((l) => (
          <NavLink key={l.to} to={l.to} className={({ isActive }) => (isActive ? 'on' : '')}>
            <Icon name={l.icon} size={19} />
            <span>{l.short}</span>
          </NavLink>
        ))}
        <button
          type="button"
          className={inSecondary ? 'on' : ''}
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen(true)}
        >
          <Icon name="settings" size={19} />
          <span>More</span>
        </button>
      </nav>

      {moreOpen && (
        <div className="phonemore-scrim" onClick={() => setMoreOpen(false)}>
          <div
            className="phonemore"
            role="dialog"
            aria-modal="true"
            aria-label="More sections"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="phonemore-who">
              <span className="av">{initials(staff)}</span>
              <span>
                <b>{staff.name}</b>
                <small>{ROLE_LABEL[staff.role]}</small>
              </span>
            </div>
            {secondary.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                onClick={() => setMoreOpen(false)}
                className={({ isActive }) => (isActive ? 'on' : '')}
              >
                <Icon name={l.icon} size={18} />
                {l.label}
              </NavLink>
            ))}
            <button type="button" className="phonemore-out" onClick={signOut}>
              <Icon name="signout" size={18} />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
