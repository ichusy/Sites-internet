<script lang="ts">
  import DialogHost from './common/DialogHost.svelte';
  import Library from './library/Library.svelte';
  import NotebookView from './notebook/NotebookView.svelte';
  import { router } from './router.svelte';

  const route = $derived(router.route);
</script>

{#if route.name === 'notebook'}
  {#key route.id}
    <NotebookView id={route.id} />
  {/key}
{:else}
  <Library view={route.view} folderId={route.folderId} />
{/if}

<DialogHost />
