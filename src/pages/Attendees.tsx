import {useMemo, useState} from 'react';
import {useNavigate, useSearchParams} from 'react-router-dom';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {api} from '@/lib/api';
import {keys} from '@/lib/keys';
import {copy, interpolate} from '@/lib/copy';
import {useDebounce} from '@/hooks/useDebounce';
import {Button} from '@/components/ui/button';
import {Input, Field} from '@/components/ui/input';
import {NativeSelect} from '@/components/ui/select';
import {Badge} from '@/components/ui/badge';
import {Table, TBody, TD, TH, THead, TR} from '@/components/ui/table';
import {Drawer} from '@/components/ui/drawer';
import {ConfirmDialog} from '@/components/ui/dialog';
import {EmptyState, ErrorState, Skeleton} from '@/components/ui/skeleton';
import {classifyLive} from '@/lib/format';
import {getProblemMeta} from '@/lib/problemLabels';
import {toast} from '@/components/ui/toast';
import {isApiError} from '@/lib/errors';
import type {Attendee} from '@/lib/schemas';

export default function AttendeesPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const q = params.get('q') ?? '';
  const state = params.get('state') ?? '';
  const course = params.get('course') ?? '';
  const cert = params.get('cert') ?? '';
  const debounced = useDebounce(q, 250);
  const [selected, setSelected] = useState<number[]>([]);
  const [editing, setEditing] = useState<Attendee | null>(null);
  const [confirmIssue, setConfirmIssue] = useState<Attendee | null>(null);
  const [adding, setAdding] = useState(false);

  const list = useQuery({
    queryKey: keys.attendees({q: debounced, state, course, cert}),
    queryFn: ({signal}) => api.getAttendees({q: debounced, state, course, cert}, signal),
  });
  const courses = useQuery({queryKey: keys.courses(), queryFn: ({signal}) => api.getCourses(signal)});

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  };

  const issue = useMutation({
    mutationFn: (id: number) => api.issueAttendee(id),
    onSuccess: async (res) => {
      toast.success(res.created ? copy.toast.issued : copy.toast.alreadyIssued);
      await queryClient.invalidateQueries();
      setConfirmIssue(null);
    },
    onError: (err) => toast.error(isApiError(err) ? err.message : copy.errors.generic),
  });

  const knownCourses = useMemo(
    () => new Set((courses.data?.courses ?? []).map((c) => c.code)),
    [courses.data],
  );

  if (list.isLoading) return <Skeleton className="h-96 w-full" />;
  if (list.error) return <ErrorState title={copy.errors.generic} />;

  const rows = list.data?.attendees ?? [];

  return (
    <div className="mx-auto max-w-7xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-4xl">{copy.attendees.title}</h1>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setAdding(true)}>
            {copy.attendees.add}
          </Button>
          <a className="inline-flex h-11 items-center rounded-md border border-border px-4 text-sm" href={api.exportCorrectionsCsvUrl(course || undefined)}>
            {copy.attendees.export}
          </a>
        </div>
      </div>
      <div className="mt-6 flex flex-wrap gap-3">
        <Input
          value={q}
          onChange={(e) => setFilter('q', e.target.value)}
          placeholder={copy.attendees.search}
          className="max-w-sm"
        />
        <NativeSelect value={state} onChange={(e) => setFilter('state', e.target.value)} aria-label={copy.attendees.state}>
          <option value="">All states</option>
          <option value="ready">Ready</option>
          <option value="needs_correction">Needs correction</option>
        </NativeSelect>
        <NativeSelect value={course} onChange={(e) => setFilter('course', e.target.value)} aria-label={copy.attendees.course}>
          <option value="">All courses</option>
          {(courses.data?.courses ?? []).map((c) => (
            <option key={c.code} value={c.code}>
              {c.code}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect value={cert} onChange={(e) => setFilter('cert', e.target.value)} aria-label={copy.attendees.cert}>
          <option value="">Any certificate</option>
          <option value="valid">Valid</option>
          <option value="revoked">Revoked</option>
        </NativeSelect>
      </div>

      {rows.length === 0 ? (
        <EmptyState title={copy.attendees.empty} />
      ) : (
        <Table className="mt-6">
          <THead>
            <TR>
              <TH>
                <input
                  type="checkbox"
                  aria-label="Select all"
                  onChange={(e) => setSelected(e.target.checked ? rows.map((r) => r.id) : [])}
                />
              </TH>
              <TH>Name</TH>
              <TH>Email</TH>
              <TH>Course</TH>
              <TH>State</TH>
              <TH>Certificate</TH>
              <TH>Actions</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((row) => (
              <TR key={row.id}>
                <TD>
                  <input
                    type="checkbox"
                    checked={selected.includes(row.id)}
                    onChange={(e) =>
                      setSelected((cur) => (e.target.checked ? [...cur, row.id] : cur.filter((id) => id !== row.id)))
                    }
                    aria-label={row.full_name}
                  />
                </TD>
                <TD>{row.full_name || '—'}</TD>
                <TD className="font-mono text-xs">{row.email_norm || '—'}</TD>
                <TD>{row.course_code}</TD>
                <TD>
                  <Badge tone={row.record_state === 'ready' ? 'success' : 'warning'}>{row.record_state}</Badge>
                  {row.problems.map((p) => (
                    <span key={p} className="ml-1 text-xs text-fg-faint">
                      {getProblemMeta(p).label}
                    </span>
                  ))}
                </TD>
                <TD className="whitespace-nowrap">
                  {row.certificate ? (
                    <button
                      type="button"
                      className="font-mono text-xs text-accent underline"
                      onClick={() => navigate(`/certificates/${row.certificate?.cert_id}`)}
                    >
                      {row.certificate.cert_id}
                    </button>
                  ) : (
                    '—'
                  )}
                </TD>
                <TD className="whitespace-nowrap">
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="ghost" className="w-20" onClick={() => setEditing(row)}>
                      {copy.attendees.edit}
                    </Button>
                    {row.record_state === 'ready' && row.completed && !row.certificate ? (
                      <Button size="sm" className="w-20" onClick={() => setConfirmIssue(row)}>
                        {copy.attendees.issue}
                      </Button>
                    ) : (
                      <span className="inline-block w-20" aria-hidden="true" />
                    )}
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <Drawer open={Boolean(editing) || adding} onOpenChange={() => { setEditing(null); setAdding(false); }} title={adding ? copy.attendees.add : copy.attendees.edit}>
        <AttendeeForm
          attendee={editing}
          knownCourses={knownCourses}
          courses={courses.data?.courses ?? []}
          onDone={async () => {
            setEditing(null);
            setAdding(false);
            await queryClient.invalidateQueries({queryKey: ['attendees']});
          }}
        />
      </Drawer>

      <ConfirmDialog
        open={Boolean(confirmIssue)}
        onOpenChange={() => setConfirmIssue(null)}
        title={copy.attendees.issue}
        body={interpolate(copy.confirm.issueOne, {
          name: confirmIssue?.full_name ?? '',
          course: confirmIssue?.course_code ?? '',
        })}
        confirmLabel={copy.attendees.issue}
        pending={issue.isPending}
        onConfirm={() => confirmIssue && issue.mutate(confirmIssue.id)}
      />
    </div>
  );
}

function AttendeeForm({
  attendee,
  knownCourses,
  courses,
  onDone,
}: {
  attendee: Attendee | null;
  knownCourses: Set<string>;
  courses: Array<{code: string; title: string}>;
  onDone: () => void;
}) {
  const [name, setName] = useState(attendee?.full_name ?? '');
  const [email, setEmail] = useState(attendee?.email_norm ?? '');
  const [course, setCourse] = useState(attendee?.course_code ?? courses[0]?.code ?? '');
  const [date, setDate] = useState(attendee?.completion_date ?? '');
  const [status, setStatus] = useState(attendee?.completed ? 'completed' : 'dropped');
  const live = classifyLive({name, email, course, completion_date: date, status}, knownCourses);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (attendee) {
          await api.patchAttendee(attendee.id, {name, email, course, completion_date: date, status});
          toast.success(copy.toast.saved);
        } else {
          await api.addAttendee({name, email, course, completion_date: date, status});
          toast.success(copy.toast.saved);
        }
        onDone();
      }}
    >
      <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Email"><Input value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      <Field label="Course">
        <NativeSelect value={course} onChange={(e) => setCourse(e.target.value)}>
          {courses.map((c) => (
            <option key={c.code} value={c.code}>{c.code} — {c.title}</option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="Completion date"><Input value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <Field label="Status">
        <NativeSelect value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="completed">completed</option>
          <option value="dropped">dropped</option>
          <option value="in progress">in progress</option>
        </NativeSelect>
      </Field>
      {live.problems.length ? (
        <ul className="text-sm text-warning">
          {live.problems.map((p) => (
            <li key={p}>{getProblemMeta(p).howToFix}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-success">Ready</p>
      )}
      <Button type="submit">{copy.toast.saved}</Button>
    </form>
  );
}
