<script lang="ts">
  import { CloudCheck, LogOut, RefreshCw } from '@lucide/svelte';
  import { serverInfo, normalizeServer, type ServerInfo } from '../../sync/api';
  import { signIn, signOut, syncEngine, syncState } from '../../sync/sync.svelte';
  import Dialog from '../common/Dialog.svelte';
  import { askConfirm } from '../common/dialogs.svelte';
  import { showToast } from '../common/toast.svelte';
  import { guestName, setGuestName } from './guest';
  import SyncStatus from './SyncStatus.svelte';

  let { onclose }: { onclose: () => void } = $props();

  let server = $state('');
  let info = $state<ServerInfo | null>(null);
  let checking = $state(false);
  let mode = $state<'login' | 'register'>('login');
  let email = $state('');
  let name = $state('');
  let password = $state('');
  let error = $state('');
  let busy = $state(false);
  let guest = $state(guestName());

  const account = $derived(syncState.account);

  // Application servie par un serveur Papier : on le propose d'office.
  $effect(() => {
    if (account || server) return;
    void serverInfo(location.origin)
      .then((i) => {
        if (!server) {
          server = location.origin;
          info = i;
          if (i.signup) mode = 'register';
        }
      })
      .catch(() => {});
  });

  async function check() {
    if (!server.trim()) return;
    checking = true;
    error = '';
    info = null;
    try {
      info = await serverInfo(normalizeServer(server));
      if (info.signup && !email) mode = 'register';
    } catch (err) {
      error = (err as Error).message;
    } finally {
      checking = false;
    }
  }

  async function submit() {
    if (account || busy) return;
    busy = true;
    error = '';
    try {
      await signIn(server, email.trim(), password, mode, name.trim());
      password = '';
      showToast('Connecté : la synchronisation commence.');
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busy = false;
    }
  }

  async function logout() {
    if (!(await askConfirm('Se déconnecter ?', 'Les carnets restent sur cet appareil, mais ne se synchronisent plus.', 'Se déconnecter'))) return;
    await signOut();
  }
</script>

<Dialog
  title="Synchronisation"
  onclose={() => onclose()}
  cancelLabel="Fermer"
  onsubmit={() => {
    if (!account && info && email && password) void submit();
    return false;
  }}
>
  {#if account}
    <div class="account">
      <CloudCheck size={22} />
      <div>
        <strong>{account.user.name}</strong> · {account.user.email}<br />
        <span class="muted">{account.server}</span>
      </div>
    </div>
    <SyncStatus detailed />
    <p class="hint">
      Vos carnets, dossiers et fichiers se synchronisent entre vos appareils connectés à ce compte. Hors ligne, tout continue de
      fonctionner : les modifications se fusionnent au retour du réseau.
    </p>
    <div class="row">
      <button type="button" class="btn" onclick={() => syncEngine.syncNow()}><RefreshCw size={15} /> Synchroniser maintenant</button>
      <button type="button" class="btn" onclick={logout}><LogOut size={15} /> Se déconnecter</button>
    </div>
  {:else}
    <p class="hint">
      Facultatif. Connectez Papier à votre serveur pour retrouver vos carnets sur tous vos appareils, les sauvegarder et les partager.
      Sans compte, tout reste sur cet appareil.
    </p>
    <label class="field">
      Adresse du serveur
      <span class="inline">
        <input type="text" bind:value={server} placeholder="https://notes.exemple.fr" autocomplete="url" inputmode="url" onchange={check} />
        <button type="button" class="btn" disabled={checking || !server.trim()} onclick={check}>{checking ? '…' : 'Vérifier'}</button>
      </span>
    </label>
    {#if info}
      <div class="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={mode === 'login'} class:active={mode === 'login'} onclick={() => (mode = 'login')}>J’ai un compte</button>
        <button type="button" role="tab" aria-selected={mode === 'register'} class:active={mode === 'register'} disabled={!info.signup} onclick={() => (mode = 'register')}>Créer un compte</button>
      </div>
      {#if mode === 'register'}
        <label class="field">Nom affiché <input type="text" bind:value={name} autocomplete="name" /></label>
      {/if}
      <label class="field">E-mail <input type="text" bind:value={email} autocomplete="email" inputmode="email" /></label>
      <label class="field">
        Mot de passe {mode === 'register' ? '(8 caractères minimum)' : ''}
        <input type="password" bind:value={password} autocomplete={mode === 'register' ? 'new-password' : 'current-password'} />
      </label>
      {#if !info.signup && mode === 'login'}<p class="hint small">La création de comptes est fermée sur ce serveur.</p>{/if}
    {/if}
  {/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  <details class="guest">
    <summary>Nom affiché sur les carnets partagés</summary>
    <label class="field">
      Quand vous ouvrez un lien de partage sans compte
      <input type="text" bind:value={guest} onchange={() => setGuestName(guest)} maxlength="40" />
    </label>
  </details>
  {#snippet actions()}
    {#if !account && info}
      <button type="button" class="btn primary" disabled={busy || !email || !password} onclick={submit}>
        {busy ? 'Connexion…' : mode === 'register' ? 'Créer le compte' : 'Se connecter'}
      </button>
    {/if}
  {/snippet}
</Dialog>

<style>
  .hint {
    margin: 0;
    color: var(--muted);
    font-size: 13.5px;
    line-height: 1.45;
  }
  .small {
    font-size: 12.5px;
  }
  .muted {
    color: var(--muted);
    font-size: 13px;
  }
  .error {
    margin: 0;
    color: var(--danger);
    font-size: 13.5px;
  }
  .account {
    display: flex;
    gap: 10px;
    align-items: center;
    color: var(--accent);
  }
  .account div {
    color: var(--text);
    font-size: 14px;
  }
  .row {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .inline {
    display: flex;
    gap: 6px;
  }
  .inline input {
    flex: 1;
    min-width: 0;
  }
  .field input {
    padding: 8px 10px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    font-size: 15px;
  }
  .tabs {
    display: flex;
    gap: 4px;
    border-bottom: 1px solid var(--border);
  }
  .tabs button {
    padding: 6px 10px;
    font-size: 13.5px;
    color: var(--muted);
    border-bottom: 2px solid transparent;
  }
  .tabs button.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
    font-weight: 600;
  }
  .guest summary {
    cursor: pointer;
    color: var(--muted);
    font-size: 13px;
  }
  .guest .field {
    margin-top: 8px;
  }
</style>
