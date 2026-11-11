import {useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {api} from '@/lib/api';
import {keys} from '@/lib/keys';
import {copy} from '@/lib/copy';
import {formatNumber, formatRelative} from '@/lib/format';
import {Stat, InstrumentPanel, SegmentedControl} from '@/components/ui/instrument';
import {PipelineRiver} from '@/components/flow/PipelineRiver';
import {CountEquation} from '@/components/flow/CountEquation';
import {Skeleton, ErrorState} from '@/components/ui/skeleton';
import {Field, Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
import {ConfirmDialog} from '@/components/ui/dialog';
import {toast} from '@/components/ui/toast';
import {isApiError} from '@/lib/errors';
import {DemoStoryTour} from '@/features/demo/DemoStoryTour';

export default function DashboardPage() {
  const [scope, setScope] = useState<'all' | 'real' | 'demo'>('all');
  const [showDemo, setShowDemo] = useState(false);
  const [quick, setQuick] = useState('');
  const [resetOpen, setResetOpen] = useState(false);
  const [adminKey, setAdminKey] = useState('');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const stats = useQuery({
    queryKey: keys.stats(scope),
    queryFn: ({signal}) => api.getStats(scope, signal),
  });
  const audit = useQuery({
    queryKey: keys.audit(),
    queryFn: ({signal}) => api.getAuditLog(signal),
  });

  const resetMut = useMutation({
    mutationFn: () => api.resetLedger(adminKey),
    onSuccess: async () => {
      toast.success(copy.toast.ledgerReset);
      setResetOpen(false);
      setAdminKey('');
      await queryClient.invalidateQueries();
    },
    onError: (error) => {
      if (isApiError(error) && error.code === 'INVALID_RESET_KEY') {
        toast.error(copy.errors.invalidResetKey);
        return;
      }
      if (isApiError(error) && error.status === 429) {
        toast.error(copy.errors.rateLimited);
        return;
      }
      toast.error(copy.errors.generic);
    },
  });

  if (stats.isLoading) {
    return <Skeleton className="h-96 w-full" />;
  }
  if (stats.error || !stats.data) {
    return <ErrorState title={copy.errors.generic} />;
  }

  const s = stats.data;
  return (
    <div className="mx-auto max-w-7xl">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-4xl">{copy.dashboard.title}</h1>
        <div className="flex flex-wrap gap-3">
          <SegmentedControl
            ariaLabel="Scope"
            value={scope}
            onChange={setScope}
            options={[
              {value: 'all', label: 'All'},
              {value: 'real', label: 'Real'},
              {value: 'demo', label: 'Demo'},
            ]}
          />
          <Button variant="secondary" onClick={() => setShowDemo((v) => !v)}>
            {copy.dashboard.demo}
          </Button>
          <Button variant="danger" onClick={() => setResetOpen(true)}>
            {copy.dashboard.reset}
          </Button>
        </div>
      </div>
      {showDemo ? (
        <div className="mt-6">
          <DemoStoryTour />
        </div>
      ) : null}
      <div className="mt-6">
        <CountEquation stats={s} />
      </div>
      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Stat label={copy.dashboard.pending} value={formatNumber(s.pending)} />
        <Stat label={copy.dashboard.issued} value={formatNumber(s.issued)} tone="success" />
        <Stat label={copy.dashboard.revoked} value={formatNumber(s.revoked)} tone="danger" />
        <Stat label={copy.dashboard.needsCorrection} value={formatNumber(s.needsCorrection)} tone="warning" />
      </div>
      <div className="mt-6 grid gap-4 xl:grid-cols-3">
        <InstrumentPanel className="xl:col-span-2">
          <PipelineRiver
            funnel={s.funnel}
            onFilter={(kind) => {
              if (kind === 'needs_correction') navigate('/attendees?state=needs_correction');
              if (kind === 'pending') navigate('/attendees');
              if (kind === 'revoked') navigate('/attendees?cert=revoked');
            }}
          />
        </InstrumentPanel>
        <InstrumentPanel>
          <h2 className="font-display text-2xl">{copy.dashboard.quickVerify}</h2>
          <form
            className="mt-4 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (quick.trim()) navigate(`/verify/${encodeURIComponent(quick.trim().toUpperCase())}`);
            }}
          >
            <Input value={quick} onChange={(e) => setQuick(e.target.value.toUpperCase())} placeholder="CL-26-" />
            <Button type="submit">{copy.verify.submit}</Button>
          </form>
          <h3 className="mt-8 font-display text-xl">{copy.dashboard.activityTitle}</h3>
          <ul className="mt-3 space-y-2 text-sm">
            {(audit.data?.audit_log ?? []).slice(0, 8).map((row) => (
              <li key={row.id} className="flex justify-between gap-3 text-fg-muted">
                <span>{row.action}</span>
                <span className="font-mono text-xs">{formatRelative(row.at)}</span>
              </li>
            ))}
          </ul>
        </InstrumentPanel>
      </div>
      <InstrumentPanel className="mt-6">
        <h2 className="font-display text-2xl">{copy.dashboard.coursesTitle}</h2>
        <ul className="mt-4 space-y-3">
          {Object.values(s.byCourse).map((course) => {
            const total = Math.max(1, course.eligible);
            const pct = Math.round((course.issued / total) * 100);
            return (
              <li key={course.code}>
                <div className="flex justify-between text-sm">
                  <span>{course.title}</span>
                  <span className="font-mono text-fg-muted">
                    {course.issued}/{course.eligible}
                  </span>
                </div>
                <div className="mt-2 h-3 overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full bg-accent" style={{width: `${pct}%`}} />
                </div>
              </li>
            );
          })}
        </ul>
      </InstrumentPanel>
      <ConfirmDialog
        open={resetOpen}
        onOpenChange={(open) => {
          setResetOpen(open);
          if (!open) {
            setAdminKey('');
            resetMut.reset();
          }
        }}
        title={copy.dashboard.reset}
        body={copy.confirm.resetLedger}
        confirmLabel={copy.dashboard.reset}
        danger
        pending={resetMut.isPending}
        confirmDisabled={!adminKey.trim()}
        onConfirm={() => {
          if (!adminKey.trim() || resetMut.isPending) return;
          resetMut.mutate();
        }}
      >
        <Field label={copy.dashboard.resetKey} htmlFor="system-reset-key" hint={copy.dashboard.resetKeyHint}>
          <Input
            id="system-reset-key"
            type="password"
            autoComplete="off"
            value={adminKey}
            onChange={(e) => setAdminKey(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && adminKey.trim() && !resetMut.isPending) {
                e.preventDefault();
                resetMut.mutate();
              }
            }}
          />
        </Field>
      </ConfirmDialog>
    </div>
  );
}
