import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchCalendar, moveToPlayGroup, type CalendarBooking, type CalendarResponse } from '../api';
import { NewBookingModal } from '../components/NewBookingModal';
import { Icon } from '../components/Icon';
import { CalendarSwitch, addDays, isoDate, weekStart } from '../components/CalendarSwitch';
import { facilityToday } from '../facility-time';
import { GROUP_DRAG_TYPE, readGroupDrag, writeGroupDrag } from '../components/group-dnd';

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
  const [dragging, setDragging] = useState<{
    bookingId: string;
    petName: string;
    fromRunId: string | null;
    date: string;
  } | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [moved, setMoved] = useState<string | null>(null);

  const from = isoDate(anchor);
  const to = isoDate(addDays(anchor, 6));
  const today = facilityToday();

  const load = useCallback(() => {
    setError(null);
    fetchCalendar(from, to)
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [from, to]);
  useEffect(load, [load]);

  const moveDog = async (bookingId: string, runId: string, petName: string, toLabel: string) => {
    setBusy(bookingId);
    setError(null);
    setMoved(null);
    try {
      await moveToPlayGroup(bookingId, runId);
      setMoved(`${petName} moved to ${toLabel}`);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
      setDragging(null);
      setDragOver(null);
    }
  };

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

        {moved && <div className="delta-note">{moved}</div>}

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
                        const full = inGroup.length >= g.capacity;
                        const dropId = `${date}:${g.id}`;
                        return (
                          <div
                            key={g.id}
                            className={`dc-cell${dragOver === dropId ? ' dropping' : ''}`}
                            onDragOver={(e) => {
                              if (full || !e.dataTransfer.types.includes(GROUP_DRAG_TYPE)) return;
                              e.preventDefault();
                              setDragOver(dropId);
                            }}
                            onDragLeave={() =>
                              setDragOver((v) => (v === dropId ? null : v))
                            }
                            onDrop={(e) => {
                              e.preventDefault();
                              setDragOver(null);
                              const payload = readGroupDrag(e.dataTransfer);
                              if (!payload || payload.fromRunId === g.id) return;
                              // A dog attends the day it was booked for. Moving
                              // it into another day's column would silently
                              // rewrite that, so those drops are refused.
                              if (payload.date !== date) return;
                              void moveDog(payload.bookingId, g.id, payload.petName, g.label);
                            }}
                          >
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
                              {inGroup.map((b) => {
                                const movable = b.status !== 'checked_out' && b.status !== 'canceled';
                                return (
                                  <span
                                    key={b.id}
                                    className={`dc-dog${dragging?.bookingId === b.id ? ' lifting' : ''}`}
                                    draggable={movable}
                                    onDragStart={(e) => {
                                      const payload = {
                                        bookingId: b.id,
                                        petName: b.petName,
                                        fromRunId: g.id,
                                        date,
                                      };
                                      writeGroupDrag(e.dataTransfer, payload);
                                      setDragging(payload);
                                    }}
                                    onDragEnd={() => {
                                      setDragging(null);
                                      setDragOver(null);
                                    }}
                                  >
                                    <Link to={`/pets/${b.petId}`} className="dc-dogname">
                                      <i style={{ background: b.avatarColor }} />
                                      {b.petName}
                                    </Link>
                                    {b.hasMeds && <em>Med</em>}
                                    {movable && groups.length > 1 && (
                                      <select
                                        className="gmove"
                                        value=""
                                        disabled={busy === b.id}
                                        aria-label={`Move ${b.petName} to another group`}
                                        onChange={(ev) => {
                                          const target = groups.find((x) => x.id === ev.target.value);
                                          if (target) {
                                            void moveDog(b.id, target.id, b.petName, target.label);
                                          }
                                        }}
                                      >
                                        {/* The dog's current group is the column
                                            it is sitting in, so repeating it on
                                            every chip is noise. Only somewhere
                                            else to go is worth listing. */}
                                        <option value="">Move…</option>
                                        {groups
                                          .filter((other) => other.id !== g.id)
                                          .map((other) => {
                                            const otherFull =
                                              dayBookings.filter((x) => x.runCode === other.code)
                                                .length >= other.capacity;
                                            return (
                                              <option key={other.id} value={other.id} disabled={otherFull}>
                                                {other.label}
                                                {otherFull ? ' (full)' : ''}
                                              </option>
                                            );
                                          })}
                                      </select>
                                    )}
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}

                      {unassigned.length > 0 && (
                        <div className="dc-unassigned">
                          <b>{unassigned.length} not yet in a group</b>
                          {/* Portal requests land here. Placing one is the same
                              gesture as moving a dog already in a group. */}
                          <div className="dc-dogs">
                            {unassigned.map((b) => (
                              <span
                                key={b.id}
                                className={`dc-dog pending${dragging?.bookingId === b.id ? ' lifting' : ''}`}
                                draggable
                                onDragStart={(e) => {
                                  const payload = {
                                    bookingId: b.id,
                                    petName: b.petName,
                                    fromRunId: null,
                                    date,
                                  };
                                  writeGroupDrag(e.dataTransfer, payload);
                                  setDragging(payload);
                                }}
                                onDragEnd={() => {
                                  setDragging(null);
                                  setDragOver(null);
                                }}
                              >
                                <Link to={`/pets/${b.petId}`} className="dc-dogname">
                                  <i style={{ background: b.avatarColor }} />
                                  {b.petName}
                                </Link>
                                <select
                                  className="gmove"
                                  value=""
                                  disabled={busy === b.id}
                                  aria-label={`Put ${b.petName} in a group`}
                                  onChange={(ev) => {
                                    const target = groups.find((x) => x.id === ev.target.value);
                                    if (target) {
                                      void moveDog(b.id, target.id, b.petName, target.label);
                                    }
                                  }}
                                >
                                  <option value="">Place…</option>
                                  {groups.map((other) => {
                                    const otherFull =
                                      dayBookings.filter((x) => x.runCode === other.code).length >=
                                      other.capacity;
                                    return (
                                      <option key={other.id} value={other.id} disabled={otherFull}>
                                        {other.label}
                                        {otherFull ? ' (full)' : ''}
                                      </option>
                                    );
                                  })}
                                </select>
                              </span>
                            ))}
                          </div>
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
