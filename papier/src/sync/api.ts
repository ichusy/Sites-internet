/** Accès à l'API du serveur Papier (voir server/http.ts). */

export interface Auth {
  /** Jeton de session (compte). */
  token?: string;
  /** Jeton d'un lien de partage. */
  share?: string;
}

export interface UserInfo {
  id: string;
  email: string;
  name: string;
}

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** « https://notes.exemple.fr/ » → « https://notes.exemple.fr » */
export function normalizeServer(url: string): string {
  let u = url.trim().replace(/\/+$/, '');
  if (u && !/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u;
}

export function wsBase(server: string): string {
  return `${server.replace(/^http/i, 'ws')}/sync`;
}

interface CallOptions {
  method?: string;
  auth?: Auth;
  json?: unknown;
  body?: BodyInit;
  type?: string;
  signal?: AbortSignal;
}

export async function apiFetch(server: string, path: string, opts: CallOptions = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.auth?.token) headers.Authorization = `Bearer ${opts.auth.token}`;
  if (opts.auth?.share) headers['X-Papier-Share'] = opts.auth.share;
  if (opts.json !== undefined) headers['Content-Type'] = 'application/json';
  else if (opts.type) headers['Content-Type'] = opts.type;
  let res: Response;
  try {
    res = await fetch(server + path, {
      method: opts.method ?? (opts.json !== undefined || opts.body ? 'POST' : 'GET'),
      headers,
      body: opts.json !== undefined ? JSON.stringify(opts.json) : opts.body,
      signal: opts.signal,
      cache: 'no-store',
    });
  } catch (err) {
    if ((err as DOMException)?.name === 'AbortError') throw err;
    throw new ApiError(0, 'Serveur injoignable (hors ligne ?).');
  }
  if (!res.ok) {
    let message = `Erreur ${res.status}`;
    try {
      message = ((await res.json()) as { error?: string }).error ?? message;
    } catch {
      /* réponse non JSON */
    }
    throw new ApiError(res.status, message);
  }
  return res;
}

export async function apiJson<T>(server: string, path: string, opts: CallOptions = {}): Promise<T> {
  return (await apiFetch(server, path, opts)).json() as Promise<T>;
}

export interface ServerInfo {
  app: string;
  version: string;
  signup: boolean;
  publicUrl: string;
}

/** Vérifie qu'une adresse est bien un serveur Papier. */
export async function serverInfo(server: string, signal?: AbortSignal): Promise<ServerInfo> {
  const info = await apiJson<ServerInfo>(server, '/api/info', { signal });
  if (info.app !== 'papier') throw new ApiError(0, 'Ce n’est pas un serveur Papier.');
  return info;
}
