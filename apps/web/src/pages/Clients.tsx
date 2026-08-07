import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchClients, type ClientRow } from '../api';

export function Clients() {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchClients()
      .then((r) => setClients(r.clients))
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <div className="hint error">Failed to load clients: {error}</div>;

  return (
    <>
      <div className="topbar">
        <h1>Clients &amp; pets</h1>
        <span className="date">{clients.length} households</span>
        <div className="right">
          <button className="btn">+ New client</button>
        </div>
      </div>
      <div className="content">
        <div className="card">
          <table className="tbl">
            <thead>
              <tr><th>Client</th><th>Pets</th><th>Phone</th><th>Balance</th></tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id}>
                  <td>
                    <b>{c.firstName} {c.lastName}</b>
                    {c.smsOptIn && <span className="pill prim" style={{ marginLeft: 8 }}>SMS</span>}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {c.pets.map((p) => (
                        <Link key={p.id} to={`/pets/${p.id}`} className="petcell">
                          <span className="pav" style={{ background: p.avatarColor, width: 24, height: 24, fontSize: 10 }}>
                            {p.name[0]}
                          </span>
                          <small className="linkish">{p.name}</small>
                        </Link>
                      ))}
                    </div>
                  </td>
                  <td>{c.phone ?? '—'}</td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {c.balanceCents > 0 ? (
                      <span style={{ color: 'var(--p-good)', fontWeight: 700 }}>
                        ${(c.balanceCents / 100).toFixed(2)} credit
                      </span>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
