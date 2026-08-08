import { useState } from 'react';
import type { PortalData } from './PortalApp';
import { updateMe } from './api';

const STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME',
  'MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA',
  'RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
];

export function PortalAccount({
  data,
  reload,
}: {
  data: PortalData;
  reload: () => Promise<void>;
}) {
  const c = data.client;
  const [form, setForm] = useState({
    firstName: c.firstName,
    lastName: c.lastName,
    contactEmail: c.contactEmail ?? '',
    phone: c.phone ?? '',
    addressLine1: c.addressLine1 ?? '',
    addressLine2: c.addressLine2 ?? '',
    city: c.city ?? '',
    state: c.state ?? '',
    postalCode: c.postalCode ?? '',
    emergencyName: c.emergencyName ?? '',
    emergencyPhone: c.emergencyPhone ?? '',
  });
  const [smsOptIn, setSmsOptIn] = useState(c.smsOptIn);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await updateMe({ ...form, smsOptIn });
      await reload();
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pt-page">
      <div className="pt-page-hd">
        <h2>Account</h2>
      </div>

      <form className="pt-card" onSubmit={submit}>
        <div className="pt-sub">
          <h4>Your details</h4>
          <div className="pt-field-row">
            <label className="pt-field">
              <span>First name</span>
              <input value={form.firstName} onChange={set('firstName')} required autoComplete="given-name" />
            </label>
            <label className="pt-field">
              <span>Last name</span>
              <input value={form.lastName} onChange={set('lastName')} required autoComplete="family-name" />
            </label>
          </div>
          <label className="pt-field">
            <span>Email</span>
            <input type="email" value={form.contactEmail} onChange={set('contactEmail')} autoComplete="email" />
          </label>
          <label className="pt-field">
            <span>Cell phone</span>
            <input type="tel" value={form.phone} onChange={set('phone')} autoComplete="tel" placeholder="(555) 019-8804" />
          </label>
        </div>

        <div className="pt-sub">
          <h4>Address</h4>
          <label className="pt-field">
            <span>Street</span>
            <input value={form.addressLine1} onChange={set('addressLine1')} autoComplete="address-line1" />
          </label>
          <label className="pt-field">
            <span>Apartment, unit (optional)</span>
            <input value={form.addressLine2} onChange={set('addressLine2')} autoComplete="address-line2" />
          </label>
          <div className="pt-field-row">
            <label className="pt-field">
              <span>City</span>
              <input value={form.city} onChange={set('city')} autoComplete="address-level2" />
            </label>
            <label className="pt-field" style={{ maxWidth: 110 }}>
              <span>State</span>
              <select value={form.state} onChange={set('state')} autoComplete="address-level1">
                <option value="">—</option>
                {STATES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
            <label className="pt-field" style={{ maxWidth: 140 }}>
              <span>ZIP</span>
              <input value={form.postalCode} onChange={set('postalCode')} autoComplete="postal-code" inputMode="numeric" />
            </label>
          </div>
        </div>

        <div className="pt-sub">
          <h4>Emergency contact</h4>
          <div className="pt-field-row">
            <label className="pt-field">
              <span>Name</span>
              <input value={form.emergencyName} onChange={set('emergencyName')} />
            </label>
            <label className="pt-field">
              <span>Phone</span>
              <input type="tel" value={form.emergencyPhone} onChange={set('emergencyPhone')} />
            </label>
          </div>
        </div>

        <div className="pt-sub">
          <h4>Text messages</h4>
          <label className="pt-check">
            <input
              type="checkbox"
              checked={smsOptIn}
              onChange={(e) => setSmsOptIn(e.target.checked)}
            />
            <span>
              <b>Text me about my pet's stay</b>
              <small>
                Booking confirmations, reminders and updates while they're here. Message rates
                may apply, and you can turn this off any time.
              </small>
            </span>
          </label>
          {c.smsConsentAt && smsOptIn && (
            <p className="pt-fine">
              You agreed to texts on {new Date(c.smsConsentAt).toLocaleDateString()}.
            </p>
          )}
        </div>

        {error && <div className="pt-error inline">{error}</div>}
        {saved && <div className="pt-saved">Saved</div>}

        <button className="pt-btn" type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </form>

      <section className="pt-card">
        <div className="pt-sub">
          <h4>Signed in as</h4>
          <p className="pt-fine">{data.email}</p>
          {c.balanceCents > 0 && (
            <p className="pt-fine">
              Account credit: <b>${(c.balanceCents / 100).toFixed(2)}</b>
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
