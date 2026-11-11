import {copy} from '@/lib/copy';
import {cn} from '@/lib/cn';
import {Mark} from './Mark';

export function Wordmark({compact = false, className}: {compact?: boolean; className?: string}) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <Mark size={40} />
      {compact ? null : (
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="font-display text-lg text-fg">{copy.brand.name}</span>
          <span className="text-[11px] tracking-micro text-fg-faint">{copy.brand.tagline}</span>
        </span>
      )}
    </div>
  );
}
