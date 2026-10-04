<script lang="ts">
  import { ArrowDown, ArrowUp, Copy, FilePlus, GripVertical, Trash2 } from '@lucide/svelte';
  import { defaultTemplate, TEMPLATE_LABELS } from '../../core/model/paper';
  import type { TemplateKind } from '../../core/model/types';
  import type { Editor } from '../../engine/Editor';
  import type { PageLayout } from '../../engine/layout';
  import Menu, { type MenuItem } from '../common/Menu.svelte';
  import { liveQuery } from 'dexie';
  import { db } from '../../core/storage/db';
  import type { TemplateRecord } from '../../core/model/types';
  import { customTemplateRef, importTemplate } from '../templates';
  import PageThumb from './PageThumb.svelte';

  let { editor, current, pageCount, readOnly = false }: { editor: Editor; current: number; pageCount: number; readOnly?: boolean } = $props();

  // Recalculé quand le nombre de pages change ou que leur ordre/format change.
  let pages = $state.raw<PageLayout[]>([]);
  $effect(() => {
    void pageCount;
    pages = editor.pages();
  });
  $effect(() => editor.onState(() => {
    const next = editor.pages();
    if (next !== pages) pages = next;
  }));

  const customsQ = liveQuery(() => db.templates.orderBy('createdAt').toArray());
  const customs = $derived<TemplateRecord[]>($customsQ ?? []);

  let list: HTMLDivElement;
  let drag = $state<{ from: number; to: number; pointerId: number } | null>(null);

  $effect(() => {
    // Garde la page courante visible dans le panneau.
    const el = list?.querySelector<HTMLElement>(`[data-index="${current}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  });

  function startDrag(e: PointerEvent, index: number) {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag = { from: index, to: index, pointerId: e.pointerId };
  }

  function moveDrag(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const items = [...list.querySelectorAll<HTMLElement>('.page')];
    let to = items.length;
    for (let i = 0; i < items.length; i++) {
      const r = items[i].getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) {
        to = i;
        break;
      }
    }
    drag.to = to;
    // Défilement automatique près des bords.
    const r = list.getBoundingClientRect();
    if (e.clientY < r.top + 40) list.scrollTop -= 12;
    else if (e.clientY > r.bottom - 40) list.scrollTop += 12;
  }

  function endDrag(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const { from, to } = drag;
    drag = null;
    const target = to > from ? to - 1 : to;
    if (target !== from) editor.movePage(from, target);
  }

  function items(p: PageLayout): MenuItem[] {
    const tpl = editor.scene(p.id)?.page.template;
    const kind = tpl?.kind;
    return [
      { label: 'Insérer une page après', icon: FilePlus, action: () => editor.addPage(p.index) },
      { label: 'Dupliquer', icon: Copy, action: () => editor.duplicatePage(p.id) },
      { label: 'Monter', icon: ArrowUp, disabled: p.index === 0, action: () => editor.movePage(p.index, p.index - 1) },
      { label: 'Descendre', icon: ArrowDown, disabled: p.index === pages.length - 1, action: () => editor.movePage(p.index, p.index + 1) },
      { header: 'Modèle' },
      ...(Object.entries(TEMPLATE_LABELS) as [TemplateKind, string][]).map(([k, label]) => ({
        label,
        checked: kind === k,
        action: () => editor.setTemplate(p.id, defaultTemplate(k)),
      })),
      ...customs.map((t) => ({
        label: t.name,
        checked: kind === 'custom' && tpl?.source?.templateId === t.id,
        action: () => editor.setTemplate(p.id, customTemplateRef(t)),
      })),
      {
        label: 'Importer un modèle…',
        action: async () => {
          const t = await importTemplate();
          if (t) editor.setTemplate(p.id, customTemplateRef(t));
        },
      },
      { separator: true },
      { label: 'Supprimer la page', icon: Trash2, danger: true, disabled: pages.length <= 1, action: () => editor.deletePage(p.id) },
    ];
  }
</script>

<div class="panel">
  <div class="list" bind:this={list} onpointermove={moveDrag} onpointerup={endDrag} onpointercancel={() => (drag = null)} role="list">
    {#each pages as p (p.id)}
      {#if drag && drag.to === p.index && drag.to !== drag.from && drag.to !== drag.from + 1}
        <div class="drop"></div>
      {/if}
      <div class="page" class:current={p.index === current} class:dragging={drag?.from === p.index} data-index={p.index} role="listitem">
        <button type="button" class="thumb" onclick={() => editor.scrollToPage(p.index)} aria-label="Aller à la page {p.index + 1}">
          <PageThumb {editor} pageId={p.id} width={104} />
        </button>
        <div class="bar">
          {#if !readOnly}
            <span class="grip" title="Glisser pour déplacer" onpointerdown={(e) => startDrag(e, p.index)} role="presentation">
              <GripVertical size={14} />
            </span>
          {/if}
          <span class="num">{p.index + 1}</span>
          {#if !readOnly}<Menu items={() => items(p)} label="Actions de la page {p.index + 1}" />{/if}
        </div>
      </div>
    {/each}
    {#if drag && drag.to === pages.length && drag.from !== pages.length - 1}
      <div class="drop"></div>
    {/if}
    {#if !readOnly}
      <button type="button" class="add" onclick={() => editor.addPage(pages.length - 1)}>
        <FilePlus size={16} /> Ajouter
      </button>
    {/if}
  </div>
</div>

<style>
  .panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .list {
    flex: 1;
    overflow: auto;
    padding: 12px 10px 24px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
  }
  .page {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 6px 6px 0;
    border-radius: 8px;
    border: 2px solid transparent;
  }
  .page.current {
    border-color: var(--accent);
  }
  .page.dragging {
    opacity: 0.4;
  }
  .thumb {
    padding: 0;
  }
  .bar {
    display: flex;
    align-items: center;
    width: 100%;
    justify-content: space-between;
  }
  .bar :global(.icon-btn) {
    width: 28px;
    height: 28px;
    color: var(--muted);
  }
  .grip {
    display: inline-flex;
    padding: 6px 4px;
    color: var(--muted);
    cursor: grab;
    touch-action: none;
  }
  .num {
    font-size: 12px;
    color: var(--muted);
  }
  .drop {
    width: 100%;
    height: 3px;
    border-radius: 2px;
    background: var(--accent);
    flex: none;
  }
  .add {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-top: 6px;
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px dashed var(--border);
    color: var(--muted);
    font-size: 13px;
  }
  .add:hover {
    background: var(--surface-2);
  }
</style>
