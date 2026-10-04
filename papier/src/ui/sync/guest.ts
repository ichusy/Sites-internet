const KEY = 'papier-guest-name';

/** Nom affiché aux autres quand on ouvre un carnet partagé sans compte. */
export function guestName(): string {
  try {
    return localStorage.getItem(KEY) || 'Invité';
  } catch {
    return 'Invité';
  }
}

export function setGuestName(name: string) {
  try {
    localStorage.setItem(KEY, name.trim().slice(0, 40));
  } catch {
    /* stockage indisponible */
  }
}
