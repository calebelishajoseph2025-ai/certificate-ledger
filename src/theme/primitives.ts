import {oklch, type Oklch} from './oklch';

export type Ramp = Record<50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950, Oklch>;

export const ink: Ramp = {
  50: oklch(0.98, 0.01, 250),
  100: oklch(0.94, 0.015, 250),
  200: oklch(0.86, 0.02, 250),
  300: oklch(0.74, 0.025, 250),
  400: oklch(0.62, 0.03, 250),
  500: oklch(0.5, 0.03, 250),
  600: oklch(0.4, 0.03, 250),
  700: oklch(0.32, 0.028, 250),
  800: oklch(0.24, 0.025, 250),
  900: oklch(0.18, 0.022, 250),
  950: oklch(0.14, 0.02, 250),
};

export const brass: Ramp = {
  50: oklch(0.97, 0.03, 85),
  100: oklch(0.93, 0.05, 85),
  200: oklch(0.86, 0.08, 85),
  300: oklch(0.78, 0.1, 85),
  400: oklch(0.72, 0.12, 85),
  500: oklch(0.68, 0.13, 85),
  600: oklch(0.58, 0.12, 85),
  700: oklch(0.48, 0.1, 85),
  800: oklch(0.38, 0.08, 85),
  900: oklch(0.3, 0.06, 85),
  950: oklch(0.24, 0.05, 85),
};

export const pine: Ramp = {
  50: oklch(0.96, 0.02, 155),
  100: oklch(0.9, 0.04, 155),
  200: oklch(0.82, 0.06, 155),
  300: oklch(0.72, 0.08, 155),
  400: oklch(0.62, 0.1, 155),
  500: oklch(0.55, 0.12, 155),
  600: oklch(0.48, 0.11, 155),
  700: oklch(0.4, 0.09, 155),
  800: oklch(0.32, 0.07, 155),
  900: oklch(0.26, 0.05, 155),
  950: oklch(0.2, 0.04, 155),
};

export const coral: Ramp = {
  50: oklch(0.96, 0.02, 25),
  100: oklch(0.9, 0.05, 25),
  200: oklch(0.82, 0.08, 25),
  300: oklch(0.72, 0.12, 25),
  400: oklch(0.64, 0.15, 25),
  500: oklch(0.58, 0.16, 25),
  600: oklch(0.5, 0.15, 25),
  700: oklch(0.42, 0.13, 25),
  800: oklch(0.34, 0.1, 25),
  900: oklch(0.28, 0.08, 25),
  950: oklch(0.22, 0.06, 25),
};

export const space = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 16,
  xl: 24,
} as const;

export const typeScale = {
  display: {size: 56, line: 64, tracking: -0.02},
  h1: {size: 36, line: 44, tracking: -0.015},
  h2: {size: 28, line: 36, tracking: -0.01},
  h3: {size: 22, line: 28, tracking: -0.005},
  body: {size: 16, line: 26, tracking: 0},
  small: {size: 14, line: 22, tracking: 0.01},
  micro: {size: 12, line: 18, tracking: 0.04},
} as const;
