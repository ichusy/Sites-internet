import { describe, expect, it } from 'vitest';
import { audioTimeAt, elementTime, formatTime, recordingAt, spansDuration, wallTimeAt } from '../src/core/audio/timeline';
import { chunksToSegments, mixDown, resampleLinear, segmentAt, splitAtSilence, transcriptToText, transcriptToVtt } from '../src/core/audio/segments';
import type { RecordingData, RecordingSpan, StrokeElement, TextElement } from '../src/core/model/types';

// Enregistrement de 10 s, pause de 5 s, puis 20 s.
const T = 1_760_000_000_000;
const spans: RecordingSpan[] = [
  { start: T, end: T + 10_000, offset: 0 },
  { start: T + 15_000, end: T + 35_000, offset: 10 },
];

describe('chronologie audio', () => {
  it('convertit l’horloge en position audio, pauses comprises', () => {
    expect(audioTimeAt(spans, T + 4_000)).toBe(4);
    expect(audioTimeAt(spans, T + 12_000)).toBe(10); // pendant la pause : reprise
    expect(audioTimeAt(spans, T + 20_000)).toBe(15);
    expect(audioTimeAt(spans, T - 1)).toBeNull();
    expect(audioTimeAt(spans, T + 36_000)).toBeNull();
  });

  it('convertit une position audio en horloge (aller-retour)', () => {
    for (const t of [T, T + 3_500, T + 15_000, T + 34_000]) expect(wallTimeAt(spans, audioTimeAt(spans, t)!)).toBe(t);
    expect(wallTimeAt(spans, 99)).toBe(T + 35_000);
    expect(spansDuration(spans)).toBe(30);
  });

  it('retrouve l’enregistrement d’un élément', () => {
    const rec = (id: string, sp: RecordingSpan[]): RecordingData => ({ id, assetId: 'a', mime: 'audio/webm', title: id, createdAt: sp[0]?.start ?? 0, duration: 30, spans: sp });
    const recs = [rec('a', spans), rec('b', [{ start: T + 100_000, end: T + 160_000, offset: 0 }]), rec('importé', [])];
    const stroke = { type: 'stroke', t0: T + 120_000, z: 1 } as StrokeElement;
    const text = { type: 'text', z: T + 5_000 } as TextElement;
    expect(recordingAt(recs, elementTime(stroke)!)).toMatchObject({ recording: { id: 'b' }, time: 20 });
    expect(recordingAt(recs, elementTime(text)!)).toMatchObject({ recording: { id: 'a' }, time: 5 });
    expect(elementTime({ type: 'text', z: 3 } as TextElement)).toBeNull();
  });

  it('formate les durées', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(75.9)).toBe('1:15');
    expect(formatTime(3725)).toBe('1:02:05');
  });
});

describe('découpage et transcription', () => {
  it('coupe les longs enregistrements dans les silences', () => {
    const rate = 100;
    const audio = new Float32Array(rate * 550).map((_, i) => Math.sin(i));
    // Silence vers 303 s : la coupe doit y tomber plutôt qu'à 300 s pile.
    audio.fill(0, rate * 302.5, rate * 303.5);
    const blocks = splitAtSilence(audio, rate, 300, 10);
    expect(blocks.length).toBe(2);
    expect(blocks[0][1] / rate).toBeGreaterThan(302.4);
    expect(blocks[0][1] / rate).toBeLessThan(303.6);
    expect(blocks[1]).toEqual([blocks[0][1], audio.length]);
    expect(splitAtSilence(new Float32Array(50 * 100), 100)).toEqual([[0, 5000]]);
  });

  it('rééchantillonne', () => {
    const out = resampleLinear(new Float32Array([0, 1, 2, 3, 4, 5]), 48000, 16000);
    expect([...out]).toEqual([0, 3]);
    expect(resampleLinear(new Float32Array(44100), 44100).length).toBe(16000);
  });

  it('mélange les canaux', () => {
    expect([...mixDown([new Float32Array([1, 0]), new Float32Array([0, 1])])]).toEqual([0.5, 0.5]);
  });

  it('décale, nettoie et fusionne les morceaux de Whisper', () => {
    const segs = chunksToSegments(
      [
        { timestamp: [0, 4.2], text: ' Bonjour à tous.' },
        { timestamp: [4.2, 8], text: 'Bonjour à tous.' },
        { timestamp: [8, 12], text: ' Sous-titres réalisés par la communauté d’Amara.org' },
        { timestamp: [12, null], text: ' La mitochondrie produit l’ATP.' },
      ],
      300,
      20,
    );
    expect(segs).toEqual([
      { start: 300, end: 308, text: 'Bonjour à tous.' },
      { start: 312, end: 320, text: 'La mitochondrie produit l’ATP.' },
    ]);
    expect(segmentAt(segs, 305)).toBe(0);
    expect(segmentAt(segs, 315)).toBe(1);
    expect(segmentAt(segs, 299)).toBe(-1);
    expect(transcriptToText(segs)).toBe('[5:00] Bonjour à tous.\n[5:12] La mitochondrie produit l’ATP.');
    expect(transcriptToVtt(segs)).toContain('00:05:12.000 --> 00:05:20.000');
  });
});

describe('recherche dans les transcriptions', () => {
  it('trouve les phrases, sans accents ni majuscules', async () => {
    const { searchTranscripts } = await import('../src/core/search/audioSearch');
    const { parseQuery } = await import('../src/core/search/match');
    const rec: RecordingData = {
      id: 'r', assetId: 'a', mime: 'audio/webm', title: 'Cours', createdAt: 0, duration: 60, spans: [],
      transcript: { provider: 'test', language: 'fr', createdAt: 0, segments: [
        { start: 0, end: 5, text: 'La cellule eucaryote possède un noyau.' },
        { start: 5, end: 9, text: 'Les mitochondries produisent l’énergie.' },
      ] },
    };
    expect(searchTranscripts([rec], parseQuery('ENERGIE')).map((h) => h.start)).toEqual([5]);
    expect(searchTranscripts([rec], parseQuery('noyau énergie')).map((h) => h.start)).toEqual([0, 5]);
    expect(searchTranscripts([rec], parseQuery('chloroplaste'))).toEqual([]);
  });
});
