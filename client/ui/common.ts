import { jobById, ROLE_COLORS, type JobId } from '../../shared/jobs';
import type { Audio } from '../audio';
import { h, store } from '../dom';
/** Kept here rather than in game/view.ts so the settings dialog does not pull in the 3D code. */
export const AUTO_HEAL_KEY = 'octaraid.autoheal';
import { keyEditor } from './keys';

/** The job glyph on its role colour, e.g. a blue 盾. */
export function jobBadge(id: JobId, size: 'sm' | 'md' | 'lg' = 'md'): HTMLElement {
  const job = jobById(id);
  return h('span', { class: `job-badge ${size}`, style: { background: ROLE_COLORS[job.role] }, title: job.name }, job.icon);
}

export type Quality = 'high' | 'medium' | 'low';
export const QUALITY_NAMES: Readonly<Record<Quality, string>> = { high: '高', medium: '中', low: '低' };

export function loadQuality(): Quality {
  const q = store.get('octaraid.quality');
  return q === 'medium' || q === 'low' ? q : 'high';
}

/** Rendering resolution for a quality setting (office PCs with integrated graphics can go lower). */
export function pixelRatioFor(q: Quality): number {
  const dpr = window.devicePixelRatio || 1;
  return q === 'high' ? Math.min(dpr, 2) : q === 'medium' ? 1 : 0.75;
}

/** Sound, picture quality and key settings; `onClose` runs when the dialog goes (e.g. to refresh key hints). */
export function settingsModal(audio: Audio, onClose?: () => void): void {
  const sfx = h('button', { class: 'btn' });
  const paintSfx = () => {
    sfx.textContent = `音效：${audio.sfxOn ? '開' : '關'}`;
  };
  sfx.onclick = () => {
    audio.toggleSfx();
    paintSfx();
  };
  paintSfx();

  const autoHeal = h('button', { class: 'btn' });
  const paintAutoHeal = () => {
    autoHeal.textContent = `補師單體治療自動選人：${store.get(AUTO_HEAL_KEY) === 'off' ? '關' : '開'}`;
  };
  autoHeal.onclick = () => {
    store.set(AUTO_HEAL_KEY, store.get(AUTO_HEAL_KEY) === 'off' ? 'on' : 'off');
    paintAutoHeal();
  };
  paintAutoHeal();

  const quality = h('div', { class: 'seg' });
  const paintQuality = () => {
    const now = loadQuality();
    quality.replaceChildren(
      ...(['high', 'medium', 'low'] as const).map((q) =>
        h(
          'button',
          {
            class: q === now ? 'on' : '',
            onclick: () => {
              store.set('octaraid.quality', q);
              window.dispatchEvent(new Event('octaraid:quality'));
              paintQuality();
            },
          },
          QUALITY_NAMES[q],
        ),
      ),
    );
  };
  paintQuality();

  const close = () => {
    back.remove();
    onClose?.();
  };
  const back = h(
    'div',
    { class: 'modal-back', onclick: (e: Event) => e.target === back && close() },
    h(
      'div',
      { class: 'modal wide' },
      h('h3', null, '設定'),
      h('div', { class: 'row' }, sfx, h('span', { class: 'muted small' }, '畫質'), quality),
      h('p', { class: 'muted small' }, '畫面卡頓時把畫質調低；只影響這台電腦。'),
      h('div', { class: 'row' }, autoHeal),
      h('p', { class: 'muted small' }, '開：沒選隊友時，單體治療給射程內 HP 比例最低的人；關：給自己。'),
      h('h4', null, '按鍵'),
      keyEditor(),
      h('div', { class: 'row end' }, h('button', { class: 'btn primary', onclick: close }, '完成')),
    ),
  );
  document.body.append(back);
}
