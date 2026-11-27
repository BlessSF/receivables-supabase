import { lazy, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { api } from './api';
import Maintenance from './pages/Maintenance';
import { AuthProvider, useAuth } from './AuthContext';
import Layout from './Layout';
import Login from './pages/Login';
// Each page is its own chunk. The loaders are kept here so the chunks can also be
// fetched ahead of time (see prefetchPages), which makes navigation feel instant.
const loaders = {
  Dashboard: () => import('./pages/Dashboard'),
  Summary: () => import('./pages/Summary'),
  Companies: () => import('./pages/Companies'),
  Ledger: () => import('./pages/Ledger'),
  Discounts: () => import('./pages/Discounts'),
  Billing: () => import('./pages/Billing'),
  Hmos: () => import('./pages/Hmos'),
  CompanyCharges: () => import('./pages/CompanyCharges'),
  Aging: () => import('./pages/Aging'),
  PastDue: () => import('./pages/PastDue'),
  Combined: () => import('./pages/Combined'),
  PdcTracker: () => import('./pages/PdcTracker'),
  SoaTracker: () => import('./pages/SoaTracker'),
  Monitoring: () => import('./pages/Monitoring'),
  ExecDashboard: () => import('./pages/ExecDashboard'),
  MonthlyReport: () => import('./pages/MonthlyReport'),
  Settings: () => import('./pages/Settings'),
  Branches: () => import('./pages/Branches'),
  Users: () => import('./pages/Users'),
  CashPosition: () => import('./pages/CashPosition'),
  MainFund: () => import('./pages/MainFund'),
  AccountTitles: () => import('./pages/AccountTitles'),
  RunningPayables: () => import('./pages/RunningPayables'),
  PaymentRecord: () => import('./pages/PaymentRecord'),
  Audit: () => import('./pages/Audit'),
  DeletedItems: () => import('./pages/DeletedItems'),
};
function prefetchPages() {
  const run = () => Object.values(loaders).forEach((load) => load().catch(() => {}));
  if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 4000 });
  else setTimeout(run, 1500);
}

const Dashboard = lazy(loaders.Dashboard);
const Summary = lazy(loaders.Summary);
const Companies = lazy(loaders.Companies);
const Ledger = lazy(loaders.Ledger);
const Discounts = lazy(loaders.Discounts);
const Billing = lazy(loaders.Billing);
const Hmos = lazy(loaders.Hmos);
const CompanyCharges = lazy(loaders.CompanyCharges);
const Aging = lazy(loaders.Aging);
const PastDue = lazy(loaders.PastDue);
const Combined = lazy(loaders.Combined);
const PdcTracker = lazy(loaders.PdcTracker);
const SoaTracker = lazy(loaders.SoaTracker);
const Monitoring = lazy(loaders.Monitoring);
const ExecDashboard = lazy(loaders.ExecDashboard);
const MonthlyReport = lazy(loaders.MonthlyReport);
const Settings = lazy(loaders.Settings);
const Branches = lazy(loaders.Branches);
const Users = lazy(loaders.Users);
const CashPosition = lazy(loaders.CashPosition);
const MainFund = lazy(loaders.MainFund);
const AccountTitles = lazy(loaders.AccountTitles);
const RunningPayables = lazy(loaders.RunningPayables);
const PaymentRecord = lazy(loaders.PaymentRecord);
const Audit = lazy(loaders.Audit);
const DeletedItems = lazy(loaders.DeletedItems);
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
    <Route key="discounts" path="/discounts" element={g('/discounts', <Discounts />)} />,
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
        <Route path="/discounts" element={g("/discounts", <Discounts />)} />
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
  // Once someone is signed in, quietly download the rest of the pages in the background
  const signedIn = !!user;
  useEffect(() => { if (signedIn) prefetchPages(); }, [signedIn]);
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