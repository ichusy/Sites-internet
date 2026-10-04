import { resolve } from 'node:path';

/** Réglages du serveur, lus dans les variables d'environnement (voir README). */
export interface Config {
  port: number;
  host: string;
  /** Dossier des données : base SQLite et fichiers. */
  dataDir: string;
  /** Adresse publique (https://…) : sert à construire les liens de partage. */
  publicUrl: string;
  /** Création de comptes ouverte à tous (sinon : seulement le premier compte). */
  allowSignup: boolean;
  /** Application compilée à servir (dossier dist/), ou null pour ne servir que l'API. */
  staticDir: string | null;
  /** Taille maximale d'un fichier envoyé (Mo). */
  maxUploadMb: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.PORT ?? 8787);
  return {
    port,
    host: env.HOST ?? '0.0.0.0',
    dataDir: resolve(env.DATA_DIR ?? './papier-data'),
    publicUrl: (env.PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/+$/, ''),
    allowSignup: /^(1|true|oui|yes)$/i.test(env.ALLOW_SIGNUP ?? ''),
    staticDir: env.STATIC_DIR === '' ? null : resolve(env.STATIC_DIR ?? './dist'),
    maxUploadMb: Number(env.MAX_UPLOAD_MB ?? 500),
  };
}
