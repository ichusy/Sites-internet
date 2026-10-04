<script lang="ts">
  import { onMount, type Snippet } from 'svelte';

  interface Props {
    title: string;
    /** Appelé à la fermeture ; `submitted` vaut true si le formulaire a été validé. */
    onclose: (submitted: boolean) => void;
    children: Snippet;
    actions: Snippet;
    wide?: boolean;
    /** Libellé du bouton de fermeture (« Annuler » par défaut). */
    cancelLabel?: string;
    /** Validation (touche Entrée) : renvoyer false garde la boîte ouverte. */
    onsubmit?: () => boolean | void;
  }
  let { title, onclose, children, actions, wide = false, cancelLabel = 'Annuler', onsubmit }: Props = $props();

  let el: HTMLDialogElement;
  let submitted = false;

  onMount(() => el.showModal());

  function submit(e: SubmitEvent) {
    e.preventDefault();
    if (onsubmit && onsubmit() === false) return;
    submitted = true;
    el.close();
  }
</script>

<dialog
  bind:this={el}
  class:wide
  onclose={() => onclose(submitted)}
  onclick={(e) => e.target === el && el.close()}
>
  <form onsubmit={submit}>
    <h2>{title}</h2>
    <div class="body">{@render children()}</div>
    <div class="actions">
      <button type="button" class="btn" onclick={() => el.close()}>{cancelLabel}</button>
      {@render actions()}
    </div>
  </form>
</dialog>

<style>
  dialog {
    border: none;
    border-radius: 14px;
    padding: 0;
    width: min(420px, calc(100vw - 32px));
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow);
  }
  dialog.wide {
    width: min(560px, calc(100vw - 32px));
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.35);
  }
  form {
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    max-height: calc(100dvh - 48px);
    overflow: auto;
  }
  h2 {
    margin: 0;
    font-size: 17px;
    font-weight: 600;
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
</style>
