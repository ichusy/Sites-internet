<script lang="ts">
  import { Cloud, CloudAlert, CloudCheck, CloudOff, RefreshCw } from '@lucide/svelte';
  import { syncState } from '../../sync/sync.svelte';

  let { detailed = false, onclick }: { detailed?: boolean; onclick?: () => void } = $props();

  let now = $state(Date.now());
  $effect(() => {
    const t = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(t);
  });

  function ago(t: number) {
    const s = Math.round((now - t) / 1000);
    if (s < 60) return 'à l’instant';
    if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
    return new Date(t).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  const label = $derived.by(() => {
    switch (syncState.status) {
      case 'synced':
        return 'Synchronisé';
      case 'syncing':
        return syncState.pending > 1 ? `Synchronisation… (${syncState.pending})` : 'Synchronisation…';
      case 'connecting':
        return 'Connexion…';
      case 'offline':
        return 'Hors ligne';
      case 'error':
        return 'Problème de synchronisation';
      default:
        return 'Synchronisation désactivée';
    }
  });
</script>

{#if onclick}
  <button type="button" class="status {syncState.status}" title={syncState.error || label} {onclick}>
    {@render icon()}
    <span class="label">{label}</span>
  </button>
{:else}
  <div class="status {syncState.status} detailed" role="status">
    {@render icon()}
    <span>
      {label}{#if syncState.lastSync && detailed}{` · dernière synchronisation ${ago(syncState.lastSync)}`}{/if}
      {#if syncState.error && detailed}<br /><span class="err">{syncState.error}</span>{/if}
    </span>
  </div>
{/if}

{#snippet icon()}
  {#if syncState.status === 'synced'}<CloudCheck size={17} />
  {:else if syncState.status === 'syncing' || syncState.status === 'connecting'}<RefreshCw size={16} class="spin" />
  {:else if syncState.status === 'offline'}<CloudOff size={17} />
  {:else if syncState.status === 'error'}<CloudAlert size={17} />
  {:else}<Cloud size={17} />{/if}
{/snippet}

<style>
  .status {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: var(--muted);
    padding: 6px 8px;
    border-radius: 8px;
  }
  button.status:hover {
    background: var(--surface-2);
  }
  .status.synced {
    color: var(--accent);
  }
  .status.error {
    color: var(--danger);
  }
  .detailed {
    align-items: flex-start;
    padding: 0;
    line-height: 1.4;
  }
  .err {
    color: var(--danger);
  }
  .status :global(.spin) {
    animation: spin 1.2s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (max-width: 700px) {
    button .label {
      display: none;
    }
  }
</style>
