import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import { WebsocketProvider } from 'y-websocket';
import { startServer, type PapierServer } from '../server/app.ts';
import { snapshotsToPrune } from '../server/snapshots.ts';

let app: PapierServer;
let dir: string;
let base: string;

type Res = Omit<Response, 'json'> & { json(): Promise<any> };

async function call(path: string, opts: { method?: string; token?: string; share?: string; json?: unknown; body?: Uint8Array; type?: string } = {}): Promise<Res> {
  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.share) headers['X-Papier-Share'] = opts.share;
  if (opts.json !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.type) headers['Content-Type'] = opts.type;
  return fetch(base + path, {
    method: opts.method ?? (opts.json !== undefined || opts.body ? 'POST' : 'GET'),
    headers,
    body: opts.json !== undefined ? JSON.stringify(opts.json) : (opts.body as Uint8Array<ArrayBuffer> | undefined),
  });
}

/** Synchronisation HTTP telle que la fait le client (voir src/sync/docSync.ts). */
async function httpSync(room: string, doc: Y.Doc, auth: { token?: string; share?: string }) {
  const sv = new Uint8Array(await (await call(`/api/doc/${room}/sv`, auth)).arrayBuffer());
  const enc = encoding.createEncoder();
  encoding.writeVarUint8Array(enc, Y.encodeStateVector(doc));
  encoding.writeVarUint8Array(enc, Y.encodeStateAsUpdate(doc, sv));
  const res = await call(`/api/doc/${room}/sync`, { ...auth, body: encoding.toUint8Array(enc), type: 'application/octet-stream' });
  expect(res.status).toBe(200);
  Y.applyUpdate(doc, new Uint8Array(await res.arrayBuffer()), 'remote');
}

async function waitFor(cond: () => boolean, ms = 3000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('délai dépassé');
    await new Promise((r) => setTimeout(r, 20));
  }
}

let alice = '';
let bob = '';

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'papier-srv-'));
  app = await startServer({ port: 0, host: '127.0.0.1', dataDir: dir, publicUrl: 'https://notes.example', allowSignup: false, staticDir: null, maxUploadMb: 5 });
  base = `http://127.0.0.1:${app.port}`;
});

afterAll(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('serveur : comptes', () => {
  it('crée le premier compte, puis la création est fermée', async () => {
    expect(await (await call('/api/info')).json()).toMatchObject({ app: 'papier', signup: true });
    const r = await call('/api/auth/register', { json: { email: 'Alice@Example.org', name: 'Alice', password: 'motdepasse1' } });
    expect(r.status).toBe(201);
    const body = await r.json();
    alice = body.token;
    expect(body.user).toMatchObject({ email: 'alice@example.org', name: 'Alice' });
    expect((await call('/api/auth/register', { json: { email: 'bob@example.org', password: 'motdepasse2' } })).status).toBe(403);
    expect(await (await call('/api/info')).json()).toMatchObject({ signup: false });
  });

  it('connexion, mauvais mot de passe, déconnexion', async () => {
    expect((await call('/api/auth/login', { json: { email: 'alice@example.org', password: 'faux-faux' } })).status).toBe(401);
    const ok = await (await call('/api/auth/login', { json: { email: 'alice@example.org', password: 'motdepasse1' } })).json();
    expect((await call('/api/me', { token: ok.token })).status).toBe(200);
    await call('/api/auth/logout', { method: 'POST', token: ok.token });
    expect((await call('/api/me', { token: ok.token })).status).toBe(401);
    // Un second compte, créé directement en base (création fermée), pour les tests de droits.
    const { hashPassword } = await import('../server/auth.ts');
    app.store.addUser({ id: 'bob1', email: 'bob@example.org', name: 'Bob', pass: await hashPassword('motdepasse2'), created_at: Date.now() });
    bob = (await (await call('/api/auth/login', { json: { email: 'bob@example.org', password: 'motdepasse2' } })).json()).token;
    expect(bob).toBeTruthy();
  });
});

describe('serveur : synchronisation', () => {
  it('deux appareils d’un même compte convergent (HTTP)', async () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    a.getMap('meta').set('title', 'Biologie');
    a.getArray('pageOrder').push(['p1']);
    await httpSync('nb-carnet1', a, { token: alice });
    b.getArray('pageOrder').push(['p2']); // modification hors ligne sur l'autre appareil
    await httpSync('nb-carnet1', b, { token: alice });
    await httpSync('nb-carnet1', a, { token: alice });
    expect(b.getMap('meta').get('title')).toBe('Biologie');
    expect(a.getArray('pageOrder').toArray().sort()).toEqual(['p1', 'p2']);
    expect(b.getArray('pageOrder').toArray().sort()).toEqual(['p1', 'p2']);
  });

  it('un autre compte n’accède pas au carnet sans lien', async () => {
    expect((await call('/api/doc/nb-carnet1/sv', { token: bob })).status).toBe(403);
    expect((await call('/api/doc/nb-carnet1/sv')).status).toBe(401);
    expect((await call('/api/doc/lib/sv')).status).toBe(401);
  });

  it('temps réel par WebSocket, lecture seule respectée', async () => {
    const view = await (await call('/api/notebooks/carnet1/shares', { token: alice, json: { mode: 'view' } })).json();
    expect(view.url).toBe(`https://notes.example/#/s/${view.token}`);
    const ws = `ws://127.0.0.1:${app.port}/sync`;
    const d1 = new Y.Doc();
    const d2 = new Y.Doc();
    const d3 = new Y.Doc();
    const p1 = new WebsocketProvider(ws, 'nb-carnet1', d1, { params: { token: alice }, disableBc: true });
    const p2 = new WebsocketProvider(ws, 'nb-carnet1', d2, { params: { token: alice }, disableBc: true });
    const p3 = new WebsocketProvider(ws, 'nb-carnet1', d3, { params: { share: view.token }, disableBc: true });
    try {
      await waitFor(() => p1.synced && p2.synced && p3.synced);
      expect(d3.getMap('meta').get('title')).toBe('Biologie');
      d1.getMap('meta').set('title', 'Biologie cellulaire');
      await waitFor(() => d2.getMap('meta').get('title') === 'Biologie cellulaire' && d3.getMap('meta').get('title') === 'Biologie cellulaire');
      // Le lecteur modifie localement : le serveur l'ignore, les autres ne le voient pas.
      d3.getMap('meta').set('title', 'Piratage');
      await new Promise((r) => setTimeout(r, 300));
      expect(d1.getMap('meta').get('title')).toBe('Biologie cellulaire');
      // Présence : chacun voit les autres.
      p1.awareness.setLocalStateField('user', { name: 'Alice' });
      await waitFor(() => [...p3.awareness.getStates().values()].some((s) => s.user?.name === 'Alice'));
    } finally {
      p1.destroy();
      p2.destroy();
      p3.destroy();
    }
  });

  it('un lien de modification permet d’écrire ; un lien révoqué ne marche plus', async () => {
    const edit = await (await call('/api/notebooks/carnet1/shares', { token: alice, json: { mode: 'edit' } })).json();
    const info = await (await call(`/api/shares/${edit.token}`)).json();
    expect(info).toMatchObject({ notebookId: 'carnet1', mode: 'edit', title: 'Biologie cellulaire', owner: 'Alice' });
    const guest = new Y.Doc();
    await httpSync('nb-carnet1', guest, { share: edit.token });
    guest.getArray('pageOrder').push(['p3']);
    await httpSync('nb-carnet1', guest, { share: edit.token });
    const owner = new Y.Doc();
    await httpSync('nb-carnet1', owner, { token: alice });
    expect(owner.getArray('pageOrder').toArray()).toContain('p3');

    const list = await (await call('/api/notebooks/carnet1/shares', { token: alice })).json();
    expect(list.shares.map((s: { mode: string }) => s.mode).sort()).toEqual(['edit', 'view']);
    expect((await call(`/api/shares/${edit.token}`, { method: 'DELETE', token: bob })).status).toBe(403);
    expect((await call(`/api/shares/${edit.token}`, { method: 'DELETE', token: alice })).status).toBe(200);
    expect((await call(`/api/shares/${edit.token}`)).status).toBe(404);
    expect((await call('/api/doc/nb-carnet1/sv', { share: edit.token })).status).toBe(401);
  });

  it('garde des versions datées, restaurables', async () => {
    const list = await (await call('/api/doc/nb-carnet1/versions', { token: alice })).json();
    expect(list.versions.length).toBeGreaterThanOrEqual(1);
    const data = new Uint8Array(await (await call(`/api/doc/nb-carnet1/versions/${list.versions[0].id}`, { token: alice })).arrayBuffer());
    const restored = new Y.Doc();
    Y.applyUpdate(restored, data);
    expect(restored.getArray('pageOrder').length).toBeGreaterThanOrEqual(1);
    expect((await call('/api/doc/nb-carnet1/versions', { token: bob })).status).toBe(403);
  });

  it('les données survivent à un redémarrage', async () => {
    const port = app.port;
    await app.close();
    app = await startServer({ port, host: '127.0.0.1', dataDir: dir, publicUrl: 'https://notes.example', allowSignup: false, staticDir: null, maxUploadMb: 5 });
    await new Promise((r) => setTimeout(r, 50)); // laisse le client HTTP oublier ses anciennes connexions
    const d = new Y.Doc();
    await httpSync('nb-carnet1', d, { token: alice });
    expect(d.getMap('meta').get('title')).toBe('Biologie cellulaire');
    expect(d.getArray('pageOrder').toArray().sort()).toEqual(['p1', 'p2', 'p3']);
  });
});

describe('serveur : fichiers', () => {
  it('envoi vérifié par empreinte, puis téléchargement', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.7 contenu de test');
    const sha = createHash('sha256').update(bytes).digest('hex');
    const missing = await (await call('/api/assets/missing', { token: alice, json: { ids: [sha, 'pas-une-empreinte'] } })).json();
    expect(missing.missing).toEqual([sha]);
    const wrong = createHash('sha256').update('autre').digest('hex');
    expect((await call(`/api/assets/${wrong}`, { method: 'PUT', token: alice, body: bytes, type: 'application/pdf' })).status).toBe(400);
    expect((await call(`/api/assets/${sha}`, { method: 'PUT', body: bytes, type: 'application/pdf' })).status).toBe(401);
    expect((await call(`/api/assets/${sha}`, { method: 'PUT', token: alice, body: bytes, type: 'application/pdf' })).status).toBe(201);
    const got = await call(`/api/assets/${sha}`, { token: bob });
    expect(got.headers.get('content-type')).toBe('application/pdf');
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(bytes);
    expect((await call(`/api/assets/${sha}`)).status).toBe(401);
    expect((await (await call('/api/assets/missing', { token: alice, json: { ids: [sha] } })).json()).missing).toEqual([]);
  });

  it('refuse les fichiers trop gros', async () => {
    const big = new Uint8Array(6 * 1024 * 1024);
    const sha = createHash('sha256').update(big).digest('hex');
    expect((await call(`/api/assets/${sha}`, { method: 'PUT', token: alice, body: big })).status).toBe(413);
  });
});

describe('historique : élagage des versions', () => {
  it('garde tout sur 48 h, puis une par jour, puis une par semaine', () => {
    const H = 3_600_000, D = 24 * H;
    const now = 400 * D + 12 * H;
    const times = [now - H, now - 30 * H, now - 3 * D, now - 3 * D - H, now - 3 * D - 2 * H, now - 40 * D, now - 41 * D, now - 400 * D];
    const pruned = snapshotsToPrune(times, now).sort();
    // Gardées : les deux récentes, la plus récente du jour J-3, une par semaine à J-40/41 (même semaine ou non).
    expect(pruned).toContain(now - 3 * D - H);
    expect(pruned).toContain(now - 3 * D - 2 * H);
    expect(pruned).toContain(now - 400 * D);
    expect(pruned).not.toContain(now - H);
    expect(pruned).not.toContain(now - 30 * H);
    expect(pruned).not.toContain(now - 3 * D);
  });
});
