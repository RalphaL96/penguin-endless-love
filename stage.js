// Penguin Endless Love / Endless Summer: 3D stage
// Three.js scene with a custom studio environment, finish materials,
// pointer / gyroscope steering with a vertical camera orbit, and an
// "awakening" intro.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const FINISHES = {
  silver:  { color: 0xf1f3f5, metalness: 1.0, roughness: 0.055 },
  gold:    { color: 0xe2b867, metalness: 1.0, roughness: 0.13 },
  onyx:    { color: 0x050607, metalness: 0.0, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.03 },
  emerald: { color: 0x0a6a44, metalness: 0.55, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.04 },
  ruby:    { color: 0x8c0f26, metalness: 0.55, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.04 },
  custom:  { color: 0xffffff, metalness: 0.15, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05 },
  heart:   { color: 0xd9c3a5, metalness: 1.0, roughness: 0.16 },
  clay:    { color: 0xc4c7ca, metalness: 0.0, roughness: 0.78 }, // unpainted resin, before baptism
};

// The hosted preview cannot serve .glb, so it sets window.PEL_MODEL_EXT = '.gltf.json'.
const EXT = window.PEL_MODEL_EXT || '.glb';
export const MODELS = {
  stand: { url: `penguin-standing${EXT}`, yaw: 0 },
  rest:  { url: `penguin-rest${EXT}`, yaw: Math.PI / 2 },
  heart: { url: `heart${EXT}`, yaw: 0, crease: Math.PI / 5 },
  standLo: { url: `penguin-standing-lo${EXT}`, yaw: 0 },
  restLo: { url: `penguin-rest-lo${EXT}`, yaw: 0 },
  // rigged standing penguin with 8 clips: Idle, Walk, Wave, Look, Sleep, Lean, Hop, Slide
  standRig: { url: `penguin-standing-rig${EXT}` },
  // rigged reclining penguin (Endless Summer), same 8 clip names with lying-down motion
  restRig: { url: `penguin-rest-rig${EXT}` },
};

// Where the magnetic heart sits: upper centre of the chest, just under the beak.
// The chest direction is found from the model itself (where the beak points
// relative to the head), so it works for any pose. y = fraction of the height.
const HEART_DOCK = {
  stand: { y: 0.6, size: 0.15, tilt: false },
  rest:  { y: 0.58, size: 0.22, tilt: true },
};

// Studio palettes: cold glacier for Endless Love, low golden sun for Endless Summer.
export const ENVS = {
  polar: { bg: 0x26323d, top: 0xeef3f7, left: 0xffffff, right: 0xd8e6f2, floor: 0x7f8c97, warm: 0xcdbba4, back: 0x4f6577 },
  summer: { bg: 0x3b2b25, top: 0xfff0de, left: 0xffe2bf, right: 0xffd2a6, floor: 0x9a8170, warm: 0xf0a865, back: 0x8a5a40 },
};

const loader = new GLTFLoader();
const geometryCache = {};

// .gltf.json carries its buffer as base64; rebuild a GLB in memory so nothing
// else has to be fetched (the preview host blocks data: fetches).
async function loadGltf(url) {
  if (!url.endsWith('.gltf.json')) return loader.loadAsync(url);
  const json = await (await fetch(url)).json();
  const b64 = json.buffers[0].uri.split(',')[1];
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  delete json.buffers[0].uri;
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jPad = (4 - (jsonBytes.length % 4)) % 4;
  const bPad = (4 - (bin.length % 4)) % 4;
  const total = 12 + 8 + jsonBytes.length + jPad + 8 + bin.length + bPad;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.length + jPad, true); dv.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20); out.fill(0x20, 20 + jsonBytes.length, 20 + jsonBytes.length + jPad);
  const bo = 20 + jsonBytes.length + jPad;
  dv.setUint32(bo, bin.length + bPad, true); dv.setUint32(bo + 4, 0x004e4942, true);
  out.set(bin, bo + 8);
  return loader.parseAsync(out.buffer, '');
}

// The whole glTF (scene, skeleton, animations), for models that move.
const gltfCache = {};
export function loadRig(key) {
  if (!gltfCache[key]) gltfCache[key] = loadGltf(MODELS[key].url);
  return gltfCache[key];
}

export function loadModel(key) {
  if (!geometryCache[key]) {
    geometryCache[key] = loadGltf(MODELS[key].url).then((gltf) => {
      let mesh = null;
      gltf.scene.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
      mesh.updateWorldMatrix(true, false);
      let geo = mesh.geometry.clone();
      // quantized attributes (int16/uint16) must become float before baking the node transform
      for (const name of ['position', 'normal']) {
        const at = geo.getAttribute(name);
        if (!at || at.array instanceof Float32Array) continue;
        const f = new Float32Array(at.count * 3);
        for (let i = 0; i < at.count; i++) { f[i * 3] = at.getX(i); f[i * 3 + 1] = at.getY(i); f[i * 3 + 2] = at.getZ(i); }
        geo.setAttribute(name, new THREE.BufferAttribute(f, 3));
      }
      geo.applyMatrix4(mesh.matrixWorld); // bake the quantization transform
      if (geo.getAttribute('normal')) geo.normalizeNormals();
      if (MODELS[key].flat) {             // keep the carved facets crisp
        geo = geo.toNonIndexed();
        geo.computeVertexNormals();
      } else if (MODELS[key].crease) {    // soft surfaces, sharp carved edges
        geo = toCreasedNormals(geo, MODELS[key].crease);
      }
      geo.computeBoundingBox();
      return geo;
    });
  }
  return geometryCache[key];
}

// Feathered alpha mask so every light reflects with soft edges, like a real softbox.
let featherTex = null;
function feather() {
  if (featherTex) return featherTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const img = g.createImageData(128, 128);
  const edge = (u) => { const d = Math.min(u, 1 - u) / 0.32; return d >= 1 ? 1 : d * d * (3 - 2 * d); };
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const v = Math.round(255 * edge((x + 0.5) / 128) * edge((y + 0.5) / 128));
    const i = (y * 128 + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  featherTex = new THREE.CanvasTexture(c);
  return featherTex;
}

export function buildEnvironment(renderer, p) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(p.bg).multiplyScalar(1.7);
  const panel = (w, h, color, intensity, pos, rot) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide,
        alphaMap: feather(), transparent: true, depthWrite: false,
      })
    );
    m.position.set(...pos);
    if (rot) m.rotation.set(...rot);
    scene.add(m);
  };
  // floor: dark near the sculpture, lifting toward the horizon (no flat grey band)
  {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    const fl = new THREE.Color(p.floor);
    grd.addColorStop(0, `rgb(${fl.r * 150},${fl.g * 150},${fl.b * 150})`);
    grd.addColorStop(1, `rgb(${Math.min(255, fl.r * 330)},${Math.min(255, fl.g * 330)},${Math.min(255, fl.b * 330)})`);
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const floor = new THREE.Mesh(new THREE.CircleGeometry(12, 48), new THREE.MeshBasicMaterial({ map: t, side: THREE.DoubleSide }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -1.2;
    scene.add(floor);
  }
  panel(8, 8, p.top, 2.8, [0, 5, 0.5], [Math.PI / 2, 0, 0]);               // overhead softbox
  panel(1.6, 7.5, p.left, 5.0, [-3.6, 2.2, 0.6], [0, Math.PI / 2.3, 0]);    // left strip
  panel(1.3, 7.5, p.right, 3.6, [3.6, 2.2, 1.2], [0, -Math.PI / 2.3, 0]);   // right strip
  panel(14, 0.5, p.top, 1.6, [0, 1.0, -4.5]);                              // thin horizon line behind
  panel(16, 7, p.top, 1.0, [0, 2.2, 5.5]);                                 // broad front fill
  panel(16, 4, p.warm, 0.5, [0, -0.6, 4.6], [0.5, Math.PI, 0]);            // warm glow, low and diffuse
  panel(8, 5, p.back, 1.0, [0, 2.4, -4.4]);                                // back fill
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(scene, 0.02).texture;
  pmrem.dispose();
  return tex;
}

export function contactShadowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(128, 128, 4, 128, 128, 128);
  grd.addColorStop(0, 'rgba(0,0,0,0.62)');
  grd.addColorStop(0.45, 'rgba(0,0,0,0.25)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// h 0–360, s and v 0–1 → THREE.Color (sRGB input)
export function hsvColor(h, s, v) {
  const f = (n) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return new THREE.Color().setRGB(f(5), f(3), f(1), THREE.SRGBColorSpace);
}

export class Stage {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.opts = Object.assign({
      model: 'stand', env: 'polar', intro: false, frameHeight: 1.18, cameraY: 0.5,
      baseYaw: 0, yawRange: 0.65,
      baseElevation: 0.08, elevationRange: 0.16, // camera orbit (radians) above/below the base
      spin: false, shadow: true, finish: 'silver', onReady: null,
      heart: false, heartDocked: false, // magnetic heart accessory
    }, opts);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.scene.environment = buildEnvironment(this.renderer, ENVS[this.opts.env] || ENVS.polar);
    this.camera = new THREE.PerspectiveCamera(28, 1, 0.05, 50);

    this.scaler = new THREE.Group();
    this.pivot = new THREE.Group();
    this.animG = new THREE.Group();     // personality animation lives here
    this.pivot.add(this.animG);
    this.anim = { key: null, w: 0, prev: null, pw: 0 };
    this.scene.add(this.scaler);
    this.scaler.add(this.pivot);

    this.material = new THREE.MeshPhysicalMaterial();
    this.material.envMapIntensity = 0;
    this.surface = 'gloss';
    this.setFinish(this.opts.finish);

    if (this.opts.shadow) {
      this.shadow = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ map: contactShadowTexture(), transparent: true, depthWrite: false })
      );
      this.shadow.rotation.x = -Math.PI / 2;
      this.shadow.position.y = 0.001;
      this.scaler.add(this.shadow);
    }

    this.target = { x: 0, y: 0 };
    this.introOn = this.opts.intro && !REDUCED;
    this.current = { yaw: this.introOn ? -2.8 : this.opts.baseYaw, el: this.opts.baseElevation };
    this.spinYaw = 0;
    this.scaleTarget = 1;
    this.lastInput = 0;
    this.envCurrent = this.introOn ? 0 : 1;
    this.visible = true;
    this.clock = new THREE.Clock();

    if (this.opts.heart) {
      this.heartMaterial = new THREE.MeshPhysicalMaterial(FINISHES.heart);
      this.heartMaterial.envMapIntensity = 1;
      this.heartT = this.opts.heartDocked ? 1 : 0;
      this.heartGoal = this.heartT;
      this.heartSpin = 0;
    }

    this.resize = this.resize.bind(this);
    this.loop = this.loop.bind(this);
    new ResizeObserver(this.resize).observe(canvas);
    new IntersectionObserver(([e]) => { this.visible = e.isIntersecting; }, { threshold: 0 }).observe(canvas);
    this.resize();
    this.setModel(this.opts.model);
    requestAnimationFrame(this.loop);
  }

  async setModel(key) {
    this.modelKey = key;
    const geo = await loadModel(key);
    if (this.modelKey !== key) return;
    if (this.mesh) this.animG.remove(this.mesh);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.rotation.y = MODELS[key].yaw;
    this.animG.add(this.mesh);
    const box = new THREE.Box3().setFromObject(this.mesh);
    const c = box.getCenter(new THREE.Vector3());
    this.mesh.position.x -= c.x;
    this.mesh.position.z -= c.z;
    const size = box.getSize(new THREE.Vector3());
    if (this.opts.heart) await this.placeHeart(key, size);
    if (this.shadow) {
      const foot = Math.max(size.x, size.z);
      this.shadow.scale.set(foot * 1.9, foot * 1.9, 1);
    }
    this.frame(size);
    if (!this.ready) {
      this.ready = true;
      this.introStart = performance.now();
      this.opts.onReady && this.opts.onReady();
    }
  }

  // Compute the docked (on the chest) and free (beside the sculpture) poses of the heart.
  async placeHeart(key, size) {
    const geo = await loadModel('heart');
    const dock = HEART_DOCK[key];
    if (!this.heart) {
      this.heart = new THREE.Mesh(geo, this.heartMaterial);
      this.animG.add(this.heart);
    }
    const saved = { r: this.pivot.rotation.clone(), s: this.scaler.scale.clone() };
    this.pivot.rotation.set(0, 0, 0); this.scaler.scale.setScalar(1);
    this.animG.position.set(0, 0, 0); this.animG.rotation.set(0, 0, 0); this.animG.scale.setScalar(1);
    this.scene.updateMatrixWorld(true);
    // beak tip = highest vertex; head = average of the top 12% of the model
    const pos = this.mesh.geometry.attributes.position;
    const v = new THREE.Vector3(), tip = new THREE.Vector3(0, -1e9, 0), head = new THREE.Vector3();
    const pts = [];
    for (let i = 0; i < pos.count; i += 3) {
      v.fromBufferAttribute(pos, i).applyMatrix4(this.mesh.matrixWorld);
      pts.push(v.clone());
      if (v.y > tip.y) tip.copy(v);
    }
    let count = 0;
    for (const q of pts) if (q.y > size.y * 0.88) { head.add(q); count++; }
    head.divideScalar(Math.max(1, count));
    const facing = new THREE.Vector3(tip.x - head.x, 0, tip.z - head.z);
    if (facing.lengthSq() < 1e-8) facing.set(0, 0, 1);
    facing.normalize();
    const dir = facing.clone().negate();            // travel from in front of the chest toward it
    const target = new THREE.Vector3(head.x, size.y * dock.y, head.z);
    const origin = target.clone().addScaledVector(facing, 5);
    const hit = new THREE.Raycaster(origin, dir).intersectObject(this.mesh, false)[0];
    let p = target.clone(), n = dir.clone().negate();
    if (hit) {
      p = hit.point.clone();
      n = hit.face.normal.clone().transformDirection(this.mesh.matrixWorld);
      if (!dock.tilt) n.y = 0;
      n.normalize().lerp(dir.clone().negate(), 0.35).normalize();
    }
    this.pivot.rotation.copy(saved.r); this.scaler.scale.copy(saved.s);

    const s = size.y * dock.size;
    this.heart.scale.setScalar(s);
    // Face the heart outward along n, then turn it around: its flat side (+z of the
    // model) rests against the chest and the carved side shows.
    const m = new THREE.Matrix4().lookAt(n, new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
    const quat = new THREE.Quaternion().setFromRotationMatrix(m)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
    // the heart's origin is its tip; shift so its centre sits on the chest point
    const centre = new THREE.Vector3(0, 0.5, 0).applyQuaternion(quat).multiplyScalar(s);
    const dockPos = p.clone().sub(centre).addScaledVector(n, s * 0.2);
    this.heartDock = { pos: dockPos, quat };
    // free: floating in front of the chest and a little to the side
    const side = new THREE.Vector3(0, 1, 0).cross(n).normalize();
    this.heartFree = { pos: dockPos.clone().addScaledVector(n, s * 2.4).addScaledVector(side, s * 1.4).add(new THREE.Vector3(0, s * 0.3, 0)) };
  }

  setHeartDocked(on) { if (this.opts.heart) this.heartGoal = on ? 1 : 0; }
  get heartDocked() { return this.heartGoal === 1; }

  // Fit the model for both height and width; the orbit radius is reused each frame.
  frame(size) {
    const m = this.opts.frameHeight;
    const vt = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    const distH = (size.y * m * 0.5) / vt;
    const distW = (Math.max(size.x, size.z) * (this.opts.frameWidth || m) * 0.5) / (vt * this.camera.aspect);
    this.orbit = { dist: Math.max(distH, distW) + size.z * 0.5, cy: size.y * this.opts.cameraY };
    this.sizeCache = size;
    this.placeCamera(this.current.el);
  }

  placeCamera(el) {
    if (!this.orbit) return;
    const { dist, cy } = this.orbit;
    this.camera.position.set(0, cy + Math.sin(el) * dist, Math.cos(el) * dist);
    this.camera.lookAt(0, cy, 0);
  }

  // key: a FINISHES key. custom: { h, s, v } for the custom colour. surface: 'gloss' | 'matte'
  setFinish(key, custom, surface) {
    const f = FINISHES[key];
    if (!f) return;
    if (surface) this.surface = surface;
    const m = this.material;
    const goal = key === 'custom' && custom
      ? (custom.hex ? new THREE.Color(custom.hex) : hsvColor(custom.h, custom.s, custom.v))
      : new THREE.Color(f.color);
    if (this.opts.colorFade && this.colorGoal) this.colorGoal = goal; // fade from the previous colour
    else { m.color.copy(goal); this.colorGoal = goal.clone(); }
    m.metalness = f.metalness;
    m.roughness = f.roughness;
    m.clearcoat = f.clearcoat || 0;
    m.clearcoatRoughness = f.clearcoatRoughness || 0;
    if (this.surface === 'matte') {
      // satin metal for metallic finishes, soft-touch paint for the rest
      m.roughness = f.metalness > 0.9 ? 0.42 : 0.62;
      m.clearcoat = 0;
    }
    m.needsUpdate = true;
  }

  setScale(s) { this.scaleTarget = s; }

  // Personality animation: crossfades from the current one. key = null for none.
  setAnimation(key) {
    if (key === this.anim.key) return;
    this.anim = { key, w: 0, prev: this.anim.key, pw: this.anim.w };
  }

  // Each personality moves the whole sculpture in its own way (no rig needed).
  poseFor(key, t, h) {
    const p = { x: 0, y: 0, rx: 0, ry: 0, rz: 0, sy: 1 };
    const smooth = (x) => x * x * (3 - 2 * x);
    switch (key) {
      case 'tender':   // gentle rocking, like leaning on someone
        p.rz = Math.sin(t * 1.3) * 0.07; p.y = Math.abs(Math.sin(t * 1.3)) * h * 0.006; break;
      case 'explorer': // looks around, turning to scan the horizon
        p.ry = Math.sin(t * 0.7) * 0.75; p.rx = -0.04 + Math.sin(t * 1.4) * 0.02; break;
      case 'dreamer':  // slow breathing, leaning back toward the sun
        p.rx = -0.09 + Math.sin(t * 0.9) * 0.025; p.sy = 1 + Math.sin(t * 0.9) * 0.018; break;
      case 'curious': { // quick head tilts with pauses
        const c = (t * 0.6) % 2, k = c < 1 ? smooth(Math.min(1, c * 3)) : 1 - smooth(Math.min(1, (c - 1) * 3));
        p.rz = (Math.floor(t * 0.3) % 2 ? 1 : -1) * 0.13 * k; p.rx = 0.06 * k; break; }
      case 'calm':     // almost still, a very slow sway
        p.rz = Math.sin(t * 0.45) * 0.025; p.ry = Math.sin(t * 0.3) * 0.08; break;
      case 'playful': { // little hops with a half spin every few jumps
        const j = Math.abs(Math.sin(t * 3.2)); p.y = j * h * 0.07; p.sy = 1 - (1 - j) * 0.04;
        p.ry = smooth((t * 0.25) % 1) * (Math.floor(t * 0.25) % 2 ? Math.PI * 2 : 0); break; }
      default: break;
    }
    return p;
  }

  applyAnimation(t, dt) {
    if (!this.sizeCache) return;
    const a = this.anim, h = this.sizeCache.y;
    a.w = Math.min(1, a.w + dt * 1.5);
    a.pw = Math.max(0, a.pw - dt * 1.5);
    if (REDUCED) { this.animG.position.set(0, 0, 0); this.animG.rotation.set(0, 0, 0); this.animG.scale.setScalar(1); return; }
    const A = this.poseFor(a.key, t, h), B = this.poseFor(a.prev, t, h);
    const mix = (k) => A[k] * a.w + B[k] * a.pw;
    this.animG.position.set(0, mix('y'), 0);
    this.animG.rotation.set(mix('rx'), mix('ry'), mix('rz'));
    const sy = 1 + (A.sy - 1) * a.w + (B.sy - 1) * a.pw;
    this.animG.scale.set(1, sy, 1);
  }

  // x, y in [-1, 1]
  steer(x, y) {
    this.target.x = Math.max(-1, Math.min(1, x));
    this.target.y = Math.max(-1, Math.min(1, y));
    this.lastInput = performance.now();
  }

  resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.sizeCache) this.frame(this.sizeCache);
  }

  loop() {
    requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.1);
    if (!this.visible || !this.mesh) return;
    const now = performance.now();
    const t = this.clock.elapsedTime;
    const idle = now - this.lastInput > 3500;
    const o = this.opts;

    let yawGoal = o.baseYaw + this.target.x * o.yawRange;
    // pointer up (negative y) lifts the camera to look down on the sculpture
    let elGoal = o.baseElevation - this.target.y * o.elevationRange;
    if (idle && !REDUCED) {
      yawGoal = o.baseYaw + Math.sin(t * 0.35) * 0.32 * Math.min(1, o.yawRange * 2);
      elGoal = o.baseElevation + Math.sin(t * 0.23) * o.elevationRange * 0.25;
    }
    if (o.spin && !REDUCED) this.spinYaw += dt * 0.45;

    // Awakening: the sculpture turns from its back to face you as the light comes up.
    // Frame-rate independent smoothing: k is the response speed per second.
    const ease = (k) => 1 - Math.exp(-k * dt);
    let kYaw = 3.4;
    if (this.introOn && now - this.introStart < 2600) {
      kYaw = 1.7;
      if (now - this.introStart < 500) yawGoal = this.current.yaw;
    }
    this.current.yaw += (yawGoal - this.current.yaw) * ease(kYaw);
    this.current.el += (elGoal - this.current.el) * ease(2.6); // slower: vertical moves feel weightier
    this.pivot.rotation.y = this.current.yaw + this.spinYaw;
    this.placeCamera(this.current.el);
    this.applyAnimation(t, dt);
    if (this.colorGoal) this.material.color.lerp(this.colorGoal, ease(4));

    this.envCurrent += (1 - this.envCurrent) * ease(1.8);

    if (this.heart && this.heartDock) {
      // move toward the goal; the snap onto the chest overshoots slightly, like a magnet
      const speed = REDUCED ? 100 : 1.6;
      this.heartT += Math.sign(this.heartGoal - this.heartT) * Math.min(Math.abs(this.heartGoal - this.heartT), dt * speed);
      const x = this.heartT;
      const c1 = 2.2, c3 = c1 + 1;
      const k = x <= 0 ? 0 : x >= 1 ? 1 : 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); // easeOutBack
      if (!REDUCED) this.heartSpin += dt * 0.9 * (1 - k);
      const freeQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.heartSpin - this.current.yaw + Math.PI); // carved side toward the viewer
      const bob = Math.sin(t * 1.6) * 0.012 * (1 - k);
      this.heart.position.lerpVectors(this.heartFree.pos, this.heartDock.pos, k).y += bob;
      this.heart.quaternion.slerpQuaternions(freeQuat, this.heartDock.quat, Math.min(1, Math.max(0, k)));
      this.heartMaterial.envMapIntensity = this.envCurrent;
    }
    this.material.envMapIntensity = this.envCurrent;

    const s = this.scaler.scale.x + (this.scaleTarget - this.scaler.scale.x) * ease(5.5);
    this.scaler.scale.setScalar(s);

    this.renderer.render(this.scene, this.camera);
  }
}
