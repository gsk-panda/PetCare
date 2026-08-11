import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { fetchStaffMe, fetchTenantMeta, type StaffUser, type TenantMeta } from './api';
import { Shell } from './components/Shell';
import { StaffSignIn } from './components/StaffSignIn';
import { StaffContext } from './staff-context';
import { setFacilityTimezone } from './facility-time';
import { Dashboard } from './pages/Dashboard';
import { Board } from './pages/Board';
import { Clients } from './pages/Clients';
import { BoardingCalendar } from './pages/BoardingCalendar';
import { DaycareCalendar } from './pages/DaycareCalendar';
import { Settings } from './pages/Settings';
import { PetProfile } from './pages/PetProfile';
import { CareRounds } from './pages/CareRounds';
import { CareLogReport } from './pages/CareLogReport';
import { Reports } from './pages/Reports';
import { Outbox } from './pages/Outbox';
import { OccupancyReport } from './pages/OccupancyReport';
import { RevenueReport } from './pages/RevenueReport';
import { VaccinationReport } from './pages/VaccinationReport';
import { PortalApp } from './portal/PortalApp';

export default function App() {
  const [tenant, setTenant] = useState<TenantMeta | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchTenantMeta()
      .then((meta) => {
        // Before setTenant, so nothing renders a date against the wrong zone.
        setFacilityTimezone(meta.timezone);
        setTenant(meta);
        document.title = meta.theme.appName;
        // White-label: tenant theme config overrides the brand tokens at runtime.
        const root = document.documentElement.style;
        root.setProperty('--brand', meta.theme.primary);
        root.setProperty('--brand-deep', meta.theme.primaryDeep);
        root.setProperty('--brand-tint', meta.theme.primaryTint);
        root.setProperty('--accent', meta.theme.accent);
        root.setProperty('--accent-ink', meta.theme.accentText);
        root.setProperty('--chrome', meta.theme.chrome);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) {
    return (
      <div className="hint error">
        Could not reach the API ({error}). Is <code>npm run dev:api</code> running?
      </div>
    );
  }
  if (!tenant) return <div className="hint">Loading…</div>;

  return (
    <Routes>
      {/* The owner-facing portal has its own shell, navigation and density. */}
      <Route path="/portal/*" element={<PortalApp />} />
      <Route path="/*" element={<StaffApp tenant={tenant} />} />
    </Routes>
  );
}

function StaffApp({ tenant }: { tenant: TenantMeta }) {
  const [staff, setStaff] = useState<StaffUser | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    fetchStaffMe()
      .then((r) => setStaff(r.staff))
      .catch(() => setStaff(null))
      .finally(() => setChecking(false));
  }, []);

  if (checking) return <div className="hint">Loading…</div>;
  if (!staff) {
    return <StaffSignIn tenantName={tenant.name} onSignedIn={setStaff} />;
  }

  return (
    <StaffContext.Provider value={staff}>
    <Shell tenant={tenant} staff={staff} onSignedOut={() => setStaff(null)}>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/board" element={<Board />} />
        <Route path="/calendar" element={<Navigate to="/calendar/boarding" replace />} />
        <Route path="/calendar/boarding" element={<BoardingCalendar />} />
        <Route path="/calendar/daycare" element={<DaycareCalendar />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/clients" element={<Clients />} />
        <Route path="/care" element={<CareRounds />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/email" element={<Outbox />} />
        <Route path="/reports/care-log" element={<CareLogReport />} />
        <Route path="/reports/occupancy" element={<OccupancyReport />} />
        <Route path="/reports/revenue" element={<RevenueReport />} />
        <Route path="/reports/vaccinations" element={<VaccinationReport />} />
        <Route path="/pets/:petId" element={<PetProfile />} />
      </Routes>
    </Shell>
    </StaffContext.Provider>
  );
}
