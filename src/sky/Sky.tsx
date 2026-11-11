import {SkyFallback} from './fallback';
import {useSky} from './useSky';
import {publishSky} from './events';
import {useEffect} from 'react';

export function Sky({enabled = true}: {enabled?: boolean}) {
  const {canvasRef, webgl, reduceMotion} = useSky(enabled);

  useEffect(() => {
    if (reduceMotion || !webgl) {
      publishSky({
        fps: 0,
        dpr: 1,
        quality: 'off',
        layerCount: 0,
        reducedMotion: reduceMotion,
        webgl,
      });
    }
  }, [reduceMotion, webgl]);

  if (!enabled || reduceMotion || !webgl) {
    return <SkyFallback />;
  }

  return (
    <div data-sky="webgl" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden="true">
      <canvas ref={canvasRef} className="h-full w-full" />
    </div>
  );
}
