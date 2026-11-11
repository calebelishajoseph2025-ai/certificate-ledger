import {lazy, Suspense} from 'react';
import {Skeleton} from '@/components/ui/skeleton';

const QR = lazy(async () => {
  const mod = await import('qrcode.react');
  return {default: mod.QRCodeSVG};
});

export function QrMark({value, size = 96}: {value: string; size?: number}) {
  return (
    <Suspense fallback={<Skeleton className="h-24 w-24" />}>
      <QR value={value} size={size} level="M" includeMargin={false} bgColor="transparent" fgColor="currentColor" />
    </Suspense>
  );
}
