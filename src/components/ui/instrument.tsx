import {cn} from '@/lib/cn';

export function InstrumentPanel({
  className,
  children,
  as: Comp = 'section',
}: {
  className?: string;
  children: React.ReactNode;
  as?: 'section' | 'div' | 'article';
}) {
  return <Comp className={cn('instrument instrument-ticks p-5 md:p-6', className)}>{children}</Comp>;
}

export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: 'default' | 'success' | 'warning' | 'danger';
}) {
  const color =
    tone === 'success'
      ? 'text-success'
      : tone === 'warning'
        ? 'text-warning'
        : tone === 'danger'
          ? 'text-danger'
          : 'text-fg';
  return (
    <InstrumentPanel className="min-h-32">
      <p className="text-xs uppercase tracking-micro text-fg-faint">{label}</p>
      <p className={cn('mt-3 font-display text-4xl tabular', color)}>{value}</p>
      {hint ? <p className="mt-2 text-sm text-fg-muted">{hint}</p> : null}
    </InstrumentPanel>
  );
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{value: T; label: string}>;
  ariaLabel: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="inline-flex rounded-md border border-border bg-bg-sunken p-1"
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="tab"
          aria-selected={value === opt.value}
          className={cn(
            'h-10 rounded-sm px-3 text-sm',
            value === opt.value ? 'bg-surface-2 text-fg' : 'text-fg-muted hover:text-fg',
          )}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
