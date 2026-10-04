<script lang="ts">
  import { Copy, CopyPlus, Scissors, Trash2 } from '@lucide/svelte';
  import type { Editor, SelectionInfo } from '../../engine/Editor';
  import { settings } from '../settings.svelte';

  let { editor, info }: { editor: Editor; info: SelectionInfo } = $props();

  let bar = $state<HTMLDivElement>();
  let size = $state({ w: 320, h: 44 });

  $effect(() => {
    if (bar) size = { w: bar.offsetWidth, h: bar.offsetHeight };
  });

  // Au-dessus de la sélection, ou en dessous s'il n'y a pas la place ; toujours dans la zone visible.
  const pos = $derived.by(() => {
    const host = bar?.parentElement;
    const maxX = (host?.clientWidth ?? 800) - size.w - 8;
    const x = Math.max(8, Math.min(info.rect.x + info.rect.width / 2 - size.w / 2, maxX));
    let y = info.rect.y - size.h - 14;
    if (y < 8) y = info.rect.y + info.rect.height + 14;
    y = Math.max(8, Math.min(y, (host?.clientHeight ?? 600) - size.h - 8));
    return { x, y };
  });
</script>

<div bind:this={bar} class="selection-bar" class:hidden={info.dragging} style:left="{pos.x}px" style:top="{pos.y}px" role="toolbar" aria-label="Sélection">
  <span class="count">{info.count} élément{info.count > 1 ? 's' : ''}</span>
  <span class="sep"></span>
  {#each settings.penPalette as c (c)}
    <button type="button" class="swatch" style:background={c} aria-label="Recolorer en {c}" title="Recolorer" onclick={() => editor.recolorSelection(c)}></button>
  {/each}
  <span class="sep"></span>
  <button type="button" class="icon-btn" title="Copier (Ctrl+C)" aria-label="Copier" onclick={() => editor.copySelection()}><Copy size={17} /></button>
  <button type="button" class="icon-btn" title="Couper (Ctrl+X)" aria-label="Couper" onclick={() => editor.cutSelection()}><Scissors size={17} /></button>
  <button type="button" class="icon-btn" title="Dupliquer (Ctrl+D)" aria-label="Dupliquer" onclick={() => editor.duplicateSelection()}><CopyPlus size={17} /></button>
  <button type="button" class="icon-btn danger" title="Supprimer (Suppr)" aria-label="Supprimer" onclick={() => editor.deleteSelection()}><Trash2 size={17} /></button>
</div>

<style>
  .selection-bar {
    position: absolute;
    z-index: 15;
    display: flex;
    align-items: center;
    gap: 3px;
    padding: 4px 6px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: var(--shadow);
    white-space: nowrap;
  }
  .hidden {
    visibility: hidden;
  }
  .count {
    font-size: 13px;
    color: var(--muted);
    padding: 0 6px;
  }
  .sep {
    width: 1px;
    height: 20px;
    background: var(--border);
    margin: 0 4px;
  }
  .swatch {
    width: 20px;
    height: 20px;
  }
  .icon-btn {
    width: 32px;
    height: 32px;
  }
  .danger {
    color: var(--danger);
  }
</style>
