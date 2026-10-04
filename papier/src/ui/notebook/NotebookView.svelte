<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import type { NotebookRecord } from '../../core/model/types';
  import { db } from '../../core/storage/db';
  import { updateNotebook } from '../../core/storage/library';
  import { openNotebook, type OpenNotebook } from '../../core/storage/notebookStore';
  import { Archive, FileDown, FileInput } from '@lucide/svelte';
  import { Editor, hasClipboard, type EditorState, type SelectionInfo } from '../../engine/Editor';
  import { pickFiles } from '../../io/files';
  import { exportNotebookArchive, exportNotebookPdf, pagesForInsertion } from '../actions';
  import type { MenuItem } from '../common/Menu.svelte';
  import SelectionBar from './SelectionBar.svelte';
  import TextEditor from './TextEditor.svelte';
  import type { TextEditRequest } from '../../engine/tools/types';
  import { putAsset } from '../../core/storage/assets';
  import { stickerAsset, type Sticker } from '../stickers';
  import { withBusy } from '../common/toast.svelte';
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
  let selection = $state<SelectionInfo | null>(null);
  let canPaste = $state(hasClipboard());
  let dropping = $state(false);
  let textReq = $state<TextEditRequest | null>(null);
  let textarea = $state<HTMLTextAreaElement>();

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
      const offState = ed.onState((s) => {
        es = s;
        canPaste = hasClipboard();
      });
      const offSel = ed.onSelection((s) => (selection = s));
      const offTool = ed.onToolChange((t) => (tool = t));
      const offText = ed.onTextEdit((req) => {
        textReq = req ? { ...req } : null;
        if (!req || !textarea) return;
        // Synchrone, pendant le geste : nécessaire pour ouvrir le clavier sur iPad.
        settings.styles.text.color = req.color;
        settings.styles.text.size = req.fontSize;
        textarea.value = req.text;
        textarea.focus();
      });
      unsub = () => {
        offState();
        offSel();
        offTool();
        offText();
      };
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

  // Couleur et taille choisies dans la barre d'outils pendant la saisie : appliquées à la zone.
  $effect(() => {
    const { color, size } = settings.styles.text;
    untrack(() => {
      if (!editor || !textReq || (textReq.color === color && textReq.fontSize === size)) return;
      editor.updateTextEdit({ color, fontSize: size });
      textReq = { ...textReq, color, fontSize: size };
    });
  });

  /** La sélection est-elle (au moins en partie) à l'écran ? */
  function selectionVisible(info: SelectionInfo) {
    const w = container?.clientWidth ?? 0;
    const h = container?.clientHeight ?? 0;
    const r = info.rect;
    return r.x + r.width > 0 && r.y + r.height > 0 && r.x < w && r.y < h;
  }

  async function insertImage() {
    const files = await pickFiles('image/*', true);
    await withBusy('Insertion…', async () => {
      for (const f of files) {
        const bmp = await createImageBitmap(f);
        const { width, height } = bmp;
        bmp.close();
        editor?.insertImage(await putAsset(f), width, height);
      }
    });
  }

  async function insertSticker(s: Sticker) {
    const id = await stickerAsset(s);
    editor?.insertImage(id, 256, 256, { sticker: true, width: 56 });
  }

  async function paste() {
    if (!editor) return;
    tool = 'lasso';
    await tick();
    editor.paste();
  }

  async function insertFiles(files: File[]) {
    const pages = await pagesForInsertion(files);
    if (pages.length) editor?.insertPages(pages);
  }

  const docItems = (): MenuItem[] => [
    { label: 'Insérer un PDF ou des images…', icon: FileInput, action: async () => insertFiles(await pickFiles('.pdf,application/pdf,image/*')) },
    { separator: true },
    { label: 'Exporter en PDF', icon: FileDown, action: () => editor && exportNotebookPdf(editor.doc, true) },
    { label: 'Exporter en PDF sans annotations', icon: FileDown, action: () => editor && exportNotebookPdf(editor.doc, false) },
    { label: 'Sauvegarder (.papier)', icon: Archive, action: () => record && exportNotebookArchive($state.snapshot(record)) },
  ];

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dropping = false;
    const files = [...(e.dataTransfer?.files ?? [])];
    if (files.length) void insertFiles(files);
  }

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
    } else if (mod && key === 'c' && editor.selection()) {
      e.preventDefault();
      editor.copySelection();
    } else if (mod && key === 'x' && editor.selection()) {
      e.preventDefault();
      editor.cutSelection();
    } else if (mod && key === 'd' && editor.selection()) {
      e.preventDefault();
      editor.duplicateSelection();
    } else if (mod && key === 'v' && hasClipboard()) {
      e.preventDefault();
      void paste();
    } else if (mod && key === 'a') {
      e.preventDefault();
      tool = 'lasso';
      void tick().then(() => editor?.selectAll());
    } else if ((key === 'delete' || key === 'backspace') && editor.selection()) {
      e.preventDefault();
      editor.deleteSelection();
    } else if (key === 'escape' && editor.selection()) {
      editor.clearSelection();
    } else if (!mod && !e.altKey) {
      if (key === 'p') tool = 'pen';
      else if (key === 'c') tool = 'pencil';
      else if (key === 't') tool = 'text';
      else if (key === 'l') tool = 'lasso';
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
      {canPaste}
      onpaste={paste}
      {docItems}
      oninsertimage={insertImage}
      onsticker={insertSticker}
    />
    <div class="workspace">
      <div
        class="canvas-host"
        class:dropping
        bind:this={container}
        data-tool={tool}
        role="application"
        aria-label="Page du carnet"
        ondragover={(e) => {
          if (e.dataTransfer?.types.includes('Files')) {
            e.preventDefault();
            dropping = true;
          }
        }}
        ondragleave={() => (dropping = false)}
        ondrop={onDrop}
      ></div>
      {#if editor && selection && tool === 'lasso' && selectionVisible(selection)}
        <SelectionBar {editor} info={selection} />
      {/if}
      {#if editor}
        <TextEditor {editor} req={textReq} {es} bind:textarea />
      {/if}
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
  .canvas-host[data-tool='lasso'] {
    cursor: default;
  }
  .canvas-host[data-tool='text'] {
    cursor: text;
  }
  .canvas-host.dropping {
    outline: 3px dashed var(--accent);
    outline-offset: -8px;
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
