<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import type { NotebookRecord } from '../../core/model/types';
  import { db } from '../../core/storage/db';
  import { updateNotebook } from '../../core/storage/library';
  import { openNotebook, type OpenNotebook } from '../../core/storage/notebookStore';
  import { Archive, FileDown, FileInput, History, Share2 } from '@lucide/svelte';
  import { listPages } from '../../core/model/notebookDoc';
  import { syncEngine, syncState, type LiveConnection } from '../../sync/sync.svelte';
  import { Presence, colorFor } from './presence.svelte';
  import PeersBar from './PeersBar.svelte';
  import ShareDialog from '../sync/ShareDialog.svelte';
  import HistoryDialog from '../sync/HistoryDialog.svelte';
  import { guestName } from '../sync/guest';
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
  import SidePanel, { type PanelTab } from './SidePanel.svelte';
  import OutlinePanel, { type PdfOutline } from './OutlinePanel.svelte';
  import SearchPanel from './SearchPanel.svelte';
  import type { PageHits } from '../../engine/search';
  import type { ID, PdfLink, PdfMetaRecord, PdfOutlineNode, PdfTextItem } from '../../core/model/types';
  import { ensurePdfAnalyzed, pdfPageTexts } from '../../pdf/analyze';
  import { askConfirm } from '../common/dialogs.svelte';
  import Toolbar from './Toolbar.svelte';
  import AudioPanel from './AudioPanel.svelte';
  import AudioDock from './AudioDock.svelte';
  import { NotebookAudio } from './audio.svelte';
  import { searchTranscripts, type AudioHit } from '../../core/search/audioSearch';
  import { parseQuery } from '../../core/search/match';

  let { id, q, page }: { id: string; q?: string; page?: number } = $props();

  const PANEL_KEY = 'papier-side-panel';

  let record = $state<NotebookRecord | null>(null);
  let missing = $state(false);
  let editor = $state.raw<Editor | null>(null);
  let es = $state<EditorState>({ canUndo: false, canRedo: false, pageCount: 0, currentPage: 0, zoom: 1 });
  let tool = $state<ToolName>('pen');
  let panel = $state<PanelTab | null>(readPanelPref());
  let searchQuery = $state('');
  let searchInput = $state<HTMLInputElement>();
  let hits = $state.raw<PageHits[]>([]);
  let activeHit = $state(-1);
  let outlines = $state.raw<PdfOutline[]>([]);
  let pdfLoading = $state(false);
  /** Tableau blanc infini (pas de pages). */
  let infinite = $state(false);
  /** Page à mettre en avant une fois la recherche (venue de la bibliothèque) calculée. */
  let pendingFocusPage: number | undefined = untrack(() => page);
  let container = $state<HTMLDivElement>();
  let selection = $state<SelectionInfo | null>(null);
  let canPaste = $state(hasClipboard());
  let dropping = $state(false);
  let textReq = $state<TextEditRequest | null>(null);
  let textarea = $state<HTMLTextAreaElement>();
  let audio = $state.raw<NotebookAudio | null>(null);
  /** Carnet synchronisé dont le contenu n'a pas encore pu être téléchargé (hors ligne). */
  let notDownloaded = $state(false);
  let loadingRemote = $state(false);
  let presence = $state.raw<Presence | null>(null);
  let shareOpen = $state(false);
  let historyOpen = $state(false);
  /** Carnet reçu par un lien en lecture seule. */
  const readOnly = $derived(record?.share?.mode === 'view');
  const synced = $derived(!!record && (!!record.share || !!syncState.account));
  /** Outil repris quand on quitte le mode « toucher pour écouter ». */
  let toolBeforeListen: ToolName = 'pen';
  const listening = $derived(tool === 'listen');

  function setListening(on: boolean) {
    if (readOnly) return;
    if (on && tool !== 'listen') {
      toolBeforeListen = tool;
      tool = 'listen';
    } else if (!on && tool === 'listen') tool = toolBeforeListen;
  }

  // Sélection écrite pendant un enregistrement : bouton « Écouter » dans la barre de sélection.
  const canListenSelection = $derived(!!selection && !!audio && !!editor && audio.recordings.length > 0 && audio.hasAudio(editor.selectedElements()));

  const audioHits = $derived<AudioHit[]>(audio && panel === 'search' ? searchTranscripts(audio.recordings, parseQuery(searchQuery)) : []);

  async function openAudioHit(h: AudioHit) {
    const rec = audio?.recordings.find((r) => r.id === h.recordingId);
    if (rec) await audio!.play(rec, h.start);
  }

  function readPanelPref(): PanelTab | null {
    try {
      const v = localStorage.getItem(PANEL_KEY);
      if (v === 'pages' || v === 'outline' || v === 'search' || v === 'audio') return v;
      if (v === 'none') return null;
      return window.innerWidth > 1000 ? 'pages' : null;
    } catch {
      return null;
    }
  }

  // ── Données des PDF (texte, sommaire, liens), mises en cache pour la durée de la vue ──
  const pdfMetas = new Map<ID, PdfMetaRecord>();
  const pdfTexts = new Map<string, PdfTextItem[]>();

  async function loadPdfData(ed: Editor) {
    const assets: ID[] = [];
    for (const l of ed.pages()) {
      const bg = ed.scene(l.id)?.page.background;
      if (bg?.kind === 'pdf' && !assets.includes(bg.assetId)) assets.push(bg.assetId);
    }
    const missing = assets.filter((a) => !pdfMetas.has(a));
    if (missing.length) {
      pdfLoading = true;
      for (const a of missing) {
        const meta = await ensurePdfAnalyzed(a);
        if (!meta) continue;
        pdfMetas.set(a, meta);
        for (const rec of await pdfPageTexts(a)) pdfTexts.set(rec.id, rec.items);
      }
      pdfLoading = false;
    }
    if (editor !== ed) return;
    outlines = assets.filter((a) => pdfMetas.has(a)).map((a) => ({ assetId: a, name: pdfMetas.get(a)!.name, outline: pdfMetas.get(a)!.outline }));
    ed.setPdfData({
      text: (a, p) => pdfTexts.get(`${a}#${p}`) ?? null,
      links: (a, p): PdfLink[] => pdfMetas.get(a)?.links[p] ?? [],
    });
  }

  async function openExternal(url: string) {
    if (await askConfirm('Ouvrir le lien ?', url, 'Ouvrir')) window.open(url, '_blank', 'noopener');
  }

  function goToOutline(assetId: ID, node: PdfOutlineNode) {
    if (node.url) void openExternal(node.url);
    else if (node.pageIndex !== undefined) editor?.goToPdfPage(assetId, node.pageIndex, node.top);
  }

  async function openSearch() {
    panel = 'search';
    await tick();
    searchInput?.focus();
    searchInput?.select();
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
      // Carnet synchronisé : on récupère d'abord la dernière version (8 s au plus).
      const managed = syncEngine.manages(rec);
      if (managed) {
        loadingRemote = true;
        await syncEngine.prepare(rec);
        loadingRemote = false;
        if (cancelled) return;
      }
      opened = await openNotebook(rec, { init: !managed });
      if (cancelled) {
        await opened.close();
        return;
      }
      if (managed && !listPages(opened.doc).length) {
        // Jamais téléchargé et serveur injoignable : on ne crée surtout pas de page vide.
        notDownloaded = true;
        await opened.close();
        opened = null;
        return;
      }
      await tick();
      const ed = new Editor(container!, opened, settings.styles);
      ed.readOnly = rec.share?.mode === 'view';
      if (ed.readOnly) tool = 'listen';
      const live: LiveConnection | null = syncEngine.connectNotebook(rec, opened.doc);
      if (live) {
        const name = syncState.account?.user.name ?? guestName();
        presence = new Presence(live.provider.awareness, ed, container!, { name, color: colorFor(name + live.provider.awareness.clientID) });
      }
      const offState = ed.onState((s) => {
        es = s;
        canPaste = hasClipboard();
      });
      const offSel = ed.onSelection((s) => (selection = s));
      const offTool = ed.onToolChange((t) => (tool = t));
      const offSearch = ed.onSearchResults((h, a) => {
        hits = h;
        activeHit = a;
        if (pendingFocusPage !== undefined) {
          const i = h.findIndex((x) => x.index === pendingFocusPage);
          if (i >= 0) {
            pendingFocusPage = undefined;
            queueMicrotask(() => ed.focusSearchResult(i));
          }
        }
      });
      const offLink = ed.onExternalLink((url) => void openExternal(url));
      const notebookAudio = new NotebookAudio(ed, rec.id);
      const offListen = ed.onListen((el) => void notebookAudio.listenTo([el]));
      const offText = ed.onTextEdit((req) => {
        textReq = req ? { ...req } : null;
        if (!req || !textarea) return;
        // Synchrone, pendant le geste : nécessaire pour ouvrir le clavier sur iPad.
        if (req.kind !== 'sticky') {
          settings.styles.text.color = req.color;
          settings.styles.text.size = req.fontSize;
        }
        textarea.value = req.text;
        textarea.focus();
      });
      unsub = () => {
        offState();
        offSel();
        offTool();
        offText();
        offSearch();
        offLink();
        offListen();
        presence?.destroy();
        presence = null;
        live?.destroy();
      };
      editor = ed;
      audio = notebookAudio;
      infinite = ed.infinite;
      if (infinite && panel === 'pages') panel = null;
      if (page !== undefined) ed.scrollToPage(page);
      if (q) {
        searchQuery = q;
        panel = 'search';
      }
      void loadPdfData(ed);
    })();

    return () => {
      cancelled = true;
      unsub?.();
      editor?.destroy();
      editor = null;
      const a = audio;
      audio = null;
      // L'enregistrement en cours est sauvé dans le carnet avant sa fermeture.
      void (async () => {
        await a?.shutdown();
        await opened?.close();
      })();
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
      localStorage.setItem(PANEL_KEY, panel ?? 'none');
    } catch {
      /* ignoré */
    }
  });

  // Recherche active seulement quand l'onglet Recherche est ouvert (léger délai pendant la frappe).
  $effect(() => {
    const query = panel === 'search' ? searchQuery : '';
    const ed = editor;
    if (!ed) return;
    const t = setTimeout(() => ed.setSearch(query), query ? 150 : 0);
    return () => clearTimeout(t);
  });

  // Nouvelles pages (PDF insérés) : recharge le sommaire et le texte des PDF.
  $effect(() => {
    void es.pageCount;
    const ed = editor;
    if (ed) untrack(() => void loadPdfData(ed));
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
      if (!editor || !textReq || textReq.kind === 'sticky' || (textReq.color === color && textReq.fontSize === size)) return;
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
    ...(record && !record.share && syncState.account
      ? [
          { label: 'Partager…', icon: Share2, action: () => (shareOpen = true) },
          { label: 'Historique des versions…', icon: History, action: () => (historyOpen = true) },
          { separator: true } as MenuItem,
        ]
      : []),
    ...(readOnly
      ? []
      : [
          infinite
            ? { label: 'Insérer des images…', icon: FileInput, action: insertImage }
            : { label: 'Insérer un PDF ou des images…', icon: FileInput, action: async () => insertFiles(await pickFiles('.pdf,application/pdf,image/*')) },
          { separator: true } as MenuItem,
        ]),
    { label: 'Exporter en PDF', icon: FileDown, action: () => editor && exportNotebookPdf(editor.doc, true) },
    ...(infinite
      ? []
      : [{ label: 'Exporter en PDF sans annotations', icon: FileDown, action: () => editor && exportNotebookPdf(editor.doc, false) }]),
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
    // Lecture seule : seulement la navigation, le zoom, la recherche et la lecture audio.
    if (readOnly && !(mod && key === 'f') && !['+', '=', '-', '0', 'pagedown', 'pageup', ' '].includes(key)) return;
    if (mod && key === 'z') {
      e.preventDefault();
      if (e.shiftKey) editor.redo();
      else editor.undo();
    } else if (mod && key === 'f') {
      e.preventDefault();
      void openSearch();
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
      else if (key === 'n') tool = 'sticky';
      else if (key === 'k') tool = 'connector';
      else if (key === 'l') tool = 'lasso';
      else if (key === 'h') tool = 'highlighter';
      else if (key === 'e') tool = 'eraser';
      else if (key === 'r' && audio?.supported && audio.recState === 'idle') void audio.startRecording();
      else if (key === ' ' && audio?.current) {
        e.preventDefault();
        audio.toggle();
      }
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
  {#if missing || notDownloaded}
    <div class="missing">
      {#if notDownloaded}
        <p>Ce carnet n’a pas encore été téléchargé sur cet appareil et le serveur est injoignable.<br />Reconnectez-vous à Internet puis rouvrez-le.</p>
      {:else}
        <p>Ce carnet n’existe pas ou a été supprimé.</p>
      {/if}
      <a class="btn" href={links.all}>Retour à la bibliothèque</a>
    </div>
  {:else}
    <Toolbar
      title={record?.title ?? ''}
      bind:tool
      {es}
      bind:panel
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
      {infinite}
      {readOnly}
      recording={!!audio && audio.recState !== 'idle'}
      canRecord={!!audio?.supported && !readOnly}
      onrecord={() => void audio?.startRecording()}
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
        <SelectionBar {editor} info={selection} canListen={canListenSelection} onlisten={() => void audio?.listenTo(editor!.selectedElements())} />
      {/if}
      {#if editor}
        <TextEditor {editor} req={textReq} {es} bind:textarea />
      {/if}
      {#if audio}
        <AudioDock {audio} panelOpen={panel === 'audio'} {listening} onlisten={setListening} />
      {/if}
      {#if loadingRemote}
        <div class="loading">Synchronisation du carnet…</div>
      {/if}
      {#if presence || readOnly || (synced && record)}
        <PeersBar peers={presence?.peers ?? []} {readOnly} owner={record?.share?.owner ?? ''} />
      {/if}
      {#if editor && panel}
        <SidePanel bind:tab={panel} tabs={infinite ? ['outline', 'search', 'audio'] : undefined}>
          {#if panel === 'pages'}
            <PagesPanel {editor} current={es.currentPage} pageCount={es.pageCount} {readOnly} />
          {:else if panel === 'outline'}
            <OutlinePanel {outlines} loading={pdfLoading} ongo={goToOutline} />
          {:else if panel === 'audio'}
            {#if audio}<AudioPanel {audio} {listening} onlisten={setListening} {readOnly} />{/if}
          {:else}
            <SearchPanel bind:query={searchQuery} bind:input={searchInput} {hits} active={activeHit} pending={pdfLoading} onpick={(i) => editor?.focusSearchResult(i)} {audioHits} onaudio={openAudioHit} />
          {/if}
        </SidePanel>
      {/if}
    </div>
  {/if}
</div>

{#if shareOpen && record}
  <ShareDialog notebook={record} onclose={() => (shareOpen = false)} />
{/if}
{#if historyOpen && record}
  <HistoryDialog notebook={record} onclose={() => (historyOpen = false)} />
{/if}

<style>
  .loading {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    padding: 10px 16px;
    border-radius: 10px;
    background: var(--surface);
    box-shadow: var(--shadow);
    color: var(--muted);
    font-size: 14px;
  }
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
  .canvas-host[data-tool='listen'] {
    cursor: pointer;
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
