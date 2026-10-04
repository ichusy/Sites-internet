import type { TranscriptSegment } from '../core/model/types';
import { TranscriptionCancelled, type Transcriber, type TranscribeRequest } from './transcribe';
import type { WhisperRequest, WhisperResponse } from './whisperProtocol';

const CACHE = 'transformers-cache';

export const WHISPER_MODELS = [
  { id: 'onnx-community/whisper-tiny', label: 'Rapide', sizeMb: 40 },
  { id: 'onnx-community/whisper-base', label: 'Équilibré', sizeMb: 80 },
  { id: 'onnx-community/whisper-small', label: 'Précis', sizeMb: 250 },
];

/** Le worker est gardé entre deux transcriptions : le modèle reste chargé en mémoire. */
let worker: Worker | null = null;
let busy = false;

function getWorker(): Worker {
  worker ??= new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module', name: 'whisper' });
  return worker;
}

function stopWorker() {
  worker?.terminate();
  worker = null;
}

/** Whisper exécuté dans le navigateur (WebGPU si disponible, sinon processeur). */
export const whisperLocal: Transcriber = {
  id: 'whisper-local',
  label: 'Whisper (sur l’appareil)',
  local: true,
  models: WHISPER_MODELS,

  transcribe(req: TranscribeRequest): Promise<TranscriptSegment[]> {
    if (busy) return Promise.reject(new Error('Une transcription est déjà en cours.'));
    busy = true;
    const w = getWorker();
    const all: TranscriptSegment[] = [];
    return new Promise<TranscriptSegment[]>((resolve, reject) => {
      const finish = (fn: () => void) => {
        busy = false;
        w.removeEventListener('message', onMessage);
        w.removeEventListener('error', onError);
        req.signal.removeEventListener('abort', onAbort);
        fn();
      };
      const onMessage = (e: MessageEvent<WhisperResponse>) => {
        const m = e.data;
        if (m.type === 'progress') req.onProgress({ phase: m.phase, ratio: m.ratio, detail: m.detail });
        else if (m.type === 'segments') {
          all.push(...m.segments);
          req.onSegments?.(m.segments);
        } else if (m.type === 'done') finish(() => resolve(all));
        else finish(() => reject(new Error(friendlyError(m.message))));
      };
      const onError = (e: ErrorEvent) => {
        stopWorker();
        finish(() => reject(new Error(friendlyError(e.message || 'Le moteur de transcription s’est arrêté.'))));
      };
      // Annulation immédiate : le worker est arrêté (le modèle sera rechargé depuis le cache).
      const onAbort = () => {
        stopWorker();
        finish(() => reject(new TranscriptionCancelled()));
      };
      w.addEventListener('message', onMessage);
      w.addEventListener('error', onError);
      req.signal.addEventListener('abort', onAbort);
      const msg: WhisperRequest = {
        type: 'run',
        audio: req.audio,
        model: req.model,
        language: req.language,
        wasmBase: new URL('ort/', document.baseURI).href,
      };
      w.postMessage(msg, [req.audio.buffer]);
    });
  },

  async downloadedModels() {
    if (typeof caches === 'undefined') return [];
    try {
      const keys = await (await caches.open(CACHE)).keys();
      return WHISPER_MODELS.filter((m) => keys.some((k) => k.url.includes(`/${m.id}/`) && k.url.endsWith('.onnx'))).map((m) => m.id);
    } catch {
      return [];
    }
  },

  async clearModels() {
    stopWorker();
    if (typeof caches !== 'undefined') await caches.delete(CACHE);
  },
};

function friendlyError(message: string): string {
  if (/fetch|network|Failed to load|404|403|ERR_/i.test(message)) {
    return 'Impossible de télécharger le modèle de transcription. Il faut être en ligne la première fois (le modèle est ensuite gardé sur l’appareil).';
  }
  if (/memory|allocation|OOM/i.test(message)) return 'Mémoire insuffisante : essayez le modèle « Rapide ».';
  return `Échec de la transcription : ${message}`;
}
