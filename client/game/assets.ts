import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * The CC0 KayKit models (CREDITS.md), loaded once per page: six characters, the weapons and the animation
 * clips (built by scripts/pack-models.mjs). If anything fails to load, the game keeps the code-built
 * characters from models.ts.
 */
export type BaseModel = 'knight' | 'barbarian' | 'mage' | 'ranger' | 'rogue' | 'rogue_hooded';
const BASES: readonly BaseModel[] = ['knight', 'barbarian', 'mage', 'ranger', 'rogue', 'rogue_hooded'];

export interface Models {
  /** the scene of each character file (clone with SkeletonUtils before use) */
  bases: Map<BaseModel, THREE.Object3D>;
  /** weapons by name, e.g. sword_1handed */
  props: Map<string, THREE.Object3D>;
  /** every clip whole, and split into the upper body (spine, arms, head) and the rest */
  clips: Map<string, THREE.AnimationClip>;
  upper: Map<string, THREE.AnimationClip>;
  lower: Map<string, THREE.AnimationClip>;
}

/** Bones that belong to the upper body: an attack can play there while the legs keep running. */
const UPPER = new Set(['spine', 'chest', 'head', 'upperarml', 'lowerarml', 'wristl', 'handl', 'handslotl', 'upperarmr', 'lowerarmr', 'wristr', 'handr', 'handslotr']);

let loading: Promise<Models | null> | null = null;
let ready: Models | null = null;

/** The models once they have loaded, else null (the caller falls back to code-built characters). */
export function loadedModels(): Models | null {
  return ready;
}

/** Starts loading (once); resolves to null when the files are missing or broken. */
export function loadModels(): Promise<Models | null> {
  loading ??= load().then(
    (m) => (ready = m),
    (err: unknown) => {
      console.warn('角色模型載入失敗，改用程式產生的角色', err);
      return null;
    },
  );
  return loading;
}

async function load(): Promise<Models> {
  const loader = new GLTFLoader();
  const url = (file: string) => new URL(`models/${file}`, document.baseURI).href;
  const [bases, props, anims] = await Promise.all([
    Promise.all(BASES.map((b) => loader.loadAsync(url(`${b}.glb`)))),
    loader.loadAsync(url('props.glb')),
    loader.loadAsync(url('anims.glb')),
  ]);
  const m: Models = { bases: new Map(), props: new Map(), clips: new Map(), upper: new Map(), lower: new Map() };
  BASES.forEach((b, k) => m.bases.set(b, bases[k]!.scene));
  for (const child of props.scene.children) m.props.set(child.name, child);
  for (const clip of anims.animations) {
    // a few clips move the whole rig (dodges): the server moves the character, so keep it in place
    const tracks = clip.tracks.filter((t) => !(t.name.startsWith('root.') && t.name.endsWith('.position')));
    const whole = new THREE.AnimationClip(clip.name, clip.duration, tracks);
    m.clips.set(clip.name, whole);
    m.upper.set(clip.name, new THREE.AnimationClip(`${clip.name}_U`, clip.duration, tracks.filter((t) => UPPER.has(t.name.split('.')[0]!))));
    m.lower.set(clip.name, new THREE.AnimationClip(`${clip.name}_L`, clip.duration, tracks.filter((t) => !UPPER.has(t.name.split('.')[0]!))));
  }
  return m;
}

// ------------------------------------------------------------------ recolouring

/**
 * Pixels whose hue lies in [h0, h1] (degrees, may wrap past 360) and whose saturation is at least `s`
 * take the colour `to`; their lightness keeps its offset from `ref`, so the texture's shading stays.
 */
export interface Recolor {
  h: [number, number];
  s: number;
  to: string;
  ref: number;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = new THREE.Color().setHSL(h / 360, s, l, THREE.SRGBColorSpace);
  return [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)];
}

const inHue = (h: number, [a, b]: [number, number]) => (a <= b ? h >= a && h <= b : h >= a || h <= b);

/** A small recoloured copy of a model's texture (the atlases are smooth gradients: 256 px is plenty). */
export function recolorTexture(source: THREE.Texture, rules: readonly Recolor[]): THREE.Texture {
  const img = source.image as CanvasImageSource & { width: number; height: number };
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0, size, size);
  if (rules.length) {
    const data = g.getImageData(0, 0, size, size);
    const px = data.data;
    const targets = rules.map((r) => {
      const c = new THREE.Color(r.to);
      const hsl = { h: 0, s: 0, l: 0 };
      c.getHSL(hsl, THREE.SRGBColorSpace);
      return [hsl.h * 360, hsl.s, hsl.l] as const;
    });
    for (let i = 0; i < px.length; i += 4) {
      const [h, s, l] = rgbToHsl(px[i]!, px[i + 1]!, px[i + 2]!);
      for (let k = 0; k < rules.length; k++) {
        const r = rules[k]!;
        if (s < r.s || !inHue(h, r.h)) continue;
        const [th, ts, tl] = targets[k]!;
        const [nr, ng, nb] = hslToRgb(th, ts, Math.max(0, Math.min(1, l + tl - r.ref)));
        px[i] = nr;
        px[i + 1] = ng;
        px[i + 2] = nb;
        break;
      }
    }
    g.putImageData(data, 0, 0);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = source.flipY;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}
