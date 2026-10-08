// Builds client/public/models from the two CC0 KayKit packs (see CREDITS.md), keeping only what the game uses:
//   node scripts/pack-models.mjs <KayKit_Adventurers_2.0_FREE folder> <KayKit_Character_Animations_1.1 folder>
// - the six Rig_Medium characters, copied as they are
// - props.glb: the weapons, merged into one file with their textures embedded
// - anims.glb: the animation clips the game plays, without the mannequin mesh they ship with
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [advDir, animDir] = process.argv.slice(2).map((p) => resolve(p));
if (!advDir || !animDir) {
  console.error('usage: node scripts/pack-models.mjs <adventurers folder> <animations folder>');
  process.exit(1);
}
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'client', 'public', 'models');
mkdirSync(out, { recursive: true });

const CHARACTERS = ['Knight', 'Barbarian', 'Mage', 'Ranger', 'Rogue', 'Rogue_Hooded'];
const PROPS = ['sword_1handed', 'shield_square_color', 'axe_2handed', 'staff', 'wand', 'bow_withString', 'spellbook_open'];
const ANIM_SETS = ['General', 'MovementBasic', 'MovementAdvanced', 'CombatMelee', 'CombatRanged', 'Simulation'];
const CLIPS = [
  'Idle_A',
  'Hit_A',
  'Death_A',
  'Death_A_Pose',
  'Spawn_Ground',
  'Use_Item',
  'Running_A',
  'Running_HoldingBow',
  'Jump_Full_Short',
  'Dodge_Backward',
  'Dodge_Forward',
  'Melee_1H_Attack_Chop',
  'Melee_1H_Attack_Slice_Diagonal',
  'Melee_1H_Attack_Slice_Horizontal',
  'Melee_1H_Attack_Stab',
  'Melee_1H_Attack_Jump_Chop',
  'Melee_2H_Attack_Chop',
  'Melee_2H_Attack_Slice',
  'Melee_2H_Attack_Spin',
  'Melee_2H_Attack_Stab',
  'Melee_2H_Idle',
  'Melee_Block',
  'Melee_Unarmed_Attack_Punch_A',
  'Melee_Unarmed_Attack_Kick',
  'Melee_Unarmed_Idle',
  'Melee_Dualwield_Attack_Chop',
  'Ranged_Bow_Release',
  'Ranged_Bow_Idle',
  'Ranged_Magic_Shoot',
  'Ranged_Magic_Spellcasting',
  'Ranged_Magic_Raise',
  'Ranged_Magic_Summon',
  'Cheering',
];

const COMPONENT_BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_COUNT = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

/** The binary chunk being written: pieces appended at 4-byte aligned offsets. */
class Bin {
  parts = [];
  length = 0;
  add(buf) {
    const pad = (4 - (this.length % 4)) % 4;
    if (pad) this.parts.push(Buffer.alloc(pad));
    const at = this.length + pad;
    this.parts.push(buf);
    this.length = at + buf.length;
    return at;
  }
  get buffer() {
    return Buffer.concat(this.parts, this.length);
  }
}

function readGlb(file) {
  const buf = readFileSync(file);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file} is not a .glb`);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const binAt = 20 + jsonLen;
  const bin = binAt < buf.length ? buf.subarray(binAt + 8, binAt + 8 + buf.readUInt32LE(binAt)) : Buffer.alloc(0);
  return { json, bin };
}

function writeGlb(file, json, bin) {
  json.buffers = [{ byteLength: bin.length }];
  const text = Buffer.from(JSON.stringify(json), 'utf8');
  const textPad = (4 - (text.length % 4)) % 4;
  const binPad = (4 - (bin.length % 4)) % 4;
  const total = 12 + 8 + text.length + textPad + 8 + bin.length + binPad;
  const o = Buffer.alloc(total);
  o.writeUInt32LE(0x46546c67, 0);
  o.writeUInt32LE(2, 4);
  o.writeUInt32LE(total, 8);
  o.writeUInt32LE(text.length + textPad, 12);
  o.writeUInt32LE(0x4e4f534a, 16);
  text.copy(o, 20);
  o.fill(0x20, 20 + text.length, 20 + text.length + textPad);
  const at = 20 + text.length + textPad;
  o.writeUInt32LE(bin.length + binPad, at);
  o.writeUInt32LE(0x004e4942, at + 4);
  bin.copy(o, at + 8);
  writeFileSync(file, o);
  return total;
}

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

// ---------------------------------------------------------------- characters

for (const name of CHARACTERS) {
  const src = join(advDir, 'Characters', 'gltf', `${name}.glb`);
  const dst = join(out, `${name.toLowerCase()}.glb`);
  copyFileSync(src, dst);
  console.log(`${name.toLowerCase()}.glb ${kb(statSync(dst).size)}`);
}

// ---------------------------------------------------------------- props

{
  const json = {
    asset: { version: '2.0', generator: 'octaraid pack-models' },
    scene: 0,
    scenes: [{ nodes: [] }],
    nodes: [],
    meshes: [],
    materials: [],
    textures: [],
    images: [],
    samplers: [],
    accessors: [],
    bufferViews: [],
  };
  const bin = new Bin();
  const imageByFile = new Map();
  for (const name of PROPS) {
    const dir = join(advDir, 'Assets', 'gltf');
    const g = JSON.parse(readFileSync(join(dir, `${name}.gltf`), 'utf8'));
    if (g.buffers.length !== 1) throw new Error(`${name}: expected one buffer`);
    const binAt = bin.add(readFileSync(join(dir, g.buffers[0].uri)));
    const base = {
      bufferView: json.bufferViews.length,
      accessor: json.accessors.length,
      mesh: json.meshes.length,
      material: json.materials.length,
      texture: json.textures.length,
      sampler: json.samplers.length,
      node: json.nodes.length,
    };
    for (const v of g.bufferViews) json.bufferViews.push({ ...v, buffer: 0, byteOffset: (v.byteOffset ?? 0) + binAt });
    for (const a of g.accessors) json.accessors.push({ ...a, bufferView: a.bufferView + base.bufferView });
    for (const s of g.samplers ?? []) json.samplers.push(s);
    // images become buffer views; the same texture file is stored once
    const imageMap = (g.images ?? []).map((im) => {
      const file = join(dir, im.uri);
      if (!imageByFile.has(file)) {
        const view = json.bufferViews.length;
        json.bufferViews.push({ buffer: 0, byteOffset: bin.add(readFileSync(file)), byteLength: statSync(file).size });
        imageByFile.set(file, json.images.length);
        json.images.push({ name: im.uri.replace(/\.png$/, ''), mimeType: 'image/png', bufferView: view });
      }
      return imageByFile.get(file);
    });
    for (const t of g.textures ?? [])
      json.textures.push({ ...t, source: imageMap[t.source], ...(t.sampler !== undefined ? { sampler: t.sampler + base.sampler } : {}) });
    for (const m of g.materials ?? []) {
      const copy = JSON.parse(JSON.stringify(m));
      const tex = copy.pbrMetallicRoughness?.baseColorTexture;
      if (tex) tex.index += base.texture;
      json.materials.push(copy);
    }
    for (const m of g.meshes)
      json.meshes.push({
        ...m,
        primitives: m.primitives.map((p) => ({
          ...p,
          attributes: Object.fromEntries(Object.entries(p.attributes).map(([k, v]) => [k, v + base.accessor])),
          ...(p.indices !== undefined ? { indices: p.indices + base.accessor } : {}),
          ...(p.material !== undefined ? { material: p.material + base.material } : {}),
        })),
      });
    for (const n of g.nodes)
      json.nodes.push({
        ...n,
        ...(n.mesh !== undefined ? { mesh: n.mesh + base.mesh } : {}),
        ...(n.children ? { children: n.children.map((c) => c + base.node) } : {}),
      });
    for (const r of g.scenes[g.scene ?? 0].nodes) json.scenes[0].nodes.push(r + base.node);
  }
  if (!json.samplers.length) delete json.samplers;
  console.log(`props.glb ${kb(writeGlb(join(out, 'props.glb'), json, bin.buffer))} (${PROPS.length} props)`);
}

// ---------------------------------------------------------------- animations

{
  const sets = ANIM_SETS.map((s) => readGlb(join(animDir, 'Animations', 'gltf', 'Rig_Medium', `Rig_Medium_${s}.glb`)));
  // the skeleton of the first set, without the mannequin's meshes and skin
  const first = sets[0].json;
  const nodes = first.nodes.map((n) => {
    const { mesh, skin, ...rest } = n;
    return rest;
  });
  const keep = new Set();
  const visit = (i) => {
    keep.add(i);
    for (const c of first.nodes[i].children ?? []) visit(c);
  };
  const rootIndex = first.nodes.findIndex((n) => n.name === 'root');
  visit(rootIndex);
  const indexByName = new Map();
  const newIndex = new Map();
  for (const i of [...keep].sort((a, b) => a - b)) newIndex.set(i, newIndex.size);
  const outNodes = [...newIndex.keys()].map((i) => {
    const n = { ...nodes[i] };
    if (n.children) n.children = n.children.filter((c) => newIndex.has(c)).map((c) => newIndex.get(c));
    indexByName.set(n.name, newIndex.get(i));
    return n;
  });
  const json = {
    asset: { version: '2.0', generator: 'octaraid pack-models' },
    scene: 0,
    scenes: [{ nodes: [newIndex.get(rootIndex)] }],
    nodes: outNodes,
    accessors: [],
    bufferViews: [],
    animations: [],
  };
  const bin = new Bin();
  const copied = new Map(); // samplers of a clip usually share one time accessor: copy it once
  const copyAccessor = (set, index) => {
    const key = `${sets.indexOf(set)}/${index}`;
    if (copied.has(key)) return copied.get(key);
    const a = set.json.accessors[index];
    const view = set.json.bufferViews[a.bufferView];
    if (view.byteStride || a.sparse) throw new Error('strided or sparse animation data is not supported');
    const size = COMPONENT_BYTES[a.componentType] * TYPE_COUNT[a.type] * a.count;
    const start = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const at = bin.add(Buffer.from(set.bin.subarray(start, start + size)));
    json.bufferViews.push({ buffer: 0, byteOffset: at, byteLength: size });
    json.accessors.push({ ...a, bufferView: json.bufferViews.length - 1, byteOffset: undefined });
    copied.set(key, json.accessors.length - 1);
    return json.accessors.length - 1;
  };
  const missing = [];
  for (const clip of CLIPS) {
    const set = sets.find((s) => s.json.animations?.some((a) => a.name === clip));
    if (!set) {
      missing.push(clip);
      continue;
    }
    const anim = set.json.animations.find((a) => a.name === clip);
    const samplers = anim.samplers.map((s) => ({ ...s, input: copyAccessor(set, s.input), output: copyAccessor(set, s.output) }));
    const channels = anim.channels
      .map((c) => {
        const name = set.json.nodes[c.target.node].name;
        return indexByName.has(name) ? { ...c, target: { ...c.target, node: indexByName.get(name) } } : null;
      })
      .filter(Boolean);
    json.animations.push({ name: clip, samplers, channels });
  }
  if (missing.length) throw new Error(`clips not found: ${missing.join(', ')}`);
  for (const a of json.accessors) delete a.byteOffset;
  console.log(`anims.glb ${kb(writeGlb(join(out, 'anims.glb'), json, bin.buffer))} (${json.animations.length} clips)`);
}

if (!existsSync(join(out, 'knight.glb'))) process.exit(1);
