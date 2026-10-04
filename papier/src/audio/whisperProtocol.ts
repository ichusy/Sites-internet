import type { TranscriptSegment } from '../core/model/types';

/** Messages échangés avec le worker Whisper (documentés pour pouvoir le remplacer ou le simuler). */
export type WhisperRequest = {
  type: 'run';
  /** Audio mono 16 kHz (transféré, pas copié). */
  audio: Float32Array;
  /** Dépôt Hugging Face du modèle, ex. « onnx-community/whisper-base ». */
  model: string;
  language: string;
  /** Adresse absolue du dossier des fichiers ONNX Runtime (wasm), servis par l'application. */
  wasmBase: string;
};

export type WhisperResponse =
  | { type: 'progress'; phase: 'download' | 'load' | 'transcribe'; ratio?: number; detail?: string }
  | { type: 'segments'; segments: TranscriptSegment[] }
  | { type: 'done' }
  | { type: 'error'; message: string };
