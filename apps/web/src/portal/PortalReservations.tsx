import { useState } from 'react';
import type { PortalData } from './PortalApp';
import { Avatar, StatusPill } from './PortalHome';
import { StayLogView } from './StayLogView';
import { DayPicker } from '../components/DayPicker';
import { cancelBooking, changeBooking, createBooking, type PortalBooking } from './api';
import { facilityToday, shiftDate } from '../facility-time';

function isoToday(): string {
  return facilityToday();
}


function fmt(iso: string): string {
  return new Date(iso + 'T12:00:00').toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export function PortalReservations({
  data,
  reload,
}: {
  data: PortalData;
  reload: () => Promise<void>;
}) {
  const [booking, setBooking] = useState(false);
  const [editing, setEditing] = useState<PortalBooking | null>(null);
  const [openLog, setOpenLog] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const today = isoToday();
  const active = data.bookings.filter((b) => b.status !== 'canceled' && b.endDate >= today);
  const history = data.bookings.filter((b) => b.status === 'canceled' || b.endDate < today);

  const cancel = async (b: PortalBooking) => {
    if (!window.confirm(`Cancel ${b.petName}'s ${b.serviceType} on ${fmt(b.startDate)}?`)) return;
    setBusy(b.id);
    setError(null);
    try {
      await cancelBooking(b.id);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="pt-page">
      <div className="pt-page-hd">
        <h2>Stays</h2>
        <button className="pt-btn small" onClick={() => setBooking(true)}>
          Book a stay
        </button>
      </div>

      {error && <div className="pt-error">{error}</div>}

      <section className="pt-card">
        <div className="pt-card-hd"><h3>Booked</h3></div>
        {active.length === 0 ? (
          <div className="pt-empty">
            <b>No stays booked</b>
            <small>When you book, it will appear here and you can change or cancel it.</small>
          </div>
        ) : (
          <ul className="pt-list">
            {active.map((b) => (
              <li key={b.id} className="stacked">
                <div className="pt-list-row">
                  <Avatar name={b.petName} color={b.avatarColor} photo={b.photoUrl} />
                  <span className="pt-list-main">
                    <b>{b.petName}</b>
                    <small>
                      {b.serviceType === 'boarding'
                        ? `${fmt(b.startDate)} → ${fmt(b.endDate)}`
                        : `Daycare · ${fmt(b.startDate)}`}
                    </small>
                  </span>
                  <StatusPill status={b.status} />
                </div>
                {b.notes && <p className="pt-note">{b.notes}</p>}
                <div className="pt-actions">
                  {(b.status === 'requested' || b.status === 'confirmed') && (
                    <>
                      <button className="pt-link" onClick={() => setEditing(b)}>Change dates</button>
                      <button
                        className="pt-link danger"
                        disabled={busy === b.id}
                        onClick={() => cancel(b)}
                      >
                        {busy === b.id ? 'Canceling…' : 'Cancel'}
                      </button>
                    </>
                  )}
                  {b.status === 'checked_in' && (
                    <button className="pt-link" onClick={() => setOpenLog(b.id)}>See their day</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {history.length > 0 && (
        <section className="pt-card">
          <div className="pt-card-hd"><h3>Past &amp; canceled</h3></div>
          <ul className="pt-list">
            {history.slice(0, 12).map((b) => (
              <li key={b.id}>
                <Avatar name={b.petName} color={b.avatarColor} photo={b.photoUrl} />
                <span className="pt-list-main">
                  <b>{b.petName}</b>
                  <small>
                    {b.serviceType === 'boarding'
                      ? `${fmt(b.startDate)} → ${fmt(b.endDate)}`
                      : fmt(b.startDate)}
                  </small>
                </span>
                {b.status === 'canceled' ? (
                  <StatusPill status="canceled" />
                ) : (
                  <button className="pt-link" onClick={() => setOpenLog(b.id)}>View log</button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(booking || editing) && (
        <BookingSheet
          data={data}
          existing={editing}
          onClose={() => {
            setBooking(false);
            setEditing(null);
          }}
          onSaved={async () => {
            setBooking(false);
            setEditing(null);
            await reload();
          }}
        />
      )}

      {openLog && <StayLogView bookingId={openLog} onClose={() => setOpenLog(null)} />}
    </div>
  );
}

function BookingSheet({
  data,
  existing,
  onClose,
  onSaved,
}: {
  data: PortalData;
  existing: PortalBooking | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const today = isoToday();
  const [petId, setPetId] = useState(existing?.petId ?? data.pets[0]?.id ?? '');
  const [serviceType, setServiceType] = useState<'boarding' | 'daycare'>(
    existing?.serviceType ?? 'boarding',
  );
  const [startDate, setStartDate] = useState(existing?.startDate ?? shiftDate(today, 1));
  const [endDate, setEndDate] = useState(existing?.endDate ?? shiftDate(today, 3));
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [days, setDays] = useState<string[]>([existing?.startDate ?? shiftDate(today, 1)]);
  const [skipped, setSkipped] = useState<Array<{ date: string; reason: string }>>([]);

  const effectiveEnd = serviceType === 'daycare' ? startDate : endDate;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (existing) {
        await changeBooking(existing.id, { startDate, endDate: effectiveEnd, notes });
      } else if (serviceType === 'daycare') {
        const result = await createBooking({
          petId,
          serviceType,
          startDate: days[0] ?? today,
          endDate: days[0] ?? today,
          notes,
          dates: days,
        });
        if (result.skipped?.length) {
          setSkipped(result.skipped);
          setDays((d) => d.filter((x) => result.skipped?.some((s) => s.date === x)));
          await onSaved();
          return;
        }
      } else {
        await createBooking({ petId, serviceType, startDate, endDate: effectiveEnd, notes });
      }
      await onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pt-sheet-scrim" onMouseDown={onClose}>
      <div
        className="pt-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={existing ? 'Change stay' : 'Book a stay'}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="pt-sheet-hd">
          <b>{existing ? `Change ${existing.petName}'s stay` : 'Book a stay'}</b>
          <button className="pt-link" onClick={onClose}>Close</button>
        </div>

        <form className="pt-sheet-form" onSubmit={submit}>
          <div className="pt-sheet-body">
          {!existing && (
            <>
              <label className="pt-field">
                <span>Who's coming?</span>
                <select value={petId} onChange={(e) => setPetId(e.target.value)} required>
                  {data.pets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.breed ? ` · ${p.breed}` : ''}
                    </option>
                  ))}
                </select>
              </label>

              <div className="pt-seg">
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
            </>
          )}

          {serviceType === 'daycare' && !existing ? (
            <label className="pt-field">
              <span>Which days?</span>
              <DayPicker selected={days} onChange={setDays} minDate={today} />
            </label>
          ) : (
            <div className="pt-field-row">
              <label className="pt-field">
                <span>{serviceType === 'daycare' ? 'Date' : 'Drop off'}</span>
                <input
                  type="date"
                  min={today}
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    if (serviceType === 'boarding' && endDate <= e.target.value) {
                      setEndDate(shiftDate(e.target.value, 1));
                    }
                  }}
                  required
                />
              </label>
              {serviceType === 'boarding' && (
                <label className="pt-field">
                  <span>Pick up</span>
                  <input
                    type="date"
                    min={shiftDate(startDate, 1)}
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    required
                  />
                </label>
              )}
            </div>
          )}

          {skipped.length > 0 && (
            <div className="pt-error inline">
              <b>We booked the rest. These days we could not:</b>
              <ul style={{ margin: '4px 0 0 1rem' }}>
                {skipped.map((s) => (
                  <li key={s.date}>
                    {fmt(s.date)} � {s.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <label className="pt-field">
            <span>Anything we should know?</span>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Feeding changes, pickup times, who's collecting…"
            />
          </label>

          {error && <div className="pt-error inline">{error}</div>}

            <p className="pt-fine">
              We'll review and confirm.{' '}
              {existing ? 'Changing the dates puts it back into review.' : ''}
            </p>
          </div>

          {/* Outside the scrolling body: with a month grid in the form, the
              button sat 108px below the fold on a phone. */}
          <div className="pt-sheet-ft">
            <button className="pt-btn" type="submit" disabled={busy || !petId}>
              {busy
                ? 'Sending…'
                : existing
                  ? 'Save changes'
                  : serviceType === 'daycare' && days.length > 1
                    ? `Request ${days.length} days`
                    : 'Request stay'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
