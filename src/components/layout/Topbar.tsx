import {useLocation, useNavigate} from 'react-router-dom';
import {copy} from '@/lib/copy';
import {Icons} from '@/components/ui/icon';
import {useAuth} from '@/hooks/useAuth';
import {useTheme} from '@/theme/ThemeProvider';
import {NativeSelect} from '@/components/ui/select';
import {StatusStrip} from './StatusStrip';
import {THEME_NAMES} from '@/theme/themes';

export function Topbar({onMenu}: {onMenu: () => void}) {
  const {authenticated, logout} = useAuth();
  const {theme, setTheme} = useTheme();
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <header className="no-print flex h-16 items-center gap-3 border-b border-border bg-bg/80 px-4 backdrop-blur">
      <button
        type="button"
        className="inline-flex h-10 w-10 items-center justify-center rounded-md hover:bg-surface-2 md:hidden"
        aria-label={copy.a11y.openMenu}
        onClick={onMenu}
      >
        <Icons.menu className="h-5 w-5" />
      </button>
      <div className="hidden md:block">
        <StatusStrip />
      </div>
      <p
        className="hidden rounded-md border border-border px-2.5 py-1 text-xs text-fg-muted lg:block"
        title={copy.legal.educationalLede}
      >
        {copy.legal.educational}
      </p>
      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          className="inline-flex h-10 items-center gap-2 rounded-md border border-border px-3 text-sm text-fg-muted hover:text-fg"
          onClick={() =>
            window.dispatchEvent(new KeyboardEvent('keydown', {key: 'k', ctrlKey: true}))
          }
        >
          <Icons.command className="h-5 w-5" />
          <span className="hidden xl:inline">{copy.nav.command}</span>
        </button>
        <label className="flex h-11 items-center gap-2 text-sm text-fg-muted">
          <span className="hidden shrink-0 sm:inline">{copy.a11y.theme}</span>
          <NativeSelect
            aria-label={copy.a11y.theme}
            value={theme}
            onChange={(e) => setTheme(e.target.value as typeof theme)}
            className="min-w-36"
          >
            {THEME_NAMES.map((name) => (
              <option key={name} value={name}>
                {copy.themes[name]}
              </option>
            ))}
          </NativeSelect>
        </label>
        {authenticated ? (
          <button
            type="button"
            className="inline-flex h-10 items-center gap-2 rounded-md px-3 text-sm hover:bg-surface-2"
            onClick={() => logout()}
          >
            <Icons.logout className="h-5 w-5" />
            {copy.nav.logout}
          </button>
        ) : location.pathname !== '/login' ? (
          <button
            type="button"
            className="inline-flex h-10 items-center rounded-md bg-accent px-3 text-sm text-accent-fg"
            onClick={() => navigate('/login')}
          >
            {copy.nav.login}
          </button>
        ) : null}
      </div>
    </header>
  );
}
