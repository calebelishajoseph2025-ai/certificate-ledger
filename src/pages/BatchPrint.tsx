import {useNavigate, useParams} from 'react-router-dom';
import {useQuery} from '@tanstack/react-query';
import {api} from '@/lib/api';
import {keys} from '@/lib/keys';
import {copy} from '@/lib/copy';
import {CertificateCanvas} from '@/components/brand/CertificateCanvas';
import {Button} from '@/components/ui/button';
import {EmptyState, ErrorState, Skeleton} from '@/components/ui/skeleton';

export default function BatchPrintPage() {
  const {courseCode = ''} = useParams();
  const navigate = useNavigate();
  const certs = useQuery({
    queryKey: keys.certificates({course: courseCode, status: 'valid', limit: 200}),
    queryFn: ({signal}) => api.getCertificates({course: courseCode, status: 'valid', limit: 200}, signal),
  });
  const branding = useQuery({queryKey: keys.branding(), queryFn: ({signal}) => api.getBranding(signal)});

  if (certs.isLoading) return <Skeleton className="h-96" />;
  if (certs.error) return <ErrorState title={copy.errors.generic} />;

  const list = certs.data?.certificates ?? [];
  if (list.length === 0) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16">
        <EmptyState
          title={copy.print.empty}
          body={copy.print.emptyBody}
          action={
            <Button variant="secondary" onClick={() => navigate('/courses')}>
              {copy.print.back}
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="certificate-print-sheet mx-auto max-w-5xl py-6">
      <div className="no-print mb-4 flex flex-wrap items-center gap-3">
        <Button onClick={() => window.print()}>{copy.certificate.print}</Button>
        <Button variant="ghost" onClick={() => navigate('/courses')}>
          {copy.print.back}
        </Button>
        <p className="text-sm text-fg-muted">
          {list.length} · {courseCode}
        </p>
      </div>
      {list.map((c) => (
        <div key={c.cert_id} className="certificate-print-item mb-8">
          <CertificateCanvas
            certificate={{
              cert_id: c.cert_id,
              holder_name: c.holder_name ?? '',
              course_title: c.course_title ?? '',
              issuer_name: branding.data?.issuerName ?? copy.brand.issuerFallback,
              issued_at: c.issued_at,
              hours: c.hours,
              theme: c.theme,
              status: c.status,
              verify_url: c.verify_url ?? `${window.location.origin}/verify/${c.cert_id}`,
              signatory1Name: branding.data?.signatory1Name ?? '',
              signatory1Title: branding.data?.signatory1Title ?? '',
              signatory2Name: branding.data?.signatory2Name ?? '',
              signatory2Title: branding.data?.signatory2Title ?? '',
            }}
          />
        </div>
      ))}
    </div>
  );
}
