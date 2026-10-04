import { mount } from 'svelte';
import { registerSW } from 'virtual:pwa-register';
import './app.css';
import { requestPersistentStorage } from './core/storage/db';
import App from './ui/App.svelte';
import { initTheme } from './ui/theme.svelte';

initTheme();

mount(App, { target: document.getElementById('app')! });

// Hors ligne : le service worker met l'app en cache et se met à jour automatiquement.
registerSW({ immediate: true });

void requestPersistentStorage();
