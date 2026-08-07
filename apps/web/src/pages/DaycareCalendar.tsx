import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchCalendar, type CalendarBooking, type CalendarResponse } from '../api';
import { NewBookingModal } from '../components/NewBookingModal';
import { Icon } from '../components/Icon';
import { CalendarSwitch, addDays, isoDate, weekStart } from '../components/CalendarSwitch';

const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/**
 * Daycare is a single-day service booked against group capacity, so it gets
 * day columns broken out by play group. Facilities that run one mixed group —
 * a common setup — see one group per day rather than empty columns.
 */
export function DaycareCalendar() {
  const [anchor, setAnchor] = useState(() => weekStart(new Date()));
  const [data, setData] = useState<CalendarResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bookingDate, setBookingDate] = useState<string | null>(null);

  const from = isoDate(anchor);
  const to = isoDate(addDays(anchor, 6));
  const today = isoDate(new Date());

  const load = useCallback(() => {
    setError(null);
    fetchCalendar(from, to)
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [from, to]);
  useEffect(load, [load]);

  const byDay = useMemo(() => {
    const m = new Map<string, CalendarBooking[]>();
    for (const b of data?.bookings ?? []) {
      if (b.serviceType !== 'daycare') continue;
      const list = m.get(b.startDate) ?? [];
      list.push(b);
      m.set(b.startDate, list);
    }
    return m;
  }, [data]);

  if (error) return <div className="hint error">Calendar failed to load: {error}</div>;

  const groups = data?.groups ?? [];
  const rangeLabel = `${anchor.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${addDays(anchor, 6).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;

  return (
    <>
      <div className="topbar">
        <h1>Daycare calendar</h1>
        <span className="date">Week of {rangeLabel}</span>
        <div className="right">
          <button className="btn ghost" onClick={() => setAnchor((a) => addDays(a, -7))} aria-label="Previous week">
            <Icon name="chevronLeft" size={15} />
          </button>
          <button className="btn ghost" onClick={() => setAnchor(weekStart(new Date()))}>This week</button>
          <button className="btn ghost" onClick={() => setAnchor((a) => addDays(a, 7))} aria-label="Next week">
            <Icon name="chevronRight" size={15} />
          </button>
          <button className="btn" onClick={() => setBookingDate(today)}>
            <Icon name="plus" size={15} />
            New booking
          </button>
        </div>
      </div>

      {bookingDate && (
        <NewBookingModal
          initialDate={bookingDate}
          onClose={() => setBookingDate(null)}
          onCreated={load}
        />
      )}

      <div className="content">
        <CalendarSwitch active="daycare" />

        {!data ? (
          <div className="hint">Loading daycare…</div>
        ) : groups.length === 0 ? (
          <div className="card">
            <div className="empty">
              <b>No play groups configured</b>
              <small>
                Daycare bookings need at least one group to go into. Add one in{' '}
                <Link to="/settings" className="linkish">Settings</Link>.
              </small>
            </div>
          </div>
        ) : (
          <div className="card">
            <div className="dc-scroll">
              <div className="dc" style={{ ['--groups' as string]: groups.length }}>
                <div className="dc-corner" />
                {groups.map((g) => (
                  <div key={g.id} className="dc-grouphd">
                    <b>{g.label}</b>
                    <small>cap {g.capacity}</small>
                  </div>
                ))}

                {Array.from({ length: 7 }, (_, i) => {
                  const date = isoDate(addDays(anchor, i));
                  const dt = new Date(date + 'T12:00:00');
                  const dayBookings = byDay.get(date) ?? [];
                  const unassigned = dayBookings.filter((b) => !b.runCode);
                  return (
                    <div key={date} className={`dc-rowgroup${date === today ? ' today' : ''}`}>
                      <button
                        type="button"
                        className="dc-dayhd"
                        onClick={() => setBookingDate(date)}
                        title={`New booking on ${date}`}
                      >
                        <span>{DOW[dt.getDay()]}</span>
                        <b>{dt.getDate()}</b>
                        <em>{dayBookings.length} dog{dayBookings.length === 1 ? '' : 's'}</em>
                      </button>

                      {groups.map((g) => {
                        const inGroup = dayBookings.filter((b) => b.runCode === g.code);
                        const pct = g.capacity
                          ? Math.round((inGroup.length / g.capacity) * 100)
                          : 0;
                        return (
                          <div key={g.id} className="dc-cell">
                            <div className="dc-count">
                              <b>{inGroup.length}</b>
                              <span className="dc-of">/ {g.capacity}</span>
                              <div className="meter">
                                <i
                                  className={pct >= 100 ? 'hot' : ''}
                                  style={{ width: `${Math.min(pct, 100)}%` }}
                                />
                              </div>
                            </div>
                            <div className="dc-dogs">
                              {inGroup.map((b) => (
                                <Link key={b.id} to={`/pets/${b.petId}`} className="dc-dog">
                                  <i style={{ background: b.avatarColor }} />
                                  {b.petName}
                                  {b.hasMeds && <em>Med</em>}
                                </Link>
                              ))}
                            </div>
                          </div>
                        );
                      })}

                      {unassigned.length > 0 && (
                        <div className="dc-unassigned">
                          <b>{unassigned.length} not yet in a group</b>
                          <span>{unassigned.map((b) => b.petName).join(', ')}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
