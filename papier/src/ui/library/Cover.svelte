<script lang="ts">
  import type { CoverSpec } from '../../core/model/types';

  let { cover, title = '', compact = false }: { cover: CoverSpec; title?: string; compact?: boolean } = $props();
</script>

<div class="cover pattern-{cover.pattern}" class:compact style:--cover={cover.color}>
  {#if title && !compact}
    <div class="label">{title}</div>
  {/if}
</div>

<style>
  .cover {
    position: relative;
    aspect-ratio: 3 / 4;
    width: 100%;
    border-radius: 4px 10px 10px 4px;
    background-color: var(--cover);
    box-shadow:
      inset 10px 0 0 rgb(0 0 0 / 0.14),
      inset 11px 0 0 rgb(255 255 255 / 0.12),
      0 1px 2px rgb(0 0 0 / 0.12),
      0 6px 14px rgb(0 0 0 / 0.12);
    overflow: hidden;
  }
  .compact {
    border-radius: 3px 6px 6px 3px;
    box-shadow:
      inset 5px 0 0 rgb(0 0 0 / 0.14),
      0 1px 3px rgb(0 0 0 / 0.15);
  }
  .pattern-stripes {
    background-image: repeating-linear-gradient(90deg, rgb(255 255 255 / 0.13) 0 6px, transparent 6px 14px);
  }
  .pattern-dots {
    background-image: radial-gradient(rgb(255 255 255 / 0.25) 1.6px, transparent 1.8px);
    background-size: 12px 12px;
  }
  .pattern-grid {
    background-image:
      linear-gradient(rgb(255 255 255 / 0.15) 1px, transparent 1px),
      linear-gradient(90deg, rgb(255 255 255 / 0.15) 1px, transparent 1px);
    background-size: 12px 12px;
  }
  .pattern-diagonal {
    background-image: repeating-linear-gradient(45deg, rgb(255 255 255 / 0.13) 0 4px, transparent 4px 12px);
  }
  .label {
    position: absolute;
    left: 18%;
    right: 10%;
    top: 16%;
    padding: 8px 10px;
    background: #fbfaf7;
    color: #22252c;
    border-radius: 4px;
    font-size: 13px;
    font-weight: 600;
    line-height: 1.25;
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.15);
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    word-break: break-word;
  }
</style>
