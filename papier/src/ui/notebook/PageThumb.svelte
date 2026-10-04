<script lang="ts">
  import { onMount } from 'svelte';
  import type { ID } from '../../core/model/types';
  import type { Editor } from '../../engine/Editor';

  let { editor, pageId, width }: { editor: Editor; pageId: ID; width: number } = $props();

  let canvas: HTMLCanvasElement;
  let visible = false;
  let stale = true;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function render() {
    if (!editor.scene(pageId) || !visible) return;
    stale = false;
    editor.renderThumbnail(canvas, pageId, width);
  }

  onMount(() => {
    // Rendu paresseux : seulement les miniatures visibles dans le panneau.
    const io = new IntersectionObserver((entries) => {
      visible = entries.some((e) => e.isIntersecting);
      if (visible && stale) render();
    });
    io.observe(canvas);
    const off = editor.onPageChange((id) => {
      if (id !== pageId) return;
      stale = true;
      clearTimeout(timer);
      timer = setTimeout(render, 300);
    });
    return () => {
      io.disconnect();
      off();
      clearTimeout(timer);
    };
  });
</script>

<canvas bind:this={canvas} style:width="{width}px" style:aspect-ratio="{editor.scene(pageId)?.page.width ?? 3} / {editor.scene(pageId)?.page.height ?? 4}"></canvas>

<style>
  canvas {
    display: block;
    background: #fff;
    border-radius: 3px;
    box-shadow: 0 0 0 1px rgb(0 0 0 / 0.08), 0 1px 4px rgb(0 0 0 / 0.12);
  }
</style>
