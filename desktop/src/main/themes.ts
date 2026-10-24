import { nativeTheme } from 'electron';
import type { Palette } from '../shared/types';

/** Шесть тем, как в Themes.kt: тёплый алый акцент. */
export const THEME_IDS = ['scarlet_dark', 'scarlet_light', 'graphite', 'sand', 'oled', 'system'];

export function themeNameKey(id: string): string {
  return id === 'system' ? 'system' : 'theme_' + id;
}

const P = (dark: boolean, bg: string, surface: string, border: string, text: string, muted: string, accent: string): Palette =>
  ({ dark, bg, surface, border, text, muted, accent, onAccent: '#FFFFFF' });

const PALETTES: Record<string, Palette> = {
  scarlet_dark: P(true, '#17181B', '#212227', '#33353C', '#ECEDEF', '#9BA0A8', '#F0453A'),
  scarlet_light: P(false, '#F6F5F4', '#FFFFFF', '#E2DEDA', '#1B1A19', '#6B6760', '#D92D20'),
  graphite: P(true, '#101114', '#1A1C20', '#2B2E35', '#E6E8EC', '#8E939C', '#E5533D'),
  sand: P(false, '#F6F1E9', '#FFFDF8', '#E6DDCF', '#2A2621', '#7A7064', '#C2410C'),
  oled: P(true, '#000000', '#0D0E10', '#24262B', '#EDEDED', '#8A8A90', '#FF3B30'),
};

export function palette(id: string): Palette {
  if (id === 'system') return nativeTheme.shouldUseDarkColors ? PALETTES.scarlet_dark : PALETTES.scarlet_light;
  return PALETTES[id] ?? PALETTES.scarlet_dark;
}

/** Инкогнито всегда тёмное — чтобы окно было сразу видно. */
export const INCOGNITO_PALETTE: Palette = P(true, '#1B1530', '#251E3D', '#3A3157', '#ECEAF4', '#A39DBA', '#F0453A');
