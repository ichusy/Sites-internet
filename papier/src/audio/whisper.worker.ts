/// <reference lib="webworker" />
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import { SPEECH_RATE, chunksToSegments, rms, splitAtSilence, type AsrChunk } from '../core/audio/segments';
import type { WhisperRequest, WhisperResponse } from './whisperProtocol';

/**
 * Worker de transcription : Whisper (transformers.js + ONNX Runtime Web), entièrement local.
 * Le moteur ONNX (wasm) est servi par l'application ; le modèle est téléchargé une fois depuis
 * Hugging Face puis gardé dans le cache du navigateur (« transformers-cache »).
 */
declare const self: DedicatedWorkerGlobalScope;

env.allowLocalModels = false;

let asr: AutomaticSpeechRecognitionPipeline | null = null;
let loadedKey = '';

function post(msg: WhisperResponse, transfer: Transferable[] = []) {
  self.postMessage(msg, transfer);
}

async function hasWebGpu(): Promise<boolean> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return !!(gpu && (await gpu.requestAdapter()));
  } catch {
    return false;
  }
}

async function load(model: string, wasmBase: string) {
  const webgpu = await hasWebGpu();
  const key = `${model}|${webgpu}`;
  if (asr && loadedKey === key) return;
  await asr?.dispose();
  asr = null;
  // Variante « asyncify » nécessaire à WebGPU ; sinon la variante simple, plus légère.
  const variant = webgpu ? 'ort-wasm-simd-threaded.asyncify' : 'ort-wasm-simd-threaded';
  env.backends.onnx.wasm!.wasmPaths = { mjs: `${wasmBase}${variant}.mjs`, wasm: `${wasmBase}${variant}.wasm` };

  const files = new Map<string, { loaded: number; total: number }>();
  const progress_callback = (p: { status: string; file?: string; loaded?: number; total?: number }) => {
    if (p.status === 'progress' && p.file) {
      files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
      let loaded = 0, total = 0;
      for (const f of files.values()) {
        loaded += f.loaded;
        total += f.total;
      }
      post({ type: 'progress', phase: 'download', ratio: total ? loaded / total : undefined, detail: `${Math.round(loaded / 1e6)} / ${Math.round(total / 1e6)} Mo` });
    }
  };
  post({ type: 'progress', phase: 'load', detail: webgpu ? 'WebGPU' : 'processeur' });
  const make = (device: 'webgpu' | 'wasm') =>
    pipeline('automatic-speech-recognition', model, {
      device,
      dtype: device === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8',
      progress_callback,
    }) as Promise<AutomaticSpeechRecognitionPipeline>;
  try {
    asr = await make(webgpu ? 'webgpu' : 'wasm');
  } catch (err) {
    if (!webgpu) throw err;
    // WebGPU indisponible en pratique (pilote, mémoire) : repli sur le processeur.
    env.backends.onnx.wasm!.wasmPaths = { mjs: `${wasmBase}ort-wasm-simd-threaded.mjs`, wasm: `${wasmBase}ort-wasm-simd-threaded.wasm` };
    asr = await make('wasm');
  }
  loadedKey = key;
}

async function run(req: Extract<WhisperRequest, { type: 'run' }>) {
  await load(req.model, req.wasmBase);
  const audio = req.audio;
  const blocks = splitAtSilence(audio);
  let done = 0;
  post({ type: 'progress', phase: 'transcribe', ratio: 0 });
  for (const [a, b] of blocks) {
    const block = audio.subarray(a, b);
    const offset = a / SPEECH_RATE;
    const length = (b - a) / SPEECH_RATE;
    // Bloc silencieux : Whisper y « entendrait » des phrases imaginaires.
    if (rms(block) > 0.002) {
      const out = (await asr!(block, {
        ...(req.language !== 'auto' ? { language: req.language } : {}),
        task: 'transcribe',
        return_timestamps: true,
        chunk_length_s: 30,
        stride_length_s: 5,
      })) as { text: string; chunks?: AsrChunk[] };
      const chunks = out.chunks ?? [{ timestamp: [0, length], text: out.text }];
      post({ type: 'segments', segments: chunksToSegments(chunks, offset, length) });
    }
    done += b - a;
    post({ type: 'progress', phase: 'transcribe', ratio: done / audio.length });
  }
  post({ type: 'done' });
}

self.onmessage = (e: MessageEvent<WhisperRequest>) => {
  const msg = e.data;
  if (msg.type === 'run') {
    run(msg).catch((err) => post({ type: 'error', message: err instanceof Error ? err.message : String(err) }));
  }
};
