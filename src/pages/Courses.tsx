import {useState, type CSSProperties} from 'react';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {useNavigate} from 'react-router-dom';
import {api} from '@/lib/api';
import {keys} from '@/lib/keys';
import {copy, interpolate} from '@/lib/copy';
import {cn} from '@/lib/cn';
import {Button} from '@/components/ui/button';
import {Field, Input} from '@/components/ui/input';
import {InstrumentPanel} from '@/components/ui/instrument';
import {ConfirmDialog, Dialog, DialogContent} from '@/components/ui/dialog';
import {CERTIFICATE_THEME_IDS, CERTIFICATE_THEMES, certificateThemeVars} from '@/theme/certificate-themes';
import {toast} from '@/components/ui/toast';
import {useQuery as useStats} from '@tanstack/react-query';
import {EmptyState} from '@/components/ui/skeleton';
import {isApiError} from '@/lib/errors';

export default function CoursesPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const courses = useQuery({queryKey: keys.courses(), queryFn: ({signal}) => api.getCourses(signal)});
  const stats = useStats({queryKey: keys.stats('all'), queryFn: ({signal}) => api.getStats('all', signal)});
  const [createOpen, setCreateOpen] = useState(false);
  const [issueCourse, setIssueCourse] = useState<string | null>(null);

  const issue = useMutation({
    mutationFn: (code: string) => api.issueAll(code, 'real'),
    onSuccess: async (res) => {
      toast.success(`Created ${res.created}, already issued ${res.already_issued}`);
      await queryClient.invalidateQueries();
      setIssueCourse(null);
    },
    onError: (err) => toast.error(isApiError(err) ? err.message : copy.errors.generic),
  });

  const list = courses.data?.courses ?? [];

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-4xl">{copy.courses.title}</h1>
        <Button onClick={() => setCreateOpen(true)}>{copy.courses.create}</Button>
      </div>
      {list.length === 0 ? (
        <EmptyState
          title={copy.courses.empty}
          action={
            <Button onClick={() => setCreateOpen(true)}>{copy.courses.create}</Button>
          }
        />
      ) : (
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {list.map((course) => {
            const cs = stats.data?.byCourse[course.code];
            return (
              <InstrumentPanel key={course.id}>
                <p className="font-mono text-xs text-accent">{course.code}</p>
                <h2 className="mt-1 font-display text-2xl">{course.title}</h2>
                <p className="mt-1 text-sm text-fg-muted">
                  {course.hours} {copy.courses.hours}
                  {course.is_demo ? ' · demo' : ''}
                </p>
                {cs ? (
                  <p className="mt-3 font-mono text-sm text-fg-muted">
                    {cs.issued} issued · {cs.pending} pending · {cs.revoked} revoked
                  </p>
                ) : null}
                <fieldset className="mt-4">
                  <legend className="mb-2 text-sm">{copy.courses.theme}</legend>
                  <div className="flex flex-wrap gap-2">
                    {CERTIFICATE_THEME_IDS.map((id) => {
                      const theme = CERTIFICATE_THEMES[id];
                      const vars = certificateThemeVars(theme) as CSSProperties;
                      const selected = course.theme === id;
                      return (
                        <button
                          key={id}
                          type="button"
                          aria-pressed={selected}
                          className={cn(
                            'inline-flex h-11 items-center gap-2 rounded-md border px-3 text-xs capitalize',
                            selected ? 'border-accent text-fg' : 'border-border text-fg-muted hover:text-fg',
                          )}
                          onClick={async () => {
                            await api.patchCourse(course.code, {theme: id});
                            await queryClient.invalidateQueries({queryKey: keys.courses()});
                          }}
                        >
                          <span
                            className="inline-block h-5 w-5 rounded-sm border"
                            style={{
                              ...vars,
                              background: 'var(--cert-paper)',
                              borderColor: 'var(--cert-border)',
                            }}
                            aria-hidden="true"
                          />
                          {theme.label}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => setIssueCourse(course.code)}>
                    {copy.courses.issueAll}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => navigate(`/print/batch/${course.code}`)}>
                    {copy.courses.printBatch}
                  </Button>
                </div>
              </InstrumentPanel>
            );
          })}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent title={copy.courses.create}>
          <CreateCourseForm
            onDone={async () => {
              setCreateOpen(false);
              await queryClient.invalidateQueries({queryKey: keys.courses()});
            }}
          />
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(issueCourse)}
        onOpenChange={(open) => {
          if (!open) setIssueCourse(null);
        }}
        title={copy.courses.issueAll}
        body={interpolate(copy.confirm.issueCourse, {course: issueCourse ?? ''})}
        confirmLabel={copy.courses.issueAll}
        pending={issue.isPending}
        onConfirm={() => issueCourse && issue.mutate(issueCourse)}
      />
    </div>
  );
}

function CreateCourseForm({onDone}: {onDone: () => void}) {
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [hours, setHours] = useState('10');
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        await api.createCourse({code, title, hours: Number(hours), theme: 'classic'});
        toast.success(copy.toast.saved);
        onDone();
      }}
    >
      <Field label="Code"><Input value={code} onChange={(e) => setCode(e.target.value)} required /></Field>
      <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} required /></Field>
      <Field label="Hours"><Input value={hours} onChange={(e) => setHours(e.target.value)} type="number" min={1} /></Field>
      <Button type="submit">{copy.courses.create}</Button>
    </form>
  );
}
