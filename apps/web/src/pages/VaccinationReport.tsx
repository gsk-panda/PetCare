import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchVaccinationReport, type VaccinationReport as Report } from '../api';
import { ReportShell, downloadCsv, toCsv } from '../components/ReportShell';

const WINDOWS = [30, 60, 90];

function status(daysLeft: number) {
  if (daysLeft < 0) return <span className="pill bad">Expired {Math.abs(daysLeft)}d ago</span>;
  if (daysLeft === 0) return <span className="pill bad">Expires today</span>;
  if (daysLeft <= 14) return <span className="pill warn">{daysLeft}d left</span>;
  return <span className="pill neutral">{daysLeft}d left</span>;
}

export function VaccinationReport() {
  const [withinDays, setWithinDays] = useState(60);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onlyBooked, setOnlyBooked] = useState(false);

  const load = useCallback(() => {
    setError(null);
    fetchVaccinationReport(withinDays)
      .then(setReport)
      .catch((e: Error) => setError(e.message));
  }, [withinDays]);
  useEffect(load, [load]);

  const rows = (report?.rows ?? []).filter((r) => !onlyBooked || r.hasUpcoming);

  const exportCsv = () => {
    if (!report) return;
    downloadCsv(
      `vaccinations-${withinDays}d.csv`,
      toCsv(
        ['Pet', 'Owner', 'Phone', 'Email', 'Vaccine', 'Expires', 'Days left', 'Verified', 'Stay booked'],
        rows.map((r) => [
          r.petName,
          r.clientName,
          r.clientPhone ?? '',
          r.clientEmail ?? '',
          r.vaccine,
          r.expiresOn,
          r.daysLeft,
          r.verified ? 'yes' : 'no',
          r.hasUpcoming ? 'yes' : 'no',
        ]),
      ),
    );
  };

  return (
    <ReportShell
      title="Vaccinations"
      covering={report ? `expiring within ${withinDays} days` : ''}
      controls={
        <div className="segmented small">
          {WINDOWS.map((d) => (
            <button
              key={d}
              type="button"
              className={withinDays === d ? 'on' : ''}
              onClick={() => setWithinDays(d)}
            >
              {d} days
            </button>
          ))}
        </div>
      }
      onExport={exportCsv}
    >
      {error && <div className="hint error">{error}</div>}
      {!report ? (
        <div className="hint">Checking the paperwork…</div>
      ) : (
        <>
          <div className="tiles">
            <div className="tile">
              <div className="lbl">Already expired</div>
              <div className="num">{report.totals.expired}</div>
              <div className="sub">out of date today</div>
            </div>
            <div className="tile">
              <div className="lbl">Blocking a stay</div>
              <div className="num">{report.totals.blockingUpcoming}</div>
              <div className="sub">expired, and booked in</div>
            </div>
            <div className="tile">
              <div className="lbl">Expiring soon</div>
              <div className="num">{report.totals.expiringSoon}</div>
              <div className="sub">within {withinDays} days</div>
            </div>
            <div className="tile">
              <div className="lbl">Unverified</div>
              <div className="num">{report.totals.unverified}</div>
              <div className="sub">no one has checked the record</div>
            </div>
          </div>

          <div className="card">
            <div className="hd">
              <b>Who to chase</b>
              <span className="cnt">{rows.length} records</span>
              <label className="toggle" style={{ marginLeft: 'auto' }}>
                <input
                  type="checkbox"
                  checked={onlyBooked}
                  onChange={(e) => setOnlyBooked(e.target.checked)}
                />
                <span>Only those with a stay booked</span>
              </label>
            </div>
            {rows.length === 0 ? (
              <div className="hint">Nothing to chase in this window.</div>
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Pet</th>
                    <th>Vaccine</th>
                    <th>Status</th>
                    <th>Owner</th>
                    <th>Contact</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={`${r.petId}-${r.vaccine}`}>
                      <td>
                        <Link to={`/pets/${r.petId}`} className="petlink">
                          <i style={{ background: r.avatarColor }} />
                          {r.petName}
                        </Link>
                        {r.hasUpcoming && <span className="pill warn" style={{ marginLeft: 6 }}>Booked</span>}
                      </td>
                      <td>
                        {r.vaccine}
                        {!r.verified && <small className="muted"> · unverified</small>}
                      </td>
                      <td>{status(r.daysLeft)}</td>
                      <td>{r.clientName}</td>
                      <td>
                        {r.clientPhone && <div>{r.clientPhone}</div>}
                        {r.clientEmail && <small className="muted">{r.clientEmail}</small>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </ReportShell>
  );
}
