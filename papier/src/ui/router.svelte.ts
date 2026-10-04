export type LibraryView = 'all' | 'favorites' | 'recent' | 'folder';

export type Route =
  | { name: 'library'; view: LibraryView; folderId: string | null }
  | { name: 'notebook'; id: string };

function parse(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'nb' && parts[1]) return { name: 'notebook', id: parts[1] };
  if (parts[0] === 'f' && parts[1]) return { name: 'library', view: 'folder', folderId: parts[1] };
  if (parts[0] === 'favoris') return { name: 'library', view: 'favorites', folderId: null };
  if (parts[0] === 'recents') return { name: 'library', view: 'recent', folderId: null };
  return { name: 'library', view: 'all', folderId: null };
}

/** Routage par fragment d'URL (#/…) : fonctionne hors ligne et dans n'importe quel sous-dossier. */
export const router = $state({ route: parse(location.hash) });

window.addEventListener('hashchange', () => {
  router.route = parse(location.hash);
});

export const links = {
  all: '#/',
  favorites: '#/favoris',
  recent: '#/recents',
  folder: (id: string) => `#/f/${id}`,
  notebook: (id: string) => `#/nb/${id}`,
};

export function go(hash: string) {
  if (location.hash !== hash) location.hash = hash;
}
