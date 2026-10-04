<script lang="ts">
  import {
    Download, Ear, FileAudio, FileText, Languages, Mic, Pause, Pencil, Play, RotateCcw, RotateCw, Trash2, Captions, X,
  } from '@lucide/svelte';
  import { tick } from 'svelte';
  import { formatTime } from '../../core/audio/timeline';
  import type { RecordingData } from '../../core/model/types';
  import { LANGUAGES } from '../../audio/transcribe';
  import { whisperLocal } from '../../audio/whisper';
  import { pickFiles } from '../../io/files';
  import Menu, { type MenuItem } from '../common/Menu.svelte';
  import { askConfirm, askText } from '../common/dialogs.svelte';
  import { withBusy } from '../common/toast.svelte';
  import { settings } from '../settings.svelte';
  import type { NotebookAudio } from './audio.svelte';

  interface Props {
    audio: NotebookAudio;
    /** Outil « toucher l'écriture pour écouter » actif. */
    listening: boolean;
    onlisten: (on: boolean) => void;
  }
  let { audio, listening, onlisten }: Props = $props();

  const RATES = [0.75, 1, 1.25, 1.5, 2];
  const PHASES = { decode: 'Préparation de l’audio…', download: 'Téléchargement du modèle (une seule fois)…', load: 'Chargement du modèle…', transcribe: 'Transcription…' };

  let downloaded = $state<string[]>([]);
  let list = $state<HTMLOListElement>();

  async function refreshModels() {
    downloaded = (await whisperLocal.downloadedModels?.()) ?? [];
  }
  $effect(() => {
    void audio.job;
    void refreshModels();
  });

  const cur = $derived(audio.current);
  const job = $derived(audio.job && audio.job.recordingId === cur?.id ? audio.job : null);
  const segments = $derived(job ? job.partial : (cur?.transcript?.segments ?? []));
  const active = $derived(job ? -1 : audio.currentSegment);
  const model = $derived(whisperLocal.models.find((m) => m.id === settings.audio.model) ?? whisperLocal.models[1]);

  // La phrase en cours reste visible pendant la lecture.
  $effect(() => {
    const i = active;
    if (i < 0 || !list) return;
    void tick().then(() => list?.querySelector(`[data-seg="${i}"]`)?.scrollIntoView({ block: 'nearest' }));
  });

  function dateLabel(r: RecordingData) {
    return new Date(r.createdAt).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  async function rename(r: RecordingData) {
    const title = await askText('Renommer l’enregistrement', 'Titre', r.title, 'Renommer');
    if (title) audio.rename(r, title);
  }

  async function remove(r: RecordingData) {
    if (await askConfirm('Supprimer l’enregistrement ?', `« ${r.title} » et sa transcription seront supprimés. L’écriture n’est pas touchée.`, 'Supprimer', true)) audio.remove(r);
  }

  async function importAudio() {
    const files = await pickFiles('audio/*,.mp3,.m4a,.wav,.ogg,.webm,.aac,.flac');
    for (const f of files) {
      const rec = await withBusy('Import de l’audio…', () => audio.importFile(f));
      if (rec) void audio.select(rec);
    }
  }

  async function clearModels() {
    if (!(await askConfirm('Supprimer les modèles téléchargés ?', 'Ils seront retéléchargés à la prochaine transcription (connexion nécessaire).', 'Supprimer', true))) return;
    await whisperLocal.clearModels?.();
    await refreshModels();
  }

  const itemsFor = (r: RecordingData) => (): MenuItem[] => [
    { label: 'Renommer…', icon: Pencil, action: () => void rename(r) },
    { label: 'Télécharger l’audio', icon: Download, action: () => void audio.download(r) },
    ...(r.transcript?.segments.length
      ? [
          { label: 'Exporter la transcription (.txt)', icon: FileText, action: () => void audio.exportTranscript(r, 'txt') },
          { label: 'Exporter les sous-titres (.vtt)', icon: Captions, action: () => void audio.exportTranscript(r, 'vtt') },
          { label: 'Transcrire de nouveau', icon: Languages, disabled: !!audio.job, action: () => void audio.transcribe(r) },
        ]
      : []),
    { separator: true },
    { label: 'Supprimer', icon: Trash2, danger: true, action: () => void remove(r) },
  ];
</script>

<div class="audio">
  <div class="actions">
    {#if audio.supported}
      <button type="button" class="btn primary" disabled={audio.recState !== 'idle'} onclick={() => void audio.startRecording()}>
        <Mic size={16} /> {audio.recState === 'idle' ? 'Enregistrer' : 'Enregistrement…'}
      </button>
    {/if}
    <button type="button" class="btn" onclick={importAudio}><FileAudio size={16} /> Importer</button>
  </div>

  {#if !audio.recordings.length}
    <p class="hint">
      Enregistrez un cours pendant que vous écrivez : en le réécoutant, l’écriture réapparaît au rythme de la voix, et toucher
      un trait fait entendre ce qui se disait à ce moment-là.
    </p>
    {#if !audio.supported}<p class="hint">L’enregistrement n’est pas disponible dans ce navigateur ; vous pouvez importer un fichier audio.</p>{/if}
  {/if}

  <ul class="recs">
    {#each audio.recordings as r (r.id)}
      <li class:selected={cur?.id === r.id}>
        <button type="button" class="rec" onclick={() => void audio.select(r)}>
          <span class="rec-title">{r.title}</span>
          <span class="rec-meta">
            {dateLabel(r)} · {formatTime(r.duration)}
            {#if r.transcript?.segments.length}· transcrit{/if}
            {#if !r.spans.length}· importé{/if}
          </span>
        </button>
        <Menu items={itemsFor(r)} />
      </li>
    {/each}
  </ul>

  {#if cur}
    <section class="player" aria-label="Lecteur">
      <div class="controls">
        <button type="button" class="icon-btn" aria-label="Reculer de 10 s" title="−10 s" onclick={() => audio.skip(-10)}><RotateCcw size={18} /></button>
        <button type="button" class="icon-btn play" aria-label={audio.playing ? 'Pause' : 'Lire'} onclick={() => audio.toggle()}>
          {#if audio.playing}<Pause size={20} />{:else}<Play size={20} />{/if}
        </button>
        <button type="button" class="icon-btn" aria-label="Avancer de 10 s" title="+10 s" onclick={() => audio.skip(10)}><RotateCw size={18} /></button>
        <span class="time">{formatTime(audio.time)} / {formatTime(audio.duration)}</span>
        <select class="rate" aria-label="Vitesse de lecture" value={settings.audio.rate} onchange={(e) => audio.setRate(Number(e.currentTarget.value))}>
          {#each RATES as r (r)}<option value={r}>{String(r).replace('.', ',')}×</option>{/each}
        </select>
        <button type="button" class="icon-btn" aria-label="Fermer le lecteur" title="Fermer" onclick={() => audio.close()}><X size={16} /></button>
      </div>
      <input
        class="scrub"
        type="range"
        min="0"
        max={Math.max(0.1, audio.duration)}
        step="0.1"
        value={audio.time}
        aria-label="Position de lecture"
        oninput={(e) => audio.seek(Number(e.currentTarget.value))}
      />
      {#if audio.synced}
        <label class="check"><input type="checkbox" checked={settings.audio.replay} onchange={(e) => audio.setReplay(e.currentTarget.checked)} /> Rejouer l’écriture au rythme de l’audio</label>
        <label class="check"><input type="checkbox" bind:checked={settings.audio.follow} disabled={!settings.audio.replay} /> Suivre l’écriture pendant la lecture</label>
        <button type="button" class="btn listen" class:on={listening} aria-pressed={listening} onclick={() => onlisten(!listening)}>
          <Ear size={16} /> {listening ? 'Touchez l’écriture pour l’écouter' : 'Toucher l’écriture pour écouter'}
        </button>
      {:else}
        <p class="hint small">Audio importé : il n’est pas synchronisé avec l’écriture.</p>
      {/if}
    </section>

    <section class="transcript" aria-label="Transcription">
      <h3>Transcription</h3>
      {#if job}
        <div class="progress">
          <span>{PHASES[job.progress.phase]}{job.progress.detail ? ` (${job.progress.detail})` : ''}</span>
          <progress max="1" value={job.progress.ratio ?? null}></progress>
          <button type="button" class="btn" onclick={() => audio.cancelTranscription()}>Annuler</button>
        </div>
      {:else if !segments.length}
        {#if cur.transcript}
          <p class="hint">Aucune parole n’a été détectée.</p>
        {/if}
        <button type="button" class="btn primary" disabled={!!audio.job} onclick={() => void audio.transcribe(cur)}>
          <Languages size={16} /> Transcrire
        </button>
        <p class="hint small">
          {whisperLocal.label} · modèle « {model.label} » · {LANGUAGES.find((l) => l.code === settings.audio.language)?.label}.
          L’audio ne quitte pas l’appareil.
          {#if !downloaded.includes(model.id)}Environ {model.sizeMb} Mo à télécharger la première fois, puis disponible hors ligne.{/if}
          {#if audio.job}Une autre transcription est en cours.{/if}
        </p>
      {/if}
      {#if segments.length}
        <ol class="segments" bind:this={list}>
          {#each segments as s, i (i)}
            <li data-seg={i}>
              <button type="button" class:active={i === active} onclick={() => void audio.play(cur, s.start)}>
                <span class="ts">{formatTime(s.start)}</span>
                <span class="txt">{s.text}</span>
              </button>
            </li>
          {/each}
        </ol>
      {/if}
    </section>
  {/if}

  <details class="settings">
    <summary>Réglages de la transcription</summary>
    <label class="field">
      Modèle
      <select bind:value={settings.audio.model}>
        {#each whisperLocal.models as m (m.id)}
          <option value={m.id}>{m.label} — ~{m.sizeMb} Mo{downloaded.includes(m.id) ? ' ✓ téléchargé' : ''}</option>
        {/each}
      </select>
    </label>
    <label class="field">
      Langue parlée
      <select bind:value={settings.audio.language}>
        {#each LANGUAGES as l (l.code)}<option value={l.code}>{l.label}</option>{/each}
      </select>
    </label>
    <p class="hint small">
      Whisper fonctionne dans le navigateur (WebGPU s’il est disponible, sinon le processeur). Le modèle « Précis » est le
      meilleur pour les cours, mais plus lent et plus lourd.
    </p>
    {#if downloaded.length}
      <button type="button" class="btn danger" onclick={clearModels}><Trash2 size={15} /> Supprimer les modèles téléchargés</button>
    {/if}
  </details>
</div>

<style>
  .audio {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 8px 24px;
    overflow: auto;
    flex: 1;
    min-height: 0;
  }
  .actions {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .hint {
    color: var(--muted);
    font-size: 13px;
    margin: 0;
    padding: 2px 4px;
    line-height: 1.4;
  }
  .small {
    font-size: 12px;
  }
  .recs {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .recs li {
    display: flex;
    align-items: center;
    border-radius: 8px;
  }
  .recs li.selected {
    background: var(--accent-soft);
  }
  .rec {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    text-align: left;
    padding: 7px 8px;
    gap: 1px;
  }
  .rec-title {
    font-size: 13.5px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rec-meta {
    font-size: 12px;
    color: var(--muted);
  }
  .player {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }
  .controls {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .controls .icon-btn {
    width: 32px;
    height: 32px;
  }
  .controls .play {
    background: var(--accent);
    color: #fff;
    border-radius: 50%;
  }
  .controls .play:hover:not(:disabled) {
    background: var(--accent);
    filter: brightness(1.08);
  }
  .time {
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: var(--muted);
    margin: 0 auto 0 6px;
    white-space: nowrap;
  }
  .rate {
    font-size: 12px;
    padding: 3px 2px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface);
    color: var(--text);
  }
  .scrub {
    width: 100%;
    accent-color: var(--accent);
  }
  .check {
    display: flex;
    gap: 6px;
    align-items: center;
    font-size: 12.5px;
  }
  .listen {
    justify-content: center;
    font-size: 13px;
  }
  .listen.on {
    background: var(--accent-soft);
    color: var(--accent);
    border-color: var(--accent);
  }
  .transcript {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  h3 {
    margin: 6px 4px 0;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
  }
  .progress {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 12.5px;
  }
  .progress progress {
    width: 100%;
    accent-color: var(--accent);
  }
  .progress .btn {
    align-self: flex-start;
  }
  .segments {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 46vh;
    overflow: auto;
  }
  .segments button {
    display: flex;
    gap: 8px;
    width: 100%;
    text-align: left;
    padding: 5px 6px;
    border-radius: 6px;
    font-size: 13px;
    line-height: 1.4;
  }
  .segments button:hover {
    background: var(--surface-2);
  }
  .segments button.active {
    background: var(--accent-soft);
  }
  .ts {
    flex: none;
    min-width: 34px;
    color: var(--muted);
    font-size: 11.5px;
    font-variant-numeric: tabular-nums;
    padding-top: 1px;
  }
  .txt {
    overflow-wrap: anywhere;
  }
  .settings {
    margin-top: 6px;
    font-size: 13px;
  }
  .settings summary {
    cursor: pointer;
    color: var(--muted);
    padding: 4px;
  }
  .settings .field {
    margin: 6px 4px;
  }
  .settings .btn {
    margin: 4px;
  }
</style>
