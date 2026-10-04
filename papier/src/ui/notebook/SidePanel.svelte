<script lang="ts" module>
  export type PanelTab = 'pages' | 'outline' | 'search';
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';

  let { tab = $bindable(), children }: { tab: PanelTab; children: Snippet } = $props();

  const TABS: { id: PanelTab; label: string }[] = [
    { id: 'pages', label: 'Pages' },
    { id: 'outline', label: 'Sommaire' },
    { id: 'search', label: 'Recherche' },
  ];
</script>

<aside class="side" class:wide={tab !== 'pages'} aria-label="Panneau latéral">
  <div class="tabs" role="tablist">
    {#each TABS as t (t.id)}
      <button type="button" role="tab" aria-selected={tab === t.id} class:active={tab === t.id} onclick={() => (tab = t.id)}>{t.label}</button>
    {/each}
  </div>
  {@render children()}
</aside>

<style>
  .side {
    width: 212px;
    flex: none;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--surface);
    border-left: 1px solid var(--border);
  }
  .side.wide {
    width: 290px;
  }
  .tabs {
    display: flex;
    gap: 2px;
    padding: 6px 6px 0;
    border-bottom: 1px solid var(--border);
    flex: none;
  }
  .tabs button {
    flex: 1;
    padding: 7px 4px 8px;
    font-size: 12.5px;
    color: var(--muted);
    border-bottom: 2px solid transparent;
    white-space: nowrap;
  }
  .tabs button.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
    font-weight: 600;
  }
  @media (max-width: 700px) {
    .side {
      position: absolute;
      right: 0;
      top: 0;
      bottom: 0;
      z-index: 20;
      box-shadow: var(--shadow);
    }
    .side.wide {
      width: min(320px, 100%);
    }
  }
</style>
