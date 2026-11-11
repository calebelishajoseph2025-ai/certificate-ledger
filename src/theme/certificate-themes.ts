import {formatOklch, oklch, type Oklch} from './oklch';

export type CertificateThemeId = 'classic' | 'modern' | 'midnight' | 'forest' | 'slate';

export interface CertificateTheme {
  id: CertificateThemeId;
  label: string;
  bg: Oklch;
  border: Oklch;
  inner: Oklch;
  text: Oklch;
  accent: Oklch;
  seal: Oklch;
  paper: Oklch;
}

export const CERTIFICATE_THEMES: Record<CertificateThemeId, CertificateTheme> = {
  classic: {
    id: 'classic',
    label: 'Classic',
    bg: oklch(0.96, 0.02, 85),
    border: oklch(0.55, 0.1, 80),
    inner: oklch(0.78, 0.08, 82),
    text: oklch(0.22, 0.03, 70),
    accent: oklch(0.48, 0.1, 80),
    seal: oklch(0.58, 0.13, 75),
    paper: oklch(0.97, 0.015, 85),
  },
  modern: {
    id: 'modern',
    label: 'Modern',
    bg: oklch(0.99, 0.005, 250),
    border: oklch(0.45, 0.12, 265),
    inner: oklch(0.82, 0.06, 265),
    text: oklch(0.2, 0.04, 265),
    accent: oklch(0.48, 0.14, 265),
    seal: oklch(0.55, 0.14, 265),
    paper: oklch(0.99, 0.004, 250),
  },
  midnight: {
    id: 'midnight',
    label: 'Midnight',
    bg: oklch(0.18, 0.03, 260),
    border: oklch(0.72, 0.12, 85),
    inner: oklch(0.32, 0.05, 80),
    text: oklch(0.93, 0.02, 90),
    accent: oklch(0.75, 0.13, 80),
    seal: oklch(0.7, 0.13, 80),
    paper: oklch(0.16, 0.03, 260),
  },
  forest: {
    id: 'forest',
    label: 'Forest',
    bg: oklch(0.96, 0.02, 155),
    border: oklch(0.38, 0.08, 155),
    inner: oklch(0.78, 0.07, 155),
    text: oklch(0.28, 0.05, 155),
    accent: oklch(0.42, 0.1, 155),
    seal: oklch(0.45, 0.11, 155),
    paper: oklch(0.97, 0.015, 155),
  },
  slate: {
    id: 'slate',
    label: 'Slate',
    bg: oklch(0.96, 0.01, 250),
    border: oklch(0.38, 0.03, 250),
    inner: oklch(0.7, 0.02, 250),
    text: oklch(0.22, 0.02, 250),
    accent: oklch(0.32, 0.03, 250),
    seal: oklch(0.4, 0.03, 250),
    paper: oklch(0.97, 0.008, 250),
  },
};

export function certificateThemeVars(theme: CertificateTheme): Record<string, string> {
  return {
    '--cert-bg': formatOklch(theme.bg),
    '--cert-border': formatOklch(theme.border),
    '--cert-inner': formatOklch(theme.inner),
    '--cert-text': formatOklch(theme.text),
    '--cert-accent': formatOklch(theme.accent),
    '--cert-seal': formatOklch(theme.seal),
    '--cert-paper': formatOklch(theme.paper),
  };
}

export const CERTIFICATE_THEME_IDS: CertificateThemeId[] = [
  'classic',
  'modern',
  'midnight',
  'forest',
  'slate',
];
