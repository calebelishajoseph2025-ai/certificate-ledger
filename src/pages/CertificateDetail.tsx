import {useState} from 'react';
import {useNavigate, useParams} from 'react-router-dom';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {api} from '@/lib/api';
import {keys} from '@/lib/keys';
import {copy, interpolate} from '@/lib/copy';
import {CertificateCanvas} from '@/components/brand/CertificateCanvas';
import {Button} from '@/components/ui/button';
import {Field, Textarea} from '@/components/ui/input';
import {ConfirmDialog} from '@/components/ui/dialog';
import {HashChain} from '@/components/flow/HashChain';
import {ErrorState, Skeleton} from '@/components/ui/skeleton';
import {toast} from '@/components/ui/toast';
import {isApiError} from '@/lib/errors';

export default function CertificateDetailPage() {
  const {certId = ''} = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [open, setOpen] = useState(false);
  const detail = useQuery({
    queryKey: keys.certificate(certId),
    queryFn: ({signal}) => api.getCertificate(certId, signal),
    enabled: Boolean(certId),
  });
  const branding = useQuery({queryKey: keys.branding(), queryFn: ({signal}) => api.getBranding(signal)});

  const revoke = useMutation({
    mutationFn: () => api.revokeCertificate(certId, reason),
    onSuccess: async () => {
      toast.success(copy.toast.revoked);
      setOpen(false);
      setReason('');
      await queryClient.invalidateQueries();
    },
    onError: (err) => toast.error(isApiError(err) ? err.message : copy.errors.generic),
  });

  if (detail.isLoading) return <Skeleton className="h-96" />;
  if (detail.error || !detail.data) return <ErrorState title={copy.errors.notFound} />;

  const c = detail.data.certificate;
  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => navigate(`/print/${c.cert_id}`)}>
          {copy.certificate.print}
        </Button>
        {c.status === 'valid' ? (
          <Button variant="danger" onClick={() => setOpen(true)}>
            {copy.certificate.revoke}
          </Button>
        ) : null}
      </div>
      <CertificateCanvas
        certificate={{
          cert_id: c.cert_id,
          holder_name: c.holder_name ?? '',
          course_title: c.course_title ?? '',
          course_code: c.course_code,
          issuer_name: branding.data?.issuerName ?? copy.brand.issuerFallback,
          issued_at: c.issued_at,
          hours: c.hours,
          theme: c.theme,
          status: c.status,
          verify_url: c.verify_url ?? window.location.origin + '/verify/' + c.cert_id,
          signatory1Name: branding.data?.signatory1Name ?? '',
          signatory1Title: branding.data?.signatory1Title ?? '',
          signatory2Name: branding.data?.signatory2Name ?? '',
          signatory2Title: branding.data?.signatory2Title ?? '',
        }}
      />
      <div className="mt-8">
        <HashChain rows={detail.data.audit_trail} />
      </div>
      <ConfirmDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setReason('');
        }}
        title={copy.certificate.revoke}
        body={interpolate(copy.confirm.revoke, {id: c.cert_id})}
        confirmLabel={copy.certificate.confirmRevoke}
        danger
        pending={revoke.isPending}
        confirmDisabled={!reason.trim()}
        onConfirm={() => {
          if (reason.trim()) revoke.mutate();
        }}
      >
        <Field label={copy.certificate.reason} hint={copy.certificate.reasonHint}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} required />
        </Field>
      </ConfirmDialog>
    </div>
  );
}
