import type { Awareness } from 'y-protocols/awareness';
import type { Editor, Peer } from '../../engine/Editor';

/** Couleurs des curseurs des personnes connectées. */
const COLORS = ['#e8590c', '#2f9e44', '#1971c2', '#c2255c', '#7048e8', '#0c8599', '#e67700'];

export function colorFor(seed: string): string {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return COLORS[Math.abs(h) % COLORS.length];
}

/**
 * Présence dans un carnet synchronisé : chacun publie son nom, sa couleur, la position de son
 * curseur et le trait qu'il est en train d'écrire (allégé) ; l'éditeur dessine ceux des autres.
 */
export class Presence {
  peers = $state.raw<Peer[]>([]);
  private last = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private awareness: Awareness,
    private editor: Editor,
    private host: HTMLElement,
    me: { name: string; color: string },
  ) {
    awareness.setLocalStateField('user', me);
    awareness.on('change', this.onChange);
    host.addEventListener('pointermove', this.onMove, { passive: true, capture: true });
    host.addEventListener('pointerdown', this.onMove, { passive: true, capture: true });
    host.addEventListener('pointerup', this.onUp, { passive: true, capture: true });
    host.addEventListener('pointerleave', this.onLeave, { passive: true });
    this.onChange();
  }

  destroy() {
    clearTimeout(this.timer);
    this.awareness.off('change', this.onChange);
    this.host.removeEventListener('pointermove', this.onMove, { capture: true });
    this.host.removeEventListener('pointerdown', this.onMove, { capture: true });
    this.host.removeEventListener('pointerup', this.onUp, { capture: true });
    this.host.removeEventListener('pointerleave', this.onLeave);
    this.awareness.setLocalState(null);
    this.editor.setPeers([]);
  }

  private onChange = () => {
    const mine = this.awareness.clientID;
    const out: Peer[] = [];
    this.awareness.getStates().forEach((s, id) => {
      if (id === mine || !s?.user) return;
      out.push({ id, name: String(s.user.name ?? 'Invité'), color: String(s.user.color ?? '#888'), cursor: s.cursor ?? null, ink: s.ink ?? null });
    });
    this.peers = out;
    this.editor.setPeers(out);
  };

  /** Au plus ~20 envois par seconde. */
  private onMove = (e: PointerEvent) => {
    const now = performance.now();
    if (now - this.last < 50) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.onMove(e), 50);
      return;
    }
    this.last = now;
    const r = this.host.getBoundingClientRect();
    this.awareness.setLocalStateField('cursor', this.editor.locate(e.clientX - r.left, e.clientY - r.top));
    this.awareness.setLocalStateField('ink', this.editor.liveStroke());
  };

  private onUp = () => {
    clearTimeout(this.timer);
    this.awareness.setLocalStateField('ink', null);
  };

  private onLeave = () => {
    clearTimeout(this.timer);
    this.awareness.setLocalStateField('cursor', null);
  };
}
