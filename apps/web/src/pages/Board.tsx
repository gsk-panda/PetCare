import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchBoard, moveToPlayGroup, type BoardCell, type BoardOccupant } from '../api';
import { CheckInPanel } from '../components/CheckInPanel';
import { CheckOutPanel } from '../components/CheckOutPanel';
import { StayDatesPanel } from '../components/StayDatesPanel';
import { Icon } from '../components/Icon';
import { facilityToday, shiftDate } from '../facility-time';
import { GROUP_DRAG_TYPE, readGroupDrag, writeGroupDrag } from '../components/group-dnd';

/**
 * The one action this occupant can take right now, if any. Only offered on
 * today's board: you cannot check a dog in yesterday, and offering the button
 * on a future day would just produce a 409 from the server.
 */
function actionFor(o: BoardOccupant, viewing: string): 'Check in' | 'Check out' | null {
  const today = facilityToday();
  if (viewing !== today) return null;
  if (o.status === 'requested' || o.status === 'confirmed') return 'Check in';
  if (o.status === 'checked_in' && (o.serviceType === 'daycare' || o.endDate === today))
    return 'Check out';
  return null;
}

/** State is relative to the day being viewed, not to today. */
function cellState(cell: BoardCell, viewing: string): 'open' | 'occ' | 'arr' | 'dep' {
  const o = cell.occupants[0];
  if (!o) return 'open';
  if (o.serviceType === 'boarding') {
    if (o.startDate === viewing) return 'arr';
    if (o.endDate === viewing) return 'dep';
    return 'occ';
  }
  return o.status === 'confirmed' || o.status === 'requested' ? 'arr' : 'occ';
}

function occupantLine(o: BoardOccupant): string {
  if (o.serviceType === 'daycare') return o.breed ?? 'daycare';
  if (o.nightNumber !== null && o.totalNights !== null && o.nightNumber >= 1) {
    return `${o.breed ?? ''} · night ${Math.min(o.nightNumber, o.totalNights)}/${o.totalNights}`;
  }
  return o.breed ?? '';
}

export function Board() {
  const today = facilityToday();
  const [date, setDate] = useState(today);
  const [cells, setCells] = useState<BoardCell[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [checkingIn, setCheckingIn] = useState<{
    occupant: BoardOccupant;
    runCode: string;
  } | null>(null);
  const [checkingOut, setCheckingOut] = useState<string | null>(null);
  const [dragging, setDragging] = useState<{
    bookingId: string;
    petName: string;
    fromRunId: string | null;
    date: string;
  } | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [moved, setMoved] = useState<string | null>(null);
  const [editingDates, setEditingDates] = useState<{
    occupant: BoardOccupant;
    runLabel: string;
  } | null>(null);

  const load = useCallback(() => {
    setError(null);
    fetchBoard(date)
      .then((r) => setCells(r.cells))
      .catch((e: Error) => setError(e.message));
  }, [date]);
  useEffect(load, [load]);

  // Every play group on the board, so a chip can offer the others.
  const groups = useMemo(() => cells.filter((c) => c.run.kind === 'playgroup'), [cells]);

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

  const zones = useMemo(() => {
    const m = new Map<string, BoardCell[]>();
    for (const c of cells) {
      const list = m.get(c.run.zone) ?? [];
      list.push(c);
      m.set(c.run.zone, list);
    }
    return [...m.entries()];
  }, [cells]);

  // Check-in opens the drop-off checklist; check-out is a single confirm.
  const act = async (o: BoardOccupant, runCode: string) => {
    const action = actionFor(o, date);
    if (!action) return;
    if (action === 'Check in') {
      setCheckingIn({ occupant: o, runCode });
      return;
    }
    // Check-out now settles the bill, so it opens the invoice rather than
    // closing the stay behind a confirm dialog.
    setCheckingOut(o.bookingId);
  };

  if (error) return <div className="hint error">Board failed to load: {error}</div>;

  return (
    <>
      <div className="topbar">
        <h1>Facility board</h1>
        <span className="date">
          {new Date(date + 'T12:00:00').toLocaleDateString(undefined, {
            weekday: 'long',
            month: 'short',
            day: 'numeric',
          })}
          {date === today && ' · today'}
        </span>
        <div className="right">
          <button
            className="btn ghost"
            onClick={() => setDate((d) => shiftDate(d, -1))}
            aria-label="Previous day"
          >
            <Icon name="chevronLeft" size={15} />
          </button>
          <input
            className="date-input"
            type="date"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            aria-label="Board date"
          />
          <button
            className="btn ghost"
            onClick={() => setDate((d) => shiftDate(d, 1))}
            aria-label="Next day"
          >
            <Icon name="chevronRight" size={15} />
          </button>
          {date !== today && (
            <button className="btn ghost" onClick={() => setDate(today)}>
              Today
            </button>
          )}
          <button className="btn ghost" onClick={load}>
            <Icon name="refresh" size={15} />
            Refresh
          </button>
        </div>
      </div>
      {checkingOut && (
        <CheckOutPanel
          bookingId={checkingOut}
          onClose={() => setCheckingOut(null)}
          onDone={load}
        />
      )}
      {editingDates && (
        <StayDatesPanel
          occupant={editingDates.occupant}
          runLabel={editingDates.runLabel}
          onClose={() => setEditingDates(null)}
          onSaved={load}
        />
      )}
      {checkingIn && (
        <CheckInPanel
          occupant={checkingIn.occupant}
          runCode={checkingIn.runCode}
          onClose={() => setCheckingIn(null)}
          onCheckedIn={load}
        />
      )}
      <div className="content">
        {moved && <div className="delta-note">{moved}</div>}
        <div className="board-legend">
          <span><i style={{ background: 'var(--surface)', boxShadow: 'inset 0 0 0 1px var(--line-strong)' }} />Occupied</span>
          <span><i style={{ background: 'var(--info-bg)', boxShadow: 'inset 0 0 0 1px var(--info)' }} />Arriving</span>
          <span><i style={{ background: 'var(--warn-bg)', boxShadow: 'inset 0 0 0 1px var(--warn)' }} />Departing</span>
          <span><i style={{ border: '1.5px dashed var(--line-strong)', background: 'transparent' }} />Open</span>
        </div>
        {zones.map(([zone, zoneCells]) => (
          <section key={zone} className="zone">
            <h2>{zone}</h2>
            <div className="runs">
              {zoneCells.map((cell) => {
                const state = cellState(cell, date);
                const isGroup = cell.run.kind === 'playgroup';

                // Play groups hold many dogs, so they get a full-width cell
                // listing every occupant rather than a truncated summary.
                if (isGroup) {
                  const full = cell.occupants.length >= cell.run.capacity;
                  return (
                    <div
                      key={cell.run.id}
                      className={`run group${dragOver === cell.run.id ? ' dropping' : ''}`}
                      onDragOver={(e) => {
                        // Read the drag payload from the event, not from React
                        // state: state set in onDragStart has not flushed by
                        // the first dragover, and gating preventDefault on it
                        // means the browser refuses the drop entirely.
                        if (full || !e.dataTransfer.types.includes(GROUP_DRAG_TYPE)) return;
                        e.preventDefault();
                        setDragOver(cell.run.id);
                      }}
                      onDragLeave={() => setDragOver((v) => (v === cell.run.id ? null : v))}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDragOver(null);
                        const payload = readGroupDrag(e.dataTransfer);
                        if (!payload || payload.fromRunId === cell.run.id) return;
                        if (payload.date !== date) return;
                        void moveDog(payload.bookingId, cell.run.id, payload.petName, cell.run.label);
                      }}
                    >
                      <div className="group-hd">
                        <span className="id">{cell.run.label}</span>
                        <b>
                          {cell.occupants.length} / {cell.run.capacity} dogs
                        </b>
                      </div>
                      {cell.occupants.length === 0 ? (
                        <small>{dragging ? 'Drop a dog here' : 'No dogs in this group today'}</small>
                      ) : (
                        <div className="grouplist">
                          {cell.occupants.map((g) => {
                            const gAction = actionFor(g, date);
                            const movable = g.status !== 'checked_out' && g.status !== 'canceled';
                            return (
                              <span
                                key={g.bookingId}
                                className={`gchip${dragging?.bookingId === g.bookingId ? ' lifting' : ''}`}
                                draggable={movable}
                                onDragStart={(e) => {
                                  const payload = {
                                    bookingId: g.bookingId,
                                    petName: g.petName,
                                    fromRunId: cell.run.id,
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
                                <Link to={`/pets/${g.petId}`} className="gname">
                                  <i style={{ background: g.avatarColor }} />
                                  {g.petName}
                                </Link>
                                {g.hasMeds && <em className="gmed">Med</em>}
                                {/* Dragging is not available on a phone, and the
                                    board is used on one. The picker is the way
                                    that always works; the drag is the shortcut. */}
                                {movable && groups.length > 1 && (
                                  <select
                                    className="gmove"
                                    value=""
                                    disabled={busy === g.bookingId}
                                    aria-label={`Move ${g.petName} to another group`}
                                    onChange={(e) =>
                                      void moveDog(
                                        g.bookingId,
                                        e.target.value,
                                        g.petName,
                                        groups.find((x) => x.run.id === e.target.value)?.run.label ?? '',
                                      )
                                    }
                                  >
                                    {/* The dog's current group is the cell it is
                                        sitting in, so listing it again is noise.
                                        Only somewhere else to go is useful. */}
                                    <option value="">Move…</option>
                                    {groups
                                      .filter((other) => other.run.id !== cell.run.id)
                                      .map((other) => (
                                        <option
                                          key={other.run.id}
                                          value={other.run.id}
                                          disabled={other.occupants.length >= other.run.capacity}
                                        >
                                          {other.run.label}
                                          {other.occupants.length >= other.run.capacity ? ' (full)' : ''}
                                        </option>
                                      ))}
                                  </select>
                                )}
                                {gAction && (
                                  <button
                                    className="gact"
                                    disabled={busy === g.bookingId}
                                    onClick={() => act(g, cell.run.code)}
                                    title={`${gAction} ${g.petName}`}
                                  >
                                    {busy === g.bookingId ? '…' : gAction === 'Check in' ? 'In' : 'Out'}
                                  </button>
                                )}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                }

                return (
                  <div key={cell.run.id} className={`run ${state}`}>
                    <span className="id">
                      {cell.run.code}
                      <span className="chips">
                        {cell.occupants[0]?.hasMeds && <span className="state-chip med">Med</span>}
                        {cell.occupants[0]?.isFirstStay && (
                          <span className="state-chip first" title="First stay with us">1st</span>
                        )}
                        {state === 'arr' && <span className="state-chip arr">In</span>}
                        {state === 'dep' && <span className="state-chip dep">Out</span>}
                      </span>
                    </span>
                    {cell.occupants.length === 0 ? (
                      <b>Open {cell.run.kind}</b>
                    ) : (
                      cell.occupants.map((o) => {
                        const action = actionFor(o, date);
                        return (
                          <div key={o.bookingId} className="occ-entry">
                            <Link to={`/pets/${o.petId}`} className="runlink">
                              <b>{o.petName}</b>
                              <small>{occupantLine(o)}</small>
                            </Link>
                            <div className="runacts">
                              {action && (
                                <button
                                  className="runact"
                                  disabled={busy === o.bookingId}
                                  onClick={() => act(o, cell.run.code)}
                                >
                                  {busy === o.bookingId ? '…' : action}
                                </button>
                              )}
                              {o.status !== 'checked_out' && (
                                <button
                                  className="runact ghost"
                                  onClick={() =>
                                    setEditingDates({ occupant: o, runLabel: cell.run.label })
                                  }
                                >
                                  Dates
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
