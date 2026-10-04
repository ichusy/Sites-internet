<script lang="ts">
  import { ChevronDown, ChevronUp, X } from '@lucide/svelte';
  import type { PageHits } from '../../engine/search';
  import type { AudioHit } from '../../core/search/audioSearch';
  import { formatTime } from '../../core/audio/timeline';

  interface Props {
    query: string;
    hits: PageHits[];
    active: number;
    pending: boolean;
    onpick: (i: number) => void;
    input?: HTMLInputElement;
    /** Phrases trouvées dans les transcriptions audio. */
    audioHits?: AudioHit[];
    onaudio?: (h: AudioHit) => void;
  }
  let { query = $bindable(), hits, active, pending, onpick, input = $bindable(), audioHits = [], onaudio }: Props = $props();

  const total = $derived(hits.reduce((n, h) => n + h.count, 0));

  function step(dir: 1 | -1) {
    if (!hits.length) return;
    onpick((active + dir + hits.length) % hits.length);
  }

  function onkeydown(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      step(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape') {
      query = '';
    }
  }
</script>

<div class="search">
  <div class="bar">
    <input
      bind:this={input}
      bind:value={query}
      type="search"
      class="input"
      placeholder="Rechercher dans le carnet"
      aria-label="Rechercher dans le carnet"
      {onkeydown}
    />
    {#if query}
      <button type="button" class="icon-btn" aria-label="Effacer" onclick={() => (query = '')}><X size={15} /></button>
    {/if}
  </div>
  {#if query.trim()}
    <div class="status">
      <span>
        {#if hits.length}
          {total} occurrence{total > 1 ? 's' : ''} sur {hits.length} page{hits.length > 1 ? 's' : ''}
        {:else if audioHits.length}
          Rien dans les pages
        {:else}
          Aucun résultat
        {/if}
      </span>
      <span class="nav">
        <button type="button" class="icon-btn" disabled={!hits.length} aria-label="Résultat précédent (Maj+Entrée)" onclick={() => step(-1)}><ChevronUp size={16} /></button>
        <button type="button" class="icon-btn" disabled={!hits.length} aria-label="Résultat suivant (Entrée)" onclick={() => step(1)}><ChevronDown size={16} /></button>
      </span>
    </div>
    {#if pending}<p class="hint">Analyse des PDF en cours : les résultats se complètent…</p>{/if}
    <div class="lists">
      <ol class="results">
        {#each hits as h, i (h.pageId)}
          <li>
            <button type="button" class:active={i === active} onclick={() => onpick(i)}>
              <span class="page">Page {h.index + 1}{h.count > 1 ? ` · ${h.count} occurrences` : ''}</span>
              <span class="snippet">{h.snippet.before}<mark>{h.snippet.match}</mark>{h.snippet.after}</span>
            </button>
          </li>
        {/each}
      </ol>
      {#if audioHits.length}
        <h3 class="group">Dans l’audio ({audioHits.length})</h3>
        <ol class="results audio">
          {#each audioHits as h, i (i)}
            <li>
              <button type="button" onclick={() => onaudio?.(h)}>
                <span class="page">{h.title} · {formatTime(h.start)}</span>
                <span class="snippet">{h.snippet.before}<mark>{h.snippet.match}</mark>{h.snippet.after}</span>
              </button>
            </li>
          {/each}
        </ol>
      {/if}
    </div>
  {:else}
    <p class="hint">Cherche dans le texte tapé, le texte des PDF importés et les transcriptions audio (sans tenir compte des accents ni des majuscules). L’écriture manuscrite viendra avec la reconnaissance d’écriture.</p>
  {/if}
</div>

<style>
  .search {
    display: flex;
    flex-direction: column;
    min-height: 0;
    flex: 1;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 10px 8px 6px;
  }
  .bar .input {
    flex: 1;
    min-width: 0;
    padding: 7px 9px;
    font-size: 14px;
  }
  .bar .icon-btn {
    width: 30px;
    height: 30px;
  }
  .status {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 8px 0 12px;
    font-size: 12.5px;
    color: var(--muted);
  }
  .nav {
    display: flex;
  }
  .nav .icon-btn {
    width: 30px;
    height: 30px;
  }
  .hint {
    color: var(--muted);
    font-size: 13px;
    padding: 6px 12px;
    margin: 0;
  }
  .group {
    margin: 4px 14px 0;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
  }
  .lists {
    flex: 1;
    overflow: auto;
    padding-bottom: 24px;
  }
  .results {
    list-style: none;
    margin: 4px 0 0;
    padding: 0 6px;
  }
  .results button {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
    text-align: left;
    padding: 8px;
    border-radius: 8px;
  }
  .results button:hover {
    background: var(--surface-2);
  }
  .results button.active {
    background: var(--accent-soft);
  }
  .page {
    font-size: 12px;
    font-weight: 600;
    color: var(--muted);
  }
  .snippet {
    font-size: 13px;
    line-height: 1.35;
    overflow-wrap: anywhere;
  }
  mark {
    background: #ffd60a;
    color: #1f2430;
    border-radius: 2px;
    padding: 0 1px;
  }
</style>
