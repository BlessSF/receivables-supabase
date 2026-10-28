import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './AuthContext';
import Layout from './Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Summary from './pages/Summary';
import Companies from './pages/Companies';
import Ledger from './pages/Ledger';
import Billing from './pages/Billing';
import Hmos from './pages/Hmos';
import CompanyCharges from './pages/CompanyCharges';
import Aging from './pages/Aging';
import PastDue from './pages/PastDue';
import SoaTracker from './pages/SoaTracker';
import Monitoring from './pages/Monitoring';
import ExecDashboard from './pages/ExecDashboard';
import MonthlyReport from './pages/MonthlyReport';
import Settings from './pages/Settings';
import Branches from './pages/Branches';
import Users from './pages/Users';
import CashPosition from './pages/CashPosition';
import MainFund from './pages/MainFund';
import AccountTitles from './pages/AccountTitles';
import RunningPayables from './pages/RunningPayables';
import PaymentRecord from './pages/PaymentRecord';
import { isExecutive, isStaff, isAccounting, navAllowed } from './utils';

function Gate() {
  const { user } = useAuth();

  if (user === undefined) {
    return <div className="loading-state" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Loading…</div>;
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
    <Route key="soa" path="/soa-tracker" element={g('/soa-tracker', <SoaTracker />)} />,
    <Route key="monitoring" path="/monitoring" element={g('/monitoring', <Monitoring />)} />,
    <Route key="p0" path="/payables" element={<Navigate to="/" replace />} />,
    <Route key="p1" path="/payables/cash-position" element={g('/payables/cash-position', <CashPosition />)} />,
    <Route key="p2" path="/payables/main" element={g('/payables/main', <MainFund />)} />,
    <Route key="p3" path="/payables/running" element={g('/payables/running', <RunningPayables />)} />,
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
        <Route path="/soa-tracker" element={g("/soa-tracker", <SoaTracker />)} />
        <Route path="/monitoring" element={g("/monitoring", <Monitoring />)} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/users" element={<Users />} />
        <Route path="/branches" element={<Branches />} />
        <Route path="/payables" element={<Navigate to="/payables/cash-position" replace />} />
        <Route path="/payables/cash-position" element={g("/payables/cash-position", <CashPosition />)} />
        <Route path="/payables/main" element={g("/payables/main", <MainFund />)} />
        <Route path="/payables/running" element={g("/payables/running", <RunningPayables />)} />
        <Route path="/payables/record" element={g("/payables/record", <PaymentRecord />)} />
        <Route path="/payables/titles" element={g("/payables/titles", <AccountTitles />)} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
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