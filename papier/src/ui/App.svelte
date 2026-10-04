<script lang="ts">
  import DialogHost from './common/DialogHost.svelte';
  import Toasts from './common/Toasts.svelte';
  import Library from './library/Library.svelte';
  import NotebookView from './notebook/NotebookView.svelte';
  import ShareLanding from './sync/ShareLanding.svelte';
  import { router } from './router.svelte';

  const route = $derived(router.route);
</script>

{#if route.name === 'notebook'}
  {#key route.id}
    <NotebookView id={route.id} q={route.q} page={route.page} />
  {/key}
{:else if route.name === 'share'}
  <ShareLanding token={route.token} />
{:else}
  <Library view={route.view} folderId={route.folderId} />
{/if}

<DialogHost />
<Toasts />
