/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';
import { viteStaticCopy } from 'vite-plugin-static-copy';

/**
 * ONNX Runtime référence son wasm via `new URL(…, import.meta.url)`, ce qui en émet une copie
 * (27 Mo) dans assets/. Inutile : le worker de transcription charge celui du dossier ort/.
 */
const dropOrtDuplicate: Plugin = {
  name: 'papier-drop-ort-duplicate',
  apply: 'build',
  generateBundle(_options, bundle) {
    for (const name of Object.keys(bundle)) if (/(^|\/)ort-wasm[^/]*\.wasm$/.test(name)) delete bundle[name];
  },
};

export default defineConfig({
  // Chemins relatifs : l'app fonctionne quel que soit le sous-dossier où elle est servie.
  base: './',
  plugins: [
    svelte(),
    // Ressources annexes de pdf.js (polices standard, CMaps, décodeurs wasm, profils ICC).
    viteStaticCopy({
      targets: [
        ...['cmaps', 'standard_fonts', 'wasm', 'iccs'].map((dir) => ({
          src: `node_modules/pdfjs-dist/${dir}`,
          dest: 'pdfjs',
          rename: { stripBase: 2 },
        })),
        // Moteur ONNX Runtime (wasm) de la transcription : servi localement, jamais depuis un CDN.
        ...['ort-wasm-simd-threaded', 'ort-wasm-simd-threaded.asyncify'].flatMap((name) =>
          ['mjs', 'wasm'].map((ext) => ({ src: `node_modules/onnxruntime-web/dist/${name}.${ext}`, dest: 'ort', rename: { stripBase: true as const } })),
        ),
      ],
    }),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Papier — notes manuscrites',
        short_name: 'Papier',
        description: 'Cahier numérique pour prendre des notes au stylet et annoter ses cours.',
        lang: 'fr',
        theme_color: '#1e2330',
        background_color: '#f4f2ee',
        display: 'standalone',
        orientation: 'any',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,woff2}'],
        // Fichiers volumineux chargés à la demande : pdf.js, et le moteur de transcription
        // (mis en cache par transformers.js lui-même à la première transcription).
        globIgnores: ['pdfjs/**', 'ort/**', '**/whisper*.js', '**/transformers*.js'],
        // Le worker pdf.js dépasse la limite par défaut de 2 Mo.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        runtimeCaching: [
          {
            // Ressources pdf.js mises en cache à la première utilisation, puis disponibles hors ligne.
            urlPattern: ({ url }) => url.pathname.includes('/pdfjs/'),
            handler: 'CacheFirst',
            options: { cacheName: 'pdfjs-resources', expiration: { maxEntries: 400 } },
          },
        ],
      },
    }),
  ],
  worker: { format: 'es', plugins: () => [dropOrtDuplicate] },
  server: { host: true },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
