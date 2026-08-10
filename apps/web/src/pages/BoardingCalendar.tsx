import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchCalendar, type CalendarBooking, type CalendarResponse } from '../api';
import { NewBookingModal } from '../components/NewBookingModal';
import { Icon } from '../components/Icon';
import { CalendarSwitch, addDays, isoDate, weekStart } from '../components/CalendarSwitch';
import { facilityToday } from '../facility-time';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SPAN_DAYS = 14;

type Filter = 'all' | 'arriving' | 'departing' | 'meds';

/**
 * Boarding as a timeline: one row per stay, one bar spanning the nights it
 * covers. The previous day-column layout repeated the same dog in every column
 * it touched, so a 10-night stay printed ten times and the week read as a wall
 * of duplicate names. A bar says the same thing once.
 */
export function BoardingCalendar() {
  const [anchor, setAnchor] = useState(() => weekStart(new Date()));
  const [data, setData] = useState<CalendarResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bookingDate, setBookingDate] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');

  const from = isoDate(anchor);
  const to = isoDate(addDays(anchor, SPAN_DAYS - 1));
  const today = facilityToday();

  const load = useCallback(() => {
    setError(null);
    fetchCalendar(from, to)
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [from, to]);
  useEffect(load, [load]);

  const days = useMemo(
    () => Array.from({ length: SPAN_DAYS }, (_, i) => isoDate(addDays(anchor, i))),
    [anchor],
  );

  const stays = useMemo(() => {
    const all = (data?.bookings ?? []).filter((b) => b.serviceType === 'boarding');
    const q = query.trim().toLowerCase();
    return all.filter((b) => {
      if (q && !`${b.petName} ${b.clientName} ${b.runCode ?? ''}`.toLowerCase().includes(q)) {
        return false;
      }
      if (filter === 'arriving') return b.startDate >= today;
      if (filter === 'departing') return b.endDate >= today && b.endDate <= to;
      if (filter === 'meds') return b.hasMeds;
      return true;
    });
  }, [data, query, filter, today, to]);

  // Column index for a date, clamped to the visible window so a stay that
  // started before the window still renders from the left edge.
  const colOf = (date: string) => {
    const i = days.indexOf(date);
    if (i >= 0) return i;
    return date < days[0]! ? 0 : SPAN_DAYS;
  };

  if (error) return <div className="hint error">Calendar failed to load: {error}</div>;

  const rangeLabel = `${anchor.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${addDays(anchor, SPAN_DAYS - 1).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;

  return (
    <>
      <div className="topbar">
        <h1>Boarding calendar</h1>
        <span className="date">{rangeLabel}</span>
        <div className="right">
          <button className="btn ghost" onClick={() => setAnchor((a) => addDays(a, -7))} aria-label="Previous week">
            <Icon name="chevronLeft" size={15} />
          </button>
          <button className="btn ghost" onClick={() => setAnchor(weekStart(new Date()))}>Today</button>
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
        <CalendarSwitch active="boarding" />

        <div className="filterbar">
          <input
            className="date-input search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a pet, owner or run…"
            aria-label="Filter stays"
          />
          <div className="segmented small">
            {(['all', 'arriving', 'departing', 'meds'] as Filter[]).map((f) => (
              <button
                key={f}
                type="button"
                className={filter === f ? 'on' : ''}
                onClick={() => setFilter(f)}
              >
                {f === 'all' ? 'All' : f === 'meds' ? 'On meds' : f[0]!.toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
          <span className="filtercount">
            {stays.length} stay{stays.length === 1 ? '' : 's'}
          </span>
        </div>

        {!data ? (
          <div className="hint">Loading stays…</div>
        ) : stays.length === 0 ? (
          <div className="card">
            <div className="empty">
              <b>No stays match</b>
              <small>
                Nothing in this window fits the current filter. Clear the search or switch back
                to All.
              </small>
            </div>
          </div>
        ) : (
          <div className="card">
            <div className="tl-scroll">
              <div className="tl" style={{ ['--cols' as string]: SPAN_DAYS }}>
                <div className="tl-head">
                  <div className="tl-name">Pet</div>
                  {days.map((d) => {
                    const dt = new Date(d + 'T12:00:00');
                    const weekend = dt.getDay() === 0 || dt.getDay() === 6;
                    const dayData = data.days.find((x) => x.date === d);
                    const booked = (dayData?.boarding ?? 0) + (dayData?.pending ?? 0);
                    const pct = data.capacity.boarding
                      ? Math.round((booked / data.capacity.boarding) * 100)
                      : 0;
                    return (
                      <button
                        key={d}
                        type="button"
                        className={`tl-day${d === today ? ' today' : ''}${weekend ? ' weekend' : ''}`}
                        onClick={() => setBookingDate(d)}
                        title={`New booking on ${d}`}
                      >
                        <span className="tl-dow">{DOW[dt.getDay()]}</span>
                        <b>{dt.getDate()}</b>
                        <span className={`tl-cap${pct > 90 ? ' hot' : ''}`}>{booked}</span>
                      </button>
                    );
                  })}
                </div>

                {stays.map((s) => (
                  <StayRow key={s.id} stay={s} days={days} colOf={colOf} today={today} />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function StayRow({
  stay,
  days,
  colOf,
  today,
}: {
  stay: CalendarBooking;
  days: string[];
  colOf: (d: string) => number;
  today: string;
}) {
  const start = colOf(stay.startDate);
  // end_date is checkout day; the bar covers nights, so it stops there.
  const end = colOf(stay.endDate);
  const span = Math.max(1, end - start);
  const nights = Math.round(
    (new Date(stay.endDate).getTime() - new Date(stay.startDate).getTime()) / 86_400_000,
  );
  const state =
    stay.status === 'requested'
      ? 'pending'
      : stay.startDate === today
        ? 'arriving'
        : stay.endDate === today
          ? 'departing'
          : 'staying';

  return (
    <div className="tl-row">
      <div className="tl-name">
        <span className="av-sm" style={{ background: stay.avatarColor }}>
          {stay.petName[0]}
        </span>
        <span className="tl-who">
          <Link to={`/pets/${stay.petId}`} className="linkish">
            {stay.petName}
          </Link>
          <em>{stay.runCode ?? 'unassigned'}</em>
        </span>
        {stay.hasMeds && <span className="state-chip med">Med</span>}
      </div>
      <div className="tl-track">
        {days.map((d) => (
          <span key={d} className={`tl-cell${d === today ? ' today' : ''}`} />
        ))}
        <div
          className={`tl-bar ${state}`}
          style={{ gridColumn: `${start + 1} / span ${span}` }}
          title={`${stay.petName} · ${stay.startDate} → ${stay.endDate}`}
        >
          <span>
            {nights} nt{nights === 1 ? '' : 's'}
            {stay.status === 'requested' ? ' · request' : ''}
          </span>
        </div>
      </div>
    </div>
  );
}
