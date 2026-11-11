export interface Oklch {
  l: number;
  c: number;
  h: number;
  a?: number;
}

export function oklch(l: number, c: number, h: number, a = 1): Oklch {
  return {l, c, h, a};
}

export function formatOklch({l, c, h, a = 1}: Oklch): string {
  if (a < 1) {
    return `oklch(${l} ${c} ${h} / ${a})`;
  }
  return `oklch(${l} ${c} ${h})`;
}

function srgbChannelToLinear(value: number): number {
  const abs = Math.abs(value);
  if (abs <= 0.04045) return value / 12.92;
  return (Math.sign(value) * (abs + 0.055) ** 2.4) / 1.055 ** 2.4;
}

function linearToSrgbChannel(value: number): number {
  const abs = Math.abs(value);
  if (abs <= 0.0031308) return 12.92 * value;
  return Math.sign(value) * (1.055 * abs ** (1 / 2.4) - 0.055);
}

export function oklchToSrgb({l, c, h}: Oklch): {r: number; g: number; b: number} {
  const hr = (h * Math.PI) / 180;
  const a = c * Math.cos(hr);
  const b = c * Math.sin(hr);

  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;

  const L = l_ ** 3;
  const M = m_ ** 3;
  const S = s_ ** 3;

  const rLin = +4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S;
  const gLin = -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S;
  const bLin = -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S;

  return {
    r: Math.min(1, Math.max(0, linearToSrgbChannel(rLin))),
    g: Math.min(1, Math.max(0, linearToSrgbChannel(gLin))),
    b: Math.min(1, Math.max(0, linearToSrgbChannel(bLin))),
  };
}

export function relativeLuminance(color: Oklch): number {
  const {r, g, b} = oklchToSrgb(color);
  const R = srgbChannelToLinear(r);
  const G = srgbChannelToLinear(g);
  const B = srgbChannelToLinear(b);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

export function contrastRatio(fg: Oklch, bg: Oklch): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export function oklchToRgbTuple(color: Oklch): [number, number, number] {
  const {r, g, b} = oklchToSrgb(color);
  return [r, g, b];
}
