import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { checkOut, fetchBoard, type BoardCell, type BoardOccupant } from '../api';
import { CheckInPanel } from '../components/CheckInPanel';
import { Icon } from '../components/Icon';

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function shiftDate(iso: string, days: number): string {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return isoDate(d);
}

/**
 * The one action this occupant can take right now, if any. Only offered on
 * today's board: you cannot check a dog in yesterday, and offering the button
 * on a future day would just produce a 409 from the server.
 */
function actionFor(o: BoardOccupant, viewing: string): 'Check in' | 'Check out' | null {
  const today = isoDate(new Date());
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
  const today = isoDate(new Date());
  const [date, setDate] = useState(today);
  const [cells, setCells] = useState<BoardCell[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [checkingIn, setCheckingIn] = useState<{
    occupant: BoardOccupant;
    runCode: string;
  } | null>(null);

  const load = useCallback(() => {
    setError(null);
    fetchBoard(date)
      .then((r) => setCells(r.cells))
      .catch((e: Error) => setError(e.message));
  }, [date]);
  useEffect(load, [load]);

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
    if (!window.confirm(`Check out ${o.petName}?`)) return;
    setBusy(o.bookingId);
    try {
      await checkOut(o.bookingId);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
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
      {checkingIn && (
        <CheckInPanel
          occupant={checkingIn.occupant}
          runCode={checkingIn.runCode}
          onClose={() => setCheckingIn(null)}
          onCheckedIn={load}
        />
      )}
      <div className="content">
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
                  return (
                    <div key={cell.run.id} className="run group">
                      <div className="group-hd">
                        <span className="id">{cell.run.label}</span>
                        <b>
                          {cell.occupants.length} / {cell.run.capacity} dogs
                        </b>
                      </div>
                      {cell.occupants.length === 0 ? (
                        <small>No dogs in this group today</small>
                      ) : (
                        <div className="grouplist">
                          {cell.occupants.map((g) => {
                            const gAction = actionFor(g, date);
                            return (
                              <span key={g.bookingId} className="gchip">
                                <Link to={`/pets/${g.petId}`} className="gname">
                                  <i style={{ background: g.avatarColor }} />
                                  {g.petName}
                                </Link>
                                {g.hasMeds && <em className="gmed">Med</em>}
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
                        {!cell.occupants[0]?.hasMeds && cell.occupants[0]?.isNewClient && (
                          <span className="state-chip new">New</span>
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
                            {action && (
                              <button
                                className="runact"
                                disabled={busy === o.bookingId}
                                onClick={() => act(o, cell.run.code)}
                              >
                                {busy === o.bookingId ? '…' : action}
                              </button>
                            )}
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
