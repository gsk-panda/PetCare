import { useState } from 'react';
import { staffLogin, type StaffUser } from '../api';

/**
 * Staff sign-in. Passwords rather than the portal's emailed codes: a shift
 * change at a shared terminal needs sign-in to take seconds, not a round trip
 * through someone's inbox.
 */
export function StaffSignIn({
  tenantName,
  onSignedIn,
}: {
  tenantName: string;
  onSignedIn: (staff: StaffUser) => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await staffLogin(email.trim(), password));
    } catch (err) {
      setError((err as Error).message);
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="signin">
      <form className="signin-card" onSubmit={submit}>
        <div className="signin-mark">CC</div>
        <h1>{tenantName}</h1>
        <p>Staff sign in</p>

        <label className="field">
          <span>Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
            autoFocus
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>

        {error && <div className="form-error">{error}</div>}

        <button className="btn" type="submit" disabled={busy || !email.trim() || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="signin-fine">
          Owners looking for their pet's stay should use the{' '}
          <a href="/portal" className="linkish">client portal</a>.
        </p>
      </form>
    </div>
  );
}
