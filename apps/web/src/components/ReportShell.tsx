import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from './Icon';

export function csvCell(value: unknown): string {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: Array<Array<string | number>>): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}

export function downloadCsv(filename: string, csv: string): void {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Common chrome for a report: where it sits, what it covers, and the two
 * things anyone wants to do with one — print it or take it into a spreadsheet.
 */
export function ReportShell({
  title,
  covering,
  controls,
  onExport,
  children,
}: {
  title: string;
  covering: string;
  controls?: ReactNode;
  onExport?: () => void;
  children: ReactNode;
}) {
  return (
    <>
      <div className="topbar">
        <Link to="/reports" className="crumb">
          <Icon name="chevronLeft" size={15} />
          Reports
        </Link>
        <h1>{title}</h1>
        <span className="date">{covering}</span>
        <div className="right">
          {controls}
          {onExport && (
            <button className="btn ghost" onClick={onExport}>
              <Icon name="download" size={15} />
              CSV
            </button>
          )}
          <button className="btn ghost" onClick={() => window.print()}>
            <Icon name="print" size={15} />
            Print
          </button>
        </div>
      </div>
      <div className="content">{children}</div>
    </>
  );
}

/** Date range control shared by the reports that take one. */
export function RangePicker({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}) {
  return (
    <>
      <input
        className="date-input"
        type="date"
        value={from}
        max={to}
        aria-label="From"
        onChange={(e) => e.target.value && onChange(e.target.value, to)}
      />
      <span className="range-sep">to</span>
      <input
        className="date-input"
        type="date"
        value={to}
        min={from}
        aria-label="To"
        onChange={(e) => e.target.value && onChange(from, e.target.value)}
      />
    </>
  );
}
