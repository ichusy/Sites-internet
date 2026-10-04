<script lang="ts">
  import { Copy, Eye, Link, PenLine, Trash2 } from '@lucide/svelte';
  import type { NotebookRecord } from '../../core/model/types';
  import { apiFetch, apiJson } from '../../sync/api';
  import { syncState } from '../../sync/sync.svelte';
  import Dialog from '../common/Dialog.svelte';
  import { showToast } from '../common/toast.svelte';

  interface Props {
    notebook: NotebookRecord;
    onclose: () => void;
  }
  let { notebook, onclose }: Props = $props();

  interface ShareLink {
    token: string;
    mode: 'view' | 'edit';
    url: string;
    createdAt?: number;
  }

  let links = $state<ShareLink[]>([]);
  let loading = $state(true);
  let error = $state('');
  let busy = $state(false);

  const account = $derived(syncState.account);
  const base = $derived(`/api/notebooks/${encodeURIComponent(notebook.id)}/shares`);

  async function load() {
    if (!account) return;
    loading = true;
    error = '';
    try {
      links = (await apiJson<{ shares: ShareLink[] }>(account.server, base, { auth: { token: account.token } })).shares;
    } catch (err) {
      error = (err as Error).message;
    } finally {
      loading = false;
    }
  }
  $effect(() => {
    void load();
  });

  async function create(mode: 'view' | 'edit') {
    if (!account) return;
    busy = true;
    try {
      const link = await apiJson<ShareLink>(account.server, base, { auth: { token: account.token }, json: { mode } });
      links = [...links, link];
      await copy(link.url);
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busy = false;
    }
  }

  async function revoke(link: ShareLink) {
    if (!account) return;
    try {
      await apiFetch(account.server, `/api/shares/${link.token}`, { method: 'DELETE', auth: { token: account.token } });
      links = links.filter((l) => l.token !== link.token);
      showToast('Lien désactivé.');
    } catch (err) {
      error = (err as Error).message;
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      showToast('Lien copié.');
    } catch {
      showToast('Copiez le lien affiché.', 'info');
    }
  }
</script>

<Dialog title="Partager « {notebook.title} »" onclose={() => onclose()} cancelLabel="Fermer" onsubmit={() => false} wide>
  <p class="hint">
    Toute personne qui a le lien peut ouvrir le carnet, sans compte. Avec un lien de modification, elle écrit avec vous en temps
    réel. Désactivez un lien pour retirer l’accès.
  </p>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#if loading}
    <p class="hint">Chargement…</p>
  {:else if links.length}
    <ul class="links">
      {#each links as l (l.token)}
        <li>
          <span class="mode">
            {#if l.mode === 'edit'}<PenLine size={15} /> Modification{:else}<Eye size={15} /> Lecture seule{/if}
          </span>
          <input class="input url" readonly value={l.url} aria-label="Lien de partage" onfocus={(e) => e.currentTarget.select()} />
          <button type="button" class="icon-btn" title="Copier" aria-label="Copier le lien" onclick={() => copy(l.url)}><Copy size={16} /></button>
          <button type="button" class="icon-btn danger" title="Désactiver" aria-label="Désactiver le lien" onclick={() => revoke(l)}><Trash2 size={16} /></button>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="hint">Aucun lien pour l’instant.</p>
  {/if}
  <div class="create">
    <button type="button" class="btn" disabled={busy || loading} onclick={() => create('view')}><Link size={15} /> Lien de lecture</button>
    <button type="button" class="btn" disabled={busy || loading} onclick={() => create('edit')}><Link size={15} /> Lien de modification</button>
  </div>
  {#snippet actions()}{/snippet}
</Dialog>

<style>
  .hint {
    margin: 0;
    color: var(--muted);
    font-size: 13.5px;
    line-height: 1.45;
  }
  .error {
    margin: 0;
    color: var(--danger);
    font-size: 13.5px;
  }
  .links {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .links li {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .mode {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 13px;
    width: 118px;
    flex: none;
  }
  .url {
    flex: 1;
    min-width: 0;
    font-size: 12.5px;
    padding: 6px 8px;
  }
  .create {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .danger {
    color: var(--danger);
  }
</style>
