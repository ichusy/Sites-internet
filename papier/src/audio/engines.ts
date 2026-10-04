import type { TranscriptSegment } from '../core/model/types';
import { decodeForSpeech } from './decode';
import { getTranscriber, registerTranscriber, type TranscribeProgress } from './transcribe';
import { whisperLocal } from './whisper';

registerTranscriber(whisperLocal);

export interface TranscribeBlobOptions {
  engine: string;
  model: string;
  language: string;
  signal: AbortSignal;
  onProgress(p: TranscribeProgress): void;
  onSegments?(segments: TranscriptSegment[]): void;
}

/** Décode un fichier audio puis le transcrit avec le moteur choisi. */
export async function transcribeBlob(blob: Blob, opts: TranscribeBlobOptions): Promise<TranscriptSegment[]> {
  const engine = getTranscriber(opts.engine);
  if (!engine) throw new Error('Aucun moteur de transcription disponible.');
  opts.onProgress({ phase: 'decode' });
  const audio = await decodeForSpeech(blob);
  if (opts.signal.aborted) throw new DOMException('Annulé', 'AbortError');
  const model = engine.models.some((m) => m.id === opts.model) ? opts.model : engine.models[0]?.id ?? '';
  return engine.transcribe({ audio, language: opts.language, model, signal: opts.signal, onProgress: opts.onProgress, onSegments: opts.onSegments });
}

export { getTranscriber, transcribers } from './transcribe';
