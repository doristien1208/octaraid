import type * as THREE from 'three';

const MIN_PITCH = 0.2;
const MAX_PITCH = 1.48;
const MIN_DIST = 7;
const MAX_DIST = 32;

/**
 * Third-person orbit camera. Dragging with either mouse button turns it, the wheel zooms, and the
 * top-down view (V) looks almost straight down so ground markers are easy to read. yaw 0 looks north.
 * A left click that does not drag is passed on (choosing a target).
 */
export class CameraRig {
  yaw = 0;
  pitch = 0.78;
  dist = 16;
  /** a left click without dragging, in client pixels */
  onClick: ((x: number, y: number) => void) | null = null;
  private top: { pitch: number; dist: number } | null = null;
  private drag: { id: number; x: number; y: number; button: number; moved: number; at: number } | null = null;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly el: HTMLElement,
  ) {
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointercancel', this.onUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('contextmenu', this.onMenu);
  }

  get topDown(): boolean {
    return this.top !== null;
  }

  toggleTop(): void {
    if (this.top) {
      this.pitch = this.top.pitch;
      this.dist = this.top.dist;
      this.top = null;
    } else {
      this.top = { pitch: this.pitch, dist: this.dist };
      this.pitch = 1.45;
      this.dist = 30;
    }
  }

  /** Ground direction W moves towards. */
  forward(): [number, number] {
    return [-Math.sin(this.yaw), -Math.cos(this.yaw)];
  }

  /** Ground direction D moves towards. */
  right(): [number, number] {
    return [Math.cos(this.yaw), -Math.sin(this.yaw)];
  }

  update(x: number, z: number): void {
    const c = Math.cos(this.pitch) * this.dist;
    this.camera.position.set(x + Math.sin(this.yaw) * c, 1 + Math.sin(this.pitch) * this.dist, z + Math.cos(this.yaw) * c);
    this.camera.lookAt(x, 1, z);
  }

  dispose(): void {
    const el = this.el;
    el.removeEventListener('pointerdown', this.onDown);
    el.removeEventListener('pointermove', this.onMove);
    el.removeEventListener('pointerup', this.onUp);
    el.removeEventListener('pointercancel', this.onUp);
    el.removeEventListener('wheel', this.onWheel);
    el.removeEventListener('contextmenu', this.onMenu);
  }

  private onDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.button !== 2) return;
    this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, button: e.button, moved: 0, at: performance.now() };
    this.el.setPointerCapture(e.pointerId);
  };

  private onMove = (e: PointerEvent) => {
    if (!this.drag || e.pointerId !== this.drag.id) return;
    const dx = e.clientX - this.drag.x;
    const dy = e.clientY - this.drag.y;
    this.drag.x = e.clientX;
    this.drag.y = e.clientY;
    this.drag.moved += Math.abs(dx) + Math.abs(dy);
    if (this.drag.moved < 5) return; // a click wobbles a little before it lets go
    this.yaw -= dx * 0.006;
    this.pitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, this.pitch + dy * 0.005));
    this.top = null; // turning by hand leaves the top-down view
  };

  private onUp = (e: PointerEvent) => {
    const d = this.drag;
    if (d?.id !== e.pointerId) return;
    this.drag = null;
    if (d.button === 0 && d.moved < 5 && performance.now() - d.at < 500) this.onClick?.(e.clientX, e.clientY);
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.dist = Math.max(MIN_DIST, Math.min(MAX_DIST, this.dist * Math.exp(e.deltaY * 0.001)));
  };

  private onMenu = (e: Event) => e.preventDefault();
}
