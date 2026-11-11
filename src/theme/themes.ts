import {brass, coral, ink, pine} from './primitives';
import {formatOklch, oklch, type Oklch} from './oklch';

export type ThemeName = 'observatory' | 'parchment' | 'tidewater';

export interface SemanticTokens {
  bg: Oklch;
  bgSunken: Oklch;
  bgElevated: Oklch;
  surface1: Oklch;
  surface2: Oklch;
  surface3: Oklch;
  fg: Oklch;
  fgMuted: Oklch;
  fgFaint: Oklch;
  border: Oklch;
  borderStrong: Oklch;
  accent: Oklch;
  accentFg: Oklch;
  accentMuted: Oklch;
  success: Oklch;
  successFg: Oklch;
  warning: Oklch;
  warningFg: Oklch;
  danger: Oklch;
  dangerFg: Oklch;
  info: Oklch;
  infoFg: Oklch;
  overlay: Oklch;
  ring: Oklch;
  glow: Oklch;
  skyA: Oklch;
  skyB: Oklch;
  skyC: Oklch;
  star: Oklch;
  nebula: Oklch;
}

export const THEMES: Record<ThemeName, SemanticTokens> = {
  observatory: {
    bg: oklch(0.16, 0.02, 250),
    bgSunken: oklch(0.13, 0.02, 250),
    bgElevated: oklch(0.2, 0.025, 250),
    surface1: oklch(0.2, 0.02, 250),
    surface2: oklch(0.24, 0.025, 250),
    surface3: oklch(0.28, 0.03, 250),
    fg: oklch(0.93, 0.01, 85),
    fgMuted: oklch(0.72, 0.02, 250),
    fgFaint: oklch(0.55, 0.02, 250),
    border: oklch(0.3, 0.02, 250),
    borderStrong: oklch(0.4, 0.03, 250),
    accent: brass[500],
    accentFg: oklch(0.18, 0.03, 85),
    accentMuted: brass[800],
    success: pine[400],
    successFg: oklch(0.16, 0.03, 155),
    warning: oklch(0.78, 0.12, 75),
    warningFg: oklch(0.22, 0.04, 75),
    danger: coral[400],
    dangerFg: oklch(0.18, 0.04, 25),
    info: oklch(0.7, 0.08, 230),
    infoFg: oklch(0.16, 0.03, 230),
    overlay: oklch(0.1, 0.02, 250, 0.72),
    ring: brass[400],
    glow: brass[500],
    skyA: oklch(0.12, 0.04, 250),
    skyB: oklch(0.14, 0.06, 280),
    skyC: oklch(0.18, 0.05, 220),
    star: oklch(0.95, 0.02, 90),
    nebula: oklch(0.45, 0.08, 280),
  },
  parchment: {
    bg: oklch(0.96, 0.02, 85),
    bgSunken: oklch(0.93, 0.025, 85),
    bgElevated: oklch(0.98, 0.015, 85),
    surface1: oklch(0.98, 0.015, 85),
    surface2: oklch(0.94, 0.02, 85),
    surface3: oklch(0.9, 0.025, 85),
    fg: oklch(0.22, 0.03, 250),
    fgMuted: oklch(0.42, 0.03, 250),
    fgFaint: oklch(0.55, 0.02, 250),
    border: oklch(0.82, 0.03, 85),
    borderStrong: oklch(0.7, 0.04, 85),
    accent: brass[700],
    accentFg: oklch(0.98, 0.02, 85),
    accentMuted: brass[200],
    success: pine[700],
    successFg: oklch(0.97, 0.02, 155),
    warning: oklch(0.55, 0.12, 70),
    warningFg: oklch(0.98, 0.02, 85),
    danger: coral[700],
    dangerFg: oklch(0.98, 0.02, 25),
    info: oklch(0.45, 0.08, 230),
    infoFg: oklch(0.98, 0.02, 230),
    overlay: oklch(0.22, 0.03, 250, 0.5),
    ring: brass[600],
    glow: brass[400],
    skyA: oklch(0.93, 0.03, 85),
    skyB: oklch(0.9, 0.04, 70),
    skyC: oklch(0.88, 0.03, 100),
    star: oklch(0.4, 0.04, 85),
    nebula: oklch(0.72, 0.06, 80),
  },
  tidewater: {
    bg: oklch(0.18, 0.03, 200),
    bgSunken: oklch(0.14, 0.03, 200),
    bgElevated: oklch(0.22, 0.035, 200),
    surface1: oklch(0.22, 0.03, 200),
    surface2: oklch(0.26, 0.035, 200),
    surface3: oklch(0.3, 0.04, 200),
    fg: oklch(0.93, 0.02, 200),
    fgMuted: oklch(0.72, 0.03, 200),
    fgFaint: oklch(0.55, 0.03, 200),
    border: oklch(0.32, 0.03, 200),
    borderStrong: oklch(0.42, 0.04, 200),
    accent: oklch(0.7, 0.1, 175),
    accentFg: oklch(0.16, 0.03, 175),
    accentMuted: oklch(0.35, 0.06, 175),
    success: pine[400],
    successFg: oklch(0.16, 0.03, 155),
    warning: oklch(0.78, 0.12, 75),
    warningFg: oklch(0.22, 0.04, 75),
    danger: coral[400],
    dangerFg: oklch(0.18, 0.04, 25),
    info: oklch(0.72, 0.08, 210),
    infoFg: oklch(0.16, 0.03, 210),
    overlay: oklch(0.12, 0.03, 200, 0.72),
    ring: oklch(0.7, 0.1, 175),
    glow: oklch(0.7, 0.1, 175),
    skyA: oklch(0.14, 0.05, 200),
    skyB: oklch(0.16, 0.06, 190),
    skyC: oklch(0.2, 0.05, 220),
    star: oklch(0.95, 0.02, 190),
    nebula: oklch(0.42, 0.08, 190),
  },
};

export const TOKEN_CSS_KEYS: Record<keyof SemanticTokens, string> = {
  bg: '--bg',
  bgSunken: '--bg-sunken',
  bgElevated: '--bg-elevated',
  surface1: '--surface-1',
  surface2: '--surface-2',
  surface3: '--surface-3',
  fg: '--fg',
  fgMuted: '--fg-muted',
  fgFaint: '--fg-faint',
  border: '--border',
  borderStrong: '--border-strong',
  accent: '--accent',
  accentFg: '--accent-fg',
  accentMuted: '--accent-muted',
  success: '--success',
  successFg: '--success-fg',
  warning: '--warning',
  warningFg: '--warning-fg',
  danger: '--danger',
  dangerFg: '--danger-fg',
  info: '--info',
  infoFg: '--info-fg',
  overlay: '--overlay',
  ring: '--ring',
  glow: '--glow',
  skyA: '--sky-a',
  skyB: '--sky-b',
  skyC: '--sky-c',
  star: '--star',
  nebula: '--nebula',
};

export function tokensToCss(tokens: SemanticTokens): string {
  return (Object.keys(TOKEN_CSS_KEYS) as Array<keyof SemanticTokens>)
    .map((key) => `${TOKEN_CSS_KEYS[key]}: ${formatOklch(tokens[key])};`)
    .join('\n  ');
}

export const THEME_CSS = (Object.keys(THEMES) as ThemeName[])
  .map((name) => `[data-theme='${name}'] {\n  ${tokensToCss(THEMES[name])}\n}`)
  .join('\n\n');

export const THEME_NAMES: ThemeName[] = ['observatory', 'parchment', 'tidewater'];

export {ink, brass, pine, coral};
