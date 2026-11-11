import {useState} from 'react';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {api} from '@/lib/api';
import {keys} from '@/lib/keys';
import {copy} from '@/lib/copy';
import {Button} from '@/components/ui/button';
import {InstrumentPanel} from '@/components/ui/instrument';
import {Badge} from '@/components/ui/badge';
import {EmptyState} from '@/components/ui/skeleton';
import {Dialog, DialogContent} from '@/components/ui/dialog';
import {toast} from '@/components/ui/toast';
import {isApiError} from '@/lib/errors';
import type {DuplicateCandidate} from '@/lib/schemas';

export default function DuplicatesPage() {
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: keys.duplicates('open'),
    queryFn: ({signal}) => api.getDuplicates('open', signal),
  });
  const [active, setActive] = useState<DuplicateCandidate | null>(null);

  const scan = useMutation({
    mutationFn: () => api.scanDuplicates(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({queryKey: ['duplicates']});
    },
  });

  const candidates = list.data?.candidates ?? [];

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-4xl">{copy.duplicates.title}</h1>
        <Button pending={scan.isPending} onClick={() => scan.mutate()}>
          {copy.duplicates.scan}
        </Button>
      </div>
      <p className="mt-2 text-sm text-fg-muted">{list.data?.open_count ?? 0} open</p>
      {candidates.length === 0 ? (
        <EmptyState title={copy.duplicates.empty} />
      ) : (
        <div className="mt-6 grid gap-4">
          {candidates.map((c) => (
            <InstrumentPanel key={c.id} className="overflow-hidden">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <Badge tone="accent">{Math.round(c.score * 100)}%</Badge>
                  <h2 className="mt-2 break-words font-display text-xl">
                    {c.person_a?.full_name} · {c.person_b?.full_name}
                  </h2>
                  <p className="mt-1 break-all font-mono text-xs text-fg-muted">
                    {c.person_a?.email_norm} / {c.person_b?.email_norm}
                  </p>
                  <p className="mt-2 break-words text-sm text-fg-muted">{c.reasons.join(' · ')}</p>
                </div>
                <Button className="shrink-0" onClick={() => setActive(c)}>
                  {copy.duplicates.review}
                </Button>
              </div>
            </InstrumentPanel>
          ))}
        </div>
      )}
      <Dialog
        open={Boolean(active)}
        onOpenChange={(open) => {
          if (!open) setActive(null);
        }}
      >
        <DialogContent title={copy.duplicates.review}>
          {active ? (
            <MergePanel
              candidate={active}
              onDone={async () => {
                setActive(null);
                await queryClient.invalidateQueries({queryKey: ['duplicates']});
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MergePanel({candidate, onDone}: {candidate: DuplicateCandidate; onDone: () => void}) {
  const [survivor, setSurvivor] = useState(candidate.person_a_id);
  const preview = useQuery({
    queryKey: keys.mergePreview(candidate.id, survivor),
    queryFn: ({signal}) => api.getMergePreview(candidate.id, survivor, signal),
  });

  return (
    <div className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="text-sm text-fg-muted">Survivor</legend>
        {[candidate.person_a, candidate.person_b].map((p) =>
          p ? (
            <label key={p.id} className="flex min-h-11 items-start gap-3">
              <input
                type="radio"
                name="survivor"
                className="mt-1"
                checked={survivor === p.id}
                onChange={() => setSurvivor(p.id)}
              />
              <span className="min-w-0 break-words">
                {p.full_name}
                <span className="mt-0.5 block break-all font-mono text-xs text-fg-muted">{p.email_norm}</span>
              </span>
            </label>
          ) : null,
        )}
      </fieldset>
      {preview.data?.conflicts.length ? (
        <p className="text-sm text-warning">{preview.data.conflicts.map((c) => c.course_code).join(', ')}</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={async () => {
            try {
              await api.mergeDuplicate(candidate.id, survivor, undefined);
              toast.success(copy.toast.merged);
              onDone();
            } catch (err) {
              toast.error(isApiError(err) && err.code === 'MERGE_BLOCKED_BOTH_CERTIFIED' ? copy.duplicates.blocked : copy.errors.generic);
            }
          }}
        >
          {copy.duplicates.merge}
        </Button>
        <Button
          variant="secondary"
          onClick={async () => {
            await api.dismissDuplicate(candidate.id, 'distinct people');
            toast.success(copy.toast.dismissed);
            onDone();
          }}
        >
          {copy.duplicates.dismiss}
        </Button>
      </div>
    </div>
  );
}
