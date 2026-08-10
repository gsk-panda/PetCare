import { useCallback, useEffect, useState } from 'react';
import {
  AuthError,
  fetchAlerts,
  fetchBookings,
  fetchMe,
  fetchPets,
  logout,
  type PortalAlert,
  type PortalBooking,
  type PortalClient,
  type PortalPet,
} from './api';
import { SignIn } from './SignIn';
import { PortalHome } from './PortalHome';
import { PortalPets } from './PortalPets';
import { PortalReservations } from './PortalReservations';
import { PortalAccount } from './PortalAccount';
import './portal.css';
import { facilityToday } from '../facility-time';

export type PortalTab = 'home' | 'reservations' | 'pets' | 'account';

export interface PortalData {
  email: string;
  client: PortalClient;
  pets: PortalPet[];
  bookings: PortalBooking[];
  alerts: PortalAlert[];
}

export function PortalApp() {
  const [data, setData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [signedOut, setSignedOut] = useState(false);
  const [tab, setTab] = useState<PortalTab>('home');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [me, pets, bookings, alerts] = await Promise.all([
        fetchMe(),
        fetchPets(),
        fetchBookings(),
        fetchAlerts(),
      ]);
      setData({
        email: me.email,
        client: me.client,
        pets: pets.pets,
        bookings: bookings.bookings,
        alerts: alerts.alerts,
      });
      setSignedOut(false);
    } catch (e) {
      if (e instanceof AuthError) setSignedOut(true);
      else setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const signOut = async () => {
    await logout().catch(() => undefined);
    setData(null);
    setSignedOut(true);
  };

  if (loading) return <div className="pt-splash">Loading…</div>;
  if (signedOut || !data) {
    return (
      <SignIn
        onSignedIn={() => {
          setLoading(true);
          void load();
        }}
      />
    );
  }

  const upcoming = data.bookings.filter(
    (b) => b.status !== 'canceled' && b.endDate >= facilityToday(),
  );

  return (
    <div className="pt">
      <header className="pt-top">
        <div className="pt-brand">
          <span className="pt-mark">CC</span>
          <div>
            <b>Cedar Creek Pet Lodge</b>
            <small>{data.client.firstName}'s account</small>
          </div>
        </div>
        <button className="pt-signout" onClick={signOut}>Sign out</button>
      </header>

      {error && <div className="pt-error">{error}</div>}

      <main className="pt-main">
        {tab === 'home' && <PortalHome data={data} onGo={setTab} reload={load} />}
        {tab === 'reservations' && <PortalReservations data={data} reload={load} />}
        {tab === 'pets' && <PortalPets data={data} reload={load} />}
        {tab === 'account' && <PortalAccount data={data} reload={load} />}
      </main>

      <nav className="pt-tabs">
        {(
          [
            ['home', 'Home'],
            ['reservations', `Stays${upcoming.length ? ` (${upcoming.length})` : ''}`],
            ['pets', 'My pets'],
            ['account', 'Account'],
          ] as Array<[PortalTab, string]>
        ).map(([key, label]) => (
          <button
            key={key}
            className={tab === key ? 'on' : ''}
            onClick={() => setTab(key)}
            aria-current={tab === key ? 'page' : undefined}
          >
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
