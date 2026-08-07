import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { fetchTenantMeta, type TenantMeta } from './api';
import { Shell } from './components/Shell';
import { Dashboard } from './pages/Dashboard';
import { Board } from './pages/Board';
import { Clients } from './pages/Clients';
import { Calendar } from './pages/Calendar';
import { PetProfile } from './pages/PetProfile';
import { CareRounds } from './pages/CareRounds';
import { CareLogReport } from './pages/CareLogReport';

export default function App() {
  const [tenant, setTenant] = useState<TenantMeta | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchTenantMeta()
      .then((meta) => {
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
    <Shell tenant={tenant}>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/board" element={<Board />} />
        <Route path="/calendar" element={<Calendar />} />
        <Route path="/clients" element={<Clients />} />
        <Route path="/care" element={<CareRounds />} />
        <Route path="/reports/care-log" element={<CareLogReport />} />
        <Route path="/pets/:petId" element={<PetProfile />} />
      </Routes>
    </Shell>
  );
}
