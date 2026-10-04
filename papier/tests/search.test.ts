import { describe, expect, it } from 'vitest';
import { findRanges, makeSnippet, matchesAll, normalize, parseQuery } from '../src/core/search/match';

describe('recherche plein texte', () => {
  it('normalise accents, casse, ligatures et apostrophes', () => {
    expect(normalize('Élève Œuvre l’ÉTÉ')).toBe("eleve oeuvre l'ete");
  });

  it('découpe la requête en termes utiles', () => {
    expect(parseQuery('  Mitochondrie  mito  ATP ')).toEqual(['mitochondrie', 'atp']);
  });

  it('exige tous les termes', () => {
    expect(matchesAll('La mitochondrie produit l’ATP', ['atp', 'mitochondrie'])).toBe(true);
    expect(matchesAll('La mitochondrie', ['atp', 'mitochondrie'])).toBe(false);
  });

  it('rend les positions dans le texte d’origine malgré accents et ligatures', () => {
    const text = 'Le cœur et l’été — énergie';
    const [r] = findRanges(text, parseQuery('ete'));
    expect(text.slice(r[0], r[1])).toBe('été');
    const [c] = findRanges(text, parseQuery('coeur'));
    expect(text.slice(c[0], c[1])).toBe('cœur');
  });

  it('trouve toutes les occurrences et fusionne les chevauchements', () => {
    const ranges = findRanges('ATP, atp et Atp', ['atp']);
    expect(ranges).toHaveLength(3);
    expect(findRanges('abcabc', ['abc', 'bca'])).toEqual([[0, 6]]);
  });

  it('fabrique un extrait lisible', () => {
    const text = 'Introduction. La membrane plasmique délimite la cellule et contrôle les échanges avec le milieu extérieur.';
    const [r] = findRanges(text, ['membrane']);
    const s = makeSnippet(text, r, 20);
    expect(s.match).toBe('membrane');
    expect(s.before.startsWith('…') || s.before.length < 25).toBe(true);
    expect(s.after.endsWith('…')).toBe(true);
  });
});
