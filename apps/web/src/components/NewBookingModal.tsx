import { useEffect, useMemo, useState } from 'react';
import {
  createBooking,
  fetchPets,
  fetchRuns,
  type PetOption,
  type RunOption,
} from '../api';
import { Icon } from './Icon';
import { facilityToday, isoDate } from '../facility-time';
import { DayPicker } from './DayPicker';


function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

interface Props {
  onClose: () => void;
  onCreated: () => void;
  /** Prefill the start date, e.g. when opened from a calendar day. */
  initialDate?: string;
}

export function NewBookingModal({ onClose, onCreated, initialDate }: Props) {
  const today = facilityToday();
  const [serviceType, setServiceType] = useState<'boarding' | 'daycare'>('boarding');
  const [petId, setPetId] = useState('');
  const [startDate, setStartDate] = useState(initialDate ?? today);
  const [endDate, setEndDate] = useState(addDays(initialDate ?? today, 1));
  const [days, setDays] = useState<string[]>(initialDate ? [initialDate] : [today]);
  const [runId, setRunId] = useState('');
  const [notes, setNotes] = useState('');

  const [pets, setPets] = useState<PetOption[]>([]);
  const [runs, setRuns] = useState<RunOption[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [skipped, setSkipped] = useState<Array<{ date: string; reason: string }>>([]);

  // Daycare books each chosen day separately. Availability is checked against
  // the first of them, which is what the run picker below is offering.
  const firstDay = days[0] ?? today;
  const effectiveStart = serviceType === 'daycare' ? firstDay : startDate;
  const effectiveEnd = serviceType === 'daycare' ? firstDay : endDate;

  useEffect(() => {
    fetchPets()
      .then((r) => setPets(r.pets))
      .catch((e: Error) => setLoadError(e.message));
  }, []);

  useEffect(() => {
    if (effectiveEnd < effectiveStart) return;
    let stale = false;
    fetchRuns(effectiveStart, effectiveEnd, serviceType)
      .then((r) => {
        if (stale) return;
        setRuns(r.runs);
        // Drop a selection that the new dates made unavailable.
        setRunId((current) =>
          current && r.runs.some((run) => run.id === current && run.available) ? current : '',
        );
      })
      .catch((e: Error) => !stale && setLoadError(e.message));
    return () => {
      stale = true;
    };
  }, [effectiveStart, effectiveEnd, serviceType]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const nights = useMemo(() => {
    if (serviceType === 'daycare') return 0;
    return Math.round(
      (new Date(endDate).getTime() - new Date(startDate).getTime()) / 86_400_000,
    );
  }, [serviceType, startDate, endDate]);

  const invalidRange = serviceType === 'boarding' && nights < 1;
  const canSubmit =
    Boolean(petId) &&
    !invalidRange &&
    !saving &&
    (serviceType === 'boarding' || days.length > 0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setSubmitError(null);
    try {
      const result = await createBooking({
        petId,
        serviceType,
        startDate: effectiveStart,
        endDate: effectiveEnd,
        runId: runId || undefined,
        notes: notes.trim() || undefined,
        ...(serviceType === 'daycare' ? { dates: days } : {}),
      });
      // Some days can be full or already booked while others go through. Say
      // which, rather than reporting a clean success for a partial one.
      if (result.skipped?.length) {
        setSkipped(result.skipped);
        setDays((d) => d.filter((x) => result.skipped?.some((s) => s.date === x)));
        onCreated();
        return;
      }
      onCreated();
      onClose();
    } catch (err) {
      setSubmitError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const availableRuns = runs.filter((r) => r.available);

  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="New booking"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-hd">
          <b>New booking</b>
          <button type="button" className="modal-x" onClick={onClose} aria-label="Close">
            <Icon name="close" size={15} />
          </button>
        </div>

        {loadError ? (
          <div className="hint error">Could not load form data: {loadError}</div>
        ) : (
          <form onSubmit={submit}>
            <div className="modal-body">
              <label className="field">
                <span>Service</span>
                <div className="segmented">
                  <button
                    type="button"
                    className={serviceType === 'boarding' ? 'on' : ''}
                    onClick={() => setServiceType('boarding')}
                  >
                    Boarding
                  </button>
                  <button
                    type="button"
                    className={serviceType === 'daycare' ? 'on' : ''}
                    onClick={() => setServiceType('daycare')}
                  >
                    Daycare
                  </button>
                </div>
              </label>

              <label className="field">
                <span>Pet</span>
                <select value={petId} onChange={(e) => setPetId(e.target.value)} required>
                  <option value="">Select a pet…</option>
                  {pets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {p.breed ?? 'mixed'} ({p.clientName})
                    </option>
                  ))}
                </select>
              </label>

              {serviceType === 'daycare' ? (
                <label className="field">
                  <span>Days</span>
                  <DayPicker selected={days} onChange={setDays} />
                </label>
              ) : (
                <div className="field-row">
                  <label className="field">
                    <span>Check in</span>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => {
                        const next = e.target.value;
                        setStartDate(next);
                        if (endDate <= next) setEndDate(addDays(next, 1));
                      }}
                      required
                    />
                  </label>
                  <label className="field">
                    <span>Check out</span>
                    <input
                      type="date"
                      value={endDate}
                      min={addDays(startDate, 1)}
                      onChange={(e) => setEndDate(e.target.value)}
                      required
                    />
                  </label>
                </div>
              )}

              {serviceType === 'boarding' ? (
                <p className="field-note">
                  {invalidRange
                    ? 'A stay must cover at least one night.'
                    : `${nights} night${nights === 1 ? '' : 's'}`}
                </p>
              ) : (
                <p className="field-note">
                  Each day is booked separately. The play group below is offered for{' '}
                  {new Date(firstDay + 'T12:00:00').toLocaleDateString(undefined, {
                    weekday: 'long',
                    month: 'short',
                    day: 'numeric',
                  })}
                  ; a day that is full will be reported rather than silently dropped.
                </p>
              )}

              {skipped.length > 0 && (
                <div className="form-error">
                  <b>Booked the rest. These days were not:</b>
                  <ul style={{ margin: '4px 0 0 var(--s-4)' }}>
                    {skipped.map((s) => (
                      <li key={s.date}>
                        {s.date} � {s.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <label className="field">
                <span>
                  {serviceType === 'daycare' ? 'Play group' : 'Run'}
                  <em>
                    {' '}
                    · {availableRuns.length} available
                  </em>
                </span>
                <select value={runId} onChange={(e) => setRunId(e.target.value)}>
                  <option value="">Assign later</option>
                  {runs.map((r) => (
                    <option key={r.id} value={r.id} disabled={!r.available}>
                      {r.code}
                      {r.kind === 'playgroup'
                        ? ` — ${r.remaining} of ${r.capacity} spots left`
                        : r.available
                          ? ` — ${r.zone}`
                          : ` — taken by ${r.takenBy}`}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Notes</span>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Feeding changes, pickup details…"
                />
              </label>

              {submitError && <div className="form-error">{submitError}</div>}
            </div>

            <div className="modal-ft">
              <button type="button" className="btn ghost" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="btn" disabled={!canSubmit}>
                {saving
                  ? 'Saving…'
                  : serviceType === 'daycare' && days.length > 1
                    ? `Book ${days.length} days`
                    : 'Create booking'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
