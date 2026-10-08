import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { ROLE_COLORS, type Job, type Role } from '../../shared/jobs';
import { recolorTexture, type Models, type Recolor } from './assets';
import { FULL_BODY, LB_CLIP, LOOKS, type Extra, type Look } from './look';
import { CodeBody, ball, box, cone, cyl, gem, mesh, myRingMaterial, ring, shadowMaterial, toon, toonGradient } from './models';

/** KayKit characters are about 2.4 units tall: this makes them about 1.75 m. */
const SCALE = 0.72;

/** One material per job (and per weapon of a job), shared by every character wearing it. */
const materials = new Map<string, THREE.Material>();

function material(key: string, source: THREE.Texture | null | undefined, rules: readonly Recolor[]): THREE.Material {
  let m = materials.get(key);
  if (!m) {
    m = new THREE.MeshToonMaterial({ map: source ? recolorTexture(source, rules) : null, gradientMap: toonGradient() });
    materials.set(key, m);
  }
  return m;
}

function textureOf(o: THREE.Object3D): THREE.Texture | null {
  let tex: THREE.Texture | null = null;
  o.traverse((c) => {
    const m = (c as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (!tex && m && 'map' in m && m.map) tex = m.map;
  });
  return tex;
}

interface Orbiter {
  obj: THREE.Object3D;
  radius: number;
  height: number;
  speed: number;
  phase: number;
}

/**
 * Plays a KayKit character's clips: an idle or a run underneath, and on top of it one skill clip at a time.
 * Upper and lower body are separate actions, so an attack plays on the arms while the legs keep running;
 * standing still, the whole body plays the skill. Death overrides everything.
 */
class Animator {
  private readonly mixer: THREE.AnimationMixer;
  private readonly idleU: THREE.AnimationAction;
  private readonly idleL: THREE.AnimationAction;
  private readonly runU: THREE.AnimationAction;
  private readonly runL: THREE.AnimationAction;
  private readonly death: THREE.AnimationAction | null;
  private over: { u: THREE.AnimationAction; l: THREE.AnimationAction; full: boolean; t: number; ends: number } | null = null;
  private o = 0;
  private m = 0;
  private d = 0;
  private dead = false;

  constructor(
    root: THREE.Object3D,
    private readonly models: Models,
    idle: string,
    run: string,
  ) {
    this.mixer = new THREE.AnimationMixer(root);
    const base = (clip: THREE.AnimationClip | undefined) => {
      const a = this.mixer.clipAction(clip ?? new THREE.AnimationClip('none', 1, []));
      a.setEffectiveWeight(0);
      a.play();
      return a;
    };
    this.idleU = base(models.upper.get(idle));
    this.idleL = base(models.lower.get(idle));
    this.runU = base(models.upper.get(run));
    this.runL = base(models.lower.get(run));
    this.runU.timeScale = this.runL.timeScale = 1.15;
    const death = models.clips.get('Death_A');
    this.death = death ? this.mixer.clipAction(death) : null;
    if (this.death) {
      this.death.setLoop(THREE.LoopOnce, 1);
      this.death.clampWhenFinished = true;
    }
  }

  /** Plays a clip once (or looped until stopLoop); it replaces whatever skill clip was playing. */
  play(name: string, loop = false, speed = 1): void {
    const u = this.models.upper.get(name);
    const l = this.models.lower.get(name);
    if (!u || !l || this.dead) return;
    if (this.over) {
      this.over.u.stop();
      this.over.l.stop();
    }
    const ua = this.mixer.clipAction(u);
    const la = this.mixer.clipAction(l);
    for (const a of [ua, la]) {
      a.reset();
      a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      a.clampWhenFinished = true;
      a.timeScale = speed;
      a.setEffectiveWeight(this.o);
      a.play();
    }
    this.over = { u: ua, l: la, full: FULL_BODY.has(name), t: 0, ends: loop ? Infinity : u.duration / speed };
  }

  /** Ends a looped clip (a cast) with a short fade. */
  stopLoop(): void {
    if (this.over && this.over.ends === Infinity) this.over.ends = this.over.t + 0.15;
  }

  get busy(): boolean {
    return this.over !== null;
  }

  setDead(on: boolean): void {
    if (on && !this.dead && this.death) {
      this.death.reset();
      this.death.play();
    }
    this.dead = on;
  }

  update(dt: number, moving: boolean): void {
    this.m += ((moving ? 1 : 0) - this.m) * Math.min(1, dt * 10);
    let want = 0;
    const over = this.over;
    if (over) {
      over.t += dt;
      want = over.ends - over.t > 0.15 ? 1 : 0;
    }
    this.o += (want - this.o) * Math.min(1, dt * (want > this.o ? 16 : 9));
    if (over && want === 0 && this.o < 0.02) {
      over.u.stop();
      over.l.stop();
      this.over = null;
      this.o = 0;
    }
    this.d += ((this.dead ? 1 : 0) - this.d) * Math.min(1, dt * 8);
    if (!this.dead && this.d < 0.01 && this.death?.isRunning()) this.death.stop();

    const live = 1 - this.d;
    const o = this.over ? this.o : 0;
    const lo = this.over?.full ? o : o * (1 - this.m);
    this.idleU.setEffectiveWeight((1 - this.m) * (1 - o) * live);
    this.runU.setEffectiveWeight(this.m * (1 - o) * live);
    this.idleL.setEffectiveWeight((1 - this.m) * (1 - lo) * live);
    this.runL.setEffectiveWeight(this.m * (1 - lo) * live);
    if (this.over) {
      this.over.u.setEffectiveWeight(o * live);
      this.over.l.setEffectiveWeight(lo * live);
    }
    this.death?.setEffectiveWeight(this.d);
    this.mixer.update(dt);
  }

  dispose(): void {
    this.mixer.stopAllAction();
  }
}

/**
 * One player character: the KayKit model dressed for the job (or the code-built fallback), its
 * animations, a name plate, a shadow, a ring under my own character and one under my target.
 */
export class Avatar {
  readonly root = new THREE.Group();
  readonly look: Look;
  /** what a mouse click on this character hits */
  readonly hitbox: THREE.Mesh;
  private readonly holder = new THREE.Group();
  private anim: Animator | null = null;
  private code: CodeBody | null = null;
  private readonly orbiters: Orbiter[] = [];
  private readonly plate: HTMLElement;
  private readonly picked: THREE.Mesh;
  private readonly bubble: THREE.Mesh;
  private dead = false;
  private casting = false;

  constructor(
    readonly job: Job,
    name: string,
    readonly mine: boolean,
    models: Models | null,
  ) {
    this.look = LOOKS[job.id];
    this.root.add(this.holder);
    if (models) this.dress(models);
    else {
      this.code = new CodeBody(job);
      this.holder.add(this.code.body);
    }
    this.addOrbiters();

    const shadow = mesh(new THREE.CircleGeometry(0.5, 24), shadowMaterial(), 0, 0.02, 0);
    shadow.rotation.x = -Math.PI / 2;
    this.root.add(shadow);
    if (mine) {
      const me = mesh(new THREE.RingGeometry(0.6, 0.72, 40), myRingMaterial(), 0, 0.03, 0);
      me.rotation.x = -Math.PI / 2;
      this.root.add(me);
    }
    this.picked = mesh(new THREE.RingGeometry(0.78, 0.98, 40), pickMaterial('ally'), 0, 0.025, 0);
    this.picked.rotation.x = -Math.PI / 2;
    this.picked.visible = false;
    this.root.add(this.picked);
    this.bubble = mesh(new THREE.SphereGeometry(0.95, 20, 14), bubbleMaterial(), 0, 0.95, 0);
    this.bubble.visible = false;
    this.holder.add(this.bubble);
    this.hitbox = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.9, 10), hiddenMaterial());
    this.hitbox.position.y = 0.95;
    this.holder.add(this.hitbox);

    this.plate = document.createElement('div');
    this.plate.className = `nameplate ${mine ? 'mine' : ''}`;
    const badge = document.createElement('span');
    badge.className = 'np-role';
    badge.style.background = ROLE_COLORS[job.role];
    badge.textContent = job.icon;
    const label = document.createElement('span');
    label.textContent = name;
    this.plate.append(badge, label);
    const tag = new CSS2DObject(this.plate);
    tag.position.set(0, job.id === 'sorcerer' ? 2.3 : 2.1, 0);
    this.holder.add(tag);
  }

  // ------------------------------------------------------------------ building

  private dress(models: Models): void {
    const look = this.look;
    const base = models.bases.get(look.base)!;
    const model = cloneSkinned(base);
    model.scale.setScalar(SCALE);
    const body = material(`${this.job.id}:body`, textureOf(base), look.rules);
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.material = body;
      m.frustumCulled = false; // skinned meshes move away from their bounding boxes when animated
      if (look.hide.includes(m.name)) m.visible = false;
    });
    for (const p of look.props) {
      const src = models.props.get(p.name);
      const bone = model.getObjectByName(p.bone);
      if (!src || !bone) continue;
      const prop = src.clone();
      prop.position.set(0, 0, 0);
      prop.rotation.set(p.flip ? Math.PI : 0, 0, 0);
      const rules = p.rules === 'job' ? look.rules : (p.rules ?? []);
      const mat = material(`${this.job.id}:${p.name}`, textureOf(src), rules);
      prop.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = mat;
      });
      bone.add(prop);
    }
    for (const e of look.extras) this.extra(e, model);
    this.holder.add(model);
    this.anim = new Animator(model, models, look.idle, look.run);
  }

  /** Code-built additions that make a job stand out, attached to the character's bones (model units). */
  private extra(e: Extra, model: THREE.Object3D): void {
    const head = model.getObjectByName('head');
    const chest = model.getObjectByName('chest');
    const handR = model.getObjectByName('handslotr');
    const add = (parent: THREE.Object3D | undefined, o: THREE.Object3D) => parent?.add(o);
    const c = this.job.colors;
    switch (e) {
      case 'plume': {
        const plume = new THREE.Group();
        const crest = mesh(box(0.08, 0.32, 0.62), toon(c.main), 0, 0.12, -0.12);
        crest.rotation.x = -0.25;
        plume.add(crest, mesh(cone(0.08, 0.16), toon(c.trim), 0, -0.02, 0.12));
        plume.position.set(0, 1.2, -0.02);
        add(head, plume);
        break;
      }
      case 'wings':
        for (const s of [1, -1]) {
          const wing = mesh(box(0.05, 0.42, 0.5), toon('#ffffff'), s * 0.62, 0.95, -0.05);
          wing.rotation.z = -s * 0.55;
          wing.rotation.y = s * 0.25;
          add(head, wing);
        }
        break;
      case 'spear': {
        const spear = new THREE.Group();
        spear.add(mesh(cyl(0.045, 0.045, 3.1), toon('#1f6f6f'), 0, 0.55, 0));
        spear.add(mesh(cone(0.11, 0.5), toon('#d9e2ec'), 0, 2.35, 0));
        spear.add(mesh(box(0.34, 0.06, 0.06), toon(c.trim), 0, 2.06, 0));
        add(handR, spear);
        break;
      }
      case 'halo': {
        const halo = mesh(ring(0.42, 0.045), toon('#ffd34d', 0.8), 0, 0.72, -0.62);
        add(chest, halo);
        break;
      }
      case 'sunDisc': {
        const staff = model.getObjectByName('staff');
        const sun = new THREE.Group();
        sun.add(mesh(ring(0.26, 0.04), toon('#ffd34d', 0.9)));
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          const ray = mesh(cone(0.05, 0.16), toon('#ffd34d', 0.9), Math.cos(a) * 0.36, Math.sin(a) * 0.36, 0);
          ray.rotation.z = a - Math.PI / 2;
          sun.add(ray);
        }
        sun.position.set(0, 1.3, 0);
        add(staff ?? handR, sun);
        break;
      }
      case 'crown':
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2;
          add(head, mesh(cone(0.07, 0.24), toon('#b9a4ff', 0.6), Math.sin(a) * 0.36, 1.0, Math.cos(a) * 0.36));
        }
        break;
      case 'headband': {
        const band = mesh(ring(0.57, 0.05), toon('#d84343'), 0, 0.58, 0);
        band.rotation.x = Math.PI / 2;
        add(head, band);
        for (const s of [1, -1]) {
          const tail = mesh(box(0.07, 0.42, 0.03), toon('#d84343'), s * 0.09, 0.4, -0.6);
          tail.rotation.x = 0.5;
          add(head, tail);
        }
        break;
      }
      case 'fists':
        for (const bone of ['handl', 'handr']) add(model.getObjectByName(bone), mesh(ball(0.17), toon('#ff9a3c', 0.85), 0, 0.08, 0));
        break;
      case 'cap': {
        const cap = new THREE.Group();
        cap.add(mesh(cyl(0.6, 0.62, 0.06, 20), toon('#2f6b2b'), 0, 0, 0));
        cap.add(mesh(cone(0.42, 0.5, 20), toon('#3f8f3a'), 0, 0.27, 0));
        const feather = mesh(box(0.05, 0.5, 0.12), toon('#d84343'), 0.3, 0.32, -0.12);
        feather.rotation.z = -0.6;
        cap.add(feather);
        cap.position.set(0, 0.98, -0.02);
        cap.rotation.x = -0.15;
        add(head, cap);
        break;
      }
      case 'orbs':
      case 'runes':
        break; // orbiters, added in addOrbiters
    }
  }

  private addOrbiters(): void {
    const extras = this.look.extras;
    const orbit = (n: number, color: string, r: number, height: number, speed: number) => {
      for (let k = 0; k < n; k++) {
        const o = mesh(gem(0.09), toon(color, 0.9));
        this.holder.add(o);
        this.orbiters.push({ obj: o, radius: r, height, speed, phase: (k / n) * Math.PI * 2 });
      }
    };
    if (extras.includes('orbs')) orbit(3, '#b9a4ff', 0.75, 1.15, 1.6);
    if (extras.includes('runes')) orbit(2, '#ff5a2c', 0.7, 0.95, 2.4);
  }

  // ------------------------------------------------------------------ playing

  /** A skill went off: its clip (the basic skill: one per combo step). */
  playSkill(slot: number, step = 0): void {
    const s = this.look.skills[slot];
    if (!s) return;
    this.casting = false;
    this.anim?.play(typeof s === 'string' ? s : s[step % 3]!);
  }

  /** the victory pose, looped until the results screen goes */
  cheer(): void {
    this.casting = false;
    this.anim?.play('Cheering', true);
  }

  get facing(): number {
    return this.holder.rotation.y;
  }

  playLimitBreak(role: Role): void {
    this.casting = false;
    this.anim?.play(LB_CLIP[role], false, role === 'healer' ? 2 : 1);
  }

  setCasting(on: boolean): void {
    if (on === this.casting) return;
    this.casting = on;
    if (on) this.anim?.play(this.look.cast, true);
    else this.anim?.stopLoop();
  }

  /** a flinch on a heavy hit, unless something else is playing */
  hurt(): void {
    if (this.anim && !this.anim.busy) this.anim.play('Hit_A');
  }

  setDead(dead: boolean): void {
    if (dead === this.dead) return;
    this.dead = dead;
    this.anim?.setDead(dead);
    this.plate.classList.toggle('dead', dead);
    if (this.code) this.code.body.rotation.x = dead ? -Math.PI / 2 : 0;
  }

  setPicked(kind: 'enemy' | 'ally' | null): void {
    this.picked.visible = kind !== null;
    if (kind) this.picked.material = pickMaterial(kind);
  }

  setShield(on: boolean): void {
    this.bubble.visible = on && !this.dead;
  }

  setOffline(off: boolean): void {
    this.plate.classList.toggle('offline', off);
  }

  /** Places and animates the character for this frame; lift raises it (a jump). */
  update(x: number, z: number, f: number, moving: boolean, dt: number, time: number, lift = 0): void {
    this.root.position.set(x, 0, z);
    this.holder.position.y = lift;
    this.holder.rotation.y = f;
    this.anim?.update(dt, moving && !this.dead);
    this.code?.update(moving && !this.dead, dt, time);
    for (const o of this.orbiters) {
      const a = time * o.speed + o.phase;
      o.obj.position.set(Math.cos(a) * o.radius, o.height + Math.sin(a * 2) * 0.08, Math.sin(a) * o.radius);
      o.obj.rotation.y = a * 2;
    }
  }

  dispose(): void {
    this.anim?.dispose();
    this.plate.remove();
  }
}

const pickMats = new Map<string, THREE.Material>();
function pickMaterial(kind: 'enemy' | 'ally'): THREE.Material {
  let m = pickMats.get(kind);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color: kind === 'enemy' ? 0xff3b3b : 0x4dff88, transparent: true, opacity: 0.8, depthWrite: false });
    pickMats.set(kind, m);
  }
  return m;
}

let bubbleMat: THREE.Material | null = null;
function bubbleMaterial(): THREE.Material {
  bubbleMat ??= new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.16, depthWrite: false });
  return bubbleMat;
}

let hiddenMat: THREE.Material | null = null;
function hiddenMaterial(): THREE.Material {
  hiddenMat ??= new THREE.MeshBasicMaterial({ visible: false });
  return hiddenMat;
}
