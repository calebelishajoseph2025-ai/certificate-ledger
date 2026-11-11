import type {ThemeName} from './themes';

export const THEME_STORAGE_KEY = 'cl.theme';
export const REDUCE_MOTION_KEY = 'cl.reduceMotion';
export const DENSITY_KEY = 'cl.density';
export const RAIL_KEY = 'cl.rail';

export type Density = 'comfortable' | 'compact';
export type RailState = 'expanded' | 'collapsed';

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

export function readTheme(): ThemeName | null {
  const value = read(THEME_STORAGE_KEY);
  if (value === 'observatory' || value === 'parchment' || value === 'tidewater') return value;
  return null;
}

export function writeTheme(theme: ThemeName): void {
  write(THEME_STORAGE_KEY, theme);
}

export function readReduceMotion(): boolean | null {
  const value = read(REDUCE_MOTION_KEY);
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

export function writeReduceMotion(value: boolean): void {
  write(REDUCE_MOTION_KEY, value ? 'true' : 'false');
}

export function readDensity(): Density {
  return read(DENSITY_KEY) === 'compact' ? 'compact' : 'comfortable';
}

export function writeDensity(value: Density): void {
  write(DENSITY_KEY, value);
}

export function readRail(): RailState {
  return read(RAIL_KEY) === 'collapsed' ? 'collapsed' : 'expanded';
}

export function writeRail(value: RailState): void {
  write(RAIL_KEY, value);
}
