import { newId } from '../model/ids';
import type { RecordingData, RecordingSpan } from '../model/types';
import { putAsset } from '../storage/assets';
import { db, type RecordingDraft } from '../storage/db';
import { spansDuration } from './timeline';

export type RecorderState = 'idle' | 'starting' | 'recording' | 'paused';

/** Formats essayés dans l'ordre : Opus (Chrome, Firefox, Safari récent), puis AAC (Safari). */
const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm'];

export function recordingSupported(): boolean {
  return typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

function pickMime(): string {
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported?.(m)) ?? '';
}

/** « Enregistrement du 4 oct., 14:32 » */
export function defaultTitle(at: number): string {
  const d = new Date(at);
  return `Enregistrement du ${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
}

/**
 * Enregistreur du micro. L'audio est écrit dans IndexedDB toutes les secondes (table `recchunks`)
 * avec les plages horaires (table `recdrafts`) : une fermeture brutale de l'onglet ne perd rien,
 * l'enregistrement est récupéré à la prochaine ouverture du carnet.
 */
export class Recorder {
  state: RecorderState = 'idle';
  private stream: MediaStream | null = null;
  private media: MediaRecorder | null = null;
  private draft: RecordingDraft | null = null;
  private writes: Promise<unknown> = Promise.resolve();
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private levelBuf: Float32Array<ArrayBuffer> | null = null;
  private stopped: (() => void) | null = null;

  constructor(private onChange: () => void = () => {}) {}

  /** Durée enregistrée jusqu'ici (s). */
  get elapsed(): number {
    if (!this.draft) return 0;
    const spans = this.draft.spans;
    const last = spans[spans.length - 1];
    if (this.state === 'recording' && last) return spansDuration(spans.slice(0, -1)) + (Date.now() - last.start) / 1000;
    return spansDuration(spans);
  }

  /** Niveau sonore instantané, 0..1 (vumètre). */
  level(): number {
    if (!this.analyser || !this.levelBuf || this.state !== 'recording') return 0;
    this.analyser.getFloatTimeDomainData(this.levelBuf);
    let peak = 0;
    for (const v of this.levelBuf) peak = Math.max(peak, Math.abs(v));
    return Math.min(1, peak * 1.6);
  }

  async start(notebookId: string) {
    if (this.state !== 'idle') return;
    this.state = 'starting';
    this.onChange();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (err) {
      this.state = 'idle';
      this.onChange();
      throw err;
    }
    const mime = pickMime();
    const media = new MediaRecorder(this.stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 48_000 });
    this.media = media;
    const draft: RecordingDraft = { id: newId(), notebookId, mime: media.mimeType || mime || 'audio/webm', createdAt: Date.now(), spans: [] };
    this.draft = draft;

    media.addEventListener('start', () => {
      const now = Date.now();
      draft.createdAt = now;
      draft.spans.push({ start: now, end: now, offset: 0 });
      this.persistDraft();
    });
    media.addEventListener('dataavailable', (e) => {
      if (!e.data.size) return;
      const last = draft.spans[draft.spans.length - 1];
      if (last && this.state === 'recording') last.end = Date.now();
      const blob = e.data;
      this.writes = this.writes.then(() => db.recchunks.add({ recordingId: draft.id, blob })).then(() => this.persistDraft());
    });
    media.addEventListener('stop', () => this.stopped?.());

    this.setupLevel(this.stream);
    media.start(1000);
    this.state = 'recording';
    this.onChange();
  }

  pause() {
    if (this.state !== 'recording' || !this.media || !this.draft) return;
    this.media.requestData();
    this.media.pause();
    const last = this.draft.spans[this.draft.spans.length - 1];
    if (last) last.end = Date.now();
    this.state = 'paused';
    this.persistDraft();
    this.onChange();
  }

  resume() {
    if (this.state !== 'paused' || !this.media || !this.draft) return;
    this.media.resume();
    const now = Date.now();
    this.draft.spans.push({ start: now, end: now, offset: spansDuration(this.draft.spans) });
    this.state = 'recording';
    this.persistDraft();
    this.onChange();
  }

  /** Termine l'enregistrement et l'enregistre comme fichier audio. */
  async stop(title?: string): Promise<RecordingData | null> {
    const media = this.media;
    const draft = this.draft;
    if (!media || !draft || this.state === 'idle' || this.state === 'starting') return null;
    const last = draft.spans[draft.spans.length - 1];
    if (last && this.state === 'recording') last.end = Date.now();
    const done = new Promise<void>((resolve) => (this.stopped = resolve));
    if (media.state !== 'inactive') media.stop();
    await done;
    await this.writes;
    await this.persistDraft();
    this.release();
    return finalizeDraft(draft.id, title);
  }

  /** Libère le micro (sans rien enregistrer de plus ; le brouillon reste récupérable). */
  release() {
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.audioCtx?.close().catch(() => {});
    this.stream = null;
    this.media = null;
    this.draft = null;
    this.audioCtx = null;
    this.analyser = null;
    this.stopped = null;
    this.state = 'idle';
    this.onChange();
  }

  private persistDraft() {
    const d = this.draft;
    if (!d) return Promise.resolve();
    const copy: RecordingDraft = { ...d, spans: d.spans.map((s) => ({ ...s })) };
    return db.recdrafts.put(copy).catch(() => {});
  }

  private setupLevel(stream: MediaStream) {
    try {
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
      this.audioCtx = ctx;
      this.analyser = analyser;
      this.levelBuf = new Float32Array(analyser.fftSize);
    } catch {
      /* vumètre indisponible : sans conséquence */
    }
  }
}

/** Assemble un brouillon en fichier audio (table `assets`) et renvoie l'enregistrement correspondant. */
export async function finalizeDraft(draftId: string, title?: string): Promise<RecordingData | null> {
  const draft = await db.recdrafts.get(draftId);
  if (!draft) return null;
  const chunks = await db.recchunks.where('recordingId').equals(draftId).sortBy('seq');
  let result: RecordingData | null = null;
  if (chunks.length) {
    const blob = new Blob(chunks.map((c) => c.blob), { type: draft.mime });
    const spans: RecordingSpan[] = draft.spans.filter((s) => s.end > s.start);
    result = {
      id: draft.id,
      assetId: await putAsset(blob),
      mime: draft.mime,
      title: title || defaultTitle(draft.createdAt),
      createdAt: draft.createdAt,
      duration: Math.round(spansDuration(spans) * 1000) / 1000,
      spans,
    };
  }
  await db.transaction('rw', db.recdrafts, db.recchunks, async () => {
    await db.recchunks.where('recordingId').equals(draftId).delete();
    await db.recdrafts.delete(draftId);
  });
  return result;
}

/**
 * Brouillons d'enregistrement laissés par une session interrompue (onglet fermé, plantage).
 * Ceux mis à jour il y a moins de 10 s sont peut-être encore en cours dans un autre onglet.
 */
export async function abandonedDrafts(notebookId: string): Promise<RecordingDraft[]> {
  const drafts = await db.recdrafts.where('notebookId').equals(notebookId).toArray();
  const now = Date.now();
  return drafts.filter((d) => {
    const last = d.spans[d.spans.length - 1];
    return !last || now - last.end > 10_000;
  });
}
