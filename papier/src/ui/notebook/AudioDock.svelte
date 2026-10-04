<script lang="ts">
  import { Ear, Pause, Play, Square, X, Mic } from '@lucide/svelte';
  import { formatTime } from '../../core/audio/timeline';
  import type { NotebookAudio } from './audio.svelte';

  interface Props {
    audio: NotebookAudio;
    /** Lecteur déjà visible dans le panneau Audio : le mini-lecteur est inutile. */
    panelOpen: boolean;
    listening: boolean;
    onlisten: (on: boolean) => void;
  }
  let { audio, panelOpen, listening, onlisten }: Props = $props();

  const recording = $derived(audio.recState === 'recording' || audio.recState === 'paused');
</script>

{#if recording}
  <div class="dock rec" role="region" aria-label="Enregistrement audio">
    <span class="dot" class:paused={audio.recState === 'paused'} style:--level={audio.recLevel}></span>
    <span class="label">{audio.recState === 'paused' ? 'En pause' : 'Enregistrement'}</span>
    <span class="time">{formatTime(audio.recElapsed)}</span>
    {#if audio.recState === 'paused'}
      <button type="button" class="icon-btn" title="Reprendre" aria-label="Reprendre l’enregistrement" onclick={() => audio.resumeRecording()}><Mic size={17} /></button>
    {:else}
      <button type="button" class="icon-btn" title="Pause" aria-label="Mettre l’enregistrement en pause" onclick={() => audio.pauseRecording()}><Pause size={17} /></button>
    {/if}
    <button type="button" class="icon-btn stop" title="Arrêter" aria-label="Arrêter l’enregistrement" onclick={() => void audio.stopRecording()}><Square size={15} /></button>
  </div>
{:else if audio.current && !panelOpen}
  <div class="dock" role="region" aria-label="Lecture audio">
    <button type="button" class="icon-btn" aria-label={audio.playing ? 'Pause' : 'Lire'} onclick={() => audio.toggle()}>
      {#if audio.playing}<Pause size={17} />{:else}<Play size={17} />{/if}
    </button>
    <span class="title">{audio.current.title}</span>
    <span class="time">{formatTime(audio.time)} / {formatTime(audio.duration)}</span>
    {#if audio.synced}
      <button type="button" class="icon-btn" class:active={listening} aria-pressed={listening} title="Toucher l’écriture pour écouter" aria-label="Toucher l’écriture pour écouter" onclick={() => onlisten(!listening)}><Ear size={17} /></button>
    {/if}
    <button type="button" class="icon-btn" title="Fermer" aria-label="Fermer le lecteur" onclick={() => audio.close()}><X size={16} /></button>
  </div>
{/if}

<style>
  .dock {
    position: absolute;
    z-index: 16;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 3px 6px 3px 10px;
    max-width: calc(100% - 24px);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 999px;
    box-shadow: var(--shadow);
    font-size: 13px;
    white-space: nowrap;
  }
  .icon-btn {
    width: 32px;
    height: 32px;
    border-radius: 50%;
  }
  .dot {
    --level: 0;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #d93a3a;
    box-shadow: 0 0 0 calc(var(--level) * 7px) rgb(217 58 58 / 0.25);
    transition: box-shadow 0.1s;
    flex: none;
  }
  .dot.paused {
    background: var(--muted);
    box-shadow: none;
  }
  .label {
    font-weight: 600;
  }
  .title {
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    font-weight: 600;
  }
  .time {
    font-variant-numeric: tabular-nums;
    color: var(--muted);
    margin: 0 4px;
  }
  .stop {
    color: #d93a3a;
  }
</style>
