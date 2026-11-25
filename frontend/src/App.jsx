import { lazy, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { api } from './api';
import Maintenance from './pages/Maintenance';
import { AuthProvider, useAuth } from './AuthContext';
import Layout from './Layout';
import Login from './pages/Login';
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Summary = lazy(() => import('./pages/Summary'));
const Companies = lazy(() => import('./pages/Companies'));
const Ledger = lazy(() => import('./pages/Ledger'));
const Billing = lazy(() => import('./pages/Billing'));
const Hmos = lazy(() => import('./pages/Hmos'));
const CompanyCharges = lazy(() => import('./pages/CompanyCharges'));
const Aging = lazy(() => import('./pages/Aging'));
const PastDue = lazy(() => import('./pages/PastDue'));
const Combined = lazy(() => import('./pages/Combined'));
const PdcTracker = lazy(() => import('./pages/PdcTracker'));
const SoaTracker = lazy(() => import('./pages/SoaTracker'));
const Monitoring = lazy(() => import('./pages/Monitoring'));
const ExecDashboard = lazy(() => import('./pages/ExecDashboard'));
const MonthlyReport = lazy(() => import('./pages/MonthlyReport'));
const Settings = lazy(() => import('./pages/Settings'));
const Branches = lazy(() => import('./pages/Branches'));
const Users = lazy(() => import('./pages/Users'));
const CashPosition = lazy(() => import('./pages/CashPosition'));
const MainFund = lazy(() => import('./pages/MainFund'));
const AccountTitles = lazy(() => import('./pages/AccountTitles'));
const RunningPayables = lazy(() => import('./pages/RunningPayables'));
const PaymentRecord = lazy(() => import('./pages/PaymentRecord'));
const Audit = lazy(() => import('./pages/Audit'));
const DeletedItems = lazy(() => import('./pages/DeletedItems'));
import { isExecutive, isStaff, isAccounting, navAllowed } from './utils';

function GateInner({ maint, recheck }) {
  const { user, logout } = useAuth();
  const [adminLogin, setAdminLogin] = useState(false);

  if (user === undefined) {
    return <div className="loading-state" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Loading…</div>;
  }
  // Maintenance mode: only an admin gets past this point
  if (maint?.on && !(user && user.is_admin_role)) {
    if (user === null && adminLogin) {
      return (<><Login /><button type="button" className="mt-back" onClick={() => setAdminLogin(false)}>← Back to the maintenance notice</button></>);
    }
    return <Maintenance info={maint} signedIn={!!user} onAdmin={() => setAdminLogin(true)} onLogout={logout} onRecheck={recheck} />;
  }
  if (user === null) {
    return <Login />;
  }

  // A page the person's sidebar access has switched off sends them back to the dashboard
  const g = (path, el) => (navAllowed(user, path) ? el : <Navigate to="/" replace />);

  // Pages every non-admin role can be given; each one is switched on / off in Users > Sidebar access
  const pageRoutes = [
    <Route key="summary" path="/summary" element={g('/summary', <Summary />)} />,
    <Route key="rbm" path="/reports-by-month" element={g('/reports-by-month', <MonthlyReport />)} />,
    <Route key="companies" path="/companies" element={g('/companies', <Companies />)} />,
    <Route key="hmos" path="/hmos" element={g('/hmos', <Hmos />)} />,
    <Route key="charges" path="/company-charges" element={g('/company-charges', <CompanyCharges />)} />,
    <Route key="billing" path="/billing" element={g('/billing', <Billing />)} />,
    <Route key="ledger" path="/ledger" element={g('/ledger', <Ledger />)} />,
    <Route key="aging" path="/aging" element={g('/aging', <Aging />)} />,
    <Route key="pastdue" path="/past-due" element={g('/past-due', <PastDue />)} />,
    <Route key="combined" path="/combined" element={g('/combined', <Combined />)} />,
    <Route key="soa" path="/soa-tracker" element={g('/soa-tracker', <SoaTracker />)} />,
    <Route key="monitoring" path="/monitoring" element={g('/monitoring', <Monitoring />)} />,
    <Route key="p0" path="/payables" element={<Navigate to="/" replace />} />,
    <Route key="p1" path="/payables/cash-position" element={g('/payables/cash-position', <CashPosition />)} />,
    <Route key="p2" path="/payables/main" element={g('/payables/main', <MainFund />)} />,
    <Route key="p3" path="/payables/running" element={g('/payables/running', <RunningPayables />)} />,
    <Route key="p3b" path="/payables/pdc" element={g('/payables/pdc', <PdcTracker />)} />,
    <Route key="p4" path="/payables/record" element={g('/payables/record', <PaymentRecord />)} />,
    <Route key="p5" path="/payables/titles" element={g('/payables/titles', <AccountTitles />)} />,
  ];

  // Owner / executive accounts
  if (isExecutive(user)) {
    return (
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<ExecDashboard />} />
          {pageRoutes}
          <Route path="/users" element={<Users />} />
          <Route path="/audit" element={<Audit />} />
          <Route path="/deleted" element={<DeletedItems />} />
          <Route path="/branches" element={<Branches />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    );
  }

  // Staff accounts
  if (isStaff(user)) {
    return (
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          {pageRoutes}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    );
  }

  // Accounting accounts: all of Receivables, but not Users, Branches, Settings (Payables only if switched on for them)
  if (isAccounting(user)) {
    return (
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          {pageRoutes}
          <Route path="/deleted" element={<DeletedItems />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/summary" element={g("/summary", <Summary />)} />
        <Route path="/reports-by-month" element={g("/reports-by-month", <MonthlyReport />)} />
        <Route path="/companies" element={g("/companies", <Companies />)} />
        <Route path="/hmos" element={g("/hmos", <Hmos />)} />
          <Route path="/company-charges" element={g("/company-charges", <CompanyCharges />)} />
        <Route path="/billing" element={g("/billing", <Billing />)} />
        <Route path="/ledger" element={g("/ledger", <Ledger />)} />
        <Route path="/aging" element={g("/aging", <Aging />)} />
        <Route path="/past-due" element={g("/past-due", <PastDue />)} />
        <Route path="/combined" element={g("/combined", <Combined />)} />
        <Route path="/soa-tracker" element={g("/soa-tracker", <SoaTracker />)} />
        <Route path="/monitoring" element={g("/monitoring", <Monitoring />)} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/users" element={<Users />} />
        <Route path="/audit" element={<Audit />} />
        <Route path="/deleted" element={<DeletedItems />} />
        <Route path="/branches" element={<Branches />} />
        <Route path="/payables" element={<Navigate to="/payables/cash-position" replace />} />
        <Route path="/payables/cash-position" element={g("/payables/cash-position", <CashPosition />)} />
        <Route path="/payables/main" element={g("/payables/main", <MainFund />)} />
        <Route path="/payables/running" element={g("/payables/running", <RunningPayables />)} />
        <Route path="/payables/record" element={g("/payables/record", <PaymentRecord />)} />
        <Route path="/payables/pdc" element={g("/payables/pdc", <PdcTracker />)} />
        <Route path="/payables/titles" element={g("/payables/titles", <AccountTitles />)} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

function Gate() {
  const { user } = useAuth();
  const [maint, setMaint] = useState(null);
  const load = () => api.getMaintenance().then((r) => setMaint(r.maintenance || null)).catch(() => {});
  useEffect(() => {
    load();
    const t = setInterval(load, 30000); // picks up a switch-on or switch-off without a refresh
    return () => clearInterval(t);
  }, []);
  return (
    <>
      <GateInner maint={maint} recheck={load} />
      {maint?.on && user?.is_admin_role && <div className="mt-banner" role="status">Maintenance mode is ON — only admins can see the system. Turn it off in Settings → Maintenance.</div>}
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </BrowserRouter>
  );
}