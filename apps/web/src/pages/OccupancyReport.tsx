import { useCallback, useEffect, useState } from 'react';
import { fetchOccupancyReport, type OccupancyReport as Report } from '../api';
import { ReportShell, RangePicker, downloadCsv, toCsv } from '../components/ReportShell';
import { facilityToday, shiftDate } from '../facility-time';

function pct(bps: number): string {
  return `${(bps / 100).toFixed(1)}%`;
}

function weekday(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export function OccupancyReport() {
  const today = facilityToday();
  const [from, setFrom] = useState(shiftDate(today, -29));
  const [to, setTo] = useState(today);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    fetchOccupancyReport(from, to)
      .then(setReport)
      .catch((e: Error) => setError(e.message));
  }, [from, to]);
  useEffect(load, [load]);

  const exportCsv = () => {
    if (!report) return;
    downloadCsv(
      `occupancy-${report.from}-to-${report.to}.csv`,
      toCsv(
        ['Date', 'Boarding', 'Boarding capacity', 'Utilisation %', 'Daycare', 'Daycare capacity'],
        report.days.map((d) => [
          d.date,
          d.boarding,
          d.boardingCapacity,
          (d.utilisationBps / 100).toFixed(1),
          d.daycare,
          d.daycareCapacity,
        ]),
      ),
    );
  };

  const peak = report ? Math.max(1, ...report.days.map((d) => d.boardingCapacity)) : 1;

  return (
    <ReportShell
      title="Occupancy"
      covering={report ? `${report.days.length} days` : ''}
      controls={
        <RangePicker
          from={from}
          to={to}
          onChange={(f, t) => {
            setFrom(f);
            setTo(t);
          }}
        />
      }
      onExport={exportCsv}
    >
      {error && <div className="hint error">{error}</div>}
      {!report ? (
        <div className="hint">Working it out…</div>
      ) : (
        <>
          <div className="tiles">
            <div className="tile">
              <div className="lbl">Utilisation</div>
              <div className="num">{pct(report.totals.utilisationBps)}</div>
              <div className="sub">of boarding capacity, across the range</div>
            </div>
            <div className="tile">
              <div className="lbl">Boarding nights</div>
              <div className="num">{report.totals.boardingNights}</div>
              <div className="sub">of {report.totals.capacityNights} available</div>
            </div>
            <div className="tile">
              <div className="lbl">Daycare days</div>
              <div className="num">{report.totals.daycareDays}</div>
              <div className="sub">dogs across all groups</div>
            </div>
            <div className="tile">
              <div className="lbl">Busiest night</div>
              <div className="num" style={{ fontSize: 'var(--t-lg)' }}>
                {report.totals.busiestDate ? weekday(report.totals.busiestDate) : '—'}
              </div>
              <div className="sub">most runs filled</div>
            </div>
          </div>

          <div className="card">
            <div className="hd">
              <b>Night by night</b>
              <span className="cnt">{report.days.length} days</span>
            </div>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Boarding</th>
                  <th style={{ width: '38%' }}>Filled</th>
                  <th>Daycare</th>
                </tr>
              </thead>
              <tbody>
                {report.days.map((d) => (
                  <tr key={d.date}>
                    <td>{weekday(d.date)}</td>
                    <td>
                      {d.boarding} / {d.boardingCapacity}
                    </td>
                    <td>
                      {/* A bar rather than a number alone: the shape of a month
                          is the thing an owner actually reads off this. */}
                      <span className="occbar" title={pct(d.utilisationBps)}>
                        <i style={{ width: `${Math.round((d.boarding / peak) * 100)}%` }} />
                        <em>{pct(d.utilisationBps)}</em>
                      </span>
                    </td>
                    <td>
                      {d.daycare > 0 ? `${d.daycare} / ${d.daycareCapacity}` : <span className="muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </ReportShell>
  );
}
