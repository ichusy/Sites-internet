<script lang="ts">
  import { ChevronDown, ChevronUp, X } from '@lucide/svelte';
  import type { PageHits } from '../../engine/search';

  interface Props {
    query: string;
    hits: PageHits[];
    active: number;
    pending: boolean;
    onpick: (i: number) => void;
    input?: HTMLInputElement;
  }
  let { query = $bindable(), hits, active, pending, onpick, input = $bindable() }: Props = $props();

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
  {:else}
    <p class="hint">Cherche dans le texte tapé et dans le texte des PDF importés (sans tenir compte des accents ni des majuscules). L’écriture manuscrite viendra avec la reconnaissance d’écriture.</p>
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
  .results {
    list-style: none;
    margin: 4px 0 0;
    padding: 0 6px 24px;
    overflow: auto;
    flex: 1;
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
