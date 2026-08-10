import { useMemo, useState } from 'react';
import { facilityToday, isoDate, shiftDate } from '../facility-time';
import { Icon } from './Icon';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function monthLabel(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
}

/**
 * Pick a set of days, not a range.
 *
 * Daycare is booked as "Monday, Wednesday and Friday", which a start/end pair
 * cannot express — the old form made that three trips through the booking
 * flow. Days are toggled individually and the past is unreachable.
 */
export function DayPicker({
  selected,
  onChange,
  minDate = facilityToday(),
}: {
  selected: string[];
  onChange: (dates: string[]) => void;
  minDate?: string;
}) {
  const first = selected[0] ?? minDate;
  const [cursor, setCursor] = useState(() => {
    const [y, m] = first.split('-').map(Number);
    return { year: y ?? 1970, month: (m ?? 1) - 1 };
  });

  const weeks = useMemo(() => {
    const start = new Date(cursor.year, cursor.month, 1);
    // Monday-start grid, matching the calendar pages.
    const lead = (start.getDay() + 6) % 7;
    const days: Array<string | null> = Array.from({ length: lead }, () => null);
    const end = new Date(cursor.year, cursor.month + 1, 0).getDate();
    for (let d = 1; d <= end; d++) days.push(isoDate(new Date(cursor.year, cursor.month, d)));
    while (days.length % 7 !== 0) days.push(null);
    return Array.from({ length: days.length / 7 }, (_, i) => days.slice(i * 7, i * 7 + 7));
  }, [cursor]);

  const chosen = new Set(selected);
  const toggle = (iso: string) => {
    const next = new Set(selected);
    if (next.has(iso)) next.delete(iso);
    else next.add(iso);
    onChange([...next].sort());
  };

  const step = (months: number) =>
    setCursor((c) => {
      const d = new Date(c.year, c.month + months, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });

  return (
    <div className="daypicker">
      <div className="daypicker-hd">
        <button type="button" className="btn ghost" onClick={() => step(-1)} aria-label="Previous month">
          <Icon name="chevronLeft" size={15} />
        </button>
        <b>{monthLabel(cursor.year, cursor.month)}</b>
        <button type="button" className="btn ghost" onClick={() => step(1)} aria-label="Next month">
          <Icon name="chevronRight" size={15} />
        </button>
      </div>

      <div className="daypicker-grid" role="group" aria-label="Daycare days">
        {WEEKDAYS.map((w) => (
          <span key={w} className="daypicker-dow">{w}</span>
        ))}
        {weeks.flat().map((iso, i) =>
          iso === null ? (
            <span key={`pad-${i}`} />
          ) : (
            <button
              key={iso}
              type="button"
              className={chosen.has(iso) ? 'daypicker-day on' : 'daypicker-day'}
              disabled={iso < minDate}
              aria-pressed={chosen.has(iso)}
              onClick={() => toggle(iso)}
            >
              {Number(iso.slice(8))}
            </button>
          ),
        )}
      </div>

      <div className="daypicker-ft">
        <span>
          {selected.length === 0
            ? 'No days chosen yet'
            : `${selected.length} day${selected.length === 1 ? '' : 's'} chosen`}
        </span>
        <div className="daypicker-actions">
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              // The common ask at the desk: the same weekday for a month.
              const anchor = selected[selected.length - 1] ?? minDate;
              const next = new Set(selected);
              for (let i = 1; i <= 4; i++) next.add(shiftDate(anchor, i * 7));
              onChange([...next].sort());
            }}
          >
            Repeat weekly ×4
          </button>
          {selected.length > 0 && (
            <button type="button" className="btn ghost" onClick={() => onChange([])}>
              Clear
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
