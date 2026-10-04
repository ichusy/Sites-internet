<script lang="ts">
  import { History } from '@lucide/svelte';
  import type { NotebookRecord } from '../../core/model/types';
  import { createNotebookFromState } from '../../core/storage/library';
  import { apiFetch, apiJson } from '../../sync/api';
  import { syncState } from '../../sync/sync.svelte';
  import Dialog from '../common/Dialog.svelte';
  import { showToast } from '../common/toast.svelte';
  import { go, links } from '../router.svelte';

  interface Props {
    notebook: NotebookRecord;
    onclose: () => void;
  }
  let { notebook, onclose }: Props = $props();

  interface Version {
    id: number;
    createdAt: number;
    size: number;
  }

  let versions = $state<Version[]>([]);
  let loading = $state(true);
  let error = $state('');
  let busy = $state<number | null>(null);

  const room = $derived(`/api/doc/nb-${encodeURIComponent(notebook.id)}/versions`);

  $effect(() => {
    const a = syncState.account;
    if (!a) return;
    void apiJson<{ versions: Version[] }>(a.server, room, { auth: { token: a.token } })
      .then((r) => (versions = r.versions))
      .catch((err) => (error = (err as Error).message))
      .finally(() => (loading = false));
  });

  const fmt = (t: number) => new Date(t).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  async function restore(v: Version) {
    const a = syncState.account;
    if (!a) return;
    busy = v.id;
    try {
      const data = new Uint8Array(await (await apiFetch(a.server, `${room}/${v.id}`, { auth: { token: a.token } })).arrayBuffer());
      const day = new Date(v.createdAt).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      const copy = await createNotebookFromState($state.snapshot(notebook) as NotebookRecord, data, `${notebook.title} (version du ${day})`);
      showToast('Copie créée à partir de cette version.');
      onclose();
      go(links.notebook(copy.id));
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busy = null;
    }
  }
</script>

<Dialog title="Historique de « {notebook.title} »" onclose={() => onclose()} cancelLabel="Fermer" onsubmit={() => false}>
  <p class="hint">
    Le serveur garde une version par heure de modification (toutes celles des deux derniers jours, puis une par jour pendant un mois,
    puis une par semaine). Une version s’ouvre comme une copie : le carnet actuel n’est pas modifié.
  </p>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#if loading}
    <p class="hint">Chargement…</p>
  {:else if !versions.length}
    <p class="hint">Pas encore de version enregistrée.</p>
  {:else}
    <ul class="versions">
      {#each versions as v (v.id)}
        <li>
          <span>{fmt(v.createdAt)}</span>
          <button type="button" class="btn small" disabled={busy !== null} onclick={() => restore(v)}>
            <History size={14} />
            {busy === v.id ? 'Création…' : 'Ouvrir une copie'}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
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
  }
  .versions {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 50vh;
    overflow: auto;
  }
  .versions li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 2px;
    border-bottom: 1px solid var(--border);
    font-size: 14px;
  }
  .small {
    padding: 4px 10px;
    font-size: 13px;
  }
</style>
