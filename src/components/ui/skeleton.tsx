import {cn} from '@/lib/cn';

export function Skeleton({className}: {className?: string}) {
  return <div className={cn('animate-pulse rounded-md bg-surface-2', className)} />;
}

export function EmptyState({title, body, action}: {title: string; body?: string; action?: React.ReactNode}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <p className="font-display text-2xl text-fg">{title}</p>
      {body ? <p className="max-w-md text-sm text-fg-muted">{body}</p> : null}
      {action}
    </div>
  );
}

export function ErrorState({title, body, action}: {title: string; body?: string; action?: React.ReactNode}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-lg border border-danger/40 bg-danger/10 p-6"
    >
      <p className="font-medium text-danger">{title}</p>
      {body ? <p className="text-sm text-fg-muted">{body}</p> : null}
      {action}
    </div>
  );
}
