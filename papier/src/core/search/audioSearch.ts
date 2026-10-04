import type { ID, RecordingData } from '../model/types';
import { findRanges, makeSnippet, matchesAll, type Snippet } from './match';

export interface AudioHit {
  recordingId: ID;
  title: string;
  /** Position de la phrase dans l'audio (s). */
  start: number;
  snippet: Snippet;
}

const MAX_PER_RECORDING = 30;

/**
 * Recherche dans les transcriptions. Un enregistrement correspond s'il contient tous les termes ;
 * chaque phrase qui contient l'un d'eux est alors un résultat (avec sa position dans l'audio).
 */
export function searchTranscripts(recordings: RecordingData[], terms: string[]): AudioHit[] {
  if (!terms.length) return [];
  const hits: AudioHit[] = [];
  for (const rec of recordings) {
    const segs = rec.transcript?.segments ?? [];
    if (!segs.length || !matchesAll(segs.map((s) => s.text).join('\n'), terms)) continue;
    let n = 0;
    for (const s of segs) {
      const range = findRanges(s.text, terms)[0];
      if (!range) continue;
      hits.push({ recordingId: rec.id, title: rec.title, start: s.start, snippet: makeSnippet(s.text, range) });
      if (++n >= MAX_PER_RECORDING) break;
    }
  }
  return hits;
}
