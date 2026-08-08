import { useEffect, useState } from 'react';
import { fetchStayLog, type StayLog } from './api';

const LABEL: Record<string, string> = {
  checkin: 'Checked in',
  checkout: 'Went home',
  feeding: 'Meal',
  medication: 'Medication',
  potty: 'Potty break',
  note: 'Note from the team',
  photo: 'Photo',
};

function time(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function day(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

/** The owner-facing view of what actually happened during a stay. */
export function StayLogView({ bookingId, onClose }: { bookingId: string; onClose: () => void }) {
  const [log, setLog] = useState<StayLog | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchStayLog(bookingId)
      .then(setLog)
      .catch((e: Error) => setError(e.message));
  }, [bookingId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const byDay = new Map<string, StayLog['events']>();
  for (const e of log?.events ?? []) {
    const key = e.careDate ?? e.occurredAt.slice(0, 10);
    byDay.set(key, [...(byDay.get(key) ?? []), e]);
  }

  return (
    <div className="pt-sheet-scrim" onMouseDown={onClose}>
      <div
        className="pt-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Stay log"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="pt-sheet-hd">
          <b>{log ? `${log.stay.petName}'s stay` : 'Stay'}</b>
          <button className="pt-link" onClick={onClose}>Close</button>
        </div>

        {error ? (
          <div className="pt-error inline">{error}</div>
        ) : !log ? (
          <div className="pt-empty"><b>Loading…</b></div>
        ) : (
          <div className="pt-sheet-body">
            <p className="pt-sheet-sub">
              {log.stay.serviceType === 'boarding'
                ? `${log.stay.startDate} → ${log.stay.endDate}`
                : log.stay.startDate}
              {log.stay.runLabel
                ? ` · ${log.stay.runLabel}`
                : log.stay.runCode
                  ? ` · ${log.stay.runCode}`
                  : ''}
            </p>

            {log.medications.length > 0 && (
              <section className="pt-sub">
                <h4>Medication given</h4>
                <ul className="pt-plain">
                  {log.medications.map((m, i) => (
                    <li key={i}>
                      <b>{m.name}</b>
                      {m.dose ? ` · ${m.dose}` : ''} · {m.schedule}
                      {m.withFood ? ' · with food' : ''}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {log.intake && (
              <section className="pt-sub">
                <h4>What we had on file</h4>
                <ul className="pt-plain">
                  {log.intake.belongings && <li>Belongings: {log.intake.belongings}</li>}
                  {log.intake.foodDescription && (
                    <li>
                      Food: {log.intake.foodDescription}
                      {log.intake.feedingAmount ? ` · ${log.intake.feedingAmount}` : ''}
                      {log.intake.feedingTimes.length
                        ? ` · ${log.intake.feedingTimes.join(', ')}`
                        : ''}
                    </li>
                  )}
                  <li>
                    Treats {log.intake.treatsAllowed ? 'allowed' : 'not allowed'} · chews{' '}
                    {log.intake.bonesAllowed ? 'allowed' : 'not allowed'}
                  </li>
                </ul>
              </section>
            )}

            {byDay.size === 0 ? (
              <div className="pt-empty">
                <b>Nothing logged yet</b>
                <small>
                  Meals, medication and check-ins appear here as the team records them.
                </small>
              </div>
            ) : (
              [...byDay.entries()].map(([date, events]) => (
                <section key={date} className="pt-sub">
                  <h4>{day(date + 'T12:00:00')}</h4>
                  <ul className="pt-timeline">
                    {events.map((e, i) => (
                      <li key={i}>
                        <span className="pt-t">{time(e.occurredAt)}</span>
                        <span>
                          <b>
                            {LABEL[e.type] ?? e.type}
                            {e.subject ? ` · ${e.subject}` : ''}
                            {e.slot ? ` · ${e.slot}` : ''}
                          </b>
                          {e.note && <small>{e.note}</small>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
