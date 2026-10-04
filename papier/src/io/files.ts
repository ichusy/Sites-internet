/** Ouvre le sélecteur de fichiers du système. */
export function pickFiles(accept: string, multiple = true): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.style.display = 'none';
    input.addEventListener('change', () => {
      resolve([...(input.files ?? [])]);
      input.remove();
    });
    input.addEventListener('cancel', () => {
      resolve([]);
      input.remove();
    });
    document.body.append(input);
    input.click();
  });
}

/** Nom de fichier sûr à partir d'un titre. */
export function safeFileName(title: string, ext: string) {
  const base = title.normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Papier';
  return `${base.slice(0, 120)}.${ext}`;
}

/**
 * Enregistre un fichier : feuille de partage sur iPad/iPhone installé en app
 * (le téléchargement y est peu pratique), téléchargement classique ailleurs.
 */
export async function saveFile(data: Blob, filename: string) {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone;
  const ios = /iP(ad|hone|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (standalone && ios && navigator.canShare) {
    const file = new File([data], filename, { type: data.type });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: filename });
        return;
      } catch (err) {
        if ((err as DOMException).name === 'AbortError') return;
      }
    }
  }
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
