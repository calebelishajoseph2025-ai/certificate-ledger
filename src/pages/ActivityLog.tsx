import {useMutation, useQuery} from '@tanstack/react-query';
import {api} from '@/lib/api';
import {keys} from '@/lib/keys';
import {copy} from '@/lib/copy';
import {Button} from '@/components/ui/button';
import {HashChain} from '@/components/flow/HashChain';
import {InstrumentPanel} from '@/components/ui/instrument';
import {formatHash} from '@/lib/format';
import {toast} from '@/components/ui/toast';
import {Badge} from '@/components/ui/badge';

export default function ActivityLogPage() {
  const audit = useQuery({queryKey: keys.audit(), queryFn: ({signal}) => api.getAuditLog(signal)});
  const verify = useMutation({mutationFn: () => api.verifyAudit()});
  const head = audit.data?.audit_log[0];

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-4xl">{copy.activity.title}</h1>
        <div className="flex gap-2">
          <Button pending={verify.isPending} onClick={() => verify.mutate()}>
            {copy.activity.verify}
          </Button>
          <Button
            variant="secondary"
            onClick={async () => {
              if (!head) return;
              await navigator.clipboard.writeText(head.row_hash);
              toast.success(copy.toast.copied);
            }}
          >
            {copy.activity.copyAnchor}
          </Button>
        </div>
      </div>
      {verify.data ? (
        <div className="mt-4">
          <Badge tone={verify.data.ok ? 'success' : 'danger'}>
            {verify.data.ok ? copy.activity.intact : copy.activity.broken}
          </Badge>
          <p className="mt-2 font-mono text-xs text-fg-muted">
            head {formatHash(verify.data.head_hash)} · checked {verify.data.checked}
          </p>
        </div>
      ) : null}
      <InstrumentPanel className="mt-6">
        <HashChain rows={audit.data?.audit_log ?? []} />
      </InstrumentPanel>
    </div>
  );
}
