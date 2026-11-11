import type {AuditRow} from '@/lib/schemas';
import {formatHash, formatDateTime} from '@/lib/format';
import {cn} from '@/lib/cn';

export function HashChain({
  rows,
  highlightSeq,
}: {
  rows: AuditRow[];
  highlightSeq?: number;
}) {
  const ordered = [...rows].sort((a, b) => a.seq - b.seq).slice(-24);
  return (
    <ol className="space-y-2 font-mono text-xs">
      {ordered.map((row) => (
        <li
          key={row.id}
          className={cn(
            'rounded-md border border-border bg-bg-sunken px-3 py-2',
            highlightSeq === row.seq && 'border-accent',
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-2 text-fg">
            <span>#{row.seq}</span>
            <span className="text-fg-muted">{row.action}</span>
            <span className="text-fg-faint">{formatDateTime(row.at)}</span>
          </div>
          <p className="mt-1 text-fg-muted">
            {formatHash(row.prev_hash)} → {formatHash(row.row_hash)}
          </p>
        </li>
      ))}
    </ol>
  );
}
