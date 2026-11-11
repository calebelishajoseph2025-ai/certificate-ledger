import {copy} from '@/lib/copy';
import {InstrumentPanel} from '@/components/ui/instrument';
import {useAuth} from '@/hooks/useAuth';
import {useQuery} from '@tanstack/react-query';
import {api} from '@/lib/api';
import {keys} from '@/lib/keys';
import {CountEquation} from '@/components/flow/CountEquation';

export default function HowDuplicatesArePreventedPage() {
  const {authenticated} = useAuth();
  const stats = useQuery({
    queryKey: keys.stats('all'),
    queryFn: ({signal}) => api.getStats('all', signal),
    enabled: authenticated,
  });

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="font-display text-4xl">{copy.explainer.title}</h1>
      <p className="mt-2 max-w-2xl text-fg-muted">{copy.explainer.lede}</p>
      <div className="mt-8 grid gap-4">
        {copy.explainer.layers.map((layer, i) => (
          <InstrumentPanel key={layer.title}>
            <p className="font-mono text-xs text-accent">0{i + 1}</p>
            <h2 className="mt-1 font-display text-2xl">{layer.title}</h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-fg-muted">{layer.body}</p>
          </InstrumentPanel>
        ))}
      </div>
      {stats.data ? (
        <div className="mt-8">
          <CountEquation stats={stats.data} />
        </div>
      ) : null}
    </div>
  );
}
