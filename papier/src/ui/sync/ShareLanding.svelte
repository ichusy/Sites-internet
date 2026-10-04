<script lang="ts">
  import { onMount } from 'svelte';
  import { defaultTemplate } from '../../core/model/paper';
  import type { NotebookRecord } from '../../core/model/types';
  import { db } from '../../core/storage/db';
  import { apiJson } from '../../sync/api';
  import { syncEngine } from '../../sync/sync.svelte';
  import { go, links } from '../router.svelte';

  let { token }: { token: string } = $props();

  interface ShareInfo {
    notebookId: string;
    mode: 'view' | 'edit';
    title: string;
    owner: string;
    record: Pick<NotebookRecord, 'kind' | 'cover' | 'paper' | 'template'> | null;
  }

  let error = $state('');

  /**
   * Lien de partage (…/#/s/<jeton>) : le carnet est ajouté à cet appareil (marqué « partagé »),
   * puis ouvert. Le lien est servi par le serveur qui héberge le carnet.
   */
  onMount(async () => {
    const server = location.origin;
    try {
      const info = await apiJson<ShareInfo>(server, `/api/shares/${encodeURIComponent(token)}`);
      const existing = await db.notebooks.get(info.notebookId);
      if (existing && !existing.share) {
        // C'est l'un de nos propres carnets.
        go(links.notebook(existing.id));
        return;
      }
      const now = Date.now();
      const share = { server, token, mode: info.mode, owner: info.owner };
      if (existing) await db.notebooks.update(existing.id, { share, title: info.title });
      else {
        const record: NotebookRecord = {
          id: info.notebookId,
          folderId: null,
          title: info.title,
          kind: info.record?.kind ?? 'paged',
          cover: info.record?.cover ?? { color: '#5b6474', pattern: 'plain' },
          favorite: false,
          tags: [],
          pageCount: 0,
          paper: info.record?.paper ?? { width: 595.28, height: 841.89 },
          template: info.record?.template ?? defaultTemplate('blank'),
          createdAt: now,
          updatedAt: now,
          openedAt: now,
          share,
        };
        await db.notebooks.add(record);
      }
      syncEngine.syncNow();
      go(links.notebook(info.notebookId));
    } catch (err) {
      error = (err as Error).message;
    }
  });
</script>

<div class="landing">
  {#if error}
    <p>{error}</p>
    <a class="btn" href={links.all}>Aller à la bibliothèque</a>
  {:else}
    <p>Ouverture du carnet partagé…</p>
  {/if}
</div>

<style>
  .landing {
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    color: var(--muted);
  }
</style>
