import {useState} from 'react';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {api} from '@/lib/api';
import {keys} from '@/lib/keys';
import {copy} from '@/lib/copy';
import {Button} from '@/components/ui/button';
import {NativeSelect} from '@/components/ui/select';
import {InstrumentPanel} from '@/components/ui/instrument';
import {Table, TBody, TD, TH, THead, TR} from '@/components/ui/table';
import {Badge} from '@/components/ui/badge';
import {ConfirmDialog} from '@/components/ui/dialog';
import {toast} from '@/components/ui/toast';
import {formatDateTime} from '@/lib/format';
import type {ImportPreview} from '@/lib/schemas';
import sampleCsv from '../../sample_data/attendees.csv?raw';
import sampleRound2Csv from '../../sample_data/attendees_round2.csv?raw';

const FIELDS = ['name', 'email', 'course', 'completion_date', 'status'] as const;

export default function ImportPage() {
  const [step, setStep] = useState(0);
  const [csv, setCsv] = useState('');
  const [filename, setFilename] = useState('attendees.csv');
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [undoId, setUndoId] = useState<number | null>(null);
  const queryClient = useQueryClient();
  const history = useQuery({queryKey: keys.imports(), queryFn: ({signal}) => api.getImports(signal)});

  const previewMut = useMutation({
    mutationFn: () => api.previewImport(csv, Object.keys(mapping).length ? mapping : undefined),
    onSuccess: (data) => {
      setPreview(data);
      setMapping(data.mapping);
      setStep(2);
    },
  });

  const commitMut = useMutation({
    mutationFn: () => api.commitImport(csv, filename, Object.keys(mapping).length ? mapping : undefined),
    onSuccess: async (data) => {
      toast.success(data.already_imported ? copy.import.already : copy.toast.imported);
      await queryClient.invalidateQueries();
      setStep(3);
    },
  });

  const onFile = async (file: File) => {
    const text = await file.text();
    setCsv(text);
    setFilename(file.name);
    setStep(1);
  };

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="font-display text-4xl">{copy.import.title}</h1>
      <ol className="mt-4 flex flex-wrap gap-3 text-sm text-fg-muted">
        {[copy.import.stepUpload, copy.import.stepMap, copy.import.stepPreview, copy.import.stepCommit].map((label, i) => (
          <li key={label} className={i === step ? 'text-accent' : ''}>
            {i + 1}. {label}
          </li>
        ))}
      </ol>

      {step === 0 ? (
        <InstrumentPanel className="mt-8">
          <label className="flex min-h-48 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-border-strong p-8">
            <span>{copy.import.drop}</span>
            <input
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onFile(file);
              }}
            />
          </label>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button
              variant="secondary"
              onClick={() => {
                setCsv(sampleCsv);
                setFilename('attendees.csv');
                setStep(1);
              }}
            >
              {copy.import.sample}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setCsv(sampleRound2Csv);
                setFilename('attendees_round2.csv');
                setStep(1);
              }}
            >
              {copy.import.sampleRound2}
            </Button>
          </div>
        </InstrumentPanel>
      ) : null}

      {step >= 1 && csv ? (
        <InstrumentPanel className="mt-6">
          <h2 className="font-display text-2xl">{copy.import.stepMap}</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {FIELDS.map((field) => (
              <label key={field} className="flex items-center justify-between gap-3 text-sm">
                <span>{field}</span>
                <NativeSelect
                  value={mapping[field] ?? ''}
                  onChange={(e) => setMapping((m) => ({...m, [field]: e.target.value}))}
                >
                  <option value="">Auto</option>
                  {(preview?.headers ?? guessHeaders(csv)).map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </NativeSelect>
              </label>
            ))}
          </div>
          <Button className="mt-4" pending={previewMut.isPending} onClick={() => previewMut.mutate()}>
            {copy.import.preview}
          </Button>
        </InstrumentPanel>
      ) : null}

      {preview && step >= 2 ? (
        <InstrumentPanel className="mt-6">
          <h2 className="font-display text-2xl">{copy.import.stepPreview}</h2>
          <div className="mt-3 flex flex-wrap gap-2 text-sm">
            {Object.entries(preview.summary).map(([k, v]) => (
              <Badge key={k}>
                {k}: {v}
              </Badge>
            ))}
          </div>
          <Table className="mt-4">
            <THead>
              <TR>
                <TH>Row</TH>
                <TH>Name</TH>
                <TH>Email</TH>
                <TH>Course</TH>
                <TH>Outcome</TH>
              </TR>
            </THead>
            <TBody>
              {preview.rows.slice(0, 40).map((row) => (
                <TR key={row.rowNumber}>
                  <TD>{row.rowNumber}</TD>
                  <TD>{row.fullName}</TD>
                  <TD className="font-mono text-xs">{row.emailNorm}</TD>
                  <TD>{row.courseCode}</TD>
                  <TD>{row.outcome}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Button className="mt-4" pending={commitMut.isPending} onClick={() => commitMut.mutate()}>
            {copy.import.commit}
          </Button>
        </InstrumentPanel>
      ) : null}

      <InstrumentPanel className="mt-6">
        <h2 className="font-display text-2xl">{copy.import.history}</h2>
        <Table className="mt-4">
          <THead>
            <TR>
              <TH>File</TH>
              <TH>When</TH>
              <TH>Rows</TH>
              <TH>Actions</TH>
            </TR>
          </THead>
          <TBody>
            {(history.data?.imports ?? []).map((imp) => (
              <TR key={imp.id}>
                <TD>{imp.filename}</TD>
                <TD>{formatDateTime(imp.created_at)}</TD>
                <TD>{imp.row_count}</TD>
                <TD>
                  {imp.undone_at ? (
                    'Undone'
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => setUndoId(imp.id)}>
                      {copy.import.undo}
                    </Button>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </InstrumentPanel>

      <ConfirmDialog
        open={undoId !== null}
        onOpenChange={() => setUndoId(null)}
        title={copy.import.undo}
        body={copy.confirm.undoImport.replace('{file}', String(undoId))}
        confirmLabel={copy.import.undo}
        danger
        onConfirm={async () => {
          if (undoId == null) return;
          await api.undoImport(undoId);
          toast.success(copy.toast.undone);
          setUndoId(null);
          await queryClient.invalidateQueries();
        }}
      />
    </div>
  );
}

function guessHeaders(csv: string): string[] {
  const line = csv.replace(/^\uFEFF/, '').split(/\r?\n/)[0] ?? '';
  return line.split(',').map((h) => h.trim()).filter(Boolean);
}
