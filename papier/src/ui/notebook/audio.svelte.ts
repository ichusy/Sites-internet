import type * as Y from 'yjs';
import { Recorder, abandonedDrafts, defaultTitle, finalizeDraft, recordingSupported, type RecorderState } from '../../core/audio/recorder';
import { segmentAt, transcriptToText, transcriptToVtt } from '../../core/audio/segments';
import { LISTEN_LEAD, audioTimeAt, elementTime, recordingAt, wallTimeAt } from '../../core/audio/timeline';
import { newId } from '../../core/model/ids';
import { deleteRecording, listRecordings, putRecording, roots } from '../../core/model/notebookDoc';
import type { ID, PageElement, RecordingData, TranscriptSegment } from '../../core/model/types';
import { getAsset, putAsset } from '../../core/storage/assets';
import type { Editor } from '../../engine/Editor';
import { extensionOf } from '../../io/archive';
import { safeFileName, saveFile } from '../../io/files';
import type { TranscribeProgress } from '../../audio/transcribe';
import { showToast } from '../common/toast.svelte';
import { settings } from '../settings.svelte';

export interface TranscriptionJob {
  recordingId: ID;
  progress: TranscribeProgress;
  /** Phrases déjà transcrites (affichées au fil de l'eau). */
  partial: TranscriptSegment[];
}

/**
 * Audio d'un carnet ouvert : enregistrement, lecture synchronisée avec l'écriture,
 * transcription. État réactif (runes Svelte), une instance par vue de carnet.
 */
export class NotebookAudio {
  recordings = $state.raw<RecordingData[]>([]);
  recState = $state<RecorderState>('idle');
  recElapsed = $state(0);
  recLevel = $state(0);

  current = $state.raw<RecordingData | null>(null);
  playing = $state(false);
  time = $state(0);
  job = $state.raw<TranscriptionJob | null>(null);

  readonly supported = recordingSupported();
  private recorder = new Recorder(() => (this.recState = this.recorder.state));
  private player: HTMLAudioElement | null = null;
  private url: string | null = null;
  private raf = 0;
  private recTimer: ReturnType<typeof setInterval> | undefined;
  private abort: AbortController | null = null;
  private lastRevealed: ID | null = null;
  private doc: Y.Doc;

  constructor(
    private editor: Editor,
    private notebookId: ID,
  ) {
    this.doc = editor.doc;
    roots(this.doc).recordings.observe(this.refresh);
    this.refresh();
    void this.recoverDrafts();
  }

  /** Fermeture du carnet : l'enregistrement en cours est terminé et sauvé avant que le document ne soit fermé. */
  async shutdown() {
    cancelAnimationFrame(this.raf);
    this.abort?.abort();
    this.unload();
    if (this.recorder.state === 'recording' || this.recorder.state === 'paused') await this.stopRecording();
    else this.recorder.release();
    clearInterval(this.recTimer);
    roots(this.doc).recordings.unobserve(this.refresh);
  }

  private refresh = () => {
    this.recordings = listRecordings(this.doc);
    const cur = this.current;
    if (cur) {
      const fresh = this.recordings.find((r) => r.id === cur.id) ?? null;
      if (!fresh) this.close();
      else this.current = fresh;
    }
  };

  /** Enregistrements interrompus (onglet fermé pendant l'enregistrement) : récupérés tels quels. */
  private async recoverDrafts() {
    const drafts = await abandonedDrafts(this.notebookId);
    for (const d of drafts) {
      const rec = await finalizeDraft(d.id, `${defaultTitle(d.createdAt)} (récupéré)`);
      if (rec) putRecording(this.doc, rec);
    }
    if (drafts.length) showToast(drafts.length > 1 ? `${drafts.length} enregistrements interrompus ont été récupérés.` : 'Un enregistrement interrompu a été récupéré.');
  }

  // ── Enregistrement ──────────────────────────────────────

  async startRecording() {
    if (this.recorder.state !== 'idle') return;
    this.pause();
    try {
      await this.recorder.start(this.notebookId);
    } catch (err) {
      const name = (err as DOMException)?.name;
      showToast(
        name === 'NotAllowedError' ? 'Accès au micro refusé : autorisez-le dans les réglages du navigateur.' : name === 'NotFoundError' ? 'Aucun micro détecté.' : 'Impossible de démarrer l’enregistrement.',
        'error',
        6000,
      );
      return;
    }
    clearInterval(this.recTimer);
    this.recTimer = setInterval(() => {
      this.recElapsed = this.recorder.elapsed;
      this.recLevel = this.recorder.level();
    }, 100);
  }

  pauseRecording() {
    this.recorder.pause();
  }

  resumeRecording() {
    this.recorder.resume();
  }

  async stopRecording() {
    clearInterval(this.recTimer);
    this.recLevel = 0;
    const rec = await this.recorder.stop();
    this.recElapsed = 0;
    if (!rec) return;
    putRecording(this.doc, rec);
    showToast('Enregistrement terminé.');
  }

  // ── Lecture ─────────────────────────────────────────────

  get duration(): number {
    return this.current?.duration ?? 0;
  }

  /** L'enregistrement courant est-il synchronisé avec l'écriture ? */
  get synced(): boolean {
    return !!this.current?.spans.length;
  }

  private unload() {
    cancelAnimationFrame(this.raf);
    this.player?.pause();
    this.player?.removeAttribute('src');
    this.player = null;
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
    this.playing = false;
  }

  /** Charge un enregistrement (sans le lire). */
  async select(rec: RecordingData) {
    if (this.current?.id === rec.id && this.player) return;
    this.unload();
    const asset = await getAsset(rec.assetId);
    if (!asset) {
      showToast('Fichier audio introuvable.', 'error');
      return;
    }
    this.url = URL.createObjectURL(asset.blob);
    const audio = new Audio();
    audio.preload = 'auto';
    audio.src = this.url;
    audio.playbackRate = settings.audio.rate;
    audio.addEventListener('ended', () => {
      this.playing = false;
      this.time = this.duration;
      this.syncInk();
    });
    audio.addEventListener('pause', () => (this.playing = false));
    audio.addEventListener('play', () => {
      this.playing = true;
      this.tick();
    });
    this.player = audio;
    this.current = rec;
    this.time = 0;
    this.lastRevealed = null;
    this.syncInk();
  }

  /** Ferme le lecteur et rétablit l'affichage normal de l'écriture. */
  close() {
    this.unload();
    this.current = null;
    this.time = 0;
    this.editor.setReplay(null);
  }

  async play(rec?: RecordingData, at?: number) {
    if (rec) await this.select(rec);
    const p = this.player;
    if (!p) return;
    if (at !== undefined) this.seek(at);
    else if (this.time >= this.duration - 0.05) this.seek(0);
    try {
      await p.play();
    } catch {
      showToast('Lecture impossible.', 'error');
    }
  }

  pause() {
    this.player?.pause();
  }

  toggle() {
    if (this.playing) this.pause();
    else void this.play();
  }

  seek(sec: number) {
    const t = Math.max(0, Math.min(this.duration, sec));
    this.time = t;
    if (this.player) this.player.currentTime = t;
    this.lastRevealed = null;
    this.syncInk();
  }

  skip(delta: number) {
    this.seek(this.time + delta);
  }

  setRate(rate: number) {
    settings.audio.rate = rate;
    if (this.player) this.player.playbackRate = rate;
  }

  setReplay(on: boolean) {
    settings.audio.replay = on;
    this.syncInk();
  }

  private tick = () => {
    cancelAnimationFrame(this.raf);
    const p = this.player;
    if (!p || p.paused) return;
    this.time = p.currentTime;
    this.syncInk();
    this.raf = requestAnimationFrame(this.tick);
  };

  /** Relecture : l'écriture affichée suit la position de lecture. */
  private syncInk() {
    const rec = this.current;
    if (!rec || !rec.spans.length || !settings.audio.replay) {
      this.editor.setReplay(null);
      return;
    }
    const t = wallTimeAt(rec.spans, this.time);
    this.editor.setReplay(t);
    if (t !== null && this.playing && settings.audio.follow) {
      const el = this.editor.latestElementBefore(t, rec.spans[0].start);
      if (el && el.id !== this.lastRevealed) {
        this.lastRevealed = el.id;
        this.editor.revealElement(el);
      }
    }
  }

  /** Phrase de la transcription en cours de lecture. */
  get currentSegment(): number {
    const segs = this.current?.transcript?.segments;
    return segs ? segmentAt(segs, this.time) : -1;
  }

  // ── Écouter depuis l'écriture ───────────────────────────

  /** Lit l'audio enregistré au moment où ces éléments ont été écrits. Renvoie faux s'il n'y en a pas. */
  async listenTo(elements: PageElement[]): Promise<boolean> {
    const times = elements.map(elementTime).filter((t): t is number => t !== null);
    if (!times.length) return false;
    const hit = recordingAt(this.recordings, Math.min(...times));
    if (!hit) {
      showToast('Aucun enregistrement n’a eu lieu pendant cette écriture.');
      return false;
    }
    await this.play(hit.recording, Math.max(0, hit.time - LISTEN_LEAD));
    return true;
  }

  /** Cet élément a-t-il été écrit pendant un enregistrement ? */
  hasAudio(elements: PageElement[]): boolean {
    return elements.some((el) => {
      const t = elementTime(el);
      return t !== null && this.recordings.some((r) => audioTimeAt(r.spans, t) !== null);
    });
  }

  // ── Gestion des enregistrements ─────────────────────────

  rename(rec: RecordingData, title: string) {
    putRecording(this.doc, { ...rec, title });
  }

  remove(rec: RecordingData) {
    if (this.current?.id === rec.id) this.close();
    if (this.job?.recordingId === rec.id) this.cancelTranscription();
    deleteRecording(this.doc, rec.id);
  }

  async download(rec: RecordingData) {
    const asset = await getAsset(rec.assetId);
    if (asset) await saveFile(asset.blob, safeFileName(rec.title, extensionOf(rec.mime)));
  }

  async exportTranscript(rec: RecordingData, format: 'txt' | 'vtt') {
    const segs = rec.transcript?.segments ?? [];
    const text = format === 'vtt' ? transcriptToVtt(segs) : transcriptToText(segs);
    await saveFile(new Blob([text], { type: format === 'vtt' ? 'text/vtt' : 'text/plain' }), safeFileName(rec.title, format));
  }

  /** Importe un fichier audio existant (cours enregistré ailleurs) : lisible et transcriptible, sans synchronisation. */
  async importFile(file: File) {
    const duration = await probeDuration(file);
    const rec: RecordingData = {
      id: newId(),
      assetId: await putAsset(file),
      mime: file.type || 'audio/mpeg',
      title: file.name.replace(/\.[^.]+$/, '') || 'Audio importé',
      createdAt: Date.now(),
      duration,
      spans: [],
    };
    putRecording(this.doc, rec);
    return rec;
  }

  // ── Transcription ───────────────────────────────────────

  async transcribe(rec: RecordingData) {
    if (this.job) return;
    const asset = await getAsset(rec.assetId);
    if (!asset) return;
    const abort = new AbortController();
    this.abort = abort;
    const { engine, model, language } = settings.audio;
    this.job = { recordingId: rec.id, progress: { phase: 'decode' }, partial: [] };
    try {
      // Chargé à la demande : le moteur (et son worker) ne pèse rien tant qu'on ne transcrit pas.
      const { transcribeBlob } = await import('../../audio/engines');
      const segments = await transcribeBlob(asset.blob, {
        engine,
        model,
        language,
        signal: abort.signal,
        onProgress: (p) => {
          if (this.job?.recordingId === rec.id) this.job = { ...this.job, progress: p };
        },
        onSegments: (s) => {
          if (this.job?.recordingId === rec.id) this.job = { ...this.job, partial: [...this.job.partial, ...s] };
        },
      });
      const latest = this.recordings.find((r) => r.id === rec.id);
      if (latest) {
        putRecording(this.doc, { ...latest, transcript: { provider: engine, model, language, createdAt: Date.now(), segments } });
        showToast(segments.length ? 'Transcription terminée.' : 'Aucune parole détectée.');
      }
    } catch (err) {
      if (!abort.signal.aborted) showToast(err instanceof Error ? err.message : 'Échec de la transcription.', 'error', 8000);
    } finally {
      if (this.abort === abort) this.abort = null;
      this.job = null;
    }
  }

  cancelTranscription() {
    this.abort?.abort();
  }
}

/** Durée d'un fichier audio (métadonnées lues par le navigateur). */
function probeDuration(file: Blob): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const a = new Audio();
    const done = (d: number) => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(d) ? d : 0);
    };
    a.preload = 'metadata';
    a.addEventListener('loadedmetadata', () => done(a.duration));
    a.addEventListener('error', () => done(0));
    a.src = url;
  });
}
