import { useState } from 'react';
import type { PortalData, PortalTab } from './PortalApp';
import { StayLogView } from './StayLogView';
import { facilityToday } from '../facility-time';

function fmt(iso: string): string {
  return new Date(iso + 'T12:00:00').toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export function PortalHome({
  data,
  onGo,
  reload,
}: {
  data: PortalData;
  onGo: (t: PortalTab) => void;
  reload: () => Promise<void>;
}) {
  const [openLog, setOpenLog] = useState<string | null>(null);
  const today = facilityToday();

  const inHouse = data.bookings.filter((b) => b.status === 'checked_in');
  const upcoming = data.bookings
    .filter((b) => b.status !== 'canceled' && b.startDate > today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const past = data.bookings
    .filter((b) => b.status === 'checked_out')
    .sort((a, b) => b.startDate.localeCompare(a.startDate));

  const urgent = data.alerts.filter((a) => a.expired || a.affectsStay);

  return (
    <div className="pt-page">
      {urgent.length > 0 && (
        <section className="pt-alert">
          <b>
            {urgent.length === 1 ? 'A vaccination needs attention' : 'Vaccinations need attention'}
          </b>
          <ul>
            {urgent.map((a) => (
              <li key={a.id}>
                <b>{a.petName}</b> · {a.vaccine}{' '}
                {a.expired
                  ? `expired ${Math.abs(a.daysLeft)} days ago`
                  : `expires ${fmt(a.expiresOn)}`}
                {a.affectsStay && <em> — during their booked stay</em>}
              </li>
            ))}
          </ul>
          <button className="pt-btn small" onClick={() => onGo('pets')}>
            Update records
          </button>
        </section>
      )}

      {inHouse.length > 0 && (
        <section className="pt-card hero">
          {inHouse.map((b) => (
            <div key={b.id} className="pt-hero-row">
              <Avatar name={b.petName} color={b.avatarColor} photo={b.photoUrl} size={54} />
              <div>
                <span className="pt-eyebrow">Here now</span>
                <h2>{b.petName} is with us</h2>
                <p>
                  {b.serviceType === 'boarding'
                    ? `Boarding until ${fmt(b.endDate)}`
                    : 'Here for daycare today'}
                  {b.runLabel ? ` · ${b.runLabel}` : b.runCode ? ` · ${b.runCode}` : ''}
                </p>
              </div>
              <button className="pt-btn small ghost" onClick={() => setOpenLog(b.id)}>
                See their day
              </button>
            </div>
          ))}
        </section>
      )}

      <section className="pt-card">
        <div className="pt-card-hd">
          <h3>Upcoming stays</h3>
          <button className="pt-link" onClick={() => onGo('reservations')}>
            Manage
          </button>
        </div>
        {upcoming.length === 0 ? (
          <div className="pt-empty">
            <b>Nothing booked yet</b>
            <small>Book a stay and it will show up here with everything you need.</small>
            <button className="pt-btn small" onClick={() => onGo('reservations')}>
              Book a stay
            </button>
          </div>
        ) : (
          <ul className="pt-list">
            {upcoming.slice(0, 4).map((b) => (
              <li key={b.id}>
                <Avatar name={b.petName} color={b.avatarColor} photo={b.photoUrl} />
                <span className="pt-list-main">
                  <b>{b.petName}</b>
                  <small>
                    {b.serviceType === 'boarding'
                      ? `${fmt(b.startDate)} → ${fmt(b.endDate)}`
                      : fmt(b.startDate)}
                  </small>
                </span>
                <StatusPill status={b.status} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {past.length > 0 && (
        <section className="pt-card">
          <div className="pt-card-hd">
            <h3>Past visits</h3>
          </div>
          <ul className="pt-list">
            {past.slice(0, 6).map((b) => (
              <li key={b.id}>
                <Avatar name={b.petName} color={b.avatarColor} photo={b.photoUrl} />
                <span className="pt-list-main">
                  <b>{b.petName}</b>
                  <small>
                    {b.serviceType === 'boarding'
                      ? `${fmt(b.startDate)} → ${fmt(b.endDate)}`
                      : fmt(b.startDate)}
                  </small>
                </span>
                <button className="pt-link" onClick={() => setOpenLog(b.id)}>
                  View log
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {openLog && <StayLogView bookingId={openLog} onClose={() => setOpenLog(null)} />}
      <button className="pt-refresh" onClick={() => void reload()}>
        Refresh
      </button>
    </div>
  );
}

export function Avatar({
  name,
  color,
  photo,
  size = 40,
}: {
  name: string;
  color: string;
  photo?: string | null;
  size?: number;
}) {
  return photo ? (
    <img className="pt-av" src={photo} alt="" width={size} height={size} style={{ width: size, height: size }} />
  ) : (
    <span
      className="pt-av fallback"
      style={{ background: color, width: size, height: size, fontSize: size * 0.4 }}
      aria-hidden="true"
    >
      {name[0]}
    </span>
  );
}

export function StatusPill({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    requested: ['pending', 'Awaiting confirmation'],
    confirmed: ['ok', 'Confirmed'],
    checked_in: ['ok', 'Here now'],
    checked_out: ['done', 'Complete'],
    canceled: ['off', 'Canceled'],
  };
  const [cls, label] = map[status] ?? ['off', status];
  return <span className={`pt-pill ${cls}`}>{label}</span>;
}
