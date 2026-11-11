import {useNavigate, useParams} from 'react-router-dom';
import {useQuery} from '@tanstack/react-query';
import {api} from '@/lib/api';
import {keys} from '@/lib/keys';
import {copy} from '@/lib/copy';
import {CertificateCanvas} from '@/components/brand/CertificateCanvas';
import {Button} from '@/components/ui/button';
import {Skeleton, ErrorState} from '@/components/ui/skeleton';

export default function PrintPage() {
  const {certId = ''} = useParams();
  const navigate = useNavigate();
  const detail = useQuery({
    queryKey: keys.certificate(certId),
    queryFn: ({signal}) => api.getCertificate(certId, signal),
  });
  const branding = useQuery({queryKey: keys.branding(), queryFn: ({signal}) => api.getBranding(signal)});
  if (detail.isLoading) return <Skeleton className="h-96" />;
  if (!detail.data) return <ErrorState title={copy.errors.notFound} />;
  const c = detail.data.certificate;
  return (
    <div className="certificate-print-sheet mx-auto max-w-5xl py-6">
      <div className="no-print mb-4 flex flex-wrap gap-3">
        <Button onClick={() => window.print()}>{copy.certificate.print}</Button>
        <Button variant="ghost" onClick={() => navigate(-1)}>
          {copy.a11y.close}
        </Button>
      </div>
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
  );
}
