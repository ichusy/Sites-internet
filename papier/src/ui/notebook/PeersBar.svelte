<script lang="ts">
  import { Eye } from '@lucide/svelte';
  import type { Peer } from '../../engine/Editor';

  interface Props {
    peers: Peer[];
    /** Carnet reçu en lecture seule. */
    readOnly: boolean;
    /** Propriétaire d'un carnet partagé. */
    owner: string;
  }
  let { peers, readOnly, owner }: Props = $props();

  const initials = (name: string) =>
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join('') || '?';
</script>

{#if peers.length || readOnly}
  <div class="peers" role="status" aria-label="Personnes connectées">
    {#if readOnly}
      <span class="ro" title={owner ? `Partagé par ${owner}` : undefined}><Eye size={14} /> Lecture seule</span>
    {/if}
    {#each peers.slice(0, 6) as p (p.id)}
      <span class="avatar" style:background={p.color} title="{p.name} est sur ce carnet">{initials(p.name)}</span>
    {/each}
    {#if peers.length > 6}<span class="more">+{peers.length - 6}</span>{/if}
  </div>
{/if}

<style>
  .peers {
    position: absolute;
    z-index: 14;
    top: 10px;
    left: 12px;
    display: flex;
    align-items: center;
    gap: 4px;
    pointer-events: auto;
  }
  .avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    color: #fff;
    font-size: 11.5px;
    font-weight: 700;
    display: grid;
    place-items: center;
    border: 2px solid var(--surface);
    box-shadow: var(--shadow);
  }
  .more {
    font-size: 12px;
    color: var(--muted);
  }
  .ro {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 10px;
    border-radius: 999px;
    background: var(--surface);
    border: 1px solid var(--border);
    box-shadow: var(--shadow);
    font-size: 12.5px;
    color: var(--muted);
  }
</style>
