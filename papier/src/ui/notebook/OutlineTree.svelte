<script lang="ts">
  import { ChevronRight, ExternalLink } from '@lucide/svelte';
  import type { PdfOutlineNode } from '../../core/model/types';
  import OutlineTree from './OutlineTree.svelte';

  let { nodes, onpick, depth = 0 }: { nodes: PdfOutlineNode[]; onpick: (n: PdfOutlineNode) => void; depth?: number } = $props();

  /** Les deux premiers niveaux sont dépliés par défaut. */
  let open = $state<Record<number, boolean>>({});
</script>

<ul>
  {#each nodes as node, i (i)}
    {@const expanded = open[i] ?? depth < 1}
    <li>
      <div class="row" style:padding-left="{4 + depth * 12}px">
        <button
          type="button"
          class="toggle"
          class:open={expanded}
          class:hidden={!node.children.length}
          aria-label={expanded ? 'Replier' : 'Déplier'}
          onclick={() => (open[i] = !expanded)}
        >
          <ChevronRight size={13} />
        </button>
        <button type="button" class="entry" class:disabled={node.pageIndex === undefined && !node.url} onclick={() => onpick(node)}>
          <span class="title">{node.title}</span>
          {#if node.url}<ExternalLink size={12} />{:else if node.pageIndex !== undefined}<span class="page">{node.pageIndex + 1}</span>{/if}
        </button>
      </div>
      {#if node.children.length && expanded}
        <OutlineTree nodes={node.children} {onpick} depth={depth + 1} />
      {/if}
    </li>
  {/each}
</ul>

<style>
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .row {
    display: flex;
    align-items: center;
    border-radius: 6px;
  }
  .row:hover {
    background: var(--surface-2);
  }
  .toggle {
    width: 20px;
    height: 28px;
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--muted);
    transition: transform 0.15s;
  }
  .toggle.open {
    transform: rotate(90deg);
  }
  .toggle.hidden {
    visibility: hidden;
  }
  .entry {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 6px 5px 0;
    text-align: left;
    font-size: 13.5px;
  }
  .entry.disabled {
    color: var(--muted);
  }
  .title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .page {
    font-size: 12px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
</style>
