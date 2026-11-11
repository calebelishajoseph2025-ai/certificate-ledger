import {useEffect, useRef, useState} from 'react';
import {useTheme} from '@/theme/ThemeProvider';
import {SKY_THEME_EVENT} from './events';
import {SkyEngine} from './engine';
import type {ThemeName} from '@/theme/themes';

function isWebGLAvailable(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    const probe = document.createElement('canvas');
    return Boolean(
      (window.WebGL2RenderingContext && probe.getContext('webgl2')) ||
      probe.getContext('webgl') ||
      probe.getContext('experimental-webgl'),
    );
  } catch {
    return false;
  }
}

export function useSky(enabled: boolean) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<SkyEngine | null>(null);
  const {theme, reduceMotion} = useTheme();
  const [webgl, setWebgl] = useState(true);

  useEffect(() => {
    if (!enabled || reduceMotion) {
      engineRef.current?.dispose();
      engineRef.current = null;
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (!isWebGLAvailable()) {
      setWebgl(false);
      return;
    }

    try {
      const engine = new SkyEngine({canvas, theme, reducedMotion: reduceMotion});
      engineRef.current = engine;
      setWebgl(true);
      const onVis = () => {
        if (document.hidden) engine.pause();
        else engine.resume();
      };
      document.addEventListener('visibilitychange', onVis);
      return () => {
        document.removeEventListener('visibilitychange', onVis);
        engine.dispose();
        engineRef.current = null;
      };
    } catch {
      setWebgl(false);
      return;
    }
  }, [enabled, reduceMotion]);

  useEffect(() => {
    if (engineRef.current) {
      engineRef.current.setTheme(theme);
    }
  }, [theme]);

  useEffect(() => {
    const onTheme = (event: Event) => {
      const detail = (event as CustomEvent<{theme: ThemeName}>).detail;
      if (detail?.theme) engineRef.current?.setTheme(detail.theme);
    };
    window.addEventListener(SKY_THEME_EVENT, onTheme);
    return () => window.removeEventListener(SKY_THEME_EVENT, onTheme);
  }, []);

  useEffect(() => {
    engineRef.current?.setReducedMotion(reduceMotion);
  }, [reduceMotion]);

  return {canvasRef, webgl, reduceMotion};
}
