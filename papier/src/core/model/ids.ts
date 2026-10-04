/** Identifiants courts, aléatoires et triables grossièrement par date. */
export function newId(): string {
  const time = Date.now().toString(36);
  const rand = new Uint8Array(8);
  crypto.getRandomValues(rand);
  let r = '';
  for (const b of rand) r += (b % 36).toString(36);
  return `${time}${r}`;
}

let lastZ = 0;

/**
 * Valeur d'empilement croissante (z) pour les nouveaux éléments.
 * Basée sur l'horloge pour rester cohérente entre appareils, strictement croissante localement.
 */
export function nextZ(): number {
  const now = Date.now();
  lastZ = now > lastZ ? now : lastZ + 0.001;
  return lastZ;
}
