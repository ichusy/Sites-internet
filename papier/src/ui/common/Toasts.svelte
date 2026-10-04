<script lang="ts">
  import { dismissToast, toasts } from './toast.svelte';
</script>

<div class="toasts" aria-live="polite">
  {#each toasts as t (t.id)}
    <div class="toast {t.kind}" role={t.kind === 'error' ? 'alert' : 'status'}>
      {#if t.kind === 'busy'}<span class="spinner" aria-hidden="true"></span>{/if}
      <span>{t.message}</span>
      {#if t.kind !== 'busy'}
        <button type="button" aria-label="Fermer" onclick={() => dismissToast(t.id)}>×</button>
      {/if}
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    left: 50%;
    bottom: max(20px, env(safe-area-inset-bottom));
    transform: translateX(-50%);
    z-index: 200;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    pointer-events: none;
    width: max-content;
    max-width: calc(100vw - 32px);
  }
  .toast {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    border-radius: 10px;
    background: #22252c;
    color: #f4f2ee;
    box-shadow: var(--shadow);
    font-size: 14px;
    pointer-events: auto;
  }
  :global(:root[data-theme='dark']) .toast {
    background: #e6e7ea;
    color: #16181d;
  }
  .toast.error {
    background: var(--danger);
    color: #fff;
  }
  button {
    font-size: 18px;
    line-height: 1;
    opacity: 0.7;
    padding: 0 2px;
  }
  .spinner {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 2px solid currentColor;
    border-right-color: transparent;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
