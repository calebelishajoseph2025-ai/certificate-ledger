import {cn} from '@/lib/cn';

const tones = {
  default: 'bg-surface-2 text-fg-muted border-border',
  success: 'bg-success/15 text-success border-success/30',
  warning: 'bg-warning/15 text-warning border-warning/30',
  danger: 'bg-danger/15 text-danger border-danger/30',
  accent: 'bg-accent/15 text-accent border-accent/30',
  info: 'bg-info/15 text-info border-info/30',
} as const;

export function Badge({
  children,
  tone = 'default',
  className,
}: {
  children: React.ReactNode;
  tone?: keyof typeof tones;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex min-h-6 items-center rounded-full border px-2.5 text-xs font-medium tracking-micro',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Chip({
  active,
  children,
  onClick,
}: {
  active?: boolean;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-10 items-center rounded-full border px-3 text-sm transition-colors',
        active ? 'border-accent bg-accent/15 text-fg' : 'border-border bg-surface-1 text-fg-muted hover:text-fg',
      )}
    >
      {children}
    </button>
  );
}
