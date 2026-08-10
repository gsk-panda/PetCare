import { useEffect, useState } from 'react';
import {
  changeStayDates,
  checkDateAvailability,
  fetchCheckoutQuote,
  type BoardOccupant,
  type DateAvailability,
} from '../api';
import { money } from './CheckOutPanel';
import { Icon } from './Icon';
import { shiftDate } from '../facility-time';


function nightsBetween(start: string, end: string): number {
  return Math.round(
    (new Date(end + 'T12:00:00').getTime() - new Date(start + 'T12:00:00').getTime()) / 86_400_000,
  );
}

/**
 * Extend or shorten a stay. Shows what the change does to the bill, because
 * "two more nights" and "another £130" are the same decision to an owner and
 * the desk should be able to say both.
 */
export function StayDatesPanel({
  occupant,
  runLabel,
  onClose,
  onSaved,
}: {
  occupant: BoardOccupant;
  runLabel: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const started = occupant.status === 'checked_in';
  const [startDate, setStartDate] = useState(occupant.startDate);
  const [endDate, setEndDate] = useState(occupant.endDate);
  const [nightlyCents, setNightlyCents] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [availability, setAvailability] = useState<DateAvailability | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    // The quote gives the current nightly rate, which is what makes the
    // difference in cost meaningful rather than a guess.
    fetchCheckoutQuote(occupant.bookingId)
      .then((q) => {
        const line = q.lines.find((l) => l.kind === 'boarding' || l.kind === 'daycare');
        setNightlyCents(line?.unitCents ?? null);
      })
      .catch(() => setNightlyCents(null));
  }, [occupant.bookingId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Ask whether the run is free for the dates currently chosen, so a clash
  // shows before Save rather than as an error after it.
  useEffect(() => {
    if (endDate < startDate) return;
    let stale = false;
    setChecking(true);
    const t = window.setTimeout(() => {
      checkDateAvailability(occupant.bookingId, startDate, endDate)
        .then((a) => !stale && setAvailability(a))
        .catch(() => !stale && setAvailability(null))
        .finally(() => !stale && setChecking(false));
    }, 250);
    return () => {
      stale = true;
      window.clearTimeout(t);
    };
  }, [occupant.bookingId, startDate, endDate]);

  const isBoarding = occupant.serviceType === 'boarding';
  const wasNights = nightsBetween(occupant.startDate, occupant.endDate);
  const nowNights = nightsBetween(startDate, endDate);
  const deltaNights = nowNights - wasNights;
  const invalid = isBoarding ? nowNights < 1 : endDate !== startDate;
  const changed = startDate !== occupant.startDate || endDate !== occupant.endDate;
  const blocked = availability !== null && !availability.available;

  const submit = async () => {
    if (invalid || !changed || saving || blocked) return;
    setSaving(true);
    setError(null);
    try {
      await changeStayDates(occupant.bookingId, { startDate, endDate });
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Change dates for ${occupant.petName}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-hd">
          <b>{occupant.petName}'s stay</b>
          <span className="pill prim" style={{ marginLeft: 8 }}>{runLabel}</span>
          <button type="button" className="modal-x" onClick={onClose} aria-label="Close">
            <Icon name="close" size={15} />
          </button>
        </div>

        <div className="modal-body">
          <p className="checkin-sub">
            Currently {occupant.startDate} → {occupant.endDate}
            {isBoarding && ` · ${wasNights} night${wasNights === 1 ? '' : 's'}`}
          </p>

          <div className="field-row">
            <label className="field">
              <span>Check in</span>
              <input
                type="date"
                value={startDate}
                disabled={started}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </label>
            {isBoarding && (
              <label className="field">
                <span>Check out</span>
                <input
                  type="date"
                  value={endDate}
                  min={shiftDate(startDate, 1)}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </label>
            )}
          </div>

          {started && (
            <p className="field-note">
              This stay has already started, so only the check-out date can change.
            </p>
          )}

          {isBoarding && (
            <div className="quickdates">
              {[-2, -1, 1, 2, 7].map((n) => (
                <button
                  key={n}
                  type="button"
                  className="chip"
                  onClick={() => setEndDate((d) => shiftDate(d, n))}
                >
                  {n > 0 ? `+${n}` : n} night{Math.abs(n) === 1 ? '' : 's'}
                </button>
              ))}
            </div>
          )}

          {!invalid && blocked && (
            <div className="form-error">
              <b>{availability!.runLabel ?? 'That run'} isn't free for those dates.</b>
              <ul style={{ margin: '4px 0 0 16px' }}>
                {availability!.conflicts.map((c, i) => (
                  <li key={i}>
                    {c.petName} is in it {c.startDate} → {c.endDate}
                  </li>
                ))}
              </ul>
              Move one of them, or pick different dates.
            </div>
          )}
          {!invalid && changed && !blocked && availability?.available && !checking && (
            <p className="field-note ok-note">
              {availability.runLabel ?? 'The run'} is free for those dates.
            </p>
          )}

          {changed && !invalid && isBoarding && (
            <div className={deltaNights >= 0 ? 'delta-note' : 'delta-note down'}>
              <b>
                {deltaNights > 0
                  ? `${deltaNights} night${deltaNights === 1 ? '' : 's'} longer`
                  : `${Math.abs(deltaNights)} night${Math.abs(deltaNights) === 1 ? '' : 's'} shorter`}
              </b>
              {nightlyCents !== null && (
                <small>
                  {deltaNights > 0 ? 'Adds ' : 'Takes off '}
                  {money(Math.abs(deltaNights) * nightlyCents)} at {money(nightlyCents)} a night.
                  Billed at check-out.
                </small>
              )}
            </div>
          )}

          {invalid && (
            <div className="form-error">
              {isBoarding ? 'A stay needs at least one night.' : 'Daycare is a single day.'}
            </div>
          )}
          {error && <div className="form-error">{error}</div>}
        </div>

        <div className="modal-ft">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn"
            onClick={submit}
            disabled={invalid || !changed || saving || blocked || checking}
          >
            {saving ? 'Saving…' : checking ? 'Checking…' : blocked ? 'Run not free' : 'Save dates'}
          </button>
        </div>
      </div>
    </div>
  );
}
