import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, renameSync, statSync, unlinkSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import * as decoding from 'lib0/decoding';
import { AccessError, resolveRoom, userFromToken } from './access.ts';
import { RateLimiter, hashPassword, hashToken, newId, newToken, verifyPassword } from './auth.ts';
import type { Config } from './config.ts';
import type { Store, UserRow } from './db.ts';
import type { DocManager } from './docs.ts';

const VERSION = '1';
const JSON_LIMIT = 1_000_000;
const SHA256 = /^[0-9a-f]{64}$/;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
  '.ttf': 'font/ttf',
  '.icc': 'application/octet-stream',
};

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: string[];
}

type Handler = (ctx: Ctx) => Promise<void> | void;

function publicUser(u: UserRow) {
  return { id: u.id, email: u.email, name: u.name };
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function sendBinary(res: ServerResponse, data: Uint8Array) {
  res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': data.byteLength });
  res.end(data);
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new HttpError(413, 'Requête trop volumineuse.');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  try {
    return JSON.parse((await readBody(req, JSON_LIMIT)).toString('utf8')) as T;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, 'JSON invalide.');
  }
}

function bearer(req: IncomingMessage): string | null {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7) : null;
}

function clientIp(req: IncomingMessage): string {
  const fwd = req.headers['x-forwarded-for'];
  return (typeof fwd === 'string' ? fwd.split(',')[0].trim() : '') || req.socket.remoteAddress || '?';
}

/** API HTTP du serveur Papier (voir docs/ARCHITECTURE.md, « Étape 10 ») et service de l’application compilée. */
export function createHandler(config: Config, store: Store, docs: DocManager) {
  const limiter = new RateLimiter(10, 10 * 60_000);
  const routes: { method: string; pattern: RegExp; handler: Handler }[] = [];
  const route = (method: string, path: string, handler: Handler) =>
    routes.push({ method, pattern: new RegExp(`^${path.replace(/:[a-z]+/g, '([^/]+)')}$`), handler });

  const currentUser = (req: IncomingMessage) => userFromToken(store, bearer(req));
  const requireUser = (req: IncomingMessage): UserRow => {
    const u = currentUser(req);
    if (!u) throw new HttpError(401, 'Connexion requise.');
    return u;
  };
  const shareHeader = (req: IncomingMessage) => {
    const v = req.headers['x-papier-share'];
    return typeof v === 'string' ? v : null;
  };
  const access = (req: IncomingMessage, room: string) => resolveRoom(store, decodeURIComponent(room), currentUser(req), shareHeader(req));

  /** Un fichier peut être lu par un compte connecté ou via n'importe quel lien de partage valide : son empreinte SHA-256 vaut capacité. */
  const canReadAssets = (req: IncomingMessage) => !!currentUser(req) || !!(shareHeader(req) && store.share(shareHeader(req)!));
  const canWriteAssets = (req: IncomingMessage) => {
    if (currentUser(req)) return true;
    const s = shareHeader(req);
    return !!(s && store.share(s)?.mode === 'edit');
  };

  // ── Informations, comptes ───────────────────────────────

  route('GET', '/api/info', ({ res }) => {
    sendJson(res, 200, { app: 'papier', version: VERSION, signup: config.allowSignup || store.userCount() === 0, publicUrl: config.publicUrl });
  });

  route('POST', '/api/auth/register', async ({ req, res }) => {
    if (!limiter.allow(`reg:${clientIp(req)}`)) throw new HttpError(429, 'Trop de tentatives, réessayez plus tard.');
    const body = await readJson<{ email?: string; name?: string; password?: string }>(req);
    const email = String(body.email ?? '').trim().toLowerCase();
    const name = String(body.name ?? '').trim() || email.split('@')[0];
    const password = String(body.password ?? '');
    if (!config.allowSignup && store.userCount() > 0) throw new HttpError(403, 'La création de comptes est fermée sur ce serveur.');
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw new HttpError(400, 'Adresse e-mail invalide.');
    if (password.length < 8) throw new HttpError(400, 'Le mot de passe doit faire au moins 8 caractères.');
    if (store.userByEmail(email)) throw new HttpError(409, 'Un compte existe déjà avec cette adresse.');
    const user: UserRow = { id: newId(), email, name: name.slice(0, 80), pass: await hashPassword(password), created_at: Date.now() };
    store.addUser(user);
    const token = newToken();
    store.addSession(hashToken(token), user.id, Date.now());
    sendJson(res, 201, { token, user: publicUser(user) });
  });

  route('POST', '/api/auth/login', async ({ req, res }) => {
    if (!limiter.allow(`login:${clientIp(req)}`)) throw new HttpError(429, 'Trop de tentatives, réessayez plus tard.');
    const body = await readJson<{ email?: string; password?: string }>(req);
    const user = store.userByEmail(String(body.email ?? '').trim().toLowerCase());
    if (!user || !(await verifyPassword(String(body.password ?? ''), user.pass))) throw new HttpError(401, 'Adresse ou mot de passe incorrect.');
    const token = newToken();
    store.addSession(hashToken(token), user.id, Date.now());
    sendJson(res, 200, { token, user: publicUser(user) });
  });

  route('POST', '/api/auth/logout', ({ req, res }) => {
    const token = bearer(req);
    if (token) store.deleteSession(hashToken(token));
    sendJson(res, 200, { ok: true });
  });

  route('GET', '/api/me', ({ req, res }) => sendJson(res, 200, { user: publicUser(requireUser(req)) }));

  // ── Synchronisation sans WebSocket (arrière-plan) ───────
  // 1. GET  …/sv   → vecteur d'état du serveur
  // 2. POST …/sync → corps : varUint8Array(vecteur du client) + varUint8Array(ce qui manque au serveur)
  //                  réponse : ce qui manque au client.

  route('GET', '/api/doc/:room/sv', ({ req, res, params }) => {
    const a = access(req, params[0]);
    sendBinary(res, docs.stateVector(a.docId));
  });

  route('POST', '/api/doc/:room/sync', async ({ req, res, params }) => {
    const a = access(req, params[0]);
    const body = new Uint8Array(await readBody(req, 200 * 1024 * 1024));
    const decoder = decoding.createDecoder(body);
    const clientSv = decoding.readVarUint8Array(decoder);
    const update = decoding.hasContent(decoder) ? decoding.readVarUint8Array(decoder) : new Uint8Array();
    // Mise à jour vide : deux octets (aucune structure, aucune suppression).
    if (!a.readOnly && update.byteLength > 2) docs.apply(a.docId, update, 'http');
    sendBinary(res, docs.diff(a.docId, clientSv));
  });

  // ── Historique des versions (carnets) ───────────────────

  route('GET', '/api/doc/:room/versions', ({ req, res, params }) => {
    const a = access(req, params[0]);
    if (a.share) throw new HttpError(403, 'Réservé au propriétaire du carnet.');
    sendJson(res, 200, { versions: store.snapshots(a.docId).map((s) => ({ id: s.id, createdAt: s.created_at, size: s.size })) });
  });

  route('GET', '/api/doc/:room/versions/:id', ({ req, res, params }) => {
    const a = access(req, params[0]);
    if (a.share) throw new HttpError(403, 'Réservé au propriétaire du carnet.');
    const data = store.snapshot(a.docId, Number(params[1]));
    if (!data) throw new HttpError(404, 'Version introuvable.');
    sendBinary(res, data);
  });

  // ── Partage ─────────────────────────────────────────────

  const ownedNotebook = (req: IncomingMessage, id: string) => {
    const user = requireUser(req);
    const docId = `nb:${decodeURIComponent(id)}`;
    const doc = store.doc(docId);
    if (!doc) throw new HttpError(404, 'Carnet pas encore synchronisé.');
    if (doc.owner_id !== user.id) throw new HttpError(403, 'Ce carnet ne vous appartient pas.');
    return { user, docId };
  };
  const shareUrl = (token: string) => `${config.publicUrl}/#/s/${token}`;

  route('GET', '/api/notebooks/:id/shares', ({ req, res, params }) => {
    const { docId } = ownedNotebook(req, params[0]);
    sendJson(res, 200, { shares: store.sharesOf(docId).map((s) => ({ token: s.token, mode: s.mode, createdAt: s.created_at, url: shareUrl(s.token) })) });
  });

  route('POST', '/api/notebooks/:id/shares', async ({ req, res, params }) => {
    const { user, docId } = ownedNotebook(req, params[0]);
    const { mode } = await readJson<{ mode?: string }>(req);
    if (mode !== 'view' && mode !== 'edit') throw new HttpError(400, 'Mode de partage invalide.');
    const token = newToken();
    store.addShare({ token, doc_id: docId, mode, created_at: Date.now(), created_by: user.id });
    sendJson(res, 201, { token, mode, url: shareUrl(token) });
  });

  route('DELETE', '/api/shares/:token', ({ req, res, params }) => {
    const user = requireUser(req);
    const share = store.share(params[0]);
    if (!share) throw new HttpError(404, 'Lien introuvable.');
    if (store.doc(share.doc_id)?.owner_id !== user.id) throw new HttpError(403, 'Ce carnet ne vous appartient pas.');
    store.revokeShare(share.token);
    sendJson(res, 200, { ok: true });
  });

  /** Ouverture d'un lien de partage : de quoi créer le carnet chez le destinataire. */
  route('GET', '/api/shares/:token', ({ res, params }) => {
    const share = store.share(params[0]);
    if (!share) throw new HttpError(404, 'Ce lien de partage n’existe pas ou a été désactivé.');
    const doc = store.doc(share.doc_id)!;
    const notebookId = share.doc_id.slice(3);
    const owner = store.userById(doc.owner_id);
    const record = docs.get(`lib:${doc.owner_id}`).doc.getMap('notebooks').get(notebookId) as Record<string, unknown> | undefined;
    const title = (docs.get(share.doc_id).doc.getMap('meta').get('title') as string | undefined) ?? (record?.title as string | undefined) ?? 'Carnet partagé';
    sendJson(res, 200, {
      notebookId,
      mode: share.mode,
      title,
      owner: owner?.name ?? '',
      record: record ? { kind: record.kind, cover: record.cover, paper: record.paper, template: record.template } : null,
    });
  });

  // ── Fichiers (PDF, images, audio), adressés par leur SHA-256 ──

  route('POST', '/api/assets/missing', async ({ req, res }) => {
    if (!canWriteAssets(req)) throw new HttpError(401, 'Connexion requise.');
    const { ids } = await readJson<{ ids?: string[] }>(req);
    const list = (Array.isArray(ids) ? ids : []).filter((id) => SHA256.test(id));
    sendJson(res, 200, { missing: list.filter((id) => !store.asset(id)) });
  });

  route('PUT', '/api/assets/:sha', async ({ req, res, params }) => {
    const user = currentUser(req);
    if (!canWriteAssets(req)) throw new HttpError(401, 'Connexion requise.');
    const sha = params[0];
    if (!SHA256.test(sha)) throw new HttpError(400, 'Empreinte invalide.');
    if (store.asset(sha)) return sendJson(res, 200, { ok: true, existed: true });
    const limit = config.maxUploadMb * 1024 * 1024;
    const tmp = join(config.dataDir, 'assets', `${sha}.${process.pid}.${Date.now()}.tmp`);
    const hash = createHash('sha256');
    let size = 0;
    const out = createWriteStream(tmp);
    try {
      for await (const chunk of req) {
        size += (chunk as Buffer).length;
        if (size > limit) throw new HttpError(413, `Fichier trop volumineux (maximum ${config.maxUploadMb} Mo).`);
        hash.update(chunk as Buffer);
        if (!out.write(chunk)) await new Promise<void>((r) => out.once('drain', () => r()));
      }
      await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
      if (hash.digest('hex') !== sha) throw new HttpError(400, 'Le contenu ne correspond pas à son empreinte.');
      renameSync(tmp, join(config.dataDir, 'assets', sha));
    } catch (err) {
      out.destroy();
      if (existsSync(tmp)) unlinkSync(tmp);
      throw err;
    }
    const mime = String(req.headers['content-type'] ?? 'application/octet-stream').slice(0, 120);
    store.addAsset(sha, mime, size, user?.id ?? null, Date.now());
    sendJson(res, 201, { ok: true });
  });

  route('GET', '/api/assets/:sha', ({ req, res, params }) => {
    if (!canReadAssets(req)) throw new HttpError(401, 'Connexion requise.');
    const sha = params[0];
    const meta = SHA256.test(sha) ? store.asset(sha) : undefined;
    const path = join(config.dataDir, 'assets', sha);
    if (!meta || !existsSync(path)) throw new HttpError(404, 'Fichier introuvable.');
    res.writeHead(200, { 'Content-Type': meta.mime, 'Content-Length': meta.size, 'Cache-Control': 'private, max-age=31536000, immutable' });
    createReadStream(path).pipe(res);
  });

  // ── Application compilée (dist/) ────────────────────────

  function serveStatic(ctx: Ctx): boolean {
    if (!config.staticDir || (ctx.req.method !== 'GET' && ctx.req.method !== 'HEAD')) return false;
    const root = config.staticDir;
    let rel = decodeURIComponent(ctx.url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    let path = normalize(join(root, rel));
    if (!path.startsWith(root + sep) && path !== root) return false;
    if (!existsSync(path) || !statSync(path).isFile()) {
      // Routage par fragment (#/…) : tout chemin inconnu sans extension renvoie l'application.
      if (extname(rel)) return false;
      path = join(root, 'index.html');
      if (!existsSync(path)) return false;
    }
    const immutable = /[\\/]assets[\\/]/.test(path.slice(root.length));
    ctx.res.writeHead(200, {
      'Content-Type': MIME[extname(path)] ?? 'application/octet-stream',
      'Content-Length': statSync(path).size,
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    if (ctx.req.method === 'HEAD') ctx.res.end();
    else createReadStream(path).pipe(ctx.res);
    return true;
  }

  return async function handle(req: IncomingMessage, res: ServerResponse) {
    // L'application peut être servie ailleurs (autre domaine) : l'API accepte toutes les origines,
    // l'authentification passe par un jeton (jamais par cookie).
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Papier-Share');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.pattern.exec(url.pathname);
        if (!m) continue;
        await r.handler({ req, res, url, params: m.slice(1) });
        return;
      }
      if (url.pathname.startsWith('/api/')) throw new HttpError(404, 'Introuvable.');
      if (!serveStatic({ req, res, url, params: [] })) throw new HttpError(404, 'Introuvable.');
    } catch (err) {
      const status = err instanceof HttpError || err instanceof AccessError ? err.status : 500;
      if (status === 500) console.error('[http]', req.method, url.pathname, err);
      if (!res.headersSent) sendJson(res, status, { error: status === 500 ? 'Erreur du serveur.' : (err as Error).message });
      else res.end();
    }
  };
}
