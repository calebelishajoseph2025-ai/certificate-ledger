import {area as d3area, curveBasis} from 'd3-shape';
import {scaleLinear} from 'd3-scale';
import type {Funnel} from '@/lib/schemas';
import {formatNumber} from '@/lib/format';
import {copy} from '@/lib/copy';

const STAGES: Array<{key: keyof Funnel; label: string; filter?: string}> = [
  {key: 'uniqueRecords', label: 'Unique records'},
  {key: 'ready', label: 'Ready', filter: 'ready'},
  {key: 'eligible', label: 'Eligible'},
  {key: 'issuedEver', label: 'Issued ever'},
  {key: 'currentlyValid', label: 'Currently valid', filter: 'valid'},
];

export function PipelineRiver({
  funnel,
  onFilter,
}: {
  funnel: Funnel;
  onFilter?: (kind: string) => void;
}) {
  const values = STAGES.map((s) => Number(funnel[s.key]));
  const max = Math.max(1, ...values);
  const width = 720;
  const height = 240;
  const baseline = height - 40;
  const x = scaleLinear()
    .domain([0, STAGES.length - 1])
    .range([56, width - 56]);
  const y = scaleLinear().domain([0, max]).range([baseline, 72]);

  const areaGen = d3area<number>()
    .x((_, i) => x(i) ?? 0)
    .y0(baseline)
    .y1((v) => y(v) ?? baseline)
    .curve(curveBasis);
  const d = areaGen(values) ?? '';

  const drops = [
    {label: 'Needs correction', value: funnel.dropOffs.needsCorrection, to: 'needs_correction'},
    {label: 'Not completed', value: funnel.dropOffs.notCompleted, to: 'not_completed'},
    {label: 'Pending', value: funnel.dropOffs.pending, to: 'pending'},
    {label: 'Revoked', value: funnel.dropOffs.revoked, to: 'revoked'},
  ];

  return (
    <div>
      <h2 className="font-display text-2xl">{copy.dashboard.funnelTitle}</h2>
      <svg viewBox={`0 0 ${width} ${height}`} className="mt-4 h-auto w-full" role="img" aria-label={copy.dashboard.funnelTitle}>
        <path d={d} fill="var(--accent)" opacity="0.22" />
        {STAGES.map((stage, i) => {
          const cx = x(i) ?? 0;
          const cy = y(values[i] ?? 0) ?? 0;
          return (
            <g key={stage.key}>
              <circle cx={cx} cy={cy} r="6" fill="var(--accent)" />
              <text x={cx} y={22} textAnchor="middle" fill="var(--fg-muted)" fontSize="11">
                {stage.label}
              </text>
              <text x={cx} y={44} textAnchor="middle" fill="var(--fg)" fontSize="14" fontFamily="var(--font-mono)">
                {formatNumber(values[i] ?? 0)}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="mt-4 flex flex-wrap gap-3">
        {drops.map((drop) => (
          <button
            key={drop.label}
            type="button"
            className="h-10 rounded-full border border-border px-3 text-sm text-fg-muted hover:text-fg"
            onClick={() => onFilter?.(drop.to)}
          >
            {drop.label}: {formatNumber(drop.value)}
          </button>
        ))}
      </div>
    </div>
  );
}
