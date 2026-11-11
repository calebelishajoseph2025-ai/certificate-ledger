import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {api} from '@/lib/api';
import {keys} from '@/lib/keys';
import {copy} from '@/lib/copy';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {InstrumentPanel} from '@/components/ui/instrument';
import {Table, TBody, TD, TH, THead, TR} from '@/components/ui/table';
import {formatDateTime} from '@/lib/format';

export default function DevelopersPage() {
  const [certId, setCertId] = useState('');
  const [output, setOutput] = useState('');
  const revocations = useQuery({
    queryKey: keys.revocations(),
    queryFn: ({signal}) => api.getRevocations(undefined, signal),
  });

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="font-display text-4xl">{copy.developers.title}</h1>
      <p className="mt-2 text-fg-muted">{copy.developers.lede}</p>

      <InstrumentPanel className="mt-8">
        <h2 className="font-display text-2xl">{copy.developers.console}</h2>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <Input value={certId} onChange={(e) => setCertId(e.target.value.toUpperCase())} placeholder="CL-26-XXXXXXXXX" />
          <Button
            type="button"
            onClick={async () => {
              try {
                const data = await api.verifyLookup(certId.trim());
                setOutput(JSON.stringify(data, null, 2));
              } catch (err) {
                setOutput(String(err));
              }
            }}
          >
            GET /api/verify/:id
          </Button>
        </div>
        {output ? <pre className="mt-4 overflow-auto rounded-md bg-bg-sunken p-4 font-mono text-xs">{output}</pre> : null}
      </InstrumentPanel>

      <InstrumentPanel className="mt-6">
        <h2 className="font-display text-2xl">{copy.developers.revocations}</h2>
        <Table className="mt-4">
          <THead>
            <TR>
              <TH>Certificate</TH>
              <TH>Revoked at</TH>
            </TR>
          </THead>
          <TBody>
            {(revocations.data?.revocations ?? []).map((row) => (
              <TR key={row.cert_id}>
                <TD className="font-mono">{row.cert_id}</TD>
                <TD>{formatDateTime(row.revoked_at)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </InstrumentPanel>
    </div>
  );
}
