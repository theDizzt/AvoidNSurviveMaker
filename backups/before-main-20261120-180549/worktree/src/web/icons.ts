/**
 * Line icons for the editor's command buttons (24×24, drawn in the button's text color).
 * `.ico-fill` parts are solid, `.ico-bg` parts are filled with the button background so a
 * shape can sit "behind" another.
 */
const SQ_A = 'M3 3h12v12H3z';
const SQ_B = 'M9 9h12v12H9z';

export const ICONS = {
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  zoomIn: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4M8 11h6M11 8v6"/>',
  zoomOut: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4M8 11h6"/>',
  panels: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 4v16M16 4v16"/>',
  panelsHidden: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 4v16M16 4v16" stroke-dasharray="2 2.5" opacity=".5"/><path d="m3 3 18 18"/>',
  fullscreen: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  exitFullscreen: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',

  // Stacking order: the solid square is the selection
  front: '<rect x="2" y="2" width="10" height="10" rx="1.5" class="ico-bg"/><rect x="7" y="7" width="10" height="10" rx="1.5" class="ico-bg"/><rect x="12" y="12" width="10" height="10" rx="1.5" class="ico-fill"/>',
  forward: '<rect x="3" y="3" width="12" height="12" rx="1.5" class="ico-bg"/><rect x="9" y="9" width="12" height="12" rx="1.5" class="ico-fill"/>',
  backward: '<rect x="3" y="3" width="12" height="12" rx="1.5" class="ico-fill"/><rect x="9" y="9" width="12" height="12" rx="1.5" class="ico-bg"/>',
  back: '<rect x="2" y="2" width="10" height="10" rx="1.5" class="ico-fill"/><rect x="7" y="7" width="10" height="10" rx="1.5" class="ico-bg"/><rect x="12" y="12" width="10" height="10" rx="1.5" class="ico-bg"/>',

  alignLeft: '<path d="M4 3v18"/><rect x="7" y="6" width="13" height="4" rx="1"/><rect x="7" y="14" width="7" height="4" rx="1"/>',
  alignCenter: '<path d="M12 3v18"/><rect x="5" y="6" width="14" height="4" rx="1"/><rect x="8" y="14" width="8" height="4" rx="1"/>',
  alignRight: '<path d="M20 3v18"/><rect x="4" y="6" width="13" height="4" rx="1"/><rect x="10" y="14" width="7" height="4" rx="1"/>',
  alignTop: '<path d="M3 4h18"/><rect x="6" y="7" width="4" height="13" rx="1"/><rect x="14" y="7" width="4" height="7" rx="1"/>',
  alignMiddle: '<path d="M3 12h18"/><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="8" width="4" height="8" rx="1"/>',
  alignBottom: '<path d="M3 20h18"/><rect x="6" y="4" width="4" height="13" rx="1"/><rect x="14" y="10" width="4" height="7" rx="1"/>',
  distH: '<path d="M3 3v18M21 3v18"/><rect x="9" y="7" width="6" height="10" rx="1"/>',
  distV: '<path d="M3 3h18M3 21h18"/><rect x="7" y="9" width="10" height="6" rx="1"/>',

  rotCW: '<path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 3v5h-5"/>',
  rotCCW: '<path d="M4 12a8 8 0 1 0 2.34-5.66"/><path d="M4 3v5h5"/>',
  flipH: '<path d="M12 2v20" stroke-dasharray="2 2"/><path d="M9 6 3 18h6z"/><path d="m15 6 6 12h-6z" class="ico-fill"/>',
  flipV: '<path d="M2 12h20" stroke-dasharray="2 2"/><path d="M6 9 18 3v6z"/><path d="m6 15 12 6v-6z" class="ico-fill"/>',

  group: '<rect x="2" y="2" width="20" height="20" rx="2" stroke-dasharray="3 2.5"/><rect x="6" y="6" width="7" height="7" rx="1"/><rect x="11" y="11" width="7" height="7" rx="1" class="ico-bg"/>',
  ungroup: '<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/><path d="M14 4h6v6M4 14v6h6" stroke-dasharray="2 2" opacity=".55"/>',
  regroup: '<rect x="2" y="2" width="20" height="20" rx="2" stroke-dasharray="3 2.5"/><path d="M16.5 12a4.5 4.5 0 1 1-1.3-3.2"/><path d="M16 6.5v2.8h-2.8"/>',

  union: `<path d="M3 3h12v6h6v12H9v-6H3z" class="ico-fill"/>`,
  combine: `<path d="${SQ_A}${SQ_B}" class="ico-fill" fill-rule="evenodd"/>`,
  fragment: `<path d="${SQ_A}"/><path d="${SQ_B}"/><rect x="9" y="9" width="6" height="6" class="ico-fill" opacity=".6"/>`,
  intersect: `<path d="${SQ_A}${SQ_B}" stroke-dasharray="2 2" opacity=".6"/><rect x="9" y="9" width="6" height="6" class="ico-fill"/>`,
  subtract: `<path d="M3 3h12v6H9v6H3z" class="ico-fill"/><path d="${SQ_B}" stroke-dasharray="2 2" opacity=".6"/>`,

  makePath: '<rect x="3" y="5" width="18" height="14" rx="2" stroke-dasharray="3 2"/>',
  makeWall: '<rect x="3" y="5" width="18" height="14" rx="2" class="ico-fill"/>',
  duplicate: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  trash: '<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M5 6l1 14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-14M10 11v6M14 11v6"/>',
} as const;

export type IconName = keyof typeof ICONS;

export function iconSvg(name: IconName): string {
  return `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
}

/** Turn a button into an icon button: the label becomes its tooltip and accessible name. */
export function setIcon(b: HTMLButtonElement, name: IconName, label: string, keys?: string): HTMLButtonElement {
  b.innerHTML = iconSvg(name);
  b.classList.add('icon-btn');
  b.title = keys ? `${label} (${keys})` : label;
  b.setAttribute('aria-label', label);
  return b;
}
