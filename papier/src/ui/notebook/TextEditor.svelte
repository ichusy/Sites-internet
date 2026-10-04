<script lang="ts">
  import type { Editor, EditorState } from '../../engine/Editor';
  import { LINE_HEIGHT, TEXT_FONT } from '../../engine/render/text';
  import type { TextEditRequest } from '../../engine/tools/types';

  interface Props {
    editor: Editor;
    req: TextEditRequest | null;
    /** État de la vue : sert seulement à repositionner l'éditeur pendant un zoom/défilement. */
    es: EditorState;
    textarea?: HTMLTextAreaElement;
  }
  let { editor, req, es, textarea = $bindable() }: Props = $props();

  const frame = $derived.by(() => {
    void es.zoom;
    void es.currentPage;
    return req ? editor.textEditorFrame(req) : null;
  });

  function autosize() {
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }

  $effect(() => {
    void req;
    void frame;
    autosize();
  });

  function oninput() {
    editor.updateTextEdit({ text: textarea!.value });
    autosize();
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') textarea!.blur();
    e.stopPropagation();
  }
</script>

<!-- Toujours présent dans le DOM : sur iPad, le clavier ne s'ouvre que si le focus est donné pendant le geste. -->
<textarea
  bind:this={textarea}
  class="text-editor"
  class:hidden={!req || !frame}
  spellcheck="true"
  aria-label="Zone de texte"
  style:left="{frame?.x ?? -9999}px"
  style:top="{frame?.y ?? -9999}px"
  style:width="{(req?.width ?? 100) * (frame?.zoom ?? 1)}px"
  style:font-size="{(req?.fontSize ?? 14) * (frame?.zoom ?? 1)}px"
  style:line-height={LINE_HEIGHT}
  style:font-family={TEXT_FONT}
  style:color={req?.color}
  style:transform="rotate({frame?.angle ?? 0}rad)"
  {oninput}
  {onkeydown}
  onblur={() => editor.commitTextEdit(textarea!.value)}
></textarea>

<style>
  .text-editor {
    position: absolute;
    z-index: 12;
    margin: 0;
    padding: 0;
    border: none;
    outline: 1.5px dashed var(--accent);
    outline-offset: 4px;
    background: transparent;
    resize: none;
    overflow: hidden;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    transform-origin: 0 0;
    caret-color: var(--accent);
  }
  .hidden {
    opacity: 0;
    pointer-events: none;
    width: 1px !important;
    height: 1px !important;
  }
</style>
