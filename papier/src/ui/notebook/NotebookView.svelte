<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { NotebookRecord } from '../../core/model/types';
  import { db } from '../../core/storage/db';
  import { updateNotebook } from '../../core/storage/library';
  import { openNotebook, type OpenNotebook } from '../../core/storage/notebookStore';
  import { Editor, type EditorState } from '../../engine/Editor';
  import type { ToolName } from '../../engine/tools/types';
  import { askText } from '../common/dialogs.svelte';
  import { links } from '../router.svelte';
  import { settings } from '../settings.svelte';
  import { theme } from '../theme.svelte';
  import PagesPanel from './PagesPanel.svelte';
  import Toolbar from './Toolbar.svelte';

  let { id }: { id: string } = $props();

  const PANEL_KEY = 'papier-pages-panel';

  let record = $state<NotebookRecord | null>(null);
  let missing = $state(false);
  let editor = $state.raw<Editor | null>(null);
  let es = $state<EditorState>({ canUndo: false, canRedo: false, pageCount: 0, currentPage: 0, zoom: 1 });
  let tool = $state<ToolName>('pen');
  let pagesOpen = $state(readPanelPref());
  let container = $state<HTMLDivElement>();

  function readPanelPref() {
    try {
      const v = localStorage.getItem(PANEL_KEY);
      return v === null ? window.innerWidth > 1000 : v === '1';
    } catch {
      return false;
    }
  }

  onMount(() => {
    let cancelled = false;
    let opened: OpenNotebook | null = null;
    let unsub: (() => void) | undefined;

    (async () => {
      const rec = await db.notebooks.get(id);
      if (cancelled) return;
      if (!rec) {
        missing = true;
        return;
      }
      record = rec;
      opened = await openNotebook(rec);
      if (cancelled) {
        await opened.close();
        return;
      }
      await tick();
      const ed = new Editor(container!, opened, settings.styles);
      unsub = ed.onState((s) => (es = s));
      editor = ed;
    })();

    return () => {
      cancelled = true;
      unsub?.();
      editor?.destroy();
      editor = null;
      void opened?.close();
    };
  });

  $effect(() => {
    if (editor) editor.fingerDrawing = settings.fingerDrawing;
  });

  $effect(() => {
    editor?.setTool(tool);
  });

  $effect(() => {
    void theme.resolved;
    const ed = editor;
    if (ed) void tick().then(() => ed.setDeskColor(getComputedStyle(container!).getPropertyValue('--desk').trim()));
  });

  $effect(() => {
    try {
      localStorage.setItem(PANEL_KEY, pagesOpen ? '1' : '0');
    } catch {
      /* ignoré */
    }
  });

  async function rename() {
    if (!record) return;
    const title = await askText('Renommer le carnet', 'Titre', record.title, 'Renommer');
    if (!title) return;
    record.title = title;
    await updateNotebook(record.id, { title });
  }

  // Le titre du document Yjs suit celui de la bibliothèque (utile pour l'export).
  $effect(() => {
    const title = record?.title;
    const ed = editor;
    if (ed && title) ed.setTitle(title);
  });

  function onKey(e: KeyboardEvent) {
    if (!editor) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (document.querySelector('dialog[open]')) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && key === 'z') {
      e.preventDefault();
      if (e.shiftKey) editor.redo();
      else editor.undo();
    } else if (mod && key === 'y') {
      e.preventDefault();
      editor.redo();
    } else if (!mod && !e.altKey) {
      if (key === 'p') tool = 'pen';
      else if (key === 'h') tool = 'highlighter';
      else if (key === 'e') tool = 'eraser';
      else if (key === '+' || key === '=') editor.zoomBy(1.25);
      else if (key === '-') editor.zoomBy(0.8);
      else if (key === '0') editor.fitWidth();
      else if (key === 'pagedown') editor.scrollToPage(Math.min(es.pageCount - 1, es.currentPage + 1));
      else if (key === 'pageup') editor.scrollToPage(Math.max(0, es.currentPage - 1));
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="notebook">
  {#if missing}
    <div class="missing">
      <p>Ce carnet n’existe pas ou a été supprimé.</p>
      <a class="btn" href={links.all}>Retour à la bibliothèque</a>
    </div>
  {:else}
    <Toolbar
      title={record?.title ?? ''}
      bind:tool
      {es}
      bind:pagesOpen
      onrename={rename}
      onundo={() => editor?.undo()}
      onredo={() => editor?.redo()}
      onaddpage={() => editor?.addPage()}
      onfit={() => editor?.fitWidth()}
    />
    <div class="workspace">
      <div class="canvas-host" bind:this={container} data-tool={tool}></div>
      {#if editor && pagesOpen}
        <PagesPanel {editor} current={es.currentPage} pageCount={es.pageCount} />
      {/if}
    </div>
  {/if}
</div>

<style>
  .notebook {
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--desk);
  }
  .workspace {
    flex: 1;
    min-height: 0;
    display: flex;
    position: relative;
  }
  .canvas-host {
    position: relative;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    cursor: crosshair;
    touch-action: none;
  }
  .canvas-host[data-tool='eraser'] {
    cursor: none;
  }
  .missing {
    margin: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    color: var(--muted);
  }
</style>
