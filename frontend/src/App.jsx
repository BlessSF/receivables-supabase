import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './AuthContext';
import Layout from './Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Summary from './pages/Summary';
import Companies from './pages/Companies';
import Ledger from './pages/Ledger';
import Aging from './pages/Aging';
import PastDue from './pages/PastDue';
import SoaTracker from './pages/SoaTracker';
import Monitoring from './pages/Monitoring';

function Gate() {
  const { user } = useAuth();

  if (user === undefined) {
    return <div className="loading-state" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Loading…</div>;
  }
  if (user === null) {
    return <Login />;
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/summary" element={<Summary />} />
        <Route path="/companies" element={<Companies />} />
        <Route path="/ledger" element={<Ledger />} />
        <Route path="/aging" element={<Aging />} />
        <Route path="/past-due" element={<PastDue />} />
        <Route path="/soa-tracker" element={<SoaTracker />} />
        <Route path="/monitoring" element={<Monitoring />} />
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
