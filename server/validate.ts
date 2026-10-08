import { VOTE_OPTIONS } from '../shared/encounters';
import { isJobId } from '../shared/jobs';
import type { C2S } from '../shared/protocol';

const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length <= max ? v : null);
const num = (v: unknown, limit: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= limit ? v : null;

/** Parses and validates one client message; anything malformed is dropped. */
export function parseC2S(raw: string): C2S | null {
  if (raw.length > 2048) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object') return null;
  const m = v as Record<string, unknown>;
  switch (m.t) {
    case 'hello': {
      const name = str(m.name, 64);
      return name === null ? null : { t: 'hello', name, token: str(m.token, 64) ?? undefined };
    }
    case 'create': {
      const name = str(m.name, 64);
      return name === null ? null : { t: 'create', name };
    }
    case 'join': {
      const code = str(m.code, 16);
      const name = str(m.name, 64);
      return code === null || name === null ? null : { t: 'join', code, name };
    }
    case 'leave':
      return { t: 'leave' };
    case 'job':
      return isJobId(m.job) ? { t: 'job', job: m.job } : null;
    case 'vote': {
      if (m.opt === null) return { t: 'vote', opt: null };
      const opt = m.opt;
      return typeof opt === 'number' && Number.isInteger(opt) && opt >= 0 && opt < VOTE_OPTIONS.length
        ? { t: 'vote', opt }
        : null;
    }
    case 'ready':
      return typeof m.ready === 'boolean' ? { t: 'ready', ready: m.ready } : null;
    case 'start':
      return { t: 'start' };
    case 'chat': {
      const text = str(m.text, 500);
      return text === null ? null : { t: 'chat', text };
    }
    case 'mv': {
      const x = num(m.x, 1000);
      const z = num(m.z, 1000);
      const f = num(m.f, 100);
      return x === null || z === null || f === null ? null : { t: 'mv', x, z, f };
    }
    case 'endtest':
      return { t: 'endtest' };
    case 'ping': {
      if (typeof m.c !== 'number' || !Number.isFinite(m.c)) return null;
      const r = typeof m.r === 'number' && Number.isFinite(m.r) ? Math.max(0, Math.min(9999, Math.round(m.r))) : undefined;
      return { t: 'ping', c: m.c, r };
    }
    default:
      return null;
  }
}

/** Strips control characters, collapses whitespace and trims to `max` characters. */
export function cleanText(raw: string, max: number): string {
  return [...raw.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim()].slice(0, max).join('');
}
