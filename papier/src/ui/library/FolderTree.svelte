<script lang="ts">
  import { ChevronRight, Folder } from '@lucide/svelte';
  import type { FolderRecord, ID } from '../../core/model/types';
  import { links } from '../router.svelte';
  import FolderTree from './FolderTree.svelte';

  interface Props {
    folders: FolderRecord[];
    parentId: ID | null;
    currentId: ID | null;
    depth?: number;
    onnavigate?: () => void;
  }
  let { folders, parentId, currentId, depth = 0, onnavigate }: Props = $props();

  const children = $derived(
    folders.filter((f) => f.parentId === parentId).sort((a, b) => a.name.localeCompare(b.name, 'fr')),
  );

  /** Dossiers dépliés, mémorisés pour la session. */
  let expanded = $state<Record<string, boolean>>({});

  function containsCurrent(id: ID): boolean {
    let cur = currentId;
    const byId = new Map(folders.map((f) => [f.id, f]));
    while (cur) {
      if (cur === id) return true;
      cur = byId.get(cur)?.parentId ?? null;
    }
    return false;
  }
</script>

<ul>
  {#each children as f (f.id)}
    {@const hasChildren = folders.some((c) => c.parentId === f.id)}
    {@const open = expanded[f.id] ?? containsCurrent(f.id)}
    <li>
      <div class="row" class:current={f.id === currentId} style:padding-left="{6 + depth * 14}px">
        <button
          type="button"
          class="toggle"
          class:open
          class:hidden={!hasChildren}
          aria-label={open ? 'Replier' : 'Déplier'}
          onclick={() => (expanded[f.id] = !open)}
        >
          <ChevronRight size={14} />
        </button>
        <a href={links.folder(f.id)} onclick={() => onnavigate?.()}>
          <Folder size={16} />
          <span>{f.name}</span>
        </a>
      </div>
      {#if hasChildren && open}
        <FolderTree {folders} parentId={f.id} {currentId} depth={depth + 1} {onnavigate} />
      {/if}
    </li>
  {/each}
</ul>

<style>
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .row {
    display: flex;
    align-items: center;
    border-radius: 8px;
  }
  .row:hover {
    background: var(--surface-2);
  }
  .row.current {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .toggle {
    width: 22px;
    height: 30px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--muted);
    transition: transform 0.15s;
    flex: none;
  }
  .toggle.open {
    transform: rotate(90deg);
  }
  .toggle.hidden {
    visibility: hidden;
  }
  a {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 6px 6px 2px;
    color: inherit;
    text-decoration: none;
  }
  a span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
