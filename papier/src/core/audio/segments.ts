import type { TranscriptSegment } from '../model/types';
import { formatTime } from './timeline';

/** Fréquence d'échantillonnage attendue par les modèles de reconnaissance vocale. */
export const SPEECH_RATE = 16000;

/** Moyenne des canaux en un seul (mono). */
export function mixDown(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const out = new Float32Array(channels[0].length);
  for (const ch of channels) for (let i = 0; i < out.length; i++) out[i] += ch[i] / channels.length;
  return out;
}

/** Énergie moyenne (RMS) de `audio[from, to)`. */
export function rms(audio: Float32Array, from = 0, to = audio.length): number {
  let sum = 0;
  const a = Math.max(0, from), b = Math.min(audio.length, to);
  for (let i = a; i < b; i++) sum += audio[i] * audio[i];
  return b > a ? Math.sqrt(sum / (b - a)) : 0;
}

/**
 * Découpe un long enregistrement en blocs d'environ `blockSec` secondes, coupés au moment le plus
 * silencieux à ±`searchSec` de la limite visée : aucun mot n'est tranché, la progression est
 * mesurable et la mémoire reste bornée. Renvoie les bornes [début, fin) en échantillons.
 */
export function splitAtSilence(audio: Float32Array, rate = SPEECH_RATE, blockSec = 300, searchSec = 10): [number, number][] {
  const blocks: [number, number][] = [];
  const block = Math.round(blockSec * rate);
  const search = Math.round(searchSec * rate);
  const win = Math.round(0.1 * rate);
  let start = 0;
  while (audio.length - start > block + search) {
    const target = start + block;
    let best = target;
    let bestE = Infinity;
    for (let c = target - search; c <= target + search - win; c += win) {
      const e = rms(audio, c, c + win);
      if (e < bestE) {
        bestE = e;
        best = c + Math.floor(win / 2);
      }
    }
    blocks.push([start, best]);
    start = best;
  }
  blocks.push([start, audio.length]);
  return blocks;
}

/** Morceau renvoyé par Whisper (transformers.js) : [début, fin] en secondes dans le bloc. */
export interface AsrChunk {
  timestamp: [number, number | null];
  text: string;
}

/** Phrases connues que Whisper « invente » sur du silence ou de la musique. */
const HALLUCINATIONS = [/amara\.org/i, /sous-titr(es|age).*(communaut|st'|réalis)/i, /merci d'avoir regardé/i, /^\s*\[?(musique|music|silence)\]?\s*$/i];

/** Convertit les morceaux d'un bloc (décalé de `offset` s, de durée `length` s) en phrases nettoyées. */
export function chunksToSegments(chunks: AsrChunk[], offset: number, length: number): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  for (const c of chunks) {
    const text = c.text.replace(/\s+/g, ' ').trim();
    if (!text || HALLUCINATIONS.some((re) => re.test(text))) continue;
    const start = offset + Math.max(0, c.timestamp[0] ?? 0);
    const end = offset + Math.min(length, c.timestamp[1] ?? length);
    const prev = out[out.length - 1];
    // Répétition en boucle (autre défaut connu de Whisper) : on ne garde que la première.
    if (prev && prev.text === text) {
      prev.end = Math.max(prev.end, end);
      continue;
    }
    out.push({ start: round2(start), end: round2(Math.max(start, end)), text });
  }
  return out;
}

function round2(x: number) {
  return Math.round(x * 100) / 100;
}

/** Phrase en cours à la position `sec` (indice), ou -1. */
export function segmentAt(segments: TranscriptSegment[], sec: number): number {
  let lo = 0, hi = segments.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segments[mid].start <= sec) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found >= 0 && sec <= segments[found].end + 1.5 ? found : -1;
}

/** Transcription en texte brut, horodatée : « [1:15] Bonjour à tous ». */
export function transcriptToText(segments: TranscriptSegment[], timestamps = true): string {
  return segments.map((s) => (timestamps ? `[${formatTime(s.start)}] ${s.text}` : s.text)).join('\n');
}

/** Sous-titres WebVTT (lisibles par les lecteurs vidéo et audio). */
export function transcriptToVtt(segments: TranscriptSegment[]): string {
  const ts = (sec: number) => {
    const ms = Math.round(sec * 1000);
    const h = Math.floor(ms / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000), s = Math.floor((ms % 60_000) / 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
  };
  return ['WEBVTT', '', ...segments.flatMap((s, i) => [String(i + 1), `${ts(s.start)} --> ${ts(s.end)}`, s.text, ''])].join('\n');
}

/** Rééchantillonnage linéaire (repli quand le navigateur ne décode pas directement à 16 kHz). */
export function resampleLinear(input: Float32Array, fromRate: number, toRate = SPEECH_RATE): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const x = i * ratio;
    const j = Math.floor(x);
    const f = x - j;
    out[i] = input[j] * (1 - f) + (input[Math.min(j + 1, input.length - 1)] ?? 0) * f;
  }
  return out;
}
