import type { TranscriptSegment } from '../core/model/types';

/**
 * Abstraction des moteurs de transcription. Papier fournit Whisper exécuté localement
 * (rien ne quitte l'appareil) ; la couche IA optionnelle pourra enregistrer ici des
 * moteurs distants (API) sans toucher au reste de l'application.
 */

export interface TranscribeProgress {
  phase: 'decode' | 'download' | 'load' | 'transcribe';
  /** Avancement 0..1 de la phase, s'il est connu. */
  ratio?: number;
  /** Précision affichable (fichier téléchargé, « WebGPU »…). */
  detail?: string;
}

export interface TranscribeRequest {
  /** Audio mono à 16 kHz. */
  audio: Float32Array;
  /** Code de langue (« fr », « en »…) ou « auto ». */
  language: string;
  /** Identifiant du modèle propre au moteur. */
  model: string;
  signal: AbortSignal;
  onProgress(p: TranscribeProgress): void;
  /** Phrases déjà transcrites, au fil de l'eau (positions absolues dans l'audio). */
  onSegments?(segments: TranscriptSegment[]): void;
}

export interface TranscriberModel {
  id: string;
  label: string;
  /** Taille de téléchargement approximative, en Mo. */
  sizeMb: number;
}

export interface Transcriber {
  id: string;
  label: string;
  /** Vrai si l'audio reste sur l'appareil. */
  local: boolean;
  models: TranscriberModel[];
  transcribe(req: TranscribeRequest): Promise<TranscriptSegment[]>;
  /** Modèles déjà téléchargés (utilisables hors ligne). */
  downloadedModels?(): Promise<string[]>;
  /** Supprime les modèles téléchargés. */
  clearModels?(): Promise<void>;
}

const registry = new Map<string, Transcriber>();

export function registerTranscriber(t: Transcriber) {
  registry.set(t.id, t);
}

export function transcribers(): Transcriber[] {
  return [...registry.values()];
}

export function getTranscriber(id: string): Transcriber | undefined {
  return registry.get(id) ?? registry.values().next().value;
}

export const LANGUAGES: { code: string; label: string }[] = [
  { code: 'fr', label: 'Français' },
  { code: 'en', label: 'Anglais' },
  { code: 'de', label: 'Allemand' },
  { code: 'es', label: 'Espagnol' },
  { code: 'it', label: 'Italien' },
  { code: 'pt', label: 'Portugais' },
  { code: 'nl', label: 'Néerlandais' },
  { code: 'auto', label: 'Détection automatique' },
];

export class TranscriptionCancelled extends Error {
  constructor() {
    super('Transcription annulée.');
  }
}
