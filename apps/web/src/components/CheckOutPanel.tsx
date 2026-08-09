import { useEffect, useState } from 'react';
import {
  completeCheckout,
  fetchBillingSettings,
  fetchCheckoutQuote,
  type BillingSettings,
  type CheckoutQuote,
  type ServiceItem,
} from '../api';
import { Icon } from './Icon';

export function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

const METHODS: Array<[string, string]> = [
  ['card_terminal', 'Card reader'],
  ['card_manual', 'Card (keyed)'],
  ['cash', 'Cash'],
  ['check', 'Check'],
  ['account_credit', 'Account credit'],
];

/**
 * Check-out. The total is derived from the stay, so the desk confirms rather
 * than calculates — a number typed by hand at pickup is a number that will be
 * wrong on a busy Sunday.
 */
export function CheckOutPanel({
  bookingId,
  onClose,
  onDone,
}: {
  bookingId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [quote, setQuote] = useState<CheckoutQuote | null>(null);
  const [billing, setBilling] = useState<BillingSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<{ totalCents: number; paidCents: number } | null>(null);

  const [extras, setExtras] = useState<string[]>([]);
  const [method, setMethod] = useState('card_terminal');
  const [reference, setReference] = useState('');
  const [takePayment, setTakePayment] = useState(true);

  useEffect(() => {
    Promise.all([fetchCheckoutQuote(bookingId), fetchBillingSettings()])
      .then(([q, b]) => {
        setQuote(q);
        setBilling(b);
      })
      .catch((e: Error) => setError(e.message));
  }, [bookingId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const chosen = (billing?.serviceItems ?? []).filter(
    (i) => i.active && extras.includes(i.id),
  );
  const extrasCents = chosen.reduce((n, i) => n + i.priceCents, 0);
  const taxableExtras = chosen.filter((i) => i.taxable).reduce((n, i) => n + i.priceCents, 0);
  const subtotal = (quote?.subtotalCents ?? 0) + extrasCents;
  const tax = quote
    ? quote.taxCents + Math.round((taxableExtras * quote.taxRateBps) / 10_000)
    : 0;
  const total = subtotal + tax;

  // The reader is not wired up yet, so offering it as the default payment
  // method would mean promising something the desk cannot actually do.
  const readerReady =
    billing?.terminal.status === 'connected' && billing.terminal.stripeConfigured;
  const methodUnavailable = method === 'card_terminal' && !readerReady;

  const submit = async () => {
    if (!quote || saving || methodUnavailable) return;
    setSaving(true);
    setError(null);
    try {
      const result = await completeCheckout(bookingId, {
        serviceItemIds: extras,
        payment: takePayment ? { method, amountCents: total, reference: reference.trim() } : undefined,
      });
      setDone({ totalCents: result.totalCents, paidCents: result.paidCents });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div
        className="modal wide"
        role="dialog"
        aria-modal="true"
        aria-label="Check out"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-hd">
          <b>{quote ? `Check out · ${quote.petName}` : 'Check out'}</b>
          <button type="button" className="modal-x" onClick={onClose} aria-label="Close">
            <Icon name="close" size={15} />
          </button>
        </div>

        {done ? (
          <>
            <div className="modal-body">
              <div className="checkout-done">
                <b>{money(done.totalCents)} invoiced</b>
                <small>
                  {done.paidCents >= done.totalCents
                    ? 'Paid in full. The stay is closed.'
                    : `${money(done.totalCents - done.paidCents)} outstanding on the account.`}
                </small>
              </div>
            </div>
            <div className="modal-ft">
              <button className="btn" onClick={onClose}>Done</button>
            </div>
          </>
        ) : error && !quote ? (
          <div className="hint error">{error}</div>
        ) : !quote || !billing ? (
          <div className="hint">Working out the total…</div>
        ) : (
          <>
            <div className="modal-body">
              <p className="checkin-sub">
                {quote.clientName} · {quote.runLabel} ·{' '}
                {quote.serviceType === 'boarding'
                  ? `${quote.startDate} → ${quote.endDate}`
                  : quote.startDate}
              </p>

              <table className="tbl checkout-lines">
                <tbody>
                  {quote.lines.map((l, i) => (
                    <tr key={i}>
                      <td>
                        {l.description}
                        {l.quantity > 1 && (
                          <small style={{ display: 'block', color: 'var(--ink-3)' }}>
                            {l.quantity} × {money(l.unitCents)}
                          </small>
                        )}
                      </td>
                      <td className="amount">{money(l.amountCents)}</td>
                    </tr>
                  ))}
                  {chosen.map((i) => (
                    <tr key={i.id}>
                      <td>{i.name}</td>
                      <td className="amount">{money(i.priceCents)}</td>
                    </tr>
                  ))}
                  <tr className="sub">
                    <td>Subtotal</td>
                    <td className="amount">{money(subtotal)}</td>
                  </tr>
                  {tax > 0 && (
                    <tr className="sub">
                      <td>Tax · {(quote.taxRateBps / 100).toFixed(2)}%</td>
                      <td className="amount">{money(tax)}</td>
                    </tr>
                  )}
                  <tr className="total">
                    <td>Total</td>
                    <td className="amount">{money(total)}</td>
                  </tr>
                </tbody>
              </table>

              <fieldset className="intake">
                <legend>Add to this visit</legend>
                <div className="chipset">
                  {billing.serviceItems
                    .filter((i) => i.active)
                    .map((i: ServiceItem) => (
                      <button
                        key={i.id}
                        type="button"
                        className={extras.includes(i.id) ? 'chip on' : 'chip'}
                        onClick={() =>
                          setExtras((prev) =>
                            prev.includes(i.id)
                              ? prev.filter((x) => x !== i.id)
                              : [...prev, i.id],
                          )
                        }
                      >
                        {i.name} · {money(i.priceCents)}
                      </button>
                    ))}
                </div>
              </fieldset>

              <fieldset className="intake">
                <legend>Payment</legend>
                <label className="check-row compact">
                  <input
                    type="checkbox"
                    checked={takePayment}
                    onChange={(e) => setTakePayment(e.target.checked)}
                  />
                  <span>
                    <b>Taking payment now</b>
                    <small>Leave unticked to bill the account and let them settle later.</small>
                  </span>
                </label>

                {takePayment && (
                  <>
                    <div className="chipset">
                      {METHODS.map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          className={method === value ? 'chip on' : 'chip'}
                          onClick={() => setMethod(value)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {methodUnavailable && (
                      <div className="form-error">
                        No card reader is connected yet.{' '}
                        {billing.terminal.stripeConfigured
                          ? 'Verify the reader in Settings, or take payment another way.'
                          : 'Set STRIPE_SECRET_KEY on the API and connect a reader in Settings, or take payment another way.'}
                      </div>
                    )}
                    <input
                      className="check-input"
                      value={reference}
                      onChange={(e) => setReference(e.target.value)}
                      placeholder={
                        method === 'check'
                          ? 'Check number'
                          : method === 'cash'
                            ? 'Note (optional)'
                            : 'Last four digits'
                      }
                    />
                  </>
                )}
              </fieldset>

              {error && <div className="form-error">{error}</div>}
            </div>

            <div className="modal-ft">
              <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
              <button
                type="button"
                className="btn"
                onClick={submit}
                disabled={saving || methodUnavailable}
              >
                {saving
                  ? 'Closing…'
                  : takePayment
                    ? `Take ${money(total)} and check out`
                    : `Check out · bill ${money(total)}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
