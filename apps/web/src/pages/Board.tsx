import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { checkIn, checkOut, fetchBoard, type BoardCell, type BoardOccupant } from '../api';

/** The one action this occupant can take right now, if any. */
function actionFor(o: BoardOccupant): 'Check in' | 'Check out' | null {
  const today = new Date().toISOString().slice(0, 10);
  if (o.status === 'requested' || o.status === 'confirmed') return 'Check in';
  if (o.status === 'checked_in' && (o.serviceType === 'daycare' || o.endDate === today))
    return 'Check out';
  return null;
}

function cellState(cell: BoardCell): 'open' | 'occ' | 'arr' | 'dep' {
  const o = cell.occupants[0];
  if (!o) return 'open';
  if (o.serviceType === 'boarding') {
    const today = new Date().toISOString().slice(0, 10);
    if (o.status === 'confirmed' && o.startDate === today) return 'arr';
    if (o.endDate === today) return 'dep';
    return 'occ';
  }
  return o.status === 'confirmed' ? 'arr' : 'occ';
}

function occupantLine(o: BoardOccupant): string {
  if (o.serviceType === 'daycare') return o.breed ?? 'daycare';
  if (o.nightNumber !== null && o.totalNights !== null && o.nightNumber >= 1) {
    return `${o.breed ?? ''} · night ${Math.min(o.nightNumber, o.totalNights)}/${o.totalNights}`;
  }
  return o.breed ?? '';
}

export function Board() {
  const [cells, setCells] = useState<BoardCell[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchBoard()
      .then((r) => setCells(r.cells))
      .catch((e: Error) => setError(e.message));
  }, []);
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

  const act = async (o: BoardOccupant) => {
    const action = actionFor(o);
    if (!action) return;
    if (action === 'Check out' && !window.confirm(`Check out ${o.petName}?`)) return;
    setBusy(o.bookingId);
    try {
      if (action === 'Check in') await checkIn(o.bookingId);
      else await checkOut(o.bookingId);
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
          {new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
          {' · '}
          {new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
        </span>
        <div className="right">
          <button className="btn ghost" onClick={load}>Refresh</button>
        </div>
      </div>
      <div className="content">
        <div className="board-legend">
          <span><i style={{ background: 'var(--p-primary)' }} />Occupied</span>
          <span><i style={{ background: 'var(--p-info)' }} />Arriving</span>
          <span><i style={{ background: 'var(--p-warm)' }} />Departing</span>
          <span><i style={{ border: '1.5px dashed #b8c4bc', background: 'transparent' }} />Open</span>
        </div>
        {zones.map(([zone, zoneCells]) => (
          <section key={zone} className="zone">
            <h2>{zone}</h2>
            <div className="runs">
              {zoneCells.map((cell) => {
                const state = cellState(cell);
                const o = cell.occupants[0];
                const isGroup = cell.run.kind === 'playgroup';
                const action = o ? actionFor(o) : null;
                return (
                  <div key={cell.run.id} className={`run ${state}`}>
                    <span className="id">{cell.run.code}</span>
                    {isGroup ? (
                      <>
                        <b>{cell.occupants.length} / {cell.run.capacity} dogs</b>
                        <small>
                          {cell.occupants.length === 0
                            ? 'no dogs yet'
                            : cell.occupants.slice(0, 3).map((x) => x.petName).join(', ') +
                              (cell.occupants.length > 3 ? ` +${cell.occupants.length - 3}` : '')}
                        </small>
                      </>
                    ) : o ? (
                      <>
                        <Link to={`/pets/${o.petId}`} className="runlink">
                          <b>{o.petName}</b>
                          <small>{occupantLine(o)}</small>
                        </Link>
                        {o.hasMeds && <span className="flag med">MED</span>}
                        {!o.hasMeds && o.isNewClient && <span className="flag new">NEW</span>}
                      </>
                    ) : (
                      <b>Open {cell.run.kind}</b>
                    )}
                    {o && action && (
                      <button
                        className="runact"
                        disabled={busy === o.bookingId}
                        onClick={() => act(o)}
                      >
                        {busy === o.bookingId ? '…' : action}
                      </button>
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
