import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  readDensity,
  readRail,
  readTheme,
  writeDensity,
  writeRail,
  writeTheme,
  type Density,
  type RailState,
} from './storage';
import {THEMES, type ThemeName} from './themes';

interface ThemeContextValue {
  theme: ThemeName;
  setTheme: (theme: ThemeName) => void;
  reduceMotion: boolean;
  density: Density;
  setDensity: (value: Density) => void;
  rail: RailState;
  setRail: (value: RailState) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function defaultTheme(): ThemeName {
  return 'tidewater';
}

function systemReduceMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function applyTheme(theme: ThemeName) {
  document.documentElement.setAttribute('data-theme', theme);
  window.dispatchEvent(new CustomEvent('cl-theme-change', {detail: {theme, tokens: THEMES[theme]}}));
}

export function ThemeProvider({children}: {children: ReactNode}) {
  const [theme, setThemeState] = useState<ThemeName>(() => readTheme() ?? defaultTheme());
  const [reduceMotion, setReduceMotionState] = useState<boolean>(() => systemReduceMotion());
  const [density, setDensityState] = useState<Density>(() => readDensity());
  const [rail, setRailState] = useState<RailState>(() => readRail());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.setAttribute('data-reduce-motion', reduceMotion ? 'true' : 'false');
  }, [reduceMotion]);

  useEffect(() => {
    document.documentElement.setAttribute('data-density', density);
  }, [density]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduceMotionState(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === 'cl.theme') {
        const next = readTheme();
        if (next) {
          setThemeState(next);
          applyTheme(next);
        }
      }
      if (event.key === 'cl.density') setDensityState(readDensity());
      if (event.key === 'cl.rail') setRailState(readRail());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setTheme = useCallback((next: ThemeName) => {
    setThemeState(next);
    writeTheme(next);
    applyTheme(next);
  }, []);

  const setDensity = useCallback((value: Density) => {
    setDensityState(value);
    writeDensity(value);
  }, []);

  const setRail = useCallback((value: RailState) => {
    setRailState(value);
    writeRail(value);
  }, []);

  const value = useMemo(
    () => ({theme, setTheme, reduceMotion, density, setDensity, rail, setRail}),
    [theme, setTheme, reduceMotion, density, setDensity, rail, setRail],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return ctx;
}
