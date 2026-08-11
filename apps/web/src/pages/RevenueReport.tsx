import { useCallback, useEffect, useState } from 'react';
import { fetchRevenueReport, type RevenueReport as Report } from '../api';
import { money } from '../components/CheckOutPanel';
import { ReportShell, RangePicker, downloadCsv, toCsv } from '../components/ReportShell';
import { facilityToday, shiftDate } from '../facility-time';

const KIND_LABEL: Record<string, string> = {
  boarding: 'Boarding',
  daycare: 'Daycare',
  service: 'Extras',
  adjustment: 'Adjustments',
};

const METHOD_LABEL: Record<string, string> = {
  card_terminal: 'Card reader',
  card_manual: 'Card (keyed)',
  cash: 'Cash',
  check: 'Check',
  account_credit: 'Account credit',
};

export function RevenueReport() {
  const today = facilityToday();
  const [from, setFrom] = useState(shiftDate(today, -29));
  const [to, setTo] = useState(today);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    fetchRevenueReport(from, to)
      .then(setReport)
      .catch((e: Error) => setError(e.message));
  }, [from, to]);
  useEffect(load, [load]);

  const exportCsv = () => {
    if (!report) return;
    downloadCsv(
      `revenue-${report.from}-to-${report.to}.csv`,
      toCsv(
        ['Date', 'Invoices', 'Total'],
        report.byDay.map((d) => [d.date, d.invoices, (d.totalCents / 100).toFixed(2)]),
      ),
    );
  };

  const peak = report ? Math.max(1, ...report.byDay.map((d) => d.totalCents)) : 1;

  return (
    <ReportShell
      title="Revenue"
      covering={report ? `${report.from} → ${report.to}` : ''}
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
        <div className="hint">Adding it up…</div>
      ) : report.totals.invoices === 0 ? (
        <div className="card">
          <div className="hint">No invoices were raised in this period.</div>
        </div>
      ) : (
        <>
          <div className="tiles">
            <div className="tile">
              <div className="lbl">Invoiced</div>
              <div className="num">{money(report.totals.totalCents)}</div>
              <div className="sub">
                {report.totals.invoices} invoice{report.totals.invoices === 1 ? '' : 's'}
              </div>
            </div>
            <div className="tile">
              <div className="lbl">Collected</div>
              <div className="num">{money(report.totals.paidCents)}</div>
              <div className="sub">payments received</div>
            </div>
            <div className="tile">
              <div className="lbl">Outstanding</div>
              <div className="num">{money(report.totals.outstandingCents)}</div>
              <div className="sub">
                {report.totals.outstandingCents > 0 ? 'still to chase' : 'nothing owed'}
              </div>
            </div>
            <div className="tile">
              <div className="lbl">Tax</div>
              <div className="num">{money(report.totals.taxCents)}</div>
              <div className="sub">on {money(report.totals.subtotalCents)} of sales</div>
            </div>
          </div>

          <div className="cols">
            <div className="card">
              <div className="hd"><b>What was sold</b></div>
              <table className="tbl">
                <tbody>
                  {report.byKind.map((k) => (
                    <tr key={k.kind}>
                      <td>{KIND_LABEL[k.kind] ?? k.kind}</td>
                      <td className="amount">{money(k.amountCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="card">
              <div className="hd"><b>How it was paid</b></div>
              {report.byMethod.length === 0 ? (
                <div className="hint">Nothing collected yet in this period.</div>
              ) : (
                <table className="tbl">
                  <tbody>
                    {report.byMethod.map((m) => (
                      <tr key={m.method}>
                        <td>{METHOD_LABEL[m.method] ?? m.method}</td>
                        <td className="amount">{money(m.amountCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="card">
            <div className="hd">
              <b>Day by day</b>
              <span className="cnt">{report.byDay.length} days with activity</span>
            </div>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Invoices</th>
                  <th style={{ width: '45%' }} />
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {report.byDay.map((d) => (
                  <tr key={d.date}>
                    <td>
                      {new Date(`${d.date}T12:00:00`).toLocaleDateString(undefined, {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </td>
                    <td>{d.invoices}</td>
                    <td>
                      <span className="occbar">
                        <i style={{ width: `${Math.round((d.totalCents / peak) * 100)}%` }} />
                      </span>
                    </td>
                    <td className="amount">{money(d.totalCents)}</td>
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
