import { NavLink, Outlet } from 'react-router-dom';
import { useEffect } from 'react';
import { useAuth } from './AuthContext';
import { getBranding, applyTabBranding } from './branding';
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
  const brand = getBranding(user);
  const displayName = brand.displayName;

  useEffect(() => {
    applyTabBranding(brand);
    return () => applyTabBranding(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brand.name, brand.initial, brand.color]);

  return (
    <div className="shell">
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
          <button className="logout-btn" onClick={logout} title="Log out"><IconLogout /> Log out</button>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}