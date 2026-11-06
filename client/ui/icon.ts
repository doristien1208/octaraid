import { STATUS, type StatusId } from '../../shared/status';
import { h } from '../dom';
import { iconOf, type SkillIcon } from '../skill-icons';

type Size = 'xs' | 'tg' | 'sm' | 'md' | 'lg';

function tile(icon: SkillIcon, size: Size): HTMLElement {
  const el = h('b', { class: `glyph icon ${size}` });
  el.style.setProperty('--a', icon.tint[0]);
  el.style.setProperty('--b', icon.tint[1]);
  el.innerHTML = `<svg viewBox="0 0 512 512" aria-hidden="true"><path d="${icon.path}"/></svg>`;
  return el;
}

/**
 * A skill's (or limit break's) icon: its picture on its colour (client/skill-icons.ts), 26, 36 or 44 px.
 * A name without a picture shows its first character on grey.
 */
export function iconTile(name: string, size: 'sm' | 'md' | 'lg'): HTMLElement {
  const icon = iconOf(name);
  return icon ? tile(icon, size) : h('b', { class: `glyph ${size}`, style: { background: '#6b6585' } }, name.slice(0, 1));
}

/** Statuses named differently from the skill that gives them. */
const STATUS_SKILL: Partial<Record<StatusId, string>> = {
  starShield: '星盾術',
  airborne: '天降擊',
};

/**
 * A status's icon, 16, 22 or 26 px: the picture of the skill that gives it (a DoT shows the skill that
 * put it there), else its glyph on blue (a buff) or red (a debuff: the bosses' marks and penalties).
 */
export function statusTile(id: StatusId, size: 'xs' | 'tg' | 'sm'): HTMLElement {
  const info = STATUS[id];
  const icon = iconOf(STATUS_SKILL[id] ?? info.name);
  return icon ? tile(icon, size) : h('b', { class: `glyph ${size} ${info.good ? 'good' : 'bad'}` }, info.icon);
}
