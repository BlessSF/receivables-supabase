import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import { getBranding, applyTabBranding } from './branding';
import { isExecutive } from './utils';
import { IconDashboard, IconList, IconBuilding, IconTable, IconClock, IconAlert, IconHash, IconActivity, IconLogout } from './icons';

const NAV_GROUPS = [
  {
    items: [
      { to: '/', label: 'Dashboard', end: true, Icon: IconDashboard },
      { to: '/summary', label: 'Summary', Icon: IconList },
    ],
  },
  {
    label: 'Accounts',
    items: [
      { to: '/companies', label: 'Companies', Icon: IconBuilding },
      { to: '/ledger', label: 'Ledger', Icon: IconTable },
    ],
  },
  {
    label: 'Collections',
    items: [
      { to: '/aging', label: 'Aging Report', Icon: IconClock },
      { to: '/past-due', label: 'Past Due', Icon: IconAlert },
      { to: '/soa-tracker', label: 'SOA Tracker', Icon: IconHash },
      { to: '/monitoring', label: 'Monitoring', Icon: IconActivity },
    ],
  },
];

// Owner / accounting accounts: reports only
const EXEC_NAV_GROUPS = [
  {
    items: [
      { to: '/', label: 'Dashboard', end: true, Icon: IconDashboard },
    ],
  },
  {
    label: 'Reports',
    items: [
      { to: '/summary', label: 'Past Due Summary', Icon: IconList },
      { to: '/past-due', label: 'Past Due by Company', Icon: IconAlert },
      { to: '/aging', label: 'Aging Report', Icon: IconClock },
    ],
  },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const brand = getBranding(user);
  const displayName = brand.displayName;
  // Sidebar: full (with logo) by default. "Collapse sidebar" hides the labels
  // and is remembered. On a company's Ledger (14 columns) the sidebar
  // collapses automatically on laptop-size windows so the grid fits; the
  // expand button still brings it back.
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('rv_sidebar_collapsed') === '1'; } catch { return false; }
  });
  const [narrow, setNarrow] = useState(() => window.innerWidth < 1500);
  const [ledgerExpanded, setLedgerExpanded] = useState(false);
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 1500);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const onLedgerGrid = location.pathname === '/ledger' && new URLSearchParams(location.search).has('company_id');
  useEffect(() => {
    applyTabBranding(brand);
    return () => applyTabBranding(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brand.name, brand.initial, brand.color]);

  const autoCollapse = onLedgerGrid && narrow && !ledgerExpanded;
  const isCollapsed = collapsed || autoCollapse;

  function toggleCollapsed() {
    if (isCollapsed && !collapsed) { setLedgerExpanded(true); return; } // expand the auto-collapsed ledger view
    const next = !collapsed;
    if (next) setLedgerExpanded(false);
    setCollapsed(next);
    try { localStorage.setItem('rv_sidebar_collapsed', next ? '1' : '0'); } catch { /* ignore */ }
  }

  return (
    <div className={`shell${isCollapsed ? ' is-collapsed' : ''}`}>
      <aside className="sidebar">
        {brand.logo ? (
          <div className="brand brand-custom" data-initial={brand.initial} style={{ '--brand-color': brand.color }} title={brand.name}>
            <div className="brand-logo-card">
              <img src={brand.logo} alt={brand.name} />
            </div>
            <div className="brand-sub">Receivables Management</div>
          </div>
        ) : (
          <div className="brand">
            <span className="brand-mark">{brand.initial}</span>
            <div>
              <div className="brand-name">{brand.name}</div>
              <div className="brand-sub">Receivables Management</div>
            </div>
          </div>
        )}
        <nav className="sidebar-nav">
          {(isExecutive(user) ? EXEC_NAV_GROUPS : NAV_GROUPS).map((group, i) => (
            <div key={i} style={{ display: 'contents' }}>
              {group.label && <div className="nav-group-label">{group.label}</div>}
              {group.items.map(({ to, label, end, Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  title={label}
                  className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}
                >
                  <Icon />
                  <span>{label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <button className="collapse-btn" onClick={toggleCollapsed} title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /><path d="m21 18-6-6 6-6" opacity="0.5" /></svg>
            Collapse sidebar
          </button>
          <div className="sidebar-account">
            <div className="avatar" aria-hidden="true">{displayName.charAt(0).toUpperCase()}</div>
            <div>
              <div className="sidebar-user">{displayName}</div>
              <div className="sidebar-role">{isExecutive(user) ? 'Reports · view only' : user?.is_admin ? 'Admin · all branches' : `${user?.username} branch`}</div>
            </div>
          </div>
          <button className="logout-btn" onClick={logout} title="Log out"><IconLogout /> Log out</button>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}