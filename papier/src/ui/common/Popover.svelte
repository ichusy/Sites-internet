<script lang="ts">
  import { tick, type Snippet } from 'svelte';

  interface Props {
    /** Contenu du bouton déclencheur. */
    trigger: Snippet;
    children: Snippet;
    label: string;
    btnClass?: string;
  }
  let { trigger, children, label, btnClass = 'icon-btn' }: Props = $props();

  let open = $state(false);
  let btn: HTMLButtonElement;
  let panel = $state<HTMLDivElement>();
  let pos = $state({ x: 0, y: 0 });

  async function toggle() {
    open = !open;
    if (!open) return;
    await tick();
    const r = btn.getBoundingClientRect();
    const p = panel!.getBoundingClientRect();
    const x = Math.max(8, Math.min(r.left + r.width / 2 - p.width / 2, window.innerWidth - p.width - 8));
    pos = { x, y: r.bottom + 6 };
  }

  function onWindowDown(e: PointerEvent) {
    if (open && panel && !panel.contains(e.target as Node) && !btn.contains(e.target as Node)) open = false;
  }
</script>

<svelte:window onpointerdown={onWindowDown} onkeydown={(e) => e.key === 'Escape' && (open = false)} onresize={() => (open = false)} />

<button bind:this={btn} type="button" class={btnClass} class:active={open} aria-label={label} title={label} aria-expanded={open} onclick={toggle}>
  {@render trigger()}
</button>

{#if open}
  <div bind:this={panel} class="popover" role="dialog" aria-label={label} style:left="{pos.x}px" style:top="{pos.y}px">
    {@render children()}
  </div>
{/if}

<style>
  .popover {
    position: fixed;
    z-index: 100;
    width: min(300px, calc(100vw - 16px));
    max-height: calc(100dvh - 80px);
    overflow: auto;
    padding: 14px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: var(--shadow);
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
</style>
