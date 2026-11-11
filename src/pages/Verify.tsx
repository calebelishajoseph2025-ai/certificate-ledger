import {FormEvent, useEffect, useMemo, useState} from 'react';
import {useParams, useSearchParams} from 'react-router-dom';
import {useQuery} from '@tanstack/react-query';
import {api} from '@/lib/api';
import {keys} from '@/lib/keys';
import {copy, interpolate} from '@/lib/copy';
import {badgeUrl, formatDate, linkedInUrl} from '@/lib/format';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {InstrumentPanel} from '@/components/ui/instrument';
import {Stamp} from '@/components/brand/Seal';
import {isApiError} from '@/lib/errors';
import {useCountdown} from '@/hooks/useCountdown';
import {fade, motion, stamp} from '@/components/motion';
import {toast} from '@/components/ui/toast';

export default function VerifyPage() {
  const params = useParams();
  const [search] = useSearchParams();
  const initial = (params.certId ?? '').toUpperCase();
  const [value, setValue] = useState(initial);
  const [lookup, setLookup] = useState(initial);
  const sig = search.get('s') ?? undefined;
  const [retry, setRetry] = useState<number | null>(null);
  const remaining = useCountdown(retry);

  useEffect(() => {
    if (initial) setLookup(initial);
  }, [initial]);

  const query = useQuery({
    queryKey: keys.verify(lookup, sig),
    queryFn: ({signal}) => api.verifyLookup(lookup, sig, signal),
    enabled: lookup.length > 0 && remaining === 0,
    retry: false,
  });

  useEffect(() => {
    if (query.error && isApiError(query.error) && query.error.status === 429) {
      setRetry(query.error.retryAfter ?? 60);
    }
  }, [query.error]);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setLookup(value.trim().toUpperCase());
  };

  const result = query.data;
  const branding = useQuery({queryKey: keys.branding(), queryFn: ({signal}) => api.getBranding(signal)});

  const linkedIn = useMemo(() => {
    if (!result || result.status !== 'valid') return '';
    return linkedInUrl({
      holderName: result.holder_name ?? '',
      courseTitle: result.course_title ?? '',
      issuerName: result.issuer_name ?? branding.data?.issuerName ?? copy.brand.issuerFallback,
      issuedAt: result.issued_at,
      certId: lookup,
    });
  }, [result, lookup, branding.data?.issuerName]);

  const statusCopy =
    result?.status === 'valid'
      ? copy.verify.valid
      : result?.status === 'revoked'
        ? copy.verify.revoked
        : result?.status === 'malformed'
          ? copy.verify.malformed
          : result?.status === 'invalid_signature'
            ? copy.verify.badSig
            : result
              ? copy.verify.notFound
              : '';

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-display text-4xl">{copy.verify.title}</h1>
      <p className="mt-2 text-fg-muted">{copy.verify.lede}</p>
      <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Input
          aria-label={copy.verify.title}
          placeholder={copy.verify.placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value.toUpperCase())}
        />
        <Button type="submit" pending={query.isFetching} disabled={remaining > 0}>
          {copy.verify.submit}
        </Button>
      </form>
      {remaining > 0 ? (
        <p role="alert" className="mt-3 text-sm text-warning">
          {interpolate(copy.verify.rateLimited, {n: remaining})}
        </p>
      ) : null}

      {result ? (
        <InstrumentPanel className="relative mt-10 min-h-64">
          {result.status === 'valid' ? (
            <motion.div className="absolute right-6 top-6" {...stamp}>
              <Stamp label="VALID" tone="success" />
            </motion.div>
          ) : result.status === 'revoked' ? (
            <Stamp label="REVOKED" tone="danger" />
          ) : (
            <Stamp label="NO RECORD" tone="warning" />
          )}
          <motion.div {...fade}>
            <p className="font-mono text-sm text-fg-faint">{lookup}</p>
            <h2 className="mt-3 font-display text-3xl">{statusCopy}</h2>
            {result.holder_name ? (
              <dl className="mt-6 grid gap-3 text-sm md:grid-cols-2">
                <div>
                  <dt className="text-fg-faint">{copy.verify.holder}</dt>
                  <dd>{result.holder_name}</dd>
                </div>
                <div>
                  <dt className="text-fg-faint">{copy.verify.course}</dt>
                  <dd>{result.course_title}</dd>
                </div>
                <div>
                  <dt className="text-fg-faint">{copy.verify.issuer}</dt>
                  <dd>{result.issuer_name}</dd>
                </div>
                <div>
                  <dt className="text-fg-faint">{copy.verify.issued}</dt>
                  <dd>{formatDate(result.issued_at)}</dd>
                </div>
              </dl>
            ) : null}
            {result.status === 'valid' ? (
              <div className="mt-6 flex flex-wrap gap-3">
                <a className="inline-flex h-11 items-center rounded-md bg-accent px-4 text-sm text-accent-fg" href={linkedIn}>
                  {copy.verify.addLinkedIn}
                </a>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={async () => {
                    const snippet = `<img alt="Certificate status" src="${badgeUrl(lookup)}" />`;
                    await navigator.clipboard.writeText(snippet);
                    toast.success(copy.toast.copied);
                  }}
                >
                  {copy.verify.embed}
                </Button>
              </div>
            ) : null}
          </motion.div>
        </InstrumentPanel>
      ) : null}
    </div>
  );
}
