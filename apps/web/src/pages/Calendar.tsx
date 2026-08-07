import { useCallback, useEffect, useState } from 'react';
import { fetchCalendar, type BookingRow, type CalendarResponse } from '../api';

const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Monday-start week containing `d`. */
function weekStart(d: Date): Date {
  const out = new Date(d);
  const dow = out.getDay();
  out.setDate(out.getDate() - (dow === 0 ? 6 : dow - 1));
  out.setHours(12, 0, 0, 0);
  return out;
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

function nights(b: BookingRow): number {
  return Math.max(
    1,
    Math.round((new Date(b.endDate).getTime() - new Date(b.startDate).getTime()) / 86_400_000),
  );
}

/** Boarding occupies a day when start <= day < end; daycare only on its own day. */
function coversDay(b: BookingRow, day: string): boolean {
  if (b.serviceType === 'daycare') return b.startDate === day;
  return b.startDate <= day && b.endDate > day;
}

export function Calendar() {
  const [anchor, setAnchor] = useState(() => weekStart(new Date()));
  const [data, setData] = useState<CalendarResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const from = isoDate(anchor);
  const to = isoDate(addDays(anchor, 6));

  const load = useCallback(() => {
    setError(null);
    fetchCalendar(from, to)
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [from, to]);
  useEffect(load, [load]);

  const today = isoDate(new Date());

  if (error) return <div className="hint error">Calendar failed to load: {error}</div>;

  const rangeLabel = `${anchor.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${addDays(anchor, 6).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;

  return (
    <>
      <div className="topbar">
        <h1>Calendar</h1>
        <span className="date">Week of {rangeLabel}</span>
        <div className="right">
          <button className="btn ghost" onClick={() => setAnchor((a) => addDays(a, -7))}>
            ‹ Prev
          </button>
          <button className="btn ghost" onClick={() => setAnchor(weekStart(new Date()))}>
            This week
          </button>
          <button className="btn ghost" onClick={() => setAnchor((a) => addDays(a, 7))}>
            Next ›
          </button>
          <button className="btn">+ New booking</button>
        </div>
      </div>
      <div className="content">
        <div className="board-legend">
          <span><i style={{ background: 'var(--p-primary)' }} />Boarding</span>
          <span><i style={{ background: '#9cc3b8' }} />Daycare</span>
          <span><i style={{ border: '1.5px dashed var(--p-warn)', background: 'var(--p-warn-tint)' }} />Pending request</span>
        </div>

        {!data ? (
          <div className="hint">Loading calendar…</div>
        ) : (
          <div className="card">
            <div className="cal">
              {data.days.map((day) => {
                const date = new Date(day.date + 'T12:00:00');
                const dayBookings = data.bookings.filter((b) => coversDay(b, day.date));
                const boarding = dayBookings.filter(
                  (b) => b.serviceType === 'boarding' && b.status !== 'requested',
                );
                const daycare = dayBookings.filter((b) => b.serviceType === 'daycare');
                const pending = dayBookings.filter((b) => b.status === 'requested');
                const booked = day.boarding + day.pending;
                const pct = data.capacity.boarding
                  ? Math.round((booked / data.capacity.boarding) * 100)
                  : 0;
                return (
                  <div key={day.date} className={`col${day.date === today ? ' today' : ''}`}>
                    <div className="dh">
                      {DOW[date.getDay()]}
                      <b>{date.getDate()}</b>
                    </div>

                    {boarding.slice(0, 3).map((b) => (
                      <div key={b.id} className="evt b">
                        {b.petName}
                        <small>
                          {b.runCode ? `${b.runCode} · ` : ''}
                          {nights(b)} nt{nights(b) === 1 ? '' : 's'}
                        </small>
                      </div>
                    ))}
                    {boarding.length > 3 && (
                      <div className="evt b more">+{boarding.length - 3} more boarding</div>
                    )}

                    {daycare.length > 0 && (
                      <div className="evt d">
                        Daycare · {daycare.length}
                        <small>{daycare.map((b) => b.petName).join(', ')}</small>
                      </div>
                    )}

                    {pending.map((b) => (
                      <div key={b.id} className="evt hold">
                        Request · {b.petName}
                        <small>{b.clientName} · review</small>
                      </div>
                    ))}

                    <div className="capline">
                      {booked} / {data.capacity.boarding} booked
                      <div className="meter">
                        <i
                          className={pct > 90 ? 'hot' : ''}
                          style={{ width: `${Math.min(pct, 100)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
