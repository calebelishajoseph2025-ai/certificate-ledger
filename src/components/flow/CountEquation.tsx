import {invariantEquation} from '@/lib/format';
import type {Stats} from '@/lib/schemas';
import {cn} from '@/lib/cn';
import {copy} from '@/lib/copy';

export function CountEquation({stats}: {stats: Stats}) {
  const {holds, formula} = invariantEquation(stats);
  return (
    <p
      className={cn(
        'font-mono text-sm tabular',
        holds ? 'text-success' : 'text-danger',
      )}
      role={holds ? undefined : 'alert'}
    >
      {holds ? copy.dashboard.invariant : copy.dashboard.invariantFail} — {formula}
    </p>
  );
}
