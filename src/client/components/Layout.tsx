import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import { IconCalendar, IconCart, IconLeaf, IconSearch } from './Icons';

function IconBook({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5zM20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z" />
    </svg>
  );
}
function IconGear({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" />
    </svg>
  );
}

const NAV = [
  { to: '/', label: 'Discover', icon: IconSearch, end: true },
  { to: '/recipes', label: 'My Recipes', icon: IconBook, end: false },
  { to: '/planner', label: 'Meal Planner', icon: IconCalendar, end: false },
  { to: '/shopping', label: 'Shopping List', icon: IconCart, end: false },
  { to: '/pantry', label: 'Pantry', icon: IconLeaf, end: false },
];

export function Layout() {
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const first = useRef(true);

  // Move focus to the page on navigation so screen-reader users hear the new page.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    mainRef.current?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <div className="site-header-inner">
          <NavLink to="/" className="brand" aria-label="The Cookbook, home">
            <svg viewBox="0 0 64 64" width="30" height="30" aria-hidden="true">
              <path d="M14 30h36a18 18 0 0 1-36 0z" fill="var(--accent)" />
              <path d="M10 30h44" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
              <path d="M26 22c0-4 4-4 4-8M34 22c0-4 4-4 4-8" stroke="var(--accent)" strokeWidth="3.5" fill="none" strokeLinecap="round" />
            </svg>
            <span>The Cookbook</span>
          </NavLink>
          <nav className="main-nav" aria-label="Main">
            <ul>
              {NAV.map(({ to, label, icon: Icon, end }) => (
                <li key={to}>
                  <NavLink to={to} end={end} className="nav-link">
                    <Icon size={20} />
                    <span>{label}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
          <NavLink to="/settings" className="nav-settings icon-btn" aria-label="Settings and backup" title="Settings and backup">
            <IconGear />
          </NavLink>
        </div>
      </header>
      <main id="main" ref={mainRef} tabIndex={-1} className="main">
        <Outlet />
      </main>
      <footer className="site-footer">
        <p>Your recipes are stored on this computer. Nothing is sent anywhere.</p>
      </footer>
    </div>
  );
}
