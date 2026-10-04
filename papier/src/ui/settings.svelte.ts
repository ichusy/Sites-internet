import type { FingerDrawing } from '../engine/input/PointerRouter';
import type { ToolStyles } from '../engine/tools/types';

export type ThemePref = 'system' | 'light' | 'dark';
export type LibrarySort = 'updatedAt' | 'createdAt' | 'openedAt' | 'title';

export interface Settings {
  theme: ThemePref;
  fingerDrawing: FingerDrawing;
  styles: ToolStyles;
  penPalette: string[];
  highlighterPalette: string[];
  pencilPalette: string[];
  librarySort: LibrarySort;
}

export const PEN_WIDTHS = [0.6, 1.1, 1.8, 3];
export const HIGHLIGHTER_WIDTHS = [8, 14, 22];
export const ERASER_SIZES = [10, 24, 48];
export const PENCIL_WIDTHS = [0.8, 1.4, 2.4];
export const TEXT_SIZES = [11, 14, 18, 24, 32];

const DEFAULTS: Settings = {
  theme: 'system',
  fingerDrawing: 'auto',
  styles: {
    pen: { brush: 'ballpoint', color: '#1f2430', width: 1.1, dash: 'solid' },
    highlighter: { color: '#fff27a', width: 14 },
    pencil: { color: '#3b3f47', width: 1.4 },
    eraser: { mode: 'stroke', size: 24 },
    text: { color: '#1f2430', size: 14 },
    gestures: { shapeRecognition: true, scribbleErase: true, loopSelect: true },
  },
  penPalette: ['#1f2430', '#2f5fd0', '#d03a3a', '#2f9e5a', '#8a4fd0', '#e08a1e'],
  highlighterPalette: ['#fff27a', '#b6f0a0', '#a8d8ff', '#ffb3d1', '#ffd28a'],
  pencilPalette: ['#3b3f47', '#6b7280', '#8a5a3c', '#2f5fd0', '#b4363a'],
  librarySort: 'updatedAt',
};

const KEY = 'papier-settings';

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const saved = JSON.parse(raw) as Partial<Settings>;
    return {
      ...structuredClone(DEFAULTS),
      ...saved,
      styles: {
        pen: { ...DEFAULTS.styles.pen, ...saved.styles?.pen },
        pencil: { ...DEFAULTS.styles.pencil, ...saved.styles?.pencil },
        highlighter: { ...DEFAULTS.styles.highlighter, ...saved.styles?.highlighter },
        eraser: { ...DEFAULTS.styles.eraser, ...saved.styles?.eraser },
        text: { ...DEFAULTS.styles.text, ...saved.styles?.text },
        gestures: { ...DEFAULTS.styles.gestures, ...saved.styles?.gestures },
      },
    };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

/** Réglages de l'utilisateur, réactifs et enregistrés automatiquement (préférences propres à l'appareil). */
export const settings: Settings = $state(load());

$effect.root(() => {
  $effect(() => {
    const json = JSON.stringify(settings);
    try {
      localStorage.setItem(KEY, json);
    } catch {
      /* stockage indisponible (navigation privée) */
    }
  });
});
