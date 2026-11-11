import {useState} from 'react';
import {useMutation} from '@tanstack/react-query';
import {api} from '@/lib/api';
import {copy} from '@/lib/copy';
import {Button} from '@/components/ui/button';
import {InstrumentPanel} from '@/components/ui/instrument';
import {isApiError} from '@/lib/errors';

export function IntegrityProbe() {
  const [result, setResult] = useState<string>('');
  const mutation = useMutation({
    mutationFn: () => api.probeDuplicate(),
    onSuccess: (data) => {
      if (data.skipped) setResult(data.message);
      else if (data.blocked) setResult(`${data.constraint}: ${data.message}`);
      else setResult(data.message);
    },
    onError: (err) => {
      setResult(isApiError(err) ? err.message : copy.errors.generic);
    },
  });

  return (
    <InstrumentPanel>
      <h2 className="font-display text-2xl">{copy.health.probe}</h2>
      <p className="mt-2 max-w-2xl text-sm text-fg-muted">{copy.health.probeLede}</p>
      <Button className="mt-4" pending={mutation.isPending} onClick={() => mutation.mutate()}>
        {copy.health.probe}
      </Button>
      {result ? (
        <pre className="mt-4 overflow-x-auto rounded-md bg-bg-sunken p-4 font-mono text-xs text-fg">
          {result}
        </pre>
      ) : null}
    </InstrumentPanel>
  );
}
