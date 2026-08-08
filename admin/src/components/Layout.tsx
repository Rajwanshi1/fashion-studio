import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { CAPTURE_ACTIONS, NAV_SECTIONS, routeMeta } from '../lib/nav';
import { PageChromeContext } from '../lib/pageChrome';
import type { PageChromeValue } from '../lib/pageChrome';
import { PHONE_QUERY, useMediaQuery } from '../lib/useMediaQuery';
import BrandLogo from './BrandLogo';
import AppBar from './shell/AppBar';
import TabBar from './shell/TabBar';
import CaptureSheet from './shell/CaptureSheet';
import MoreSheet from './shell/MoreSheet';

const navClass = ({ isActive }: { isActive: boolean }) => (isActive ? 'on' : '');

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isPhone = useMediaQuery(PHONE_QUERY);

  // Page-scoped chrome. The title override is keyed to the path that set it, so a
  // detail page's dynamic title can never survive navigation to another route.
  const [titleOverride, setTitleOverride] = useState<{ path: string; title: string } | null>(null);
  const [searchPlaceholder, setSearchPlaceholder] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [captureOpen, setCaptureOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;

  useEffect(() => {
    setQuery('');
    setCaptureOpen(false);
    setMoreOpen(false);
  }, [location.pathname]);

  const setTitle = useCallback((title: string | null) => {
    setTitleOverride(title == null ? null : { path: pathRef.current, title });
  }, []);
  const registerSearch = useCallback((placeholder: string) => {
    setSearchPlaceholder(placeholder);
  }, []);
  const unregisterSearch = useCallback(() => {
    setSearchPlaceholder(null);
  }, []);

  const chrome = useMemo<PageChromeValue>(
    () => ({ setTitle, registerSearch, unregisterSearch, query, setQuery }),
    [setTitle, registerSearch, unregisterSearch, query],
  );

  const meta = routeMeta(location.pathname);
  const title =
    (titleOverride?.path === location.pathname ? titleOverride.title : null) ?? meta?.title ?? '';

  const signOut = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <PageChromeContext.Provider value={chrome}>
      <div className="admin">
        {!isPhone && (
          <aside className="side">
            <div className="brand">
              <NavLink to="/" className="wordmark">
                <BrandLogo />
                Tanvi Agnihotry
              </NavLink>
              <span className="atelier">· Atelier ·</span>
            </div>
            <nav aria-label="Admin">
              <div className="side-cap">
                {CAPTURE_ACTIONS.map((item) => (
                  <NavLink key={item.to} to={item.to} className={navClass}>
                    {item.label}
                  </NavLink>
                ))}
              </div>
              {NAV_SECTIONS.map((section) => (
                <div className="side-sec" key={section.title}>
                  <div className="sec-title">{section.title}</div>
                  {section.items.map((item) => (
                    <NavLink key={item.to} to={item.to} end={item.end} className={navClass}>
                      {item.label}
                    </NavLink>
                  ))}
                </div>
              ))}
            </nav>
            <div className="side-foot">
              {user && (
                <span className="who">
                  {user.firstName} {user.lastName}
                </span>
              )}
              <button type="button" className="signout" onClick={signOut}>
                Sign Out
              </button>
            </div>
          </aside>
        )}
        {isPhone && (
          <AppBar
            title={title}
            backTo={meta?.backTo}
            searchPlaceholder={searchPlaceholder}
            query={query}
            onQueryChange={setQuery}
          />
        )}
        <main className="canvas">
          <Outlet />
        </main>
        {isPhone && (
          <>
            <TabBar onCapture={() => setCaptureOpen(true)} onMore={() => setMoreOpen(true)} />
            <CaptureSheet open={captureOpen} onClose={() => setCaptureOpen(false)} />
            <MoreSheet
              open={moreOpen}
              onClose={() => setMoreOpen(false)}
              userName={user ? `${user.firstName} ${user.lastName}` : null}
              onSignOut={signOut}
            />
          </>
        )}
      </div>
    </PageChromeContext.Provider>
  );
}
