import {useEffect, useMemo, useState} from 'react';
import {Command} from 'cmdk';
import {useNavigate} from 'react-router-dom';
import {copy} from '@/lib/copy';
import {useAuth} from '@/hooks/useAuth';
import {useHotkeys} from '@/hooks/useHotkeys';
import {useQuery} from '@tanstack/react-query';
import {api} from '@/lib/api';
import {keys} from '@/lib/keys';
import {useDebounce} from '@/hooks/useDebounce';
import {Icons} from '@/components/ui/icon';

const PUBLIC_PAGES = [
  {to: '/', label: copy.nav.home, icon: Icons.home},
  {to: '/verify', label: copy.nav.verify, icon: Icons.badgeCheck},
  {to: '/developers', label: copy.nav.developers, icon: Icons.hash},
  {to: '/how-it-works/duplicates', label: copy.nav.duplicatesExplainer, icon: Icons.layers},
  {to: '/login', label: copy.nav.login, icon: Icons.key},
];

const PRIVATE_PAGES = [
  {to: '/dashboard', label: copy.nav.dashboard, icon: Icons.dashboard},
  {to: '/attendees', label: copy.nav.attendees, icon: Icons.users},
  {to: '/import', label: copy.nav.import, icon: Icons.upload},
  {to: '/courses', label: copy.nav.courses, icon: Icons.book},
  {to: '/duplicates', label: copy.nav.duplicates, icon: Icons.merge},
  {to: '/activity', label: copy.nav.activity, icon: Icons.activity},
  {to: '/health', label: copy.nav.health, icon: Icons.health},
];

const groupClass =
  '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-micro [&_[cmdk-group-heading]]:text-fg-faint';

const itemClass =
  'flex h-11 cursor-pointer items-center gap-3 rounded-md px-3 text-sm text-fg-muted data-[selected=true]:bg-surface-2 data-[selected=true]:text-fg';

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const debounced = useDebounce(query, 250);
  const navigate = useNavigate();
  const {authenticated} = useAuth();

  useHotkeys(
    useMemo(
      () => ({
        'mod+k': () => setOpen((v) => !v),
      }),
      [],
    ),
  );

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const attendees = useQuery({
    queryKey: keys.attendees({q: debounced}),
    queryFn: ({signal}) => api.getAttendees({q: debounced}, signal),
    enabled: open && authenticated && debounced.length > 1,
  });

  const go = (to: string) => {
    setOpen(false);
    navigate(to);
  };

  if (!open) return null;

  const pages = authenticated ? [...PUBLIC_PAGES.filter((p) => p.to !== '/login'), ...PRIVATE_PAGES] : PUBLIC_PAGES;

  return (
    <div className="fixed inset-0 z-[80]">
      <button
        type="button"
        className="absolute inset-0 bg-overlay"
        aria-label={copy.a11y.close}
        onClick={() => setOpen(false)}
      />
      <Command
        label={copy.nav.command}
        className="instrument instrument-ticks relative mx-auto mt-[12vh] w-[min(92vw,640px)] overflow-hidden bg-bg-elevated shadow-2xl"
      >
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Icons.search className="h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
          <Command.Input
            value={query}
            onValueChange={setQuery}
            placeholder={copy.command.placeholder}
            className="h-14 min-w-0 flex-1 bg-transparent text-base text-fg outline-none placeholder:text-fg-faint"
          />
          <kbd className="hidden h-7 shrink-0 items-center rounded-md border border-border px-2 font-mono text-[11px] text-fg-muted sm:inline-flex">
            Esc
          </kbd>
        </div>
        <Command.List className="max-h-80 overflow-y-auto p-2">
          <Command.Empty className="px-3 py-8 text-center text-sm text-fg-muted">{copy.command.empty}</Command.Empty>
          <Command.Group heading={copy.command.pages} className={groupClass}>
            {pages.map((page) => (
              <Command.Item key={page.to} value={page.label} onSelect={() => go(page.to)} className={itemClass}>
                <page.icon className="h-5 w-5 shrink-0 text-accent" />
                <span>{page.label}</span>
              </Command.Item>
            ))}
          </Command.Group>
          {authenticated && attendees.data?.attendees.length ? (
            <Command.Group heading={copy.command.attendees} className={groupClass}>
              {attendees.data.attendees.slice(0, 8).map((row) => (
                <Command.Item
                  key={row.id}
                  value={`${row.full_name} ${row.email_norm}`}
                  onSelect={() => go('/attendees')}
                  className={itemClass}
                >
                  <Icons.users className="h-5 w-5 shrink-0 text-accent" />
                  <span className="min-w-0 truncate">{row.full_name}</span>
                  <span className="ml-auto shrink-0 font-mono text-xs text-fg-faint">{row.course_code}</span>
                </Command.Item>
              ))}
            </Command.Group>
          ) : null}
        </Command.List>
        <div className="flex items-center gap-4 border-t border-border px-4 py-2.5 text-[11px] text-fg-faint">
          <span className="inline-flex items-center gap-1.5">
            <kbd className="rounded border border-border px-1.5 py-0.5 font-mono">↑↓</kbd>
            {copy.command.hintMove}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <kbd className="rounded border border-border px-1.5 py-0.5 font-mono">↵</kbd>
            {copy.command.hintOpen}
          </span>
          <span className="ml-auto inline-flex items-center gap-1.5">
            <kbd className="rounded border border-border px-1.5 py-0.5 font-mono">Esc</kbd>
            {copy.command.hintClose}
          </span>
        </div>
      </Command>
    </div>
  );
}

export function openCommandPalette(): void {
  window.dispatchEvent(new KeyboardEvent('keydown', {key: 'k', metaKey: true}));
}
