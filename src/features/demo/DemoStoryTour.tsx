import {useState} from 'react';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {api} from '@/lib/api';
import {keys} from '@/lib/keys';
import {copy} from '@/lib/copy';
import {Button} from '@/components/ui/button';
import {InstrumentPanel} from '@/components/ui/instrument';
import {formatNumber} from '@/lib/format';
import {ConfirmDialog} from '@/components/ui/dialog';
import {toast} from '@/components/ui/toast';
import {isApiError} from '@/lib/errors';

export function DemoStoryTour() {
  const [step, setStep] = useState(0);
  const [resetOpen, setResetOpen] = useState(false);
  const queryClient = useQueryClient();
  const stats = useQuery({
    queryKey: keys.stats('demo'),
    queryFn: ({signal}) => api.getStats('demo', signal),
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries();
  };

  const run = useMutation({
    mutationFn: async (index: number) => {
      if (index === 0) await api.loadDemo();
      if (index === 2 || index === 3) await api.issueAll(undefined, 'demo');
      if (index === 5) await api.importDemo('modified');
      if (index === 6) await api.scanDuplicates();
      if (index === 7) await api.verifyAudit();
      if (index === 8) await api.probeDuplicate();
    },
    onSuccess: async () => {
      await invalidate();
      setStep((s) => Math.min(copy.demo.steps.length - 1, s + 1));
    },
    onError: (err) => toast.error(isApiError(err) ? err.message : copy.errors.generic),
  });

  const reset = useMutation({
    mutationFn: () => api.resetDemo(),
    onSuccess: async () => {
      setResetOpen(false);
      setStep(0);
      await invalidate();
      toast.success(copy.toast.demoReset);
    },
    onError: (err) => toast.error(isApiError(err) ? err.message : copy.errors.generic),
  });

  const current = copy.demo.steps[step];
  if (!current) return null;

  return (
    <InstrumentPanel className="mb-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-micro text-accent">{copy.demo.title}</p>
          <h2 className="mt-1 font-display text-2xl">
            {step + 1}. {current.title}
          </h2>
          <p className="mt-2 max-w-xl text-sm text-fg-muted">{current.body}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setResetOpen(true)}>
            {copy.demo.reset}
          </Button>
          <Button pending={run.isPending} onClick={() => run.mutate(step)}>
            {copy.demo.next}
          </Button>
        </div>
      </div>
      {stats.data ? (
        <dl className="mt-6 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
          <div>
            <dt className="text-fg-faint">Eligible</dt>
            <dd className="font-mono tabular">{formatNumber(stats.data.eligibleTotal)}</dd>
          </div>
          <div>
            <dt className="text-fg-faint">Issued</dt>
            <dd className="font-mono tabular">{formatNumber(stats.data.issued)}</dd>
          </div>
          <div>
            <dt className="text-fg-faint">Pending</dt>
            <dd className="font-mono tabular">{formatNumber(stats.data.pending)}</dd>
          </div>
          <div>
            <dt className="text-fg-faint">Needs correction</dt>
            <dd className="font-mono tabular">{formatNumber(stats.data.needsCorrection)}</dd>
          </div>
        </dl>
      ) : null}
      <ConfirmDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        title={copy.demo.reset}
        body={copy.confirm.resetDemo}
        confirmLabel={copy.demo.reset}
        danger
        pending={reset.isPending}
        onConfirm={() => reset.mutate()}
      />
    </InstrumentPanel>
  );
}
