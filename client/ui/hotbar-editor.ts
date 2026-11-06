import { jobById, skillAt, type Job, type JobId } from '../../shared/jobs';
import { h } from '../dom';
import { BAR_SKILLS, clearAt, defaultLayout, loadLayout, place, saveLayout, swap, type Layout } from '../hotbar';
import { BAR_ACTIONS, keysText, loadBindings } from '../keys';
import { iconTile } from './icon';

/** The icon of the skill in a skill slot of the job (0–9, SPRINT_SLOT). */
export function skillGlyph(job: Job, slot: number, size: 'sm' | 'md' | 'lg' = 'lg'): HTMLElement {
  return iconTile(skillAt(job, slot)!.name, size);
}

/**
 * 技能配置: which skill goes on which hotbar slot, for one job. Drag a skill from the list onto a slot; drag
 * a slot onto another to swap them, or off the bar to empty it. Without dragging: click a skill, then a
 * slot. Right-click (or ×) empties a slot. Saved at once; `onChange` lets the hotbar follow.
 */
export function hotbarEditor(jobId: JobId, onChange?: (layout: Layout) => void): void {
  const job = jobById(jobId);
  const keys = loadBindings();
  let layout = loadLayout(jobId);
  /** a skill picked by a click, waiting for a slot (from: the slot it came from) */
  let picked: { skill: number; from: number | null } | null = null;
  const grid = h('div', { class: 'bar-grid' });
  const palette = h('div', { class: 'bar-palette' });
  const note = h('p', { class: 'bar-note small' });
  const name = (skill: number) => skillAt(job, skill)?.name ?? '';
  const keyOf = (pos: number) => keysText(keys, BAR_ACTIONS[pos]!) || '無鍵';

  const commit = (next: Layout, text: string) => {
    layout = next;
    saveLayout(jobId, layout);
    onChange?.(layout);
    note.textContent = text;
    picked = null;
    render();
  };

  const drop = (skill: number, from: number | null, to: number) => {
    if (from === to) return render();
    if (from === null) commit(place(layout, to, skill), `「${name(skill)}」放到熱鍵 ${to + 1}（${keyOf(to)}）`);
    else commit(swap(layout, from, to), `熱鍵 ${from + 1} 和熱鍵 ${to + 1} 互換`);
  };

  const remove = (pos: number) => {
    const skill = layout[pos];
    if (skill === null || skill === undefined) return;
    commit(clearAt(layout, pos), `已從熱鍵 ${pos + 1} 拿掉「${name(skill)}」`);
  };

  /** Click or drag: a press that moves more than a few pixels drags, otherwise it is a click. */
  const press = (e: PointerEvent, skill: number, from: number | null, click: () => void) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const [x0, y0] = [e.clientX, e.clientY];
    let ghost: HTMLElement | null = null;
    const move = (ev: PointerEvent) => {
      if (!ghost && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
      if (!ghost) {
        ghost = h('div', { class: 'bar-ghost' }, skillGlyph(job, skill), h('span', null, name(skill)));
        document.body.append(ghost);
      }
      ghost.style.left = `${ev.clientX}px`;
      ghost.style.top = `${ev.clientY}px`;
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!ghost) return click();
      ghost.remove();
      const cell = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-pos]');
      if (cell) drop(skill, from, Number(cell.dataset.pos));
      else if (from !== null) remove(from); // dragged off the bar
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const render = () => {
    const cell = (pos: number) => {
      const skill = layout[pos] ?? null;
      const el = h(
        'div',
        {
          class: `bar-cell ${skill === null ? 'empty' : ''} ${picked && picked.from === pos ? 'picked' : ''}`,
          'data-pos': String(pos),
          title: skill === null ? '空格：把技能拖到這裡' : `${skillAt(job, skill)!.name}：${skillAt(job, skill)!.desc}`,
          oncontextmenu: (e: Event) => {
            e.preventDefault();
            remove(pos);
          },
        },
        h('span', { class: 'bar-key' }, keyOf(pos)),
        skill === null ? h('span', { class: 'bar-empty' }, '空') : skillGlyph(job, skill),
        skill === null ? null : h('span', { class: 'tname' }, name(skill)),
        skill === null
          ? null
          : h(
              'button',
              {
                class: 'bar-x',
                title: '拿掉',
                onclick: (e: Event) => {
                  e.stopPropagation();
                  remove(pos);
                },
              },
              '×',
            ),
      );
      el.addEventListener('pointerdown', (e) => {
        if ((e.target as HTMLElement).closest('.bar-x')) return;
        const clickSlot = () => {
          if (picked) {
            if (picked.from === null) drop(picked.skill, null, pos);
            else drop(picked.skill, picked.from, pos);
          } else if (skill !== null) {
            picked = { skill, from: pos };
            note.textContent = `已選「${name(skill)}」：再點一個熱鍵格放過去（會互換）`;
            render();
          }
        };
        if (skill === null) {
          if (e.button === 0) clickSlot();
          return;
        }
        press(e, skill, pos, clickSlot);
      });
      return el;
    };
    grid.replaceChildren(
      h('div', { class: 'bar-row' }, ...[6, 7, 8, 9, 10, 11].map(cell)),
      h('div', { class: 'bar-row' }, ...[0, 1, 2, 3, 4, 5].map(cell)),
    );
    palette.replaceChildren(
      ...BAR_SKILLS.map((skill) => {
        const s = skillAt(job, skill)!;
        const at = layout.indexOf(skill);
        const el = h(
          'div',
          { class: `bar-tile ${at >= 0 ? 'placed' : ''} ${picked?.skill === skill && picked.from === null ? 'picked' : ''}`, title: `${s.name}：${s.desc}` },
          skillGlyph(job, skill),
          h('span', { class: 'tname' }, s.name),
          h('span', { class: 'tkind small' }, s.kind === 'gcd' ? 'GCD' : '能力技'),
          h('span', { class: 'tat small' }, at >= 0 ? `熱鍵 ${at + 1}` : '未放'),
        );
        el.addEventListener('pointerdown', (e) =>
          press(e, skill, null, () => {
            picked = picked?.skill === skill && picked.from === null ? null : { skill, from: null };
            note.textContent = picked ? `已選「${s.name}」：再點一個熱鍵格放過去` : '';
            render();
          }),
        );
        return el;
      }),
    );
  };

  const close = () => {
    window.removeEventListener('keydown', onKey, true);
    back.remove();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.code !== 'Escape') return;
    e.stopPropagation();
    if (picked) {
      picked = null;
      note.textContent = '';
      render();
    } else close();
  };
  window.addEventListener('keydown', onKey, true);

  const back = h(
    'div',
    { class: 'modal-back' },
    h(
      'div',
      { class: 'modal wide bar-editor' },
      h('h3', null, `技能配置：${job.name}`),
      h(
        'p',
        { class: 'muted small' },
        '把下方的技能拖到熱鍵格；拖到另一格會互換，拖出熱鍵列就拿掉（右鍵或 × 也能拿掉）。不想拖曳的話，先點技能、再點格子。每個職業各存一份，存在這台電腦。',
      ),
      grid,
      note,
      h('h4', null, `${job.name}的技能`),
      palette,
      h(
        'div',
        { class: 'row end' },
        h('button', { class: 'btn', onclick: () => commit(defaultLayout(), '已恢復預設配置') }, '恢復預設'),
        h('button', { class: 'btn primary', onclick: close }, '完成'),
      ),
    ),
  );
  render();
  document.body.append(back);
}
