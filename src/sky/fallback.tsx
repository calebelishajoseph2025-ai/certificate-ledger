import {copy} from '@/lib/copy';

export function SkyFallback() {
  return (
    <div
      data-sky="fallback"
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
      style={{
        background:
          'radial-gradient(1200px 700px at 12% 8%, var(--sky-b), transparent 55%), radial-gradient(900px 600px at 88% 12%, var(--sky-c), transparent 50%), radial-gradient(1000px 800px at 50% 110%, var(--nebula), var(--sky-a))',
      }}
    >
      <span className="sr-only">{copy.a11y.skyOff}</span>
    </div>
  );
}
