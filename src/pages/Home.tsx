import {FormEvent, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {useQuery} from '@tanstack/react-query';
import {copy} from '@/lib/copy';
import {api} from '@/lib/api';
import {keys} from '@/lib/keys';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {InstrumentPanel} from '@/components/ui/instrument';
import {StatusStrip} from '@/components/layout/StatusStrip';
import {useAuth} from '@/hooks/useAuth';

export default function HomePage() {
  const navigate = useNavigate();
  const {authenticated} = useAuth();
  const [certId, setCertId] = useState('');
  const branding = useQuery({queryKey: keys.branding(), queryFn: ({signal}) => api.getBranding(signal)});

  const onVerify = (event: FormEvent) => {
    event.preventDefault();
    const id = certId.trim().toUpperCase();
    if (!id) return;
    navigate(`/verify/${encodeURIComponent(id)}`);
  };

  return (
    <div className="mx-auto max-w-6xl">
      <p className="text-xs uppercase tracking-micro text-accent">{copy.home.eyebrow}</p>
      <h1 className="font-display mt-4 max-w-4xl text-5xl leading-tight md:text-6xl">{copy.home.headline}</h1>
      <p className="mt-5 max-w-2xl text-lg text-fg-muted">{copy.home.lede}</p>
      <p className="mt-2 text-sm text-fg-faint">{branding.data?.issuerName ?? copy.brand.issuerFallback}</p>
      <p className="mt-3 max-w-2xl text-sm text-fg-muted">
        {copy.legal.educational}. {copy.legal.educationalLede}
      </p>

      <form onSubmit={onVerify} className="mt-10 max-w-2xl">
        <InstrumentPanel className="p-6 md:p-8">
          <label htmlFor="home-cert-id" className="text-sm font-medium text-fg">
            {copy.home.verifyLabel}
          </label>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-stretch">
            <Input
              id="home-cert-id"
              aria-label={copy.home.verifyLabel}
              placeholder={copy.home.verifyPlaceholder}
              value={certId}
              onChange={(e) => setCertId(e.target.value.toUpperCase())}
              autoCapitalize="characters"
              className="h-12 flex-1 text-base"
            />
            <Button type="submit" size="lg" className="sm:min-w-48">
              {copy.home.verifyCta}
            </Button>
          </div>
        </InstrumentPanel>
      </form>

      <div className="mt-6 flex flex-wrap gap-3">
        <Button variant="secondary" onClick={() => navigate(authenticated ? '/dashboard' : '/login')}>
          {copy.home.enterLedger}
        </Button>
        <Button variant="ghost" onClick={() => navigate('/how-it-works/duplicates')}>
          {copy.home.defenseTitle}
        </Button>
      </div>

      <div className="mt-12">
        <StatusStrip />
      </div>

      <section className="mt-16">
        <h2 className="font-display text-3xl">{copy.home.defenseTitle}</h2>
        <p className="mt-2 max-w-2xl text-fg-muted">{copy.home.defenseLede}</p>
        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {copy.explainer.layers.map((layer, i) => (
            <InstrumentPanel key={layer.title}>
              <p className="font-mono text-xs text-accent">0{i + 1}</p>
              <h3 className="mt-2 font-display text-xl">{layer.title}</h3>
              <p className="mt-2 text-sm text-fg-muted">{layer.body}</p>
            </InstrumentPanel>
          ))}
        </div>
      </section>

      <p className="mt-16 text-sm text-fg-faint">{copy.home.footer}</p>
    </div>
  );
}
