import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import { getBranding, applyTabBranding } from './branding';
import { isExecutive, isStaff } from './utils';
import { IconDashboard, IconList, IconBuilding, IconTable, IconClock, IconAlert, IconHash, IconActivity, IconCalendar, IconLogout, IconReceipt, IconHeart, IconSettings, IconUsers, IconCoins, IconBranches, IconWallet, IconBook, IconChecklist, IconPenPlus } from './icons';

// The Ledger grid has 15 columns; below this window width the sidebar folds away on it so they fit.
const LEDGER_NARROW_PX = 1700;

const NAV_GROUPS = [
  {
    items: [
      { to: '/', label: 'Dashboard', end: true, Icon: IconDashboard },
      { to: '/summary', label: 'Summary', Icon: IconList },
      { to: '/reports-by-month', label: 'Reports by Month', Icon: IconCalendar },
    ],
  },
  {
    label: 'Accounts',
    items: [
      { to: '/companies', label: 'Companies', Icon: IconBuilding },
      { to: '/hmos', label: 'HMOs', Icon: IconHeart },
      { to: '/company-charges', label: 'Company Charges', Icon: IconCoins },
      { to: '/billing', label: 'Billing', Icon: IconReceipt },
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

// Payables module (admin): Cash Position is the dashboard, Main is automatic but editable, Running Payables is the source list
const PAYABLES_NAV_GROUPS = [
  {
    items: [
      { to: '/payables/cash-position', label: 'Cash Position', Icon: IconWallet },
      { to: '/payables/main', label: 'Main', Icon: IconBook },
      { to: '/payables/running', label: 'Running Payables', Icon: IconChecklist },
      { to: '/payables/record', label: 'Payment Record', Icon: IconPenPlus },
      { to: '/payables/titles', label: 'Account Titles', Icon: IconList },
    ],
  },
];

// Admin accounts also get Settings
const SETTINGS_GROUP = {
  label: 'System',
  items: [
    { to: '/users', label: 'Users', Icon: IconUsers },
    { to: '/branches', label: 'Branches', Icon: IconBranches },
    { to: '/settings', label: 'Settings', Icon: IconSettings },
  ],
};

// Staff accounts: dashboard, monthly report, companies + HMOs (view only) and the ledger (all companies)
const STAFF_NAV_GROUPS = [
  {
    items: [
      { to: '/', label: 'Dashboard', end: true, Icon: IconDashboard },
      { to: '/reports-by-month', label: 'Reports by Month', Icon: IconCalendar },
    ],
  },
  {
    label: 'Accounts',
    items: [
      { to: '/companies', label: 'Companies', Icon: IconBuilding },
      { to: '/hmos', label: 'HMOs', Icon: IconHeart },
      { to: '/company-charges', label: 'Company Charges', Icon: IconCoins },
      { to: '/billing', label: 'Billing', Icon: IconReceipt },
      { to: '/ledger', label: 'Ledger', Icon: IconTable },
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
      { to: '/reports-by-month', label: 'Reports by Month', Icon: IconCalendar },
    ],
  },
  {
    label: 'Accounts',
    items: [
      { to: '/ledger', label: 'Ledger', Icon: IconTable },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/branches', label: 'Branches', Icon: IconBranches },
      { to: '/users', label: 'Users', Icon: IconUsers },
    ],
  },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const brand = getBranding(user);
  const displayName = brand.displayName;
  // Sidebar: full (with logo) by default. "Collapse sidebar" hides the labels
  // and is remembered. On a company's Ledger (15 columns) the sidebar
  // collapses automatically on laptop-size windows so the grid fits; the
  // expand button still brings it back.
  const location = useLocation();
  const navigate = useNavigate();
  const inPayables = location.pathname.startsWith('/payables');
  const showModuleToggle = !!user?.is_admin && !isExecutive(user) && !isStaff(user);
  function switchModule(mod) {
    if (mod === 'payables') {
      let last = '/payables/cash-position';
      try { last = localStorage.getItem('rv_last_payables_path') || last; } catch { /* ignore */ }
      navigate(last);
    } else {
      navigate('/');
    }
  }
  useEffect(() => {
    if (!inPayables) return;
    try { localStorage.setItem('rv_last_payables_path', location.pathname); } catch { /* ignore */ }
  }, [inPayables, location.pathname]);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('rv_sidebar_collapsed') === '1'; } catch { return false; }
  });
  const [narrow, setNarrow] = useState(() => window.innerWidth < LEDGER_NARROW_PX);
  const [ledgerExpanded, setLedgerExpanded] = useState(false);
  const [drawer, setDrawer] = useState(false); // phone: slide-out menu
  useEffect(() => { setDrawer(false); }, [location.pathname, location.search]);
  useEffect(() => {
    if (!drawer) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setDrawer(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawer]);
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < LEDGER_NARROW_PX);
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
    <div className={`shell${isCollapsed ? ' is-collapsed' : ''}${drawer ? ' drawer-open' : ''}`}>
      <header className="mobile-bar">
        <button type="button" className="mobile-menu-btn" onClick={() => setDrawer(true)} aria-label="Open menu" aria-expanded={drawer}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
        </button>
        <span className="mobile-bar-title">{brand.name}</span>
      </header>
      <div className="drawer-backdrop" onClick={() => setDrawer(false)} />
      <aside className="sidebar">
        {brand.logo ? (
          <div className="brand brand-custom" data-initial={brand.initial} style={{ '--brand-color': brand.color }} title={brand.name}>
            <div className="brand-logo-card">
              <img src={brand.logo} alt={brand.name} />
            </div>
          </div>
        ) : (
          <div className="brand">
            <div>
              <div className="brand-name">{brand.name}</div>
            </div>
          </div>
        )}
        {showModuleToggle && (
          <div className="module-toggle" role="tablist" aria-label="Module">
            <button type="button" role="tab" aria-selected={!inPayables} className={'module-seg receivables' + (!inPayables ? ' active' : '')} onClick={() => switchModule('receivables')} title="Receivables">
              <span>Receivables</span>
            </button>
            <button type="button" role="tab" aria-selected={inPayables} className={'module-seg payables' + (inPayables ? ' active' : '')} onClick={() => switchModule('payables')} title="Payables">
              <span>Payables</span>
            </button>
          </div>
        )}
        <nav className="sidebar-nav">
          {(inPayables && showModuleToggle ? PAYABLES_NAV_GROUPS : isExecutive(user) ? EXEC_NAV_GROUPS : isStaff(user) ? STAFF_NAV_GROUPS : user?.is_admin ? [...NAV_GROUPS, SETTINGS_GROUP] : NAV_GROUPS).map((group, i) => (
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
              <div className="sidebar-role">{isExecutive(user) ? 'Executive · view only' : isStaff(user) ? 'Staff' : user?.is_admin ? 'Admin · all branches' : `${user?.username} branch`}</div>
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