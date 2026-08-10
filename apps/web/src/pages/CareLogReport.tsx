import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { CareTask } from '@petcare/shared';
import { fetchCareLog, type CareLogReport as Report } from '../api';
import { Icon } from '../components/Icon';
import { facilityToday, isoDate } from '../facility-time';


function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function toCsv(report: Report): string {
  const header = ['Date', 'Run', 'Pet', 'Round', 'Type', 'Medication', 'Detail', 'Status', 'Given at', 'Given by'];
  const rows = report.pets.flatMap((p) =>
    p.tasks.map((t) => [
      report.date,
      p.runCode ?? '',
      p.petName,
      t.slot,
      t.type,
      t.subject ?? '',
      t.detail,
      t.done ? 'Given' : 'Not given',
      t.doneAt ? new Date(t.doneAt).toLocaleTimeString() : '',
      t.doneBy ?? '',
    ]),
  );
  return [header, ...rows].map((r) => r.map((c) => csvCell(String(c))).join(',')).join('\r\n');
}

function statusPill(t: CareTask) {
  if (t.done) return <span className="pill good">Given</span>;
  return t.type === 'medication' ? (
    <span className="pill bad">Missed dose</span>
  ) : (
    <span className="pill warn">Not given</span>
  );
}

export function CareLogReport() {
  const [date, setDate] = useState(facilityToday());
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchCareLog(date)
      .then(setReport)
      .catch((e: Error) => setError(e.message));
  }, [date]);
  useEffect(load, [load]);

  const download = () => {
    if (!report) return;
    const blob = new Blob([toCsv(report)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `care-log-${report.date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const s = report?.summary;
  const medsMissed = s ? s.medicationsScheduled - s.medicationsGiven : 0;

  return (
    <>
      <div className="topbar no-print">
        <h1>Daily care log</h1>
        <input
          className="date-input"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          aria-label="Report date"
        />
        <div className="right">
          <Link to="/care" className="btn ghost">Back to rounds</Link>
          <button className="btn ghost" onClick={download} disabled={!report}>
            <Icon name="download" size={15} />
            Export CSV
          </button>
          <button className="btn" onClick={() => window.print()} disabled={!report}>
            <Icon name="print" size={15} />
            Print
          </button>
        </div>
      </div>

      <div className="content">
        {error && <div className="form-error">{error}</div>}

        <div className="print-head">
          <h2>Feeding &amp; medication log</h2>
          <p>
            Cedar Creek Pet Lodge ·{' '}
            {new Date(date + 'T12:00:00').toLocaleDateString(undefined, {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </p>
        </div>

        {!report ? (
          <div className="hint">Loading report…</div>
        ) : report.pets.length === 0 ? (
          <div className="hint">No scheduled care for this date.</div>
        ) : (
          <>
            <div className="tiles">
              <div className="tile">
                <div className="lbl">Pets in care</div>
                <div className="num">{s!.pets}</div>
              </div>
              <div className="tile">
                <div className="lbl">Meals given</div>
                <div className="num">
                  {s!.feedingsGiven} / {s!.feedingsScheduled}
                </div>
              </div>
              <div className="tile">
                <div className="lbl">Doses given</div>
                <div className="num">
                  {s!.medicationsGiven} / {s!.medicationsScheduled}
                </div>
              </div>
              <div className="tile">
                <div className="lbl">Missed doses</div>
                <div
                  className="num"
                  style={{ color: medsMissed ? 'var(--p-bad)' : 'var(--p-good)' }}
                >
                  {medsMissed}
                </div>
              </div>
            </div>

            <div className="card">
              <table className="tbl report">
                <thead>
                  <tr>
                    <th>Run</th>
                    <th>Pet</th>
                    <th>Round</th>
                    <th>Care</th>
                    <th>Status</th>
                    <th>Given</th>
                  </tr>
                </thead>
                <tbody>
                  {report.pets.map((p) =>
                    p.tasks.map((t, i) => (
                      <tr key={`${p.petId}-${t.slot}-${t.type}-${t.subject ?? ''}`}>
                        <td>{i === 0 ? (p.runCode ?? '—') : ''}</td>
                        <td>{i === 0 ? <b>{p.petName}</b> : ''}</td>
                        <td>{t.slot}</td>
                        <td>
                          {t.type === 'medication' ? (
                            <>
                              <b>{t.subject}</b>
                              <small style={{ display: 'block', color: 'var(--p-ink-soft)' }}>
                                {t.detail}
                              </small>
                            </>
                          ) : (
                            <>
                              Feeding
                              <small style={{ display: 'block', color: 'var(--p-ink-soft)' }}>
                                {t.detail}
                              </small>
                            </>
                          )}
                        </td>
                        <td>{statusPill(t)}</td>
                        <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {t.doneAt
                            ? `${new Date(t.doneAt).toLocaleTimeString(undefined, {
                                hour: 'numeric',
                                minute: '2-digit',
                              })}${t.doneBy ? ` · ${t.doneBy}` : ''}`
                            : '—'}
                        </td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </>
  );
}
