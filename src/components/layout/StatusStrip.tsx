import {useQuery} from '@tanstack/react-query';
import {api} from '@/lib/api';
import {keys} from '@/lib/keys';
import {copy} from '@/lib/copy';
import {cn} from '@/lib/cn';

export function StatusStrip() {
  const health = useQuery({
    queryKey: keys.health(),
    queryFn: ({signal}) => api.getHealth(signal),
    refetchInterval: 30_000,
  });
  const ok = health.data?.ok;
  const db = health.data?.db;
  const dbError = (health.data as unknown as { dbError?: string | null })?.dbError;
  return (
    <div className="flex flex-wrap items-center gap-4 text-xs uppercase tracking-micro text-fg-muted">
      <span className="inline-flex items-center gap-2">
        <span className={cn('h-2.5 w-2.5 rounded-full', ok ? 'bg-success' : 'bg-danger')} />
        {copy.home.statusApi}: {ok ? copy.home.statusOnline : copy.home.statusOffline}
      </span>
      <span
        className="inline-flex items-center gap-2"
        title={!db && dbError ? `Database connection: ${dbError}` : undefined}
      >
        <span className={cn('h-2.5 w-2.5 rounded-full', db ? 'bg-success' : 'bg-danger')} />
        {copy.home.statusDb}: {db ? copy.home.statusOnline : copy.home.statusOffline}
      </span>
    </div>
  );
}
