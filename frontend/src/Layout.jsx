import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from './AuthContext';
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

export default function Layout() {
  const { user, logout } = useAuth();
  const displayName = user?.full_name || user?.username || '';

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">M</span>
          <div>
            <div className="brand-name">Multipliers</div>
            <div className="brand-sub">Receivables Management</div>
          </div>
        </div>
        <nav className="sidebar-nav">
          {NAV_GROUPS.map((group, i) => (
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
          <div className="sidebar-account">
            <div className="avatar" aria-hidden="true">{displayName.charAt(0).toUpperCase()}</div>
            <div>
              <div className="sidebar-user">{displayName}</div>
              <div className="sidebar-role">{user?.is_admin ? 'Admin · all branches' : `${user?.username} branch`}</div>
            </div>
          </div>
          <button className="logout-btn" onClick={logout}><IconLogout /> Log out</button>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}