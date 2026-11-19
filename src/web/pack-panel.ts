import { t as tr } from './i18n';
import { gameplayKey, levelLabel } from './localized/level';
import { encodePack } from './localized/share';
import { PACK_VERSION, type MapData, type MapPack } from '../core/types';
import { LIMITS, validatePack } from './localized/validate';

/**
 * Map pack builder in the editor: collect levels, order them, open one to edit, save the edits
 * back, and play / export / share the whole pack. The pack being built is kept in this browser.
 */

const STORAGE_KEY = 'avoid-n-survive:pack';

/** What the pack panel needs from the editor */
export interface PackHost {
  getMap(): MapData;
  isVerified(map: MapData): boolean;
  openMap(map: MapData, verified: boolean): void;
}

interface Stored {
  pack: MapPack;
  /** Per level: cleared in test play (needed to share the pack) */
  verified: boolean[];
  /** Level currently open in the editor */
  opened: number | null;
}

function emptyPack(): MapPack {
  return { pack: PACK_VERSION, name: tr('pack.myMapPack'), author: '', levels: [] };
}

export class PackPanel {
  /** Play the pack from level `index` */
  onPlay: (pack: MapPack, index: number) => void = () => {};

  private pack: MapPack = emptyPack();
  private verified: boolean[] = [];
  private opened: number | null = null;
  private readonly name: HTMLInputElement;
  private readonly author: HTMLInputElement;
  private readonly list: HTMLElement;
  private readonly status: HTMLElement;
  private readonly actions: HTMLElement;
  private readonly shareUrl: HTMLInputElement;
  private readonly file: HTMLInputElement;

  constructor(root: HTMLElement, private readonly host: PackHost) {
    this.restore();

    const field = (label: string, input: HTMLElement) => {
      const l = document.createElement('label');
      l.className = 'field wide';
      const s = document.createElement('span');
      s.textContent = label;
      l.append(s, input);
      return l;
    };
    this.name = document.createElement('input');
    this.name.maxLength = LIMITS.maxText;
    this.name.addEventListener('change', () => {
      this.pack.name = this.name.value.trim().slice(0, LIMITS.maxText) || tr('map.untitledPack');
      this.commit();
    });
    this.author = document.createElement('input');
    this.author.maxLength = LIMITS.maxText;
    this.author.addEventListener('change', () => {
      this.pack.author = this.author.value.trim().slice(0, LIMITS.maxText);
      this.commit();
    });
    const fields = document.createElement('div');
    fields.className = 'fields';
    fields.append(field(tr('pack.packName'), this.name), field(tr('pack.packAuthor'), this.author));

    this.list = document.createElement('ol');
    this.list.className = 'pack-list';
    this.status = document.createElement('p');
    this.status.className = 'muted pack-status';
    this.actions = document.createElement('div');
    this.actions.className = 'actions';
    this.shareUrl = document.createElement('input');
    this.shareUrl.readOnly = true;
    this.shareUrl.placeholder = tr('pack.packShareLinkAppearsHere');
    this.file = document.createElement('input');
    this.file.type = 'file';
    this.file.accept = '.json,application/json';
    this.file.hidden = true;
    this.file.addEventListener('change', () => void this.importFile());

    root.replaceChildren(fields, this.list, this.status, this.actions, this.shareUrl, this.file);
    this.render();
  }

  /** A level cleared in play: mark matching pack levels as verified */
  markVerified(map: MapData): void {
    const key = gameplayKey(map);
    let changed = false;
    this.pack.levels.forEach((l, i) => {
      if (!this.verified[i] && gameplayKey(l) === key) changed = this.verified[i] = true;
    });
    if (changed) this.commit();
  }

  /** Re-render (the editor's map changed) */
  refresh(): void {
    this.render();
  }

  // ───────────────────────── State ─────────────────────────

  private restore(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as Partial<Stored>;
      // An empty pack can't pass validation, so keep its name / author separately
      const levels = Array.isArray(data.pack?.levels) ? data.pack.levels : [];
      this.pack = levels.length ? validatePack(data.pack) : { ...emptyPack(), name: data.pack?.name || tr('pack.myMapPack'), author: data.pack?.author ?? '' };
      this.verified = this.pack.levels.map((_, i) => data.verified?.[i] === true);
      this.opened = typeof data.opened === 'number' && data.opened < this.pack.levels.length ? data.opened : null;
    } catch {
      this.pack = emptyPack();
    }
  }

  private commit(): void {
    try {
      const data: Stored = { pack: this.pack, verified: this.verified, opened: this.opened };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      /* storage unavailable */
    }
    this.shareUrl.value = '';
    this.render();
  }

  /** Is the open level edited in the editor but not saved back to the pack? */
  private dirty(): boolean {
    if (this.opened === null) return false;
    return JSON.stringify(this.host.getMap()) !== JSON.stringify(this.pack.levels[this.opened]);
  }

  private isVerified(i: number): boolean {
    // A test-play clear in the editor counts too
    if (!this.verified[i] && this.host.isVerified(this.pack.levels[i])) this.verified[i] = true;
    return this.verified[i];
  }

  // ───────────────────────── Actions ─────────────────────────

  private add(): void {
    if (this.pack.levels.length >= LIMITS.maxPackLevels) return alert(tr('pack.full', { max: LIMITS.maxPackLevels }));
    const map = this.host.getMap();
    this.pack.levels.push(map);
    this.verified.push(this.host.isVerified(map));
    this.opened = this.pack.levels.length - 1;
    this.commit();
  }

  private saveOpened(): void {
    if (this.opened === null) return;
    const map = this.host.getMap();
    this.pack.levels[this.opened] = map;
    this.verified[this.opened] = this.host.isVerified(map);
    this.commit();
  }

  private open(i: number): void {
    this.opened = i;
    this.host.openMap(this.pack.levels[i], this.verified[i]);
    this.commit();
  }

  private move(i: number, d: -1 | 1): void {
    const j = i + d;
    if (j < 0 || j >= this.pack.levels.length) return;
    const swap = <T>(a: T[]) => ([a[i], a[j]] = [a[j], a[i]]);
    swap(this.pack.levels);
    swap(this.verified);
    if (this.opened === i) this.opened = j;
    else if (this.opened === j) this.opened = i;
    this.commit();
  }

  private remove(i: number): void {
    if (!confirm(tr('pack.confirmRemove', { label: levelLabel(this.pack.levels[i]) }))) return;
    this.pack.levels.splice(i, 1);
    this.verified.splice(i, 1);
    if (this.opened === i) this.opened = null;
    else if (this.opened !== null && this.opened > i) this.opened--;
    this.commit();
  }

  /** Level numbers follow the pack order: 1, 2, 3… */
  private renumber(): void {
    this.pack.levels.forEach((l, i) => (l.level = i + 1));
    this.commit();
    // Keep the editor in step when the open level got a new number
    if (this.opened !== null) this.host.openMap(this.pack.levels[this.opened], this.verified[this.opened]);
  }

  private newPack(): void {
    if (this.pack.levels.length && !confirm(tr('pack.startANewEmptyMap'))) return;
    this.pack = emptyPack();
    this.verified = [];
    this.opened = null;
    this.commit();
  }

  private exportFile(): void {
    const blob = new Blob([JSON.stringify(validatePack(this.pack), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${this.pack.name.replace(/[\\/:*?"<>|]/g, '_') || 'map-pack'}.pack.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  private async importFile(): Promise<void> {
    const f = this.file.files?.[0];
    this.file.value = '';
    if (!f) return;
    try {
      const pack = validatePack(JSON.parse(await f.text()));
      if (this.pack.levels.length && !confirm(tr('pack.confirmReplace', { name: pack.name, n: pack.levels.length }))) return;
      this.pack = pack;
      // Imported levels have to be cleared again before the pack can be shared
      this.verified = pack.levels.map(() => false);
      this.opened = null;
      this.commit();
    } catch (err) {
      alert(tr('pack.loadFailed', { message: (err as Error).message }));
    }
  }

  private async share(): Promise<void> {
    const code = await encodePack(validatePack(this.pack));
    const url = `${location.origin}${location.pathname}#p=${code}`;
    this.shareUrl.value = url;
    this.shareUrl.select();
    try {
      await navigator.clipboard.writeText(url);
      this.status.textContent = tr('pack.linkCopied', { n: url.length });
    } catch {
      this.status.textContent = tr('pack.linkManual', { n: url.length });
    }
  }

  // ───────────────────────── View ─────────────────────────

  private button(text: string, onClick: () => void, opts: { title?: string; disabled?: boolean; cls?: string } = {}): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    if (opts.title) {
      b.title = opts.title;
      b.setAttribute('aria-label', opts.title);
    }
    if (opts.cls) b.className = opts.cls;
    b.disabled = !!opts.disabled;
    b.addEventListener('click', onClick);
    return b;
  }

  private render(): void {
    if (document.activeElement !== this.name) this.name.value = this.pack.name;
    if (document.activeElement !== this.author) this.author.value = this.pack.author;
    const n = this.pack.levels.length;
    const dirty = this.dirty();

    this.list.replaceChildren(...this.pack.levels.map((l, i) => {
      const li = document.createElement('li');
      li.className = i === this.opened ? 'open' : '';
      const label = document.createElement('span');
      label.className = 'pack-label';
      label.textContent = levelLabel(l);
      label.title = tr('pack.file', { name: l.name });
      const badge = document.createElement('span');
      const ok = this.isVerified(i);
      badge.className = ok ? 'pack-badge ok' : 'pack-badge';
      badge.textContent = ok ? '✓' : '!';
      badge.title = tr(ok ? 'pack.verified' : 'pack.unverified');
      const tools = document.createElement('span');
      tools.className = 'pack-tools';
      tools.append(
        this.button(tr(i === this.opened ? 'pack.editing' : 'pack.open'), () => this.open(i), { title: tr('pack.openInTheEditor'), disabled: i === this.opened }),
        this.button('↑', () => this.move(i, -1), { title: tr('pack.moveUp'), disabled: i === 0 }),
        this.button('↓', () => this.move(i, 1), { title: tr('pack.moveDown'), disabled: i === n - 1 }),
        this.button('✕', () => this.remove(i), { title: tr('pack.removeFromPack'), cls: 'danger' }),
      );
      li.append(badge, label, tools);
      return li;
    }));

    const unverified = this.pack.levels.filter((_, i) => !this.isVerified(i)).length;
    this.status.textContent = !n
      ? tr('pack.statusEmpty')
      : dirty
        ? tr('pack.statusDirty', { n: this.opened! + 1 })
        : unverified
          ? tr(n === 1 ? 'pack.statusUnverifiedOne' : 'pack.statusUnverifiedMany', { n, unverified })
          : tr(n === 1 ? 'pack.statusReadyOne' : 'pack.statusReadyMany', { n });

    this.actions.replaceChildren(
      this.button(tr('pack.addCurrentMap'), () => this.add(), { cls: 'primary' }),
      this.button(tr('pack.saveToPack'), () => this.saveOpened(), { disabled: !dirty, title: tr('pack.replaceTheOpenLevelWith') }),
      this.button(tr('pack.playPack'), () => this.onPlay(validatePack(this.pack), this.opened ?? 0), { disabled: !n }),
      this.button(tr('pack.number1N'), () => this.renumber(), { disabled: !n, title: tr('pack.setEachLevelNumberTo') }),
      this.button(tr('pack.sharePack'), () => void this.share(), { disabled: !n || unverified > 0, title: unverified ? 'Every level must be cleared first' : 'Create a share link' }),
      this.button(tr('pack.export'), () => this.exportFile(), { disabled: !n, title: tr('pack.downloadThePackAsA') }),
      this.button(tr('pack.import'), () => this.file.click(), { title: tr('pack.loadAPackJsonFile') }),
      this.button(tr('pack.newPack'), () => this.newPack(), { cls: 'danger' }),
    );
  }
}
