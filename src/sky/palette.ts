import {oklchToRgbTuple} from '@/theme/oklch';
import {THEMES, type ThemeName} from '@/theme/themes';

export interface SkyPalette {
  a: [number, number, number];
  b: [number, number, number];
  c: [number, number, number];
  star: [number, number, number];
  nebula: [number, number, number];
}

export function skyPalette(theme: ThemeName): SkyPalette {
  const t = THEMES[theme];
  return {
    a: oklchToRgbTuple(t.skyA),
    b: oklchToRgbTuple(t.skyB),
    c: oklchToRgbTuple(t.skyC),
    star: oklchToRgbTuple(t.star),
    nebula: oklchToRgbTuple(t.nebula),
  };
}
