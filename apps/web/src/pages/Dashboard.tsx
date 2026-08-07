import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DashboardStats } from '@petcare/shared';
import { fetchBookings, fetchDashboard, type BookingRow } from '../api';

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function statusPill(b: BookingRow) {
  if (b.status === 'checked_in') return <span className="pill good">Checked in</span>;
  if (b.status === 'checked_out') return <span className="pill prim">Checked out</span>;
  if (b.status === 'requested') return <span className="pill warn">Review</span>;
  return <span className="pill info">Arriving</span>;
}

export function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [arrivals, setArrivals] = useState<BookingRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    Promise.all([fetchDashboard(), fetchBookings(today, today)])
      .then(([s, b]) => {
        setStats(s);
        setArrivals(b.bookings.filter((x) => x.startDate === today));
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <div className="hint error">Failed to load dashboard: {error}</div>;
  if (!stats) return <div className="hint">Loading dashboard…</div>;

  const pct = stats.occupancy.capacity
    ? Math.round((stats.occupancy.occupied / stats.occupancy.capacity) * 100)
    : 0;
  const maxWeek = Math.max(1, ...stats.next7Days.map((d) => d.boarding + d.daycare));
  const todayStr = new Date().toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  return (
    <>
      <div className="topbar">
        <h1>Good morning, Rosa</h1>
        <span className="date">{todayStr}</span>
        <div className="right">
          <button className="btn">+ New booking</button>
        </div>
      </div>
      <div className="content">
        <div className="tiles">
          <div className="tile">
            <div className="lbl">Occupancy</div>
            <div className="num">
              {stats.occupancy.occupied} / {stats.occupancy.capacity}
            </div>
            <div className="sub">
              {pct}% · {stats.occupancy.daycareOnly} daycare today
            </div>
            <div className="meter">
              <i className={pct > 90 ? 'hot' : ''} style={{ width: `${Math.min(pct, 100)}%` }} />
            </div>
          </div>
          <div className="tile">
            <div className="lbl">Arrivals today</div>
            <div className="num">{stats.arrivalsToday}</div>
            <div className="sub">boarding + daycare</div>
          </div>
          <div className="tile">
            <div className="lbl">Departures today</div>
            <div className="num">{stats.departuresToday}</div>
            <div className="sub">boarding checkouts</div>
          </div>
          <div className="tile">
            <div className="lbl">On the books</div>
            <div className="num">{stats.next7Days.reduce((n, d) => n + d.boarding + d.daycare, 0)}</div>
            <div className="sub">pet-days, next 7 days</div>
          </div>
        </div>

        <div className="cols">
          <div className="card">
            <div className="hd">
              <b>Today's arrivals</b>
              <span className="cnt">{arrivals.length}</span>
              <Link to="/board" style={{ marginLeft: 'auto', color: 'var(--p-primary)', fontWeight: 700, fontSize: 12.5 }}>
                Open board
              </Link>
            </div>
            {arrivals.length === 0 ? (
              <div className="hint">No arrivals scheduled today.</div>
            ) : (
              <table className="tbl">
                <thead>
                  <tr><th>Pet</th><th>Service</th><th>Run</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {arrivals.map((b) => (
                    <tr key={b.id}>
                      <td>
                        <div className="petcell">
                          <span className="pav" style={{ background: b.avatarColor }}>
                            {b.petName[0]}
                          </span>
                          <span>
                            <b>{b.petName}</b>
                            <small>{b.breed ?? '—'} · {b.clientName}</small>
                          </span>
                        </div>
                      </td>
                      <td>
                        {b.serviceType === 'boarding'
                          ? `Boarding · ${nights(b)} nights`
                          : 'Daycare'}
                      </td>
                      <td>{b.runCode ?? '—'}</td>
                      <td>{statusPill(b)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="card">
            <div className="hd"><b>Occupancy · next 7 days</b></div>
            <div className="week">
              {stats.next7Days.map((d, i) => {
                const total = d.boarding + d.daycare;
                const h = Math.round((total / maxWeek) * 100);
                const bPart = total ? (d.boarding / total) * 100 : 0;
                return (
                  <div key={d.date} className={`day${i === 0 ? ' today' : ''}`}>
                    <div className="stack" style={{ height: `${Math.max(h, 4)}%` }}>
                      <div className="bar-d" style={{ height: `${100 - bPart}%` }} />
                      <div className="bar-b" style={{ height: `${bPart}%` }} />
                    </div>
                    <small>{DOW[new Date(d.date + 'T12:00:00').getDay()]}</small>
                  </div>
                );
              })}
            </div>
            <div className="legend">
              <span><i style={{ background: 'var(--p-primary)' }} />Boarding</span>
              <span><i style={{ background: '#9cc3b8' }} />Daycare</span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function nights(b: BookingRow): number {
  return Math.round(
    (new Date(b.endDate).getTime() - new Date(b.startDate).getTime()) / 86_400_000,
  );
}
