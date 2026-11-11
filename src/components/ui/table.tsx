import {cn} from '@/lib/cn';

export function Table({children, className}: {children: React.ReactNode; className?: string}) {
  return (
    <div className={cn('overflow-x-auto rounded-lg border border-border', className)}>
      <table className="w-full min-w-[960px] border-collapse text-left text-sm">{children}</table>
    </div>
  );
}

export function THead({children}: {children: React.ReactNode}) {
  return (
    <thead className="bg-surface-2 text-xs uppercase tracking-micro text-fg-faint">
      {children}
    </thead>
  );
}

export function TBody({children}: {children: React.ReactNode}) {
  return <tbody className="divide-y divide-border">{children}</tbody>;
}

export function TR({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr className={cn('hover:bg-surface-2/60', className)} {...props}>
      {children}
    </tr>
  );
}

export function TH({children, className}: {children: React.ReactNode; className?: string}) {
  return <th className={cn('px-4 py-3 font-medium', className)}>{children}</th>;
}

export function TD({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={cn('px-4 py-3 align-middle text-fg', className)}>{children}</td>;
}
