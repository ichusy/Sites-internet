import { settings } from './settings.svelte';

/** Thème effectivement appliqué (préférence utilisateur ou réglage du système). */
export const theme = $state({ resolved: 'light' as 'light' | 'dark' });

export function initTheme() {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  let systemDark = $state(media.matches);
  media.addEventListener('change', (e) => (systemDark = e.matches));

  $effect.root(() => {
    $effect(() => {
      const resolved = settings.theme === 'system' ? (systemDark ? 'dark' : 'light') : settings.theme;
      theme.resolved = resolved;
      document.documentElement.dataset.theme = resolved;
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#16181d' : '#f4f2ee');
    });
  });
}
