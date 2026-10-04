/**
 * Recherche plein texte « à la française » : insensible à la casse, aux accents,
 * aux ligatures (œ, æ) et aux variantes d'apostrophes et de tirets.
 * Les positions trouvées sont rendues dans le texte d'origine (pour le surlignage).
 */

const SPECIAL: Record<string, string> = {
  œ: 'oe', Œ: 'oe', æ: 'ae', Æ: 'ae', ß: 'ss',
  '’': "'", '‘': "'", 'ʼ': "'", '`': "'",
  '“': '"', '”': '"', '«': '"', '»': '"',
  '–': '-', '—': '-', '‑': '-',
  '\u00a0': ' ', '\u202f': ' ', '\u2009': ' ', '\t': ' ', '\n': ' ', '\r': ' ',
};

export interface Normalized {
  norm: string;
  /** Pour chaque caractère normalisé, l'indice du caractère d'origine (+ une entrée finale). */
  map: number[];
}

export function normalizeWithMap(text: string): Normalized {
  let norm = '';
  const map: number[] = [];
  let i = 0;
  for (const ch of text) {
    const rep = SPECIAL[ch] ?? ch.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
    for (const r of rep) {
      norm += r;
      map.push(i);
    }
    i += ch.length;
  }
  map.push(text.length);
  return { norm, map };
}

export function normalize(text: string): string {
  return normalizeWithMap(text).norm;
}

/** Termes de la requête, normalisés, sans doublons (les termes inclus dans un autre sont retirés). */
export function parseQuery(query: string): string[] {
  const terms = [...new Set(normalize(query).split(/\s+/).filter((t) => t.length > 0))];
  return terms.filter((t) => !terms.some((o) => o !== t && o.includes(t)));
}

/** Le texte contient-il tous les termes ? */
export function matchesAll(text: string, terms: string[]): boolean {
  if (!terms.length) return false;
  const n = normalize(text);
  return terms.every((t) => n.includes(t));
}

/** Plages [début, fin[ (indices du texte d'origine) de toutes les occurrences des termes, triées et fusionnées. */
export function findRanges(text: string, terms: string[]): [number, number][] {
  if (!terms.length || !text) return [];
  const { norm, map } = normalizeWithMap(text);
  const raw: [number, number][] = [];
  for (const term of terms) {
    let from = 0;
    for (;;) {
      const at = norm.indexOf(term, from);
      if (at < 0) break;
      raw.push([map[at], map[at + term.length - 1] + charLen(text, map[at + term.length - 1])]);
      from = at + Math.max(1, term.length);
    }
  }
  raw.sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const r of raw) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([...r]);
  }
  return out;
}

function charLen(text: string, index: number) {
  const code = text.codePointAt(index) ?? 0;
  return code > 0xffff ? 2 : 1;
}

export interface Snippet {
  before: string;
  match: string;
  after: string;
}

/** Extrait autour d'une plage, coupé aux mots, sur une seule ligne. */
export function makeSnippet(text: string, range: [number, number], radius = 48): Snippet {
  const flat = (s: string) => s.replace(/\s+/g, ' ');
  let start = Math.max(0, range[0] - radius);
  let end = Math.min(text.length, range[1] + radius);
  if (start > 0) {
    const sp = text.indexOf(' ', start);
    if (sp >= 0 && sp < range[0]) start = sp + 1;
  }
  if (end < text.length) {
    const sp = text.lastIndexOf(' ', end);
    if (sp > range[1]) end = sp;
  }
  return {
    before: (start > 0 ? '…' : '') + flat(text.slice(start, range[0])).trimStart(),
    match: flat(text.slice(range[0], range[1])),
    after: flat(text.slice(range[1], end)).trimEnd() + (end < text.length ? '…' : ''),
  };
}
