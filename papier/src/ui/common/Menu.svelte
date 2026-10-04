<script lang="ts" module>
  import type { Component } from 'svelte';

  export type MenuItem =
    | { label: string; action: () => void; icon?: Component; danger?: boolean; disabled?: boolean; checked?: boolean }
    | { header: string }
    | { separator: true };
</script>

<script lang="ts">
  import { Ellipsis } from '@lucide/svelte';
  import { tick } from 'svelte';

  interface Props {
    items: MenuItem[] | (() => MenuItem[]);
    label?: string;
    icon?: Component;
    btnClass?: string;
  }
  let { items, label = 'Plus d’actions', icon: Icon = Ellipsis, btnClass = 'icon-btn' }: Props = $props();

  let open = $state(false);
  let btn: HTMLButtonElement;
  let menu = $state<HTMLDivElement>();
  let pos = $state({ x: 0, y: 0 });
  let list = $state<MenuItem[]>([]);

  async function toggle(e: MouseEvent) {
    e.stopPropagation();
    if (open) return close();
    list = typeof items === 'function' ? items() : items;
    open = true;
    await tick();
    const r = btn.getBoundingClientRect();
    const m = menu!.getBoundingClientRect();
    let x = r.right - m.width;
    if (x < 8) x = Math.min(r.left, window.innerWidth - m.width - 8);
    let y = r.bottom + 4;
    if (y + m.height > window.innerHeight - 8) y = Math.max(8, r.top - m.height - 4);
    pos = { x, y };
  }

  function close() {
    open = false;
  }

  function onWindowDown(e: PointerEvent) {
    if (open && menu && !menu.contains(e.target as Node) && !btn.contains(e.target as Node)) close();
  }
</script>

<svelte:window onpointerdown={onWindowDown} onkeydown={(e) => e.key === 'Escape' && close()} onresize={close} />

<button bind:this={btn} type="button" class={btnClass} aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} onclick={toggle}>
  <Icon size={18} />
</button>

{#if open}
  <div bind:this={menu} class="menu" role="menu" style:left="{pos.x}px" style:top="{pos.y}px">
    {#each list as item, i (i)}
      {#if 'separator' in item}
        <hr />
      {:else if 'header' in item}
        <div class="header">{item.header}</div>
      {:else}
        <button
          type="button"
          role="menuitem"
          class:danger={item.danger}
          disabled={item.disabled}
          onclick={(e) => {
            e.stopPropagation();
            close();
            item.action();
          }}
        >
          {#if item.icon}<item.icon size={16} />{:else}<span class="spacer"></span>{/if}
          <span class="text">{item.label}</span>
          {#if item.checked}<span class="check">✓</span>{/if}
        </button>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .menu {
    position: fixed;
    z-index: 100;
    min-width: 200px;
    max-height: calc(100dvh - 16px);
    overflow: auto;
    padding: 6px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: var(--shadow);
    display: flex;
    flex-direction: column;
  }
  .menu button {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-radius: 6px;
    text-align: left;
    font-size: 14px;
  }
  .menu button:hover:not(:disabled) {
    background: var(--surface-2);
  }
  .menu .danger {
    color: var(--danger);
  }
  .spacer {
    width: 16px;
  }
  .text {
    flex: 1;
  }
  .check {
    color: var(--accent);
  }
  .header {
    padding: 6px 10px 2px;
    font-size: 12px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  hr {
    border: none;
    border-top: 1px solid var(--border);
    margin: 4px 0;
  }
</style>
