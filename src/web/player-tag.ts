/**
 * Show a player tag ("Nickname#0639") in `target`, with the #discriminator in a lighter color
 * (.tag-num). Nicknames can't contain "#", so the last "#" always starts the discriminator.
 */
export function renderTag(target: HTMLElement, tag: string): void {
  const at = tag.lastIndexOf('#');
  if (at < 0) {
    target.textContent = tag;
    return;
  }
  const num = document.createElement('span');
  num.className = 'tag-num';
  num.textContent = tag.slice(at);
  target.replaceChildren(tag.slice(0, at), num);
}
