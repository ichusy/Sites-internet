<script lang="ts">
  import { db } from '../../core/storage/db';
  import { COVER_COLORS, COVER_PATTERNS, PAPER_FORMATS, TEMPLATE_LABELS, defaultTemplate } from '../../core/model/paper';
  import type { CoverPattern, FolderRecord, ID, TemplateKind, TemplateRecord } from '../../core/model/types';
  import { liveQuery } from 'dexie';
  import { X } from '@lucide/svelte';
  import { customTemplateRef, deleteTemplate, importTemplate } from '../templates';
  import Cover from '../library/Cover.svelte';
  import Dialog from './Dialog.svelte';
  import { dialogs } from './dialogs.svelte';

  const req = $derived(dialogs.current);

  // ── Saisie de texte ──
  let text = $state('');
  // ── Carnet ──
  let nbTitle = $state('');
  let coverColor = $state(COVER_COLORS[1]);
  let coverPattern = $state<CoverPattern>('plain');
  let paperId = $state('a4');
  let nbKind = $state<'paged' | 'canvas'>('paged');
  let templateKind = $state<TemplateKind>('lined');
  /** Modèle importé choisi (templateKind = 'custom'). */
  let customId = $state<ID | null>(null);
  const customsQ = liveQuery(() => db.templates.orderBy('createdAt').toArray());
  const customs = $derived<TemplateRecord[]>($customsQ ?? []);
  // ── Dossier ──
  let folders = $state<{ folder: FolderRecord; depth: number }[]>([]);
  let folderChoice = $state<ID | null>(null);

  $effect(() => {
    const r = dialogs.current;
    if (!r) return;
    if (r.kind === 'prompt') text = r.value;
    if (r.kind === 'notebook') {
      nbTitle = r.record?.title ?? '';
      nbKind = r.record?.kind ?? 'paged';
      coverColor = r.record?.cover.color ?? COVER_COLORS[Math.floor(Math.random() * 8)];
      coverPattern = r.record?.cover.pattern ?? 'plain';
      paperId = 'a4';
      templateKind = r.record?.template.kind ?? 'lined';
      customId = r.record?.template.source?.templateId ?? null;
    }
    if (r.kind === 'folder') {
      folderChoice = null;
      void loadFolders(r.exclude);
    }
  });

  async function loadFolders(exclude: ID | null) {
    const all = await db.folders.toArray();
    const out: { folder: FolderRecord; depth: number }[] = [];
    const walk = (parent: ID | null, depth: number) => {
      all
        .filter((f) => f.parentId === parent && f.id !== exclude)
        .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
        .forEach((f) => {
          out.push({ folder: f, depth });
          walk(f.id, depth + 1);
        });
    };
    walk(null, 0);
    folders = out;
  }

  function chosenTemplate(current?: import('../../core/model/types').TemplateRef) {
    if (templateKind === 'custom') {
      const t = customs.find((c) => c.id === customId);
      return t ? customTemplateRef(t) : defaultTemplate('blank');
    }
    return current && current.kind === templateKind ? current : defaultTemplate(templateKind);
  }

  /** Un nouveau carnet sur modèle importé prend le format de ce modèle. */
  function customPaper() {
    const t = templateKind === 'custom' ? customs.find((c) => c.id === customId) : undefined;
    return t ? { width: t.width, height: t.height } : undefined;
  }

  async function addCustom() {
    const t = await importTemplate();
    if (t) {
      templateKind = 'custom';
      customId = t.id;
    }
  }

  function close(submitted: boolean) {
    const r = dialogs.current;
    if (!r) return;
    switch (r.kind) {
      case 'prompt':
        r.resolve(submitted ? text.trim() : null);
        break;
      case 'confirm':
        r.resolve(submitted);
        break;
      case 'folder':
        r.resolve(submitted ? { folderId: folderChoice } : null);
        break;
      case 'notebook': {
        if (!submitted) return r.resolve(null);
        const paper = PAPER_FORMATS.find((p) => p.id === paperId) ?? PAPER_FORMATS[0];
        r.resolve({
          title: nbTitle.trim() || 'Sans titre',
          kind: r.record?.kind ?? nbKind,
          cover: { color: coverColor, pattern: coverPattern },
          paper: r.record?.paper ?? customPaper() ?? { width: paper.width, height: paper.height },
          template: chosenTemplate(r.record?.template),
        });
        break;
      }
    }
  }
</script>

{#if req?.kind === 'prompt'}
  {#key req}
    <Dialog title={req.title} onclose={close}>
      <label class="field">
        {req.label}
        <!-- svelte-ignore a11y_autofocus -->
        <input type="text" bind:value={text} autofocus />
      </label>
      {#snippet actions()}
        <button class="btn primary" type="submit">{req.confirm}</button>
      {/snippet}
    </Dialog>
  {/key}
{:else if req?.kind === 'confirm'}
  {#key req}
    <Dialog title={req.title} onclose={close}>
      <p class="message">{req.message}</p>
      {#snippet actions()}
        <button class="btn primary" class:danger-fill={req.danger} type="submit">{req.confirm}</button>
      {/snippet}
    </Dialog>
  {/key}
{:else if req?.kind === 'folder'}
  {#key req}
    <Dialog title={req.title} onclose={close}>
      <div class="folder-list" role="listbox" aria-label="Dossiers">
        <button type="button" role="option" aria-selected={folderChoice === null} class:selected={folderChoice === null} onclick={() => (folderChoice = null)}>
          Bibliothèque (racine)
        </button>
        {#each folders as { folder, depth } (folder.id)}
          <button
            type="button"
            role="option"
            aria-selected={folderChoice === folder.id}
            class:selected={folderChoice === folder.id}
            style:padding-left="{12 + (depth + 1) * 16}px"
            onclick={() => (folderChoice = folder.id)}
          >
            {folder.name}
          </button>
        {/each}
      </div>
      {#snippet actions()}
        <button class="btn primary" type="submit">Déplacer ici</button>
      {/snippet}
    </Dialog>
  {/key}
{:else if req?.kind === 'notebook'}
  {#key req}
    <Dialog title={req.record ? 'Modifier le carnet' : 'Nouveau carnet'} onclose={close} wide>
      <div class="nb-form">
        <div class="preview">
          <Cover cover={{ color: coverColor, pattern: coverPattern }} title={nbTitle || 'Sans titre'} />
        </div>
        <div class="fields">
          <label class="field">
            Titre
            <!-- svelte-ignore a11y_autofocus -->
            <input type="text" bind:value={nbTitle} placeholder="Ex. Biologie cellulaire" autofocus />
          </label>
          <div class="field">
            Couleur de couverture
            <div class="row">
              {#each COVER_COLORS as c (c)}
                <button type="button" class="swatch" class:selected={coverColor === c} style:background={c} aria-label="Couleur {c}" onclick={() => (coverColor = c)}></button>
              {/each}
              <label class="swatch custom" title="Autre couleur" style:background={coverColor}>
                <input type="color" bind:value={coverColor} class="sr-only" />
                +
              </label>
            </div>
          </div>
          <div class="field">
            Motif
            <div class="row">
              {#each COVER_PATTERNS as p (p.id)}
                <button type="button" class="pattern" class:selected={coverPattern === p.id} title={p.label} onclick={() => (coverPattern = p.id)}>
                  <Cover cover={{ color: coverColor, pattern: p.id }} compact />
                </button>
              {/each}
            </div>
          </div>
          {#if !req.record}
            <div class="field">
              Type
              <div class="row">
                <button type="button" class="chip" class:selected={nbKind === 'paged'} onclick={() => (nbKind = 'paged')}>Carnet de pages</button>
                <button type="button" class="chip" class:selected={nbKind === 'canvas'} onclick={() => (nbKind = 'canvas')}>Tableau blanc infini</button>
              </div>
            </div>
          {/if}
          {#if !req.record && nbKind === 'paged'}
            <label class="field">
              Format
              <select bind:value={paperId}>
                {#each PAPER_FORMATS as f (f.id)}
                  <option value={f.id}>{f.label}</option>
                {/each}
              </select>
            </label>
          {/if}
          {#if nbKind === 'paged'}
          <div class="field">
            Modèle des nouvelles pages
            <div class="row">
              {#each Object.entries(TEMPLATE_LABELS) as [kind, label] (kind)}
                <button type="button" class="chip" class:selected={templateKind === kind} onclick={() => (templateKind = kind as TemplateKind)}>{label}</button>
              {/each}
              {#each customs as t (t.id)}
                <span class="chip custom-chip" class:selected={templateKind === 'custom' && customId === t.id}>
                  <button type="button" onclick={() => ((templateKind = 'custom'), (customId = t.id))}>{t.name}</button>
                  <button type="button" class="chip-x" aria-label="Supprimer le modèle {t.name}" onclick={() => deleteTemplate(t.id)}><X size={12} /></button>
                </span>
              {/each}
              <button type="button" class="chip add-chip" onclick={addCustom}>+ Importer un modèle…</button>
            </div>
          </div>
          {:else}
            <p class="hint">Une surface sans bords pour cartes mentales et schémas : post-its, connecteurs, dessin, texte et images.</p>
          {/if}
        </div>
      </div>
      {#snippet actions()}
        <button class="btn primary" type="submit">{req.record ? 'Enregistrer' : 'Créer'}</button>
      {/snippet}
    </Dialog>
  {/key}
{/if}

<style>
  .hint {
    margin: 0;
    font-size: 13px;
    color: var(--muted);
  }
  .message {
    margin: 0;
    color: var(--muted);
  }
  .danger-fill {
    background: var(--danger) !important;
    border-color: var(--danger) !important;
  }
  .folder-list {
    display: flex;
    flex-direction: column;
    max-height: 50vh;
    overflow: auto;
    border: 1px solid var(--border);
    border-radius: 8px;
  }
  .folder-list button {
    text-align: left;
    padding: 9px 12px;
  }
  .folder-list button:hover {
    background: var(--surface-2);
  }
  .folder-list button.selected {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .nb-form {
    display: flex;
    gap: 20px;
  }
  .preview {
    width: 130px;
    flex: none;
  }
  .fields {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-width: 0;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }
  .custom {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    font-weight: 700;
    cursor: pointer;
  }
  .pattern {
    width: 34px;
    padding: 2px;
    border-radius: 6px;
    border: 2px solid transparent;
  }
  .pattern.selected {
    border-color: var(--accent);
  }
  .chip {
    padding: 5px 12px;
    border-radius: 999px;
    border: 1px solid var(--border);
    font-size: 14px;
    color: var(--text);
  }
  .chip.selected {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--accent);
  }
  .custom-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding-right: 6px;
  }
  .custom-chip button {
    color: inherit;
    font-size: 14px;
  }
  .chip-x {
    display: inline-flex;
    opacity: 0.6;
  }
  .add-chip {
    border-style: dashed;
    color: var(--muted);
  }
  @media (max-width: 520px) {
    .nb-form {
      flex-direction: column;
    }
    .preview {
      width: 100px;
      align-self: center;
    }
  }
</style>
