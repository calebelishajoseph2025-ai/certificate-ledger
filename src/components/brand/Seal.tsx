export function Seal({size = 88}: {size?: number; label?: string}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 88 88"
      aria-hidden="true"
      className="text-current"
    >
      <circle cx="44" cy="44" r="42" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="44" cy="44" r="35" fill="none" stroke="currentColor" strokeWidth="0.75" opacity="0.65" />
      <circle cx="44" cy="44" r="26" fill="currentColor" opacity="0.12" />
      <g transform="translate(44 44) scale(2.15) translate(-20 -20)">
        <path
          fill="currentColor"
          d="M20 9.2 21.7 14.4 27.2 14.6 22.9 18 24.5 23.2 20 20.3 15.5 23.2 17.1 18 12.8 14.6 18.3 14.4z"
        />
      </g>
    </svg>
  );
}

export function Stamp({label, tone = 'success'}: {label: string; tone?: 'success' | 'danger' | 'warning'}) {
  const color =
    tone === 'danger' ? 'text-danger border-danger' : tone === 'warning' ? 'text-warning border-warning' : 'text-success border-success';
  return (
    <div
      className={`pointer-events-none absolute right-8 top-8 rotate-[-8deg] rounded-md border-2 px-4 py-2 font-display text-2xl uppercase tracking-micro ${color}`}
    >
      {label}
    </div>
  );
}
