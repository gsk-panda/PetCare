import { useState } from 'react';
import { requestCode, verifyCode } from './api';

/**
 * Passwordless sign-in. Owners get a code by email rather than a password:
 * fewer credentials to lose, and nothing worth stealing in the database.
 */
export function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submitEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await requestCode(email.trim());
      setDevCode(r.devCode ?? null);
      setStep('code');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await verifyCode(email.trim(), code.trim());
      onSignedIn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pt-signin">
      <div className="pt-signin-card">
        <span className="pt-mark lg">CC</span>
        <h1>Cedar Creek Pet Lodge</h1>

        {step === 'email' ? (
          <>
            <p>Sign in to book stays, update your pet's details and see how their visit went.</p>
            <form onSubmit={submitEmail}>
              <label className="pt-field">
                <span>Email address</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  required
                  autoFocus
                />
              </label>
              {error && <div className="pt-error inline">{error}</div>}
              <button className="pt-btn" type="submit" disabled={busy || !email.trim()}>
                {busy ? 'Sending…' : 'Email me a code'}
              </button>
            </form>
            <small className="pt-fine">
              We'll email a 6-digit code. If your address is on file you'll have it in a moment.
            </small>
          </>
        ) : (
          <>
            <p>
              Enter the 6-digit code we sent to <b>{email}</b>.
            </p>
            <form onSubmit={submitCode}>
              <label className="pt-field">
                <span>Code</span>
                <input
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="123456"
                  autoComplete="one-time-code"
                  required
                  autoFocus
                  className="pt-code"
                />
              </label>
              {devCode && (
                <div className="pt-devnote">
                  No mail service is connected yet, so here is the code for testing:{' '}
                  <b>{devCode}</b>
                </div>
              )}
              {error && <div className="pt-error inline">{error}</div>}
              <button className="pt-btn" type="submit" disabled={busy || code.length !== 6}>
                {busy ? 'Checking…' : 'Sign in'}
              </button>
            </form>
            <button
              className="pt-link"
              onClick={() => {
                setStep('email');
                setCode('');
                setError(null);
              }}
            >
              Use a different email
            </button>
          </>
        )}
      </div>
    </div>
  );
}
