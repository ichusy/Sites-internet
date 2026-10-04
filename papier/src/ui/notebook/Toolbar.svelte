<script lang="ts">
  import {
    ChevronLeft, ClipboardPaste, Eraser, FilePlus, Highlighter, LassoSelect, PanelRight, Pen, Redo2, SlidersHorizontal, Undo2, X,
  } from '@lucide/svelte';
  import Menu, { type MenuItem } from '../common/Menu.svelte';
  import type { Brush, DashStyle } from '../../core/model/types';
  import type { EditorState } from '../../engine/Editor';
  import type { ToolName } from '../../engine/tools/types';
  import Popover from '../common/Popover.svelte';
  import { links } from '../router.svelte';
  import { ERASER_SIZES, HIGHLIGHTER_WIDTHS, PEN_WIDTHS, settings } from '../settings.svelte';

  interface Props {
    title: string;
    tool: ToolName;
    es: EditorState;
    pagesOpen: boolean;
    onrename: () => void;
    onundo: () => void;
    onredo: () => void;
    onaddpage: () => void;
    onfit: () => void;
    canPaste: boolean;
    onpaste: () => void;
    docItems: () => MenuItem[];
  }
  let {
    title, tool = $bindable(), es, pagesOpen = $bindable(), onrename, onundo, onredo, onaddpage, onfit, canPaste, onpaste, docItems,
  }: Props = $props();

  const styles = settings.styles;

  const BRUSHES: { id: Brush; label: string }[] = [
    { id: 'ballpoint', label: 'Bille' },
    { id: 'fountain', label: 'Plume' },
    { id: 'brush', label: 'Pinceau' },
  ];
  const DASHES: { id: DashStyle; label: string }[] = [
    { id: 'solid', label: 'Continu' },
    { id: 'dashed', label: 'Tirets' },
    { id: 'dotted', label: 'Points' },
  ];

  let customColor = $state('#3461c9');

  const palette = $derived(tool === 'highlighter' ? settings.highlighterPalette : settings.penPalette);
  const currentColor = $derived(tool === 'highlighter' ? styles.highlighter.color : styles.pen.color);

  function pickColor(c: string) {
    if (tool === 'highlighter') styles.highlighter.color = c;
    else {
      styles.pen.color = c;
      if (tool === 'eraser') tool = 'pen';
    }
  }

  function addToPalette() {
    const list = tool === 'highlighter' ? settings.highlighterPalette : settings.penPalette;
    if (!list.includes(customColor)) list.push(customColor);
    pickColor(customColor);
  }

  function removeFromPalette(c: string) {
    const list = tool === 'highlighter' ? settings.highlighterPalette : settings.penPalette;
    if (list.length > 1) list.splice(list.indexOf(c), 1);
  }
</script>

<header class="toolbar">
  <div class="group left">
    <a class="icon-btn" href={links.all} aria-label="Retour à la bibliothèque" title="Bibliothèque"><ChevronLeft size={20} /></a>
    <button type="button" class="title" title="Renommer" onclick={onrename}>{title}</button>
  </div>

  <div class="group tools" role="toolbar" aria-label="Outils">
    <button type="button" class="icon-btn" class:active={tool === 'pen'} aria-pressed={tool === 'pen'} title="Stylo (P)" aria-label="Stylo" onclick={() => (tool = 'pen')}>
      <Pen size={19} />
    </button>
    <button type="button" class="icon-btn" class:active={tool === 'highlighter'} aria-pressed={tool === 'highlighter'} title="Surligneur (H)" aria-label="Surligneur" onclick={() => (tool = 'highlighter')}>
      <Highlighter size={19} />
    </button>
    <button type="button" class="icon-btn" class:active={tool === 'eraser'} aria-pressed={tool === 'eraser'} title="Gomme (E)" aria-label="Gomme" onclick={() => (tool = 'eraser')}>
      <Eraser size={19} />
    </button>
    <button type="button" class="icon-btn" class:active={tool === 'lasso'} aria-pressed={tool === 'lasso'} title="Lasso (L)" aria-label="Lasso" onclick={() => (tool = 'lasso')}>
      <LassoSelect size={19} />
    </button>

    <span class="sep"></span>

    {#if tool === 'lasso'}
      <span class="hint">Entourez ou touchez des traits pour les sélectionner</span>
      <button type="button" class="btn small" disabled={!canPaste} title="Coller (Ctrl+V)" onclick={onpaste}>
        <ClipboardPaste size={16} /> Coller
      </button>
    {:else if tool === 'eraser'}
      {#each ERASER_SIZES as size (size)}
        <button type="button" class="icon-btn" class:active={styles.eraser.size === size} title="Taille {size}px" aria-label="Taille de gomme {size}" onclick={() => (styles.eraser.size = size)}>
          <span class="dot ring" style:width="{Math.min(22, 6 + size / 3)}px" style:height="{Math.min(22, 6 + size / 3)}px"></span>
        </button>
      {/each}
    {:else}
      <div class="swatches">
        {#each palette as c (c)}
          <button type="button" class="swatch" class:selected={currentColor === c} style:background={c} aria-label="Couleur {c}" onclick={() => pickColor(c)}></button>
        {/each}
      </div>
      <span class="sep"></span>
      {#each tool === 'highlighter' ? HIGHLIGHTER_WIDTHS : PEN_WIDTHS as w, i (w)}
        {@const current = tool === 'highlighter' ? styles.highlighter.width : styles.pen.width}
        <button
          type="button"
          class="icon-btn width"
          class:active={Math.abs(current - w) < 0.01}
          aria-label="Épaisseur {i + 1}"
          title="Épaisseur {w} pt"
          onclick={() => (tool === 'highlighter' ? (styles.highlighter.width = w) : (styles.pen.width = w))}
        >
          <span class="dot" style:width="{4 + i * 4}px" style:height="{4 + i * 4}px" style:background={currentColor}></span>
        </button>
      {/each}
    {/if}

    {#if tool !== 'lasso'}
    <Popover label="Réglages de l’outil">
      {#snippet trigger()}<SlidersHorizontal size={18} />{/snippet}
      {#if tool === 'eraser'}
        <div class="opt">
          <span class="opt-label">Mode</span>
          <div class="chips">
            <button type="button" class="chip" class:selected={styles.eraser.mode === 'stroke'} onclick={() => (styles.eraser.mode = 'stroke')}>Trait entier</button>
            <button type="button" class="chip" class:selected={styles.eraser.mode === 'partial'} onclick={() => (styles.eraser.mode = 'partial')}>Partielle</button>
          </div>
        </div>
        <label class="opt">
          <span class="opt-label">Taille : {styles.eraser.size} px</span>
          <input type="range" min="6" max="80" step="1" bind:value={styles.eraser.size} />
        </label>
      {:else}
        {#if tool === 'pen'}
          <div class="opt">
            <span class="opt-label">Pointe</span>
            <div class="chips">
              {#each BRUSHES as b (b.id)}
                <button type="button" class="chip" class:selected={styles.pen.brush === b.id} onclick={() => (styles.pen.brush = b.id)}>{b.label}</button>
              {/each}
            </div>
          </div>
          <div class="opt">
            <span class="opt-label">Trait</span>
            <div class="chips">
              {#each DASHES as d (d.id)}
                <button type="button" class="chip" class:selected={styles.pen.dash === d.id} onclick={() => (styles.pen.dash = d.id)}>{d.label}</button>
              {/each}
            </div>
          </div>
          <label class="opt">
            <span class="opt-label">Épaisseur : {styles.pen.width.toFixed(1)} pt</span>
            <input type="range" min="0.3" max="8" step="0.1" bind:value={styles.pen.width} />
          </label>
        {:else}
          <label class="opt">
            <span class="opt-label">Épaisseur : {styles.highlighter.width} pt</span>
            <input type="range" min="4" max="40" step="1" bind:value={styles.highlighter.width} />
          </label>
        {/if}
        <div class="opt">
          <span class="opt-label">Palette</span>
          <div class="chips">
            {#each palette as c (c)}
              <span class="palette-item">
                <button type="button" class="swatch" class:selected={currentColor === c} style:background={c} aria-label="Couleur {c}" onclick={() => pickColor(c)}></button>
                <button type="button" class="remove" aria-label="Retirer {c} de la palette" onclick={() => removeFromPalette(c)}><X size={10} /></button>
              </span>
            {/each}
          </div>
          <div class="custom">
            <input type="color" bind:value={customColor} aria-label="Couleur personnalisée" />
            <button type="button" class="btn" onclick={addToPalette}>Ajouter à la palette</button>
          </div>
        </div>
      {/if}
    </Popover>
    {/if}
  </div>

  <div class="group right">
    <button type="button" class="icon-btn" disabled={!es.canUndo} title="Annuler (Ctrl+Z, tap à 2 doigts)" aria-label="Annuler" onclick={onundo}><Undo2 size={19} /></button>
    <button type="button" class="icon-btn" disabled={!es.canRedo} title="Rétablir (Ctrl+Maj+Z, tap à 3 doigts)" aria-label="Rétablir" onclick={onredo}><Redo2 size={19} /></button>
    <span class="sep"></span>
    <button type="button" class="zoom" title="Ajuster à la largeur (0)" onclick={onfit}>{Math.round(es.zoom * 100)} %</button>
    <span class="page-indicator" title="Page courante">{es.currentPage + 1}/{es.pageCount}</span>
    <button type="button" class="icon-btn" title="Ajouter une page" aria-label="Ajouter une page" onclick={onaddpage}><FilePlus size={19} /></button>
    <button type="button" class="icon-btn" class:active={pagesOpen} aria-pressed={pagesOpen} title="Pages" aria-label="Panneau des pages" onclick={() => (pagesOpen = !pagesOpen)}>
      <PanelRight size={19} />
    </button>
    <Menu items={docItems} label="Importer, exporter…" />
  </div>
</header>

<style>
  .toolbar {
    height: var(--toolbar-h);
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 8px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    overflow-x: auto;
    scrollbar-width: none;
  }
  .group {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .left {
    flex: 1 1 0;
    min-width: 0;
  }
  .right {
    flex: 1 1 0;
    justify-content: flex-end;
  }
  .title {
    font-weight: 600;
    padding: 6px 8px;
    border-radius: 8px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .title:hover {
    background: var(--surface-2);
  }
  .sep {
    width: 1px;
    height: 22px;
    background: var(--border);
    margin: 0 6px;
    flex: none;
  }
  .swatches {
    display: flex;
    gap: 4px;
    padding: 0 2px;
  }
  .swatch {
    width: 24px;
    height: 24px;
  }
  .width {
    width: 30px;
  }
  .dot {
    display: inline-block;
    border-radius: 50%;
    background: var(--text);
    box-shadow: 0 0 0 1px rgb(0 0 0 / 0.18);
  }
  .dot.ring {
    background: none;
    border: 1.5px solid var(--text);
  }
  .zoom {
    min-width: 54px;
    padding: 6px;
    border-radius: 8px;
    font-size: 13px;
    font-variant-numeric: tabular-nums;
    color: var(--muted);
  }
  .zoom:hover {
    background: var(--surface-2);
  }
  .hint {
    font-size: 13px;
    color: var(--muted);
    padding: 0 8px;
    white-space: nowrap;
  }
  .btn.small {
    padding: 5px 10px;
    font-size: 14px;
  }
  .page-indicator {
    font-size: 13px;
    color: var(--muted);
    padding: 0 6px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .opt {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .opt-label {
    font-size: 13px;
    color: var(--muted);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip {
    padding: 5px 12px;
    border-radius: 999px;
    border: 1px solid var(--border);
    font-size: 14px;
  }
  .chip.selected {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--accent);
  }
  .palette-item {
    position: relative;
  }
  .remove {
    position: absolute;
    top: -5px;
    right: -5px;
    width: 15px;
    height: 15px;
    border-radius: 50%;
    background: var(--surface-2);
    border: 1px solid var(--border);
    display: none;
    align-items: center;
    justify-content: center;
    padding: 0;
  }
  .palette-item:hover .remove,
  .palette-item:focus-within .remove {
    display: inline-flex;
  }
  @media (hover: none) {
    .remove {
      display: inline-flex;
    }
  }
  .custom {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .custom input {
    width: 40px;
    height: 32px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: none;
  }
  input[type='range'] {
    width: 100%;
    accent-color: var(--accent);
  }

  @media (max-width: 900px) {
    .left {
      flex: 0 0 auto;
    }
    .title,
    .hint,
    .page-indicator {
      display: none;
    }
    .right {
      flex: 0 0 auto;
    }
    .tools {
      flex: 1 0 auto;
      justify-content: center;
    }
  }
</style>
