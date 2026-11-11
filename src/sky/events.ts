export const SKY_THEME_EVENT = 'cl-theme-change';

export type SkyQuality = 'high' | 'medium' | 'low' | 'off';

export interface SkyState {
  fps: number;
  dpr: number;
  quality: SkyQuality;
  layerCount: number;
  reducedMotion: boolean;
  webgl: boolean;
}

export function publishSky(state: SkyState): void {
  if (typeof window === 'undefined') return;
  window.__sky = state;
}
