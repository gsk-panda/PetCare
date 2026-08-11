import { useCallback, useEffect, useState } from 'react';
import {
  cancelOutbox,
  fetchOutbox,
  releaseOutbox,
  retryOutbox,
  runVaccineSweep,
  type OutboxMessage,
} from '../api';
import { Icon } from '../components/Icon';
import { canManageSettings, useStaff } from '../staff-context';

const KIND_LABEL: Record<string, string> = {
  vaccine_expiry: 'Vaccine reminder',
  booking_confirmation: 'Booking confirmation',
  checkout_summary: 'Receipt',
};

const TABS: Array<[string, string]> = [
  ['queued', 'Waiting'],
  ['sent', 'Sent'],
  ['failed', 'Failed'],
  ['canceled', 'Canceled'],
  ['all', 'Everything'],
];

function when(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function Outbox() {
  const staff = useStaff();
  // Releasing a message to a customer is an owner or manager decision.
  const canManage = canManageSettings(staff);
  const [status, setStatus] = useState('queued');
  const [messages, setMessages] = useState<OutboxMessage[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<OutboxMessage | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Escape closes the preview, as it does in every other dialog in the app.
  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPreview(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [preview]);

  const load = useCallback(() => {
    fetchOutbox(status)
      .then((r) => {
        setMessages(r.messages);
        setCounts(r.counts);
        setChosen(new Set());
      })
      .catch((e: Error) => setError(e.message));
  }, [status]);
  useEffect(load, [load]);

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const r = (await fn()) as Record<string, number | boolean>;
      const counted = Object.entries(r)
        .filter(([, v]) => typeof v === 'number' && v > 0)
        .map(([k, v]) => `${v} ${k}`)
        .join(', ');
      // A silent no-op is the confusing case, so name the reason for it.
      setNote(
        r.mailerReady === false
          ? `${label}. Nothing can leave the building yet: no mailer is configured on the server, so released messages stay here until SES_FROM is set.`
          : counted
            ? `${label}: ${counted}`
            : `${label}. Nothing needed doing.`,
      );
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const ids = [...chosen];
  const toggle = (id: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const held = messages.filter((m) => m.status === 'queued' && !m.releasedAt);

  return (
    <>
      <div className="topbar">
        <h1>Email</h1>
        <span className="date">
          {counts.queued ?? 0} waiting · {counts.sent ?? 0} sent
          {counts.failed ? ` · ${counts.failed} failed` : ''}
        </span>
        <div className="right">
          {canManage && (
            <button
              className="btn ghost"
              disabled={busy}
              onClick={() => act('Vaccine sweep', () => runVaccineSweep(30))}
            >
              <Icon name="refresh" size={15} />
              Check vaccines
            </button>
          )}
          {canManage && held.length > 0 && (
            <button
              className="btn"
              disabled={busy}
              onClick={() => act('Released', () => releaseOutbox({ all: true }))}
            >
              Send all {held.length} waiting
            </button>
          )}
        </div>
      </div>

      <div className="content">
        <div className="segmented small" style={{ maxWidth: 520 }}>
          {TABS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={status === value ? 'on' : ''}
              onClick={() => setStatus(value)}
            >
              {label}
              {counts[value] ? ` ${counts[value]}` : ''}
            </button>
          ))}
        </div>

        {error && <div className="form-error">{error}</div>}
        {note && <div className="delta-note">{note}</div>}

        {!canManage && (
          <div className="readonly-note">
            <b>You can read these but not send them</b>
            <small>Releasing a message to a customer is an owner or manager decision.</small>
          </div>
        )}

        {ids.length > 0 && canManage && (
          <div className="bulkbar">
            <b>{ids.length} selected</b>
            {status !== 'failed' ? (
              <button
                className="btn"
                disabled={busy}
                onClick={() => act('Released', () => releaseOutbox({ ids }))}
              >
                Send
              </button>
            ) : (
              <button
                className="btn"
                disabled={busy}
                onClick={() => act('Retried', () => retryOutbox(ids))}
              >
                Try again
              </button>
            )}
            {status === 'queued' && (
              <button
                className="btn ghost"
                disabled={busy}
                onClick={() => act('Canceled', () => cancelOutbox(ids))}
              >
                Cancel
              </button>
            )}
          </div>
        )}

        <div className="card">
          <div className="hd">
            <b>{TABS.find(([v]) => v === status)?.[1]}</b>
            <span className="cnt">{messages.length}</span>
          </div>
          {messages.length === 0 ? (
            <div className="hint">Nothing here.</div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  {canManage && <th style={{ width: 34 }} />}
                  <th>To</th>
                  <th>Message</th>
                  <th>Kind</th>
                  <th>When</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {messages.map((m) => (
                  <tr key={m.id} className={m.status === 'canceled' ? 'muted-row' : undefined}>
                    {canManage && (
                      <td>
                        <input
                          type="checkbox"
                          checked={chosen.has(m.id)}
                          onChange={() => toggle(m.id)}
                          aria-label={`Select message to ${m.clientName}`}
                        />
                      </td>
                    )}
                    <td>
                      <b>{m.clientName}</b>
                      <small className="muted" style={{ display: 'block' }}>{m.toEmail}</small>
                    </td>
                    <td>
                      {m.subject}
                      {m.lastError && (
                        <small style={{ display: 'block', color: 'var(--bad)' }}>
                          {m.lastError}
                        </small>
                      )}
                    </td>
                    <td>
                      <span className="pill neutral">{KIND_LABEL[m.kind] ?? m.kind}</span>
                    </td>
                    <td>
                      {m.sentAt ? (
                        <span className="pill good">Sent {when(m.sentAt)}</span>
                      ) : m.status === 'failed' ? (
                        <span className="pill bad">Failed</span>
                      ) : m.releasedAt ? (
                        <span className="pill warn">Released, not sent</span>
                      ) : (
                        <span className="muted">Held {when(m.createdAt)}</span>
                      )}
                      {m.releasedByName && (
                        <small className="muted" style={{ display: 'block' }}>
                          by {m.releasedByName}
                        </small>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn ghost" onClick={() => setPreview(m)}>
                        Read
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {preview && (
        <div className="modal-scrim" onMouseDown={() => setPreview(null)}>
          <div
            className="modal wide"
            role="dialog"
            aria-modal="true"
            aria-label="Message"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="modal-hd">
              <b>{preview.subject}</b>
              <button className="modal-x" onClick={() => setPreview(null)} aria-label="Close">
                <Icon name="close" size={15} />
              </button>
            </div>
            <div className="modal-body">
              <p className="checkin-sub">
                To {preview.clientName} · {preview.toEmail}
              </p>
              {/* Plain text, shown as written: what the customer receives is
                  exactly this, so previewing anything prettier would lie. */}
              <pre className="mailbody">{preview.body}</pre>
            </div>
            <div className="modal-ft">
              <button className="btn ghost" onClick={() => setPreview(null)}>
                Close
              </button>
              {canManage && preview.status === 'queued' && (
                <button
                  className="btn"
                  disabled={busy}
                  onClick={async () => {
                    await act('Released', () => releaseOutbox({ ids: [preview.id] }));
                    setPreview(null);
                  }}
                >
                  Send this one
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
