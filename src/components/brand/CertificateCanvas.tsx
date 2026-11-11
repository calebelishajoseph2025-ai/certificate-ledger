import {
  CERTIFICATE_THEMES,
  certificateThemeVars,
  type CertificateThemeId,
} from '@/theme/certificate-themes';
import {copy} from '@/lib/copy';
import {cn} from '@/lib/cn';
import {formatDate} from '@/lib/format';
import {QrMark} from './QrMark';
import {Seal} from './Seal';
import {Stamp} from './Seal';
import type {CSSProperties} from 'react';

export interface CertificateView {
  cert_id: string;
  holder_name: string;
  course_title: string;
  course_code?: string;
  issuer_name: string;
  issued_at: string;
  hours?: number;
  theme?: string;
  status: 'valid' | 'revoked';
  verify_url: string;
  signatory1Name: string;
  signatory1Title: string;
  signatory2Name: string;
  signatory2Title: string;
}

export function CertificateCanvas({certificate}: {certificate: CertificateView}) {
  const themeId = (CERTIFICATE_THEMES[certificate.theme as CertificateThemeId]
    ? certificate.theme
    : 'classic') as CertificateThemeId;
  const theme = CERTIFICATE_THEMES[themeId];
  const vars = certificateThemeVars(theme) as CSSProperties;
  const modern = themeId === 'modern' || themeId === 'slate';

  return (
    <article
      data-cert-theme={themeId}
      className={cn(
        'certificate-page relative mx-auto flex aspect-[297/210] w-full max-w-5xl flex-col overflow-hidden p-8 md:p-12',
        themeId === 'modern' || themeId === 'slate'
          ? 'rounded-none border'
          : themeId === 'forest'
            ? 'rounded-[28px] border-2'
            : themeId === 'midnight'
              ? 'rounded-lg border-8'
              : 'rounded-lg border-2',
      )}
      style={{
        ...vars,
        background: 'var(--cert-paper)',
        borderColor: 'var(--cert-border)',
        color: 'var(--cert-text)',
      }}
    >
      <ThemeChrome themeId={themeId} />
      <header className="relative flex items-start justify-between">
        <div>
          <p className="text-xs uppercase tracking-micro" style={{color: 'var(--cert-accent)'}}>
            {certificate.issuer_name}
          </p>
          <h1
            className={cn(
              'mt-2 text-4xl md:text-5xl',
              modern ? 'font-sans tracking-tight' : 'font-cert',
            )}
          >
            {copy.certificate.title}
          </h1>
        </div>
        <div style={{color: 'var(--cert-seal)'}}>
          <Seal />
        </div>
      </header>
      <p className="relative mt-8 shrink-0 text-sm uppercase tracking-micro" style={{color: 'var(--cert-accent)'}}>
        {copy.certificate.presented}
      </p>
      <p
        className={cn(
          'relative mt-2 shrink-0 text-4xl md:text-5xl',
          modern ? 'font-sans font-medium' : 'font-cert italic',
        )}
      >
        {certificate.holder_name}
      </p>
      <p className="relative mt-4 max-w-2xl shrink-0 text-lg">
        {copy.certificate.completed}{' '}
        <span className="font-medium">{certificate.course_title}</span>
        {certificate.hours ? ` · ${certificate.hours} hours` : ''}
      </p>
      <div className="relative mt-auto flex flex-wrap items-end justify-between gap-8 pt-6">
        <div className="flex gap-12">
          <div>
            <p className="font-sign text-3xl">{certificate.signatory1Name}</p>
            <p className="text-xs uppercase tracking-micro">{certificate.signatory1Title}</p>
          </div>
          <div>
            <p className="font-sign text-3xl">{certificate.signatory2Name}</p>
            <p className="text-xs uppercase tracking-micro">{certificate.signatory2Title}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="font-mono text-xs">{certificate.cert_id}</p>
          <p className="text-xs">
            {copy.certificate.issuedOn} {formatDate(certificate.issued_at)}
          </p>
          <div className="mt-2 inline-block text-[var(--cert-text)]">
            <QrMark value={certificate.verify_url} size={88} />
          </div>
        </div>
      </div>
      {certificate.status === 'revoked' ? (
        <Stamp label={copy.certificate.revokedStamp} tone="danger" />
      ) : null}
    </article>
  );
}

function ThemeChrome({themeId}: {themeId: CertificateThemeId}) {
  if (themeId === 'classic') {
    return (
      <>
        <div className="pointer-events-none absolute inset-4 border" style={{borderColor: 'var(--cert-inner)'}} />
        <div className="pointer-events-none absolute inset-6 border-2" style={{borderColor: 'var(--cert-accent)'}} />
      </>
    );
  }
  if (themeId === 'modern') {
    return (
      <div
        className="pointer-events-none absolute bottom-0 left-0 top-0 w-3"
        style={{background: 'var(--cert-accent)'}}
      />
    );
  }
  if (themeId === 'midnight') {
    return (
      <>
        <div className="pointer-events-none absolute inset-3 border" style={{borderColor: 'var(--cert-border)'}} />
        <div className="pointer-events-none absolute inset-7 border" style={{borderColor: 'var(--cert-inner)'}} />
      </>
    );
  }
  if (themeId === 'forest') {
    return (
      <div
        className="pointer-events-none absolute inset-5 rounded-[40px] border"
        style={{borderColor: 'var(--cert-inner)'}}
      />
    );
  }
  return (
    <>
      <div
        className="pointer-events-none absolute inset-y-8 left-6 w-px"
        style={{background: 'var(--cert-border)'}}
      />
      <div
        className="pointer-events-none absolute inset-y-8 right-6 w-px"
        style={{background: 'var(--cert-border)'}}
      />
    </>
  );
}
