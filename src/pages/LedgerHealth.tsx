import {useQuery} from '@tanstack/react-query';
import {api} from '@/lib/api';
import {keys} from '@/lib/keys';
import {copy} from '@/lib/copy';
import {Button} from '@/components/ui/button';
import {InstrumentPanel} from '@/components/ui/instrument';
import {IntegrityProbe} from '@/components/flow/IntegrityProbe';
import {Badge} from '@/components/ui/badge';
import {Skeleton, ErrorState} from '@/components/ui/skeleton';

export default function LedgerHealthPage() {
  const health = useQuery({
    queryKey: keys.ledgerHealth(),
    queryFn: ({signal}) => api.getLedgerHealth(signal),
  });

  if (health.isLoading) return <Skeleton className="h-96" />;
  if (health.error || !health.data) return <ErrorState title={copy.errors.generic} />;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-4xl">{copy.health.title}</h1>
        <Button variant="secondary" onClick={() => health.refetch()}>
          {copy.health.rerun}
        </Button>
      </div>
      <p className="mt-2 text-sm text-fg-muted">
        {health.data.ok ? 'All hard checks passed' : 'One or more checks failed'} · {health.data.duration_ms}ms
      </p>
      <div className="mt-6 grid gap-3">
        {health.data.checks.map((check) => (
          <InstrumentPanel key={check.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-xl">{check.label}</h2>
                <p className="mt-1 text-sm text-fg-muted">{check.detail}</p>
              </div>
              <Badge tone={check.status === 'pass' ? 'success' : check.status === 'warn' ? 'warning' : 'danger'}>
                {check.status}
              </Badge>
            </div>
          </InstrumentPanel>
        ))}
      </div>
      <div className="mt-8">
        <IntegrityProbe />
      </div>
    </div>
  );
}
