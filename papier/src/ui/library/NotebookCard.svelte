<script lang="ts">
  import { Copy, FolderInput, Pencil, Star, Trash2 } from '@lucide/svelte';
  import type { NotebookRecord } from '../../core/model/types';
  import { deleteNotebook, duplicateNotebook, toggleFavorite, updateNotebook } from '../../core/storage/library';
  import { askConfirm, askFolder, askNotebook } from '../common/dialogs.svelte';
  import Menu, { type MenuItem } from '../common/Menu.svelte';
  import { links } from '../router.svelte';
  import Cover from './Cover.svelte';

  let { nb }: { nb: NotebookRecord } = $props();

  const date = $derived(new Date(nb.updatedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }));

  async function edit() {
    const form = await askNotebook(nb);
    if (form) await updateNotebook(nb.id, { title: form.title, cover: form.cover, template: form.template });
  }

  async function move() {
    const res = await askFolder(`Déplacer « ${nb.title} »`);
    if (res) await updateNotebook(nb.id, { folderId: res.folderId });
  }

  async function remove() {
    const ok = await askConfirm('Supprimer le carnet ?', `« ${nb.title} » et toutes ses pages seront définitivement supprimés.`, 'Supprimer', true);
    if (ok) await deleteNotebook(nb.id);
  }

  const items = (): MenuItem[] => [
    { label: 'Renommer, couverture…', icon: Pencil, action: edit },
    { label: nb.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris', icon: Star, action: () => toggleFavorite(nb.id) },
    { label: 'Dupliquer', icon: Copy, action: () => duplicateNotebook(nb.id) },
    { label: 'Déplacer vers…', icon: FolderInput, action: move },
    { separator: true },
    { label: 'Supprimer', icon: Trash2, danger: true, action: remove },
  ];
</script>

<article class="card">
  <a href={links.notebook(nb.id)} class="cover-link" aria-label="Ouvrir {nb.title}">
    <Cover cover={nb.cover} title={nb.title} />
  </a>
  <div class="meta">
    <div class="text">
      <a href={links.notebook(nb.id)} class="title">{nb.title}</a>
      <div class="sub">{nb.pageCount} page{nb.pageCount > 1 ? 's' : ''} · {date}</div>
    </div>
    <button
      type="button"
      class="icon-btn star"
      class:on={nb.favorite}
      aria-label={nb.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
      aria-pressed={nb.favorite}
      onclick={() => toggleFavorite(nb.id)}
    >
      <Star size={16} fill={nb.favorite ? 'currentColor' : 'none'} />
    </button>
    <Menu items={items} />
  </div>
</article>

<style>
  .card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }
  .cover-link {
    display: block;
    transition: transform 0.15s;
  }
  .cover-link:hover {
    transform: translateY(-2px);
  }
  .meta {
    display: flex;
    align-items: flex-start;
    gap: 0;
  }
  .text {
    flex: 1;
    min-width: 0;
  }
  .title {
    display: block;
    color: var(--text);
    text-decoration: none;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sub {
    font-size: 12px;
    color: var(--muted);
  }
  .meta :global(.icon-btn) {
    width: 30px;
    height: 30px;
    color: var(--muted);
  }
  .star.on {
    color: #e0a400;
  }
</style>
