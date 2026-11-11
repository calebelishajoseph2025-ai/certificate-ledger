import {NavLink} from 'react-router-dom';
import {copy} from '@/lib/copy';
import {cn} from '@/lib/cn';
import {Icons} from '@/components/ui/icon';
import {Wordmark} from '@/components/brand/Wordmark';
import {useAuth} from '@/hooks/useAuth';
import {useTheme} from '@/theme/ThemeProvider';

const items = [
  {to: '/dashboard', label: copy.nav.dashboard, icon: Icons.dashboard, auth: true},
  {to: '/attendees', label: copy.nav.attendees, icon: Icons.users, auth: true},
  {to: '/import', label: copy.nav.import, icon: Icons.upload, auth: true},
  {to: '/courses', label: copy.nav.courses, icon: Icons.book, auth: true},
  {to: '/duplicates', label: copy.nav.duplicates, icon: Icons.merge, auth: true},
  {to: '/activity', label: copy.nav.activity, icon: Icons.activity, auth: true},
  {to: '/health', label: copy.nav.health, icon: Icons.health, auth: true},
  {to: '/verify', label: copy.nav.verify, icon: Icons.badgeCheck, auth: false},
  {to: '/developers', label: copy.nav.developers, icon: Icons.hash, auth: false},
  {to: '/how-it-works/duplicates', label: copy.nav.duplicatesExplainer, icon: Icons.layers, auth: false},
];

export function Rail() {
  const {authenticated} = useAuth();
  const {rail, setRail} = useTheme();
  const collapsed = rail === 'collapsed';

  return (
    <aside
      className={cn(
        'no-print sticky top-0 hidden h-screen flex-col border-r border-border bg-bg-sunken/90 backdrop-blur md:flex',
        collapsed ? 'w-[72px]' : 'w-64',
      )}
    >
      <div className="flex h-16 shrink-0 items-center justify-between px-3">
        <NavLink to="/" aria-label={copy.brand.name}>
          <Wordmark compact={collapsed} />
        </NavLink>
        <button
          type="button"
          className="inline-flex h-10 w-10 items-center justify-center rounded-md hover:bg-surface-2"
          aria-label={collapsed ? copy.a11y.expandRail : copy.a11y.collapseRail}
          onClick={() => setRail(collapsed ? 'expanded' : 'collapsed')}
        >
          {collapsed ? <Icons.railOpen className="h-5 w-5" /> : <Icons.railClose className="h-5 w-5" />}
        </button>
      </div>
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3" aria-label="Primary">
        {items
          .filter((item) => !item.auth || authenticated)
          .map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({isActive}) =>
                cn(
                  'flex h-11 items-center gap-3 rounded-md px-3 text-sm text-fg-muted hover:bg-surface-2 hover:text-fg',
                  isActive && 'bg-surface-2 text-fg',
                )
              }
            >
              <item.icon className="h-5 w-5 shrink-0" />
              {collapsed ? <span className="sr-only">{item.label}</span> : item.label}
            </NavLink>
          ))}
      </nav>
      {collapsed ? null : (
        <div className="shrink-0 px-4 pb-5 text-[11px] leading-5 text-fg-faint">
          <p>{copy.brand.tagline}</p>
          <p className="mt-1">{copy.legal.educational}.</p>
        </div>
      )}
    </aside>
  );
}
