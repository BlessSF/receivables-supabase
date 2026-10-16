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
import Users from './pages/Users';
import { isExecutive, isStaff } from './utils';

function Gate() {
  const { user } = useAuth();

  if (user === undefined) {
    return <div className="loading-state" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Loading…</div>;
  }
  if (user === null) {
    return <Login />;
  }

  // Owner / accounting accounts: report pages only
  if (isExecutive(user)) {
    return (
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<ExecDashboard />} />
          <Route path="/summary" element={<Summary />} />
          <Route path="/past-due" element={<PastDue />} />
          <Route path="/aging" element={<Aging />} />
          <Route path="/reports-by-month" element={<MonthlyReport />} />
          <Route path="/ledger" element={<Ledger />} />
          <Route path="/users" element={<Users />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    );
  }

  // Staff accounts: dashboard, every company's ledger, reports by month
  if (isStaff(user)) {
    return (
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/companies" element={<Companies />} />
          <Route path="/hmos" element={<Hmos />} />
          <Route path="/company-charges" element={<CompanyCharges />} />
          <Route path="/ledger" element={<Ledger />} />
          <Route path="/reports-by-month" element={<MonthlyReport />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/summary" element={<Summary />} />
        <Route path="/reports-by-month" element={<MonthlyReport />} />
        <Route path="/companies" element={<Companies />} />
        <Route path="/hmos" element={<Hmos />} />
          <Route path="/company-charges" element={<CompanyCharges />} />
        <Route path="/billing" element={<Billing />} />
        <Route path="/ledger" element={<Ledger />} />
        <Route path="/aging" element={<Aging />} />
        <Route path="/past-due" element={<PastDue />} />
        <Route path="/soa-tracker" element={<SoaTracker />} />
        <Route path="/monitoring" element={<Monitoring />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/users" element={<Users />} />
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