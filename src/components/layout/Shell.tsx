import {useEffect, useState} from 'react';
import {Outlet, useLocation} from 'react-router-dom';
import {copy} from '@/lib/copy';
import {Rail} from './Rail';
import {Topbar} from './Topbar';
import {CommandPalette} from '@/components/command/CommandPalette';
import {Sky} from '@/sky/Sky';
import {NavLink} from 'react-router-dom';
import {copy as c} from '@/lib/copy';
import {cn} from '@/lib/cn';
import {useAuth} from '@/hooks/useAuth';

export function Shell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const {authenticated} = useAuth();
  const location = useLocation();

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  return (
    <div className="relative min-h-screen bg-bg text-fg">
      <Sky />
      <a href="#content" className="skip-link">
        {copy.a11y.skip}
      </a>
      <div className="relative flex min-h-screen">
        <Rail />
        {mobileOpen ? (
          <div className="fixed inset-0 z-40 md:hidden">
            <button
              type="button"
              className="absolute inset-0 bg-overlay"
              aria-label={copy.a11y.close}
              onClick={() => setMobileOpen(false)}
            />
            <div className="relative h-full w-72 border-r border-border bg-bg-sunken p-4">
              <nav className="flex flex-col gap-1">
                <NavLink className={linkClass} to="/">
                  {c.nav.home}
                </NavLink>
                {authenticated ? (
                  <>
                    <NavLink className={linkClass} to="/dashboard">{c.nav.dashboard}</NavLink>
                    <NavLink className={linkClass} to="/attendees">{c.nav.attendees}</NavLink>
                    <NavLink className={linkClass} to="/import">{c.nav.import}</NavLink>
                    <NavLink className={linkClass} to="/courses">{c.nav.courses}</NavLink>
                    <NavLink className={linkClass} to="/duplicates">{c.nav.duplicates}</NavLink>
                    <NavLink className={linkClass} to="/activity">{c.nav.activity}</NavLink>
                    <NavLink className={linkClass} to="/health">{c.nav.health}</NavLink>
                  </>
                ) : null}
                <NavLink className={linkClass} to="/verify">{c.nav.verify}</NavLink>
              </nav>
            </div>
          </div>
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar onMenu={() => setMobileOpen(true)} />
          <main id="content" className="relative flex-1 px-4 py-6 md:px-8 md:py-8">
            <Outlet />
          </main>
        </div>
      </div>
      <CommandPalette />
    </div>
  );
}

function linkClass({isActive}: {isActive: boolean}) {
  return cn(
    'flex h-11 items-center rounded-md px-3 text-sm',
    isActive ? 'bg-surface-2 text-fg' : 'text-fg-muted hover:text-fg',
  );
}
