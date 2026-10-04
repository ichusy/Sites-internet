<script lang="ts">
  import {
    Archive, ArchiveRestore, BookPlus, ChevronRight, Clock, Folder, FolderInput, FolderPlus, Library as LibraryIcon,
    Menu as MenuIcon, Pencil, Search, Settings, Star, Trash2, Upload,
  } from '@lucide/svelte';
  import { backupLibrary, importIntoLibrary, pickAndImport } from '../actions';
  import { searchLibrary, type LibraryHit } from '../../core/search/librarySearch';
  import { pickFiles } from '../../io/files';
  import { liveQuery } from 'dexie';
  import { db } from '../../core/storage/db';
  import { createFolder, createNotebook, deleteFolder, moveFolder, renameFolder } from '../../core/storage/library';
  import type { FolderRecord, ID, NotebookRecord } from '../../core/model/types';
  import { askConfirm, askFolder, askNotebook, askText } from '../common/dialogs.svelte';
  import Menu, { type MenuItem } from '../common/Menu.svelte';
  import { go, links, type LibraryView } from '../router.svelte';
  import { settings, type LibrarySort } from '../settings.svelte';
  import FolderTree from './FolderTree.svelte';
  import NotebookCard from './NotebookCard.svelte';

  let { view, folderId }: { view: LibraryView; folderId: ID | null } = $props();

  const foldersQ = liveQuery(() => db.folders.toArray());
  const notebooksQ = liveQuery(() => db.notebooks.toArray());
  const folders = $derived<FolderRecord[]>($foldersQ ?? []);
  const notebooks = $derived<NotebookRecord[]>($notebooksQ ?? []);

  let search = $state('');
  let sidebarOpen = $state(false);

  const currentFolder = $derived(folderId ? folders.find((f) => f.id === folderId) : undefined);

  const breadcrumb = $derived.by(() => {
    const out: FolderRecord[] = [];
    let cur = currentFolder;
    while (cur) {
      out.unshift(cur);
      cur = cur.parentId ? folders.find((f) => f.id === cur!.parentId) : undefined;
    }
    return out;
  });

  const SORTS: { id: LibrarySort; label: string }[] = [
    { id: 'updatedAt', label: 'Modifiés récemment' },
    { id: 'openedAt', label: 'Ouverts récemment' },
    { id: 'createdAt', label: 'Créés récemment' },
    { id: 'title', label: 'Titre (A→Z)' },
  ];

  function sortNotebooks(list: NotebookRecord[]): NotebookRecord[] {
    const key = settings.librarySort;
    return [...list].sort((a, b) =>
      key === 'title' ? a.title.localeCompare(b.title, 'fr', { numeric: true }) : (b[key] ?? 0) - (a[key] ?? 0),
    );
  }

  const query = $derived(search.trim().toLocaleLowerCase('fr'));

  // ── Recherche dans le contenu (texte tapé et PDF de tous les carnets) ──
  let contentHits = $state.raw<LibraryHit[]>([]);
  let contentStatus = $state<string | null>(null);
  let searching = $state(false);

  $effect(() => {
    const q = search.trim();
    if (!q) {
      contentHits = [];
      searching = false;
      return;
    }
    let stale = false;
    searching = true;
    const t = setTimeout(async () => {
      const found = await searchLibrary(q, (msg) => !stale && (contentStatus = msg));
      if (stale) return;
      contentHits = found;
      searching = false;
      contentStatus = null;
    }, 300);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  });

  const shownFolders = $derived.by(() => {
    if (query) return folders.filter((f) => f.name.toLocaleLowerCase('fr').includes(query));
    if (view === 'all' || view === 'folder') {
      return folders
        .filter((f) => f.parentId === (view === 'folder' ? folderId : null))
        .sort((a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true }));
    }
    return [];
  });

  const shownNotebooks = $derived.by(() => {
    if (query) return sortNotebooks(notebooks.filter((n) => n.title.toLocaleLowerCase('fr').includes(query)));
    switch (view) {
      case 'favorites':
        return sortNotebooks(notebooks.filter((n) => n.favorite));
      case 'recent':
        return notebooks
          .filter((n) => n.openedAt > 0)
          .sort((a, b) => b.openedAt - a.openedAt)
          .slice(0, 24);
      case 'folder':
        return sortNotebooks(notebooks.filter((n) => n.folderId === folderId));
      default:
        return sortNotebooks(notebooks.filter((n) => n.folderId === null));
    }
  });

  const heading = $derived(
    query ? 'Résultats' : view === 'favorites' ? 'Favoris' : view === 'recent' ? 'Récents' : (currentFolder?.name ?? 'Bibliothèque'),
  );

  const targetFolder = $derived(view === 'folder' ? folderId : null);

  async function newNotebook() {
    const form = await askNotebook();
    if (!form) return;
    const nb = await createNotebook({ ...form, folderId: targetFolder });
    go(links.notebook(nb.id));
  }

  async function newFolder(parentId: ID | null = targetFolder) {
    const name = await askText('Nouveau dossier', 'Nom du dossier', '', 'Créer');
    if (name) await createFolder(name, parentId);
  }

  function countIn(folder: FolderRecord) {
    return notebooks.filter((n) => n.folderId === folder.id).length + folders.filter((f) => f.parentId === folder.id).length;
  }

  function folderItems(f: FolderRecord): MenuItem[] {
    return [
      { label: 'Renommer', icon: Pencil, action: async () => {
        const name = await askText('Renommer le dossier', 'Nom du dossier', f.name, 'Renommer');
        if (name) await renameFolder(f.id, name);
      } },
      { label: 'Nouveau sous-dossier', icon: FolderPlus, action: () => newFolder(f.id) },
      { label: 'Déplacer vers…', icon: FolderInput, action: async () => {
        const res = await askFolder(`Déplacer « ${f.name} »`, f.id);
        if (res) await moveFolder(f.id, res.folderId);
      } },
      { separator: true },
      { label: 'Supprimer', icon: Trash2, danger: true, action: async () => {
        const ok = await askConfirm('Supprimer le dossier ?', `Le dossier « ${f.name} » sera supprimé. Son contenu remontera d'un niveau, rien n'est perdu.`, 'Supprimer', true);
        if (ok) {
          await deleteFolder(f.id);
          if (folderId === f.id) go(f.parentId ? links.folder(f.parentId) : links.all);
        }
      } },
    ];
  }

  async function importFiles(files?: File[]) {
    const nb = files ? await importIntoLibrary(files, targetFolder) : await pickAndImport(targetFolder);
    if (nb) go(links.notebook(nb.id));
  }

  let dropping = $state(false);

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dropping = false;
    const files = [...(e.dataTransfer?.files ?? [])];
    if (files.length) void importFiles(files);
  }

  const settingsItems = (): MenuItem[] => [
    { header: 'Données' },
    { label: 'Sauvegarder la bibliothèque', icon: Archive, action: backupLibrary },
    { label: 'Restaurer une sauvegarde…', icon: ArchiveRestore, action: async () => importFiles(await pickFiles('.papier,application/zip', true)) },
    { header: 'Thème' },
    { label: 'Automatique', checked: settings.theme === 'system', action: () => (settings.theme = 'system') },
    { label: 'Clair', checked: settings.theme === 'light', action: () => (settings.theme = 'light') },
    { label: 'Sombre', checked: settings.theme === 'dark', action: () => (settings.theme = 'dark') },
    { header: 'Écrire au doigt' },
    { label: 'Auto (désactivé dès qu’un stylet est utilisé)', checked: settings.fingerDrawing === 'auto', action: () => (settings.fingerDrawing = 'auto') },
    { label: 'Toujours', checked: settings.fingerDrawing === 'always', action: () => (settings.fingerDrawing = 'always') },
    { label: 'Jamais (le doigt fait défiler)', checked: settings.fingerDrawing === 'never', action: () => (settings.fingerDrawing = 'never') },
  ];

  const closeSidebar = () => (sidebarOpen = false);
</script>

<div class="library" class:sidebar-open={sidebarOpen}>
  <aside class="sidebar">
    <div class="brand">
      <span class="logo" aria-hidden="true"></span>
      Papier
    </div>
    <nav>
      <a href={links.all} class:current={view === 'all' && !query} onclick={closeSidebar}><LibraryIcon size={18} /> Bibliothèque</a>
      <a href={links.favorites} class:current={view === 'favorites' && !query} onclick={closeSidebar}><Star size={18} /> Favoris</a>
      <a href={links.recent} class:current={view === 'recent' && !query} onclick={closeSidebar}><Clock size={18} /> Récents</a>
    </nav>
    <div class="section-title">
      Dossiers
      <button type="button" class="icon-btn small" aria-label="Nouveau dossier" title="Nouveau dossier" onclick={() => newFolder(null)}>
        <FolderPlus size={16} />
      </button>
    </div>
    <div class="tree">
      {#if folders.length}
        <FolderTree {folders} parentId={null} currentId={folderId} onnavigate={closeSidebar} />
      {:else}
        <p class="hint">Aucun dossier.</p>
      {/if}
    </div>
    <div class="sidebar-footer">
      <Menu items={settingsItems} icon={Settings} label="Réglages" />
    </div>
  </aside>
  <button type="button" class="scrim" aria-label="Fermer le menu" onclick={closeSidebar}></button>

  <main
    class:dropping
    ondragover={(e) => {
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault();
        dropping = true;
      }
    }}
    ondragleave={(e) => {
      if (e.currentTarget === e.target) dropping = false;
    }}
    ondrop={onDrop}
  >
    <header class="topbar">
      <button type="button" class="icon-btn menu-btn" aria-label="Menu" onclick={() => (sidebarOpen = true)}>
        <MenuIcon size={20} />
      </button>
      <label class="search">
        <Search size={16} />
        <span class="sr-only">Rechercher</span>
        <input type="search" placeholder="Rechercher un carnet ou un dossier" bind:value={search} />
      </label>
      <div class="spacer"></div>
      <button type="button" class="btn" title="Importer des PDF, des images ou une sauvegarde .papier" onclick={() => importFiles()}>
        <Upload size={16} /> <span class="label">Importer</span>
      </button>
      <button type="button" class="btn" onclick={() => newFolder()}>
        <FolderPlus size={16} /> <span class="label">Dossier</span>
      </button>
      <button type="button" class="btn primary" onclick={newNotebook}>
        <BookPlus size={16} /> <span class="label">Carnet</span>
      </button>
    </header>

    <div class="content">
      <div class="heading">
        <div class="crumbs">
          {#if view === 'folder' && !query}
            <a href={links.all}>Bibliothèque</a>
            {#each breadcrumb as f, i (f.id)}
              <ChevronRight size={14} />
              {#if i < breadcrumb.length - 1}
                <a href={links.folder(f.id)}>{f.name}</a>
              {:else}
                <h1>{f.name}</h1>
              {/if}
            {/each}
          {:else}
            <h1>{heading}</h1>
          {/if}
        </div>
        {#if view !== 'recent' || query}
          <label class="sort">
            <span class="sr-only">Trier</span>
            <select bind:value={settings.librarySort}>
              {#each SORTS as s (s.id)}
                <option value={s.id}>{s.label}</option>
              {/each}
            </select>
          </label>
        {/if}
        {#if currentFolder && !query}
          <Menu items={() => folderItems(currentFolder)} label="Actions du dossier" />
        {/if}
      </div>

      {#if shownFolders.length}
        <section class="folders">
          {#each shownFolders as f (f.id)}
            <div class="folder-card">
              <a href={links.folder(f.id)}>
                <Folder size={20} />
                <span class="name">{f.name}</span>
                <span class="count">{countIn(f)}</span>
              </a>
              <Menu items={() => folderItems(f)} label="Actions du dossier" />
            </div>
          {/each}
        </section>
      {/if}

      {#if shownNotebooks.length}
        <section class="grid">
          {#each shownNotebooks as nb (nb.id)}
            <NotebookCard {nb} />
          {/each}
        </section>
      {/if}

      {#if query}
        <section class="content-hits" aria-label="Résultats dans le contenu">
          <h2>Dans le contenu</h2>
          {#if contentStatus}<p class="hint">{contentStatus}</p>{/if}
          {#if contentHits.length}
            <ol>
              {#each contentHits as h (h.notebookId + h.pageIndex)}
                <li>
                  <a href={links.notebook(h.notebookId, { q: search.trim(), page: h.pageIndex })}>
                    <span class="where">{h.title} · page {h.pageIndex + 1}{h.source === 'pdf' ? ' · PDF' : ''}</span>
                    <span class="snippet">{h.snippet.before}<mark>{h.snippet.match}</mark>{h.snippet.after}</span>
                  </a>
                </li>
              {/each}
            </ol>
          {:else if searching}
            <p class="hint">Recherche…</p>
          {:else}
            <p class="hint">Aucun résultat dans le texte tapé ni dans les PDF.</p>
          {/if}
        </section>
      {:else if !shownNotebooks.length && !shownFolders.length}
        <div class="empty">
          {#if view === 'favorites'}
            <p>Aucun favori. Touchez l’étoile d’un carnet pour l’ajouter ici.</p>
          {:else if view === 'recent'}
            <p>Les carnets que vous ouvrez apparaîtront ici.</p>
          {:else}
            <p>Ce dossier est vide.</p>
            <div class="empty-actions">
              <button type="button" class="btn primary" onclick={newNotebook}><BookPlus size={16} /> Créer un carnet</button>
              <button type="button" class="btn" onclick={() => importFiles()}><Upload size={16} /> Importer un PDF</button>
            </div>
            <p class="hint-drop">Vous pouvez aussi glisser des PDF ou des images ici.</p>
          {/if}
        </div>
      {/if}
    </div>
  </main>
</div>

<style>
  .library {
    display: flex;
    height: 100%;
  }
  .sidebar {
    width: 250px;
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 14px 10px;
    background: var(--surface);
    border-right: 1px solid var(--border);
    overflow: auto;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    font-weight: 700;
    font-size: 18px;
    padding: 4px 8px 14px;
  }
  .logo {
    width: 22px;
    height: 26px;
    border-radius: 3px 6px 6px 3px;
    background: var(--accent);
    box-shadow: inset 4px 0 0 rgb(0 0 0 / 0.2);
  }
  nav {
    display: flex;
    flex-direction: column;
  }
  nav a {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-radius: 8px;
    color: inherit;
    text-decoration: none;
  }
  nav a:hover {
    background: var(--surface-2);
  }
  nav a.current {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .section-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 14px;
    padding: 0 4px 0 10px;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
  }
  .icon-btn.small {
    width: 28px;
    height: 28px;
  }
  .tree {
    flex: 1;
  }
  .hint {
    color: var(--muted);
    font-size: 13px;
    padding: 0 10px;
  }
  .sidebar-footer {
    display: flex;
    padding-top: 8px;
  }
  .scrim {
    display: none;
  }
  main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .topbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 20px;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }
  .menu-btn {
    display: none;
  }
  .search {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 10px;
    width: min(380px, 100%);
    min-width: 0;
    border-radius: 8px;
    background: var(--surface-2);
    color: var(--muted);
  }
  .search input {
    flex: 1;
    min-width: 0;
    border: none;
    background: none;
    padding: 8px 0;
    outline: none;
    color: var(--text);
  }
  .spacer {
    flex: 1;
  }
  .content {
    flex: 1;
    overflow: auto;
    padding: 20px 24px 40px;
  }
  .heading {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 18px;
  }
  .crumbs {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    color: var(--muted);
  }
  .crumbs a {
    color: var(--muted);
    text-decoration: none;
  }
  .crumbs a:hover {
    color: var(--text);
  }
  h1 {
    margin: 0;
    font-size: 22px;
    font-weight: 650;
    color: var(--text);
  }
  .sort select {
    padding: 6px 8px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--surface);
  }
  .folders {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 10px;
    margin-bottom: 24px;
  }
  .folder-card {
    display: flex;
    align-items: center;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding-right: 4px;
  }
  .folder-card a {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 6px 12px 14px;
    color: inherit;
    text-decoration: none;
  }
  .folder-card .name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .folder-card .count {
    font-size: 12px;
    color: var(--muted);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 28px 22px;
  }
  main.dropping {
    outline: 3px dashed var(--accent);
    outline-offset: -8px;
    background: var(--accent-soft);
  }
  .empty-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: center;
  }
  .hint-drop {
    font-size: 13px;
  }
  .content-hits {
    margin-top: 28px;
    max-width: 760px;
  }
  .content-hits h2 {
    font-size: 15px;
    font-weight: 650;
    margin: 0 0 8px;
  }
  .content-hits ol {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .content-hits a {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 9px 12px;
    border-radius: 8px;
    color: inherit;
    text-decoration: none;
  }
  .content-hits a:hover {
    background: var(--surface);
  }
  .where {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--muted);
  }
  .snippet {
    font-size: 14px;
    overflow-wrap: anywhere;
  }
  .content-hits mark {
    background: #ffd60a;
    color: #1f2430;
    border-radius: 2px;
    padding: 0 1px;
  }
  .content-hits .hint {
    color: var(--muted);
    font-size: 13px;
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 60px 20px;
    color: var(--muted);
    text-align: center;
  }

  @media (max-width: 760px) {
    .sidebar {
      position: fixed;
      inset: 0 auto 0 0;
      z-index: 50;
      transform: translateX(-100%);
      transition: transform 0.2s;
      box-shadow: var(--shadow);
    }
    .sidebar-open .sidebar {
      transform: none;
    }
    .sidebar-open .scrim {
      display: block;
      position: fixed;
      inset: 0;
      z-index: 40;
      background: rgb(0 0 0 / 0.3);
    }
    .menu-btn {
      display: inline-flex;
    }
    .topbar {
      padding: 8px 12px;
    }
    .topbar .label {
      display: none;
    }
    .content {
      padding: 16px;
    }
    .grid {
      grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
      gap: 22px 16px;
    }
  }
</style>
