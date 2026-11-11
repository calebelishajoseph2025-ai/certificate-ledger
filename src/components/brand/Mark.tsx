export function Mark({size = 40, className}: {size?: number; className?: string}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      className={className}
      aria-hidden="true"
    >
      <rect x="1" y="1" width="38" height="38" rx="8" fill="var(--accent)" opacity="0.12" />
      <rect
        x="1"
        y="1"
        width="38"
        height="38"
        rx="8"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="1"
        opacity="0.55"
      />
      <circle cx="20" cy="20" r="13" fill="none" stroke="var(--accent)" strokeWidth="1.4" />
      <circle cx="20" cy="20" r="9" fill="none" stroke="var(--accent)" strokeWidth="0.7" opacity="0.65" />
      <path
        fill="var(--accent)"
        d="M20 9.2 21.7 14.4 27.2 14.6 22.9 18 24.5 23.2 20 20.3 15.5 23.2 17.1 18 12.8 14.6 18.3 14.4z"
      />
    </svg>
  );
}
