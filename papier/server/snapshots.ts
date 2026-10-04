const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Délai minimal entre deux versions enregistrées d'un même carnet. */
export const SNAPSHOT_EVERY = HOUR;

/**
 * Versions à supprimer pour garder un historique lisible et borné :
 * toutes celles des dernières 48 h, puis une par jour jusqu'à 30 jours,
 * puis une par semaine jusqu'à un an. On garde la plus récente de chaque période.
 * `times` : dates de création (ms), dans n'importe quel ordre.
 */
export function snapshotsToPrune(times: number[], now: number): number[] {
  const sorted = [...times].sort((a, b) => b - a);
  const keptBuckets = new Set<string>();
  const prune: number[] = [];
  for (const t of sorted) {
    const age = now - t;
    if (age < 2 * DAY) continue;
    let bucket: string;
    if (age < 30 * DAY) bucket = `d${Math.floor(t / DAY)}`;
    else if (age < 365 * DAY) bucket = `w${Math.floor(t / (7 * DAY))}`;
    else {
      prune.push(t);
      continue;
    }
    if (keptBuckets.has(bucket)) prune.push(t);
    else keptBuckets.add(bucket);
  }
  return prune;
}
