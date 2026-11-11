import {FormEvent, useEffect, useState} from 'react';
import {Link, useNavigate} from 'react-router-dom';
import {copy, interpolate} from '@/lib/copy';
import {useAuth} from '@/hooks/useAuth';
import {Button} from '@/components/ui/button';
import {Field, Input} from '@/components/ui/input';
import {InstrumentPanel} from '@/components/ui/instrument';
import {isApiError} from '@/lib/errors';
import {useCountdown} from '@/hooks/useCountdown';
import {fadeUp, motion} from '@/components/motion';

export default function LoginPage() {
  const {login, authenticated} = useAuth();
  const navigate = useNavigate();
  const [secret, setSecret] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  const remaining = useCountdown(retryAfter);

  useEffect(() => {
    if (authenticated) navigate('/dashboard', {replace: true});
  }, [authenticated, navigate]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setPending(true);
    try {
      await login(secret);
      navigate('/dashboard');
    } catch (err) {
      if (isApiError(err) && err.status === 429) {
        const seconds = err.retryAfter ?? 15 * 60;
        setRetryAfter(seconds);
        setError(interpolate(copy.login.locked, {n: seconds}));
      } else {
        setError(copy.login.error);
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md items-center">
      <motion.div className="w-full" {...fadeUp}>
        <InstrumentPanel>
          <h1 className="font-display text-3xl">{copy.login.title}</h1>
          <p className="mt-2 text-sm text-fg-muted">{copy.login.lede}</p>
          <form className="mt-6 flex flex-col gap-4" onSubmit={onSubmit}>
            <Field label={copy.login.field} htmlFor="organizer-secret">
              <Input
                id="organizer-secret"
                type="password"
                autoComplete="current-password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                required
              />
            </Field>
            {error ? (
              <p role="alert" className="text-sm text-danger">
                {remaining > 0 ? interpolate(copy.login.locked, {n: remaining}) : error}
              </p>
            ) : null}
            <Button type="submit" pending={pending} disabled={remaining > 0}>
              {pending ? copy.login.signingIn : copy.login.submit}
            </Button>
          </form>
          <p className="mt-6 text-sm text-fg-muted">
            {copy.login.publicHint}{' '}
            <Link className="text-accent underline" to="/verify">
              {copy.login.verifyLink}
            </Link>
          </p>
        </InstrumentPanel>
      </motion.div>
    </div>
  );
}
