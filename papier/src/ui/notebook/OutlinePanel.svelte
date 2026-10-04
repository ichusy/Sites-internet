<script lang="ts" module>
  import type { ID, PdfOutlineNode } from '../../core/model/types';

  export interface PdfOutline {
    assetId: ID;
    name: string;
    outline: PdfOutlineNode[];
  }
</script>

<script lang="ts">
  import OutlineTree from './OutlineTree.svelte';

  interface Props {
    outlines: PdfOutline[];
    loading: boolean;
    ongo: (assetId: ID, node: PdfOutlineNode) => void;
  }
  let { outlines, loading, ongo }: Props = $props();

  const withOutline = $derived(outlines.filter((o) => o.outline.length));
</script>

<div class="outline">
  {#if loading}
    <p class="hint">Analyse des PDF…</p>
  {:else if !outlines.length}
    <p class="hint">Aucun PDF dans ce carnet. Le sommaire des PDF importés apparaîtra ici.</p>
  {:else if !withOutline.length}
    <p class="hint">{outlines.length > 1 ? 'Ces PDF n’ont' : 'Ce PDF n’a'} pas de sommaire intégré.</p>
  {/if}
  {#each withOutline as o (o.assetId)}
    <section>
      {#if withOutline.length > 1}<h3>{o.name}</h3>{/if}
      <OutlineTree nodes={o.outline} onpick={(node) => ongo(o.assetId, node)} />
    </section>
  {/each}
  {#if outlines.length}
    <p class="hint small">Astuce : touchez un lien du PDF du doigt (ou avec le lasso, ou Ctrl/⌘ + clic) pour le suivre.</p>
  {/if}
</div>

<style>
  .outline {
    padding: 8px 6px 24px;
    overflow: auto;
    flex: 1;
  }
  h3 {
    margin: 10px 8px 4px;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
  }
  .hint {
    color: var(--muted);
    font-size: 13px;
    padding: 4px 10px;
  }
  .small {
    font-size: 12px;
    margin-top: 16px;
  }
</style>
