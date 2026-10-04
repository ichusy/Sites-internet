import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface UserRow {
  id: string;
  email: string;
  name: string;
  pass: string;
  created_at: number;
}

export interface DocRow {
  id: string;
  owner_id: string;
  created_at: number;
  updated_at: number;
}

export interface ShareRow {
  token: string;
  doc_id: string;
  mode: 'view' | 'edit';
  created_at: number;
  created_by: string;
  revoked: number;
}

/**
 * Base SQLite du serveur (module node:sqlite, sans dépendance native).
 *  - docs / doc_updates : documents Yjs (bibliothèque de chaque compte, carnets),
 *    stockés comme suite de mises à jour, compactée de temps en temps ;
 *  - snapshots : versions datées des carnets (historique) ;
 *  - shares : liens de partage ; assets : fichiers (le contenu est sur disque).
 */
export class Store {
  readonly db: DatabaseSync;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(join(dataDir, 'assets'), { recursive: true });
    this.db = new DatabaseSync(join(dataDir, 'papier.sqlite'));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, pass TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS docs (
        id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS doc_updates (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, doc_id TEXT NOT NULL, data BLOB NOT NULL
      );
      CREATE INDEX IF NOT EXISTS doc_updates_doc ON doc_updates(doc_id, seq);
      CREATE TABLE IF NOT EXISTS snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT, doc_id TEXT NOT NULL, created_at INTEGER NOT NULL, data BLOB NOT NULL
      );
      CREATE INDEX IF NOT EXISTS snapshots_doc ON snapshots(doc_id, created_at);
      CREATE TABLE IF NOT EXISTS shares (
        token TEXT PRIMARY KEY, doc_id TEXT NOT NULL, mode TEXT NOT NULL, created_at INTEGER NOT NULL,
        created_by TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS shares_doc ON shares(doc_id);
      CREATE TABLE IF NOT EXISTS assets (
        sha TEXT PRIMARY KEY, mime TEXT NOT NULL, size INTEGER NOT NULL, owner_id TEXT, created_at INTEGER NOT NULL
      );
    `);
  }

  close() {
    this.db.close();
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const out = fn();
      this.db.exec('COMMIT');
      return out;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  // ── Comptes ─────────────────────────────────────────────

  userCount(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  }

  addUser(u: UserRow) {
    this.db.prepare('INSERT INTO users (id, email, name, pass, created_at) VALUES (?, ?, ?, ?, ?)').run(u.id, u.email, u.name, u.pass, u.created_at);
  }

  userByEmail(email: string): UserRow | undefined {
    return this.db.prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined;
  }

  userById(id: string): UserRow | undefined {
    return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  }

  addSession(tokenHash: string, userId: string, now: number) {
    this.db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, last_seen) VALUES (?, ?, ?, ?)').run(tokenHash, userId, now, now);
  }

  sessionUser(tokenHash: string, now: number): UserRow | undefined {
    const row = this.db.prepare('SELECT user_id, last_seen FROM sessions WHERE token_hash = ?').get(tokenHash) as { user_id: string; last_seen: number } | undefined;
    if (!row) return undefined;
    // Mise à jour de la date d'utilisation au plus une fois par heure.
    if (now - row.last_seen > 3_600_000) this.db.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?').run(now, tokenHash);
    return this.userById(row.user_id);
  }

  deleteSession(tokenHash: string) {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
  }

  // ── Documents ───────────────────────────────────────────

  doc(id: string): DocRow | undefined {
    return this.db.prepare('SELECT * FROM docs WHERE id = ?').get(id) as DocRow | undefined;
  }

  addDoc(id: string, ownerId: string, now: number) {
    this.db.prepare('INSERT OR IGNORE INTO docs (id, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?)').run(id, ownerId, now, now);
  }

  touchDoc(id: string, now: number) {
    this.db.prepare('UPDATE docs SET updated_at = ? WHERE id = ?').run(now, id);
  }

  updates(docId: string): Uint8Array[] {
    return (this.db.prepare('SELECT data FROM doc_updates WHERE doc_id = ? ORDER BY seq').all(docId) as { data: Uint8Array }[]).map((r) => r.data);
  }

  updateCount(docId: string): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM doc_updates WHERE doc_id = ?').get(docId) as { n: number }).n;
  }

  appendUpdate(docId: string, data: Uint8Array) {
    this.db.prepare('INSERT INTO doc_updates (doc_id, data) VALUES (?, ?)').run(docId, data);
  }

  /** Remplace toutes les mises à jour d'un document par leur fusion. */
  replaceUpdates(docId: string, merged: Uint8Array) {
    this.transaction(() => {
      this.db.prepare('DELETE FROM doc_updates WHERE doc_id = ?').run(docId);
      this.db.prepare('INSERT INTO doc_updates (doc_id, data) VALUES (?, ?)').run(docId, merged);
    });
  }

  // ── Versions ────────────────────────────────────────────

  lastSnapshotAt(docId: string): number {
    const row = this.db.prepare('SELECT MAX(created_at) AS t FROM snapshots WHERE doc_id = ?').get(docId) as { t: number | null };
    return row.t ?? 0;
  }

  addSnapshot(docId: string, createdAt: number, data: Uint8Array) {
    this.db.prepare('INSERT INTO snapshots (doc_id, created_at, data) VALUES (?, ?, ?)').run(docId, createdAt, data);
  }

  snapshots(docId: string): { id: number; created_at: number; size: number }[] {
    return this.db
      .prepare('SELECT id, created_at, length(data) AS size FROM snapshots WHERE doc_id = ? ORDER BY created_at DESC')
      .all(docId) as { id: number; created_at: number; size: number }[];
  }

  snapshot(docId: string, id: number): Uint8Array | undefined {
    return (this.db.prepare('SELECT data FROM snapshots WHERE doc_id = ? AND id = ?').get(docId, id) as { data: Uint8Array } | undefined)?.data;
  }

  deleteSnapshots(docId: string, times: number[]) {
    const stmt = this.db.prepare('DELETE FROM snapshots WHERE doc_id = ? AND created_at = ?');
    this.transaction(() => times.forEach((t) => stmt.run(docId, t)));
  }

  // ── Partage ─────────────────────────────────────────────

  addShare(s: Omit<ShareRow, 'revoked'>) {
    this.db.prepare('INSERT INTO shares (token, doc_id, mode, created_at, created_by) VALUES (?, ?, ?, ?, ?)').run(s.token, s.doc_id, s.mode, s.created_at, s.created_by);
  }

  share(token: string): ShareRow | undefined {
    return this.db.prepare('SELECT * FROM shares WHERE token = ? AND revoked = 0').get(token) as ShareRow | undefined;
  }

  sharesOf(docId: string): ShareRow[] {
    return this.db.prepare('SELECT * FROM shares WHERE doc_id = ? AND revoked = 0 ORDER BY created_at').all(docId) as unknown as ShareRow[];
  }

  revokeShare(token: string) {
    this.db.prepare('UPDATE shares SET revoked = 1 WHERE token = ?').run(token);
  }

  // ── Fichiers ────────────────────────────────────────────

  asset(sha: string): { sha: string; mime: string; size: number } | undefined {
    return this.db.prepare('SELECT sha, mime, size FROM assets WHERE sha = ?').get(sha) as { sha: string; mime: string; size: number } | undefined;
  }

  addAsset(sha: string, mime: string, size: number, ownerId: string | null, now: number) {
    this.db.prepare('INSERT OR IGNORE INTO assets (sha, mime, size, owner_id, created_at) VALUES (?, ?, ?, ?, ?)').run(sha, mime, size, ownerId, now);
  }
}
