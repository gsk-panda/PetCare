import { useCallback, useEffect, useState } from 'react';
import {
  createServiceItem,
  fetchBillingSettings,
  updateBillingSettings,
  updateServiceItem,
  verifyStripeTerminal,
  type BillingSettings as Billing,
  type StripeVerifyResult,
} from '../api';
import { money } from './CheckOutPanel';
import { Icon } from './Icon';

/**
 * The zones a US boarding facility plausibly sits in. Not exhaustive on
 * purpose — a list of 400 IANA names is worse than a short one, and the
 * configured value is always offered even when it is not here.
 */
const ZONES = [
  'America/New_York',
  'America/Detroit',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
];

/** Dollars in the input, cents on the wire. */
function toCents(dollars: string): number | null {
  const n = Number(dollars.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export function BillingSettings({
  onError,
  canEdit,
}: {
  onError: (msg: string | null) => void;
  canEdit: boolean;
}) {
  const [data, setData] = useState<Billing | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [verified, setVerified] = useState<StripeVerifyResult | null>(null);

  const load = useCallback(() => {
    fetchBillingSettings()
      .then(setData)
      .catch((e: Error) => onError(e.message));
  }, [onError]);
  useEffect(load, [load]);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    onError(null);
    try {
      await fn();
      load();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const verify = async () => {
    setBusy('verify');
    onError(null);
    try {
      setVerified(await verifyStripeTerminal());
      load();
    } catch (e) {
      setVerified(null);
      onError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!data) return <div className="card"><div className="hint">Loading billing…</div></div>;

  const t = data.terminal;

  return (
    <>
      <div className="card">
        <div className="hd">
          <b>Pricing</b>
          <span className="cnt">{data.serviceItems.filter((i) => i.active).length} extras</span>
          {canEdit && !adding && (
            <button className="btn ghost" style={{ marginLeft: 'auto' }} onClick={() => setAdding(true)}>
              <Icon name="plus" size={15} />
              Add extra
            </button>
          )}
        </div>

        <p className="setting-note">
          Nightly and daily rates live on each run type and play group above. These extras are
          offered at check-out.
        </p>

        <div className="rate-row">
          <label className="inline-field" style={{ maxWidth: 170 }}>
            <span>Sales tax</span>
            <div className="suffix-field">
              <input
                type="number"
                min={0}
                max={30}
                step={0.25}
                defaultValue={(data.taxRateBps / 100).toFixed(2)}
                disabled={!canEdit}
                onWheel={(e) => e.currentTarget.blur()}
                onBlur={(e) => {
                  const bps = Math.round(Number(e.target.value) * 100);
                  if (Number.isInteger(bps) && bps !== data.taxRateBps) {
                    void run('tax', () => updateBillingSettings({ taxRateBps: bps }));
                  }
                }}
              />
              <em>%</em>
            </div>
          </label>
          <label className="inline-field" style={{ maxWidth: 170 }}>
            <span>Pickup by</span>
            <input
              type="time"
              defaultValue={data.pickupCutoff}
              disabled={!canEdit}
              onBlur={(e) => {
                if (e.target.value && e.target.value !== data.pickupCutoff) {
                  void run('cutoff', () => updateBillingSettings({ pickupCutoff: e.target.value }));
                }
              }}
            />
          </label>
          <label className="inline-field" style={{ maxWidth: 230 }}>
            <span>Time zone</span>
            <select
              defaultValue={data.timezone}
              disabled={!canEdit}
              onChange={(e) => {
                if (e.target.value && e.target.value !== data.timezone) {
                  void run('timezone', () => updateBillingSettings({ timezone: e.target.value }));
                }
              }}
            >
              {/* The configured zone first, in case it is one this list omits. */}
              {[data.timezone, ...ZONES.filter((z) => z !== data.timezone)].map((z) => (
                <option key={z} value={z}>
                  {z.split('/').pop()?.replace(/_/g, ' ')} · {z}
                </option>
              ))}
            </select>
          </label>
          <p className="field-note">
            Tax applies to boarding, daycare and taxable extras; adjustments are never taxed.
            Collect after {data.pickupCutoffLabel} and the pickup day is charged as a full day.
            The time zone decides more than the cutoff: it is what the whole building means by
            &ldquo;today&rdquo;, so care rounds and the board roll over at your midnight rather
            than the server&rsquo;s.
          </p>
        </div>

        {adding && (
          <form
            className="group-add"
            onSubmit={(e) => {
              e.preventDefault();
              const cents = toCents(newPrice);
              if (!newName.trim() || cents === null) return;
              void run('new-item', async () => {
                await createServiceItem({ name: newName.trim(), priceCents: cents });
                setNewName('');
                setNewPrice('');
                setAdding(false);
              });
            }}
          >
            <label className="inline-field">
              <span>Name</span>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Exit bath" autoFocus />
            </label>
            <label className="inline-field" style={{ maxWidth: 130 }}>
              <span>Price</span>
              <input value={newPrice} onChange={(e) => setNewPrice(e.target.value)} placeholder="28.00" inputMode="decimal" />
            </label>
            <div className="group-add-actions">
              <button type="button" className="btn ghost" onClick={() => setAdding(false)}>Cancel</button>
              <button className="btn" type="submit" disabled={busy === 'new-item' || !newName.trim()}>
                Add
              </button>
            </div>
          </form>
        )}

        <table className="tbl">
          <thead>
            <tr><th>Extra</th><th>Price</th><th /></tr>
          </thead>
          <tbody>
            {data.serviceItems.map((i) => (
              <tr key={i.id} className={i.active ? undefined : 'muted-row'}>
                <td>
                  <input
                    className="cell-input"
                    defaultValue={i.name}
                    readOnly={!canEdit}
                    aria-label={`Name for ${i.name}`}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v && v !== i.name) void run(i.id, () => updateServiceItem(i.id, { name: v }));
                    }}
                  />
                </td>
                <td>
                  <input
                    className="cell-input narrow"
                    defaultValue={(i.priceCents / 100).toFixed(2)}
                    readOnly={!canEdit}
                    inputMode="decimal"
                    aria-label={`Price for ${i.name}`}
                    onBlur={(e) => {
                      const cents = toCents(e.target.value);
                      if (cents !== null && cents !== i.priceCents) {
                        void run(i.id, () => updateServiceItem(i.id, { priceCents: cents }));
                      }
                    }}
                  />
                </td>
                <td style={{ textAlign: 'right' }}>
                  {canEdit && (
                    <button
                      className="btn ghost"
                      disabled={busy === i.id}
                      onClick={() => void run(i.id, () => updateServiceItem(i.id, { active: !i.active }))}
                    >
                      {i.active ? 'Retire' : 'Restore'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="hd">
          <b>Card reader</b>
          <span className={`pill ${t.status === 'connected' ? 'good' : 'neutral'}`}>
            {t.status === 'connected' ? 'Connected' : 'Not connected'}
          </span>
        </div>

        <div className="terminal-body">
          <div className="terminal-provider">
            <div>
              <b>Stripe Terminal</b>
              <small>
                Card-present payments on a Stripe reader, settling through the same Stripe
                account as everything else. Square and Clover are not supported yet.
              </small>
            </div>
          </div>

          {!t.stripeConfigured ? (
            <div className="readonly-note">
              <b>No Stripe key on this server</b>
              <small>
                Set <code>STRIPE_SECRET_KEY</code> in the API environment and restart it, then
                verify here. The key is deliberately not stored in the database, so it never
                appears in a backup.
              </small>
            </div>
          ) : (
            <p className="field-note">
              A Stripe key is configured. Verifying asks Stripe which readers this account can
              see, so a connection means a real call succeeded.
            </p>
          )}

          {verified?.ok && (
            <div className="terminal-result">
              <b>
                Connected to {verified.account?.name ?? verified.account?.id}
                {verified.account?.livemode === false && ' · test mode'}
              </b>
              {(verified.locations ?? []).length === 0 ? (
                <small>No Terminal locations on this account yet.</small>
              ) : (
                <ul>
                  {verified.locations!.map((l) => (
                    <li key={l.id}>
                      <b>{l.label}</b>
                      {l.readers.length === 0
                        ? ' · no readers registered'
                        : ` · ${l.readers.map((r) => `${r.label} (${r.status})`).join(', ')}`}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {canEdit && (
            <button className="btn" onClick={verify} disabled={busy === 'verify' || !t.stripeConfigured}>
              {busy === 'verify' ? 'Checking with Stripe…' : 'Verify connection'}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
