// The island: a shared, autonomous world where every awakened penguin lives.
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { FINISHES, ENVS, buildEnvironment, loadModel, loadRig, contactShadowTexture } from './stage.js';
import { Colony, ISLAND_R, DAY, SLIDE_DOWN, SLIDE_HOLD, SLIDE_UP, rand, daylight } from './life.js';
import { listPenguins } from './registry.js';
import { STRINGS } from './i18n.js';
import { ECO } from './i18n-eco.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let lang = 'es';
function t(key, vars) {
  let s = ECO[lang]?.[key] ?? STRINGS[lang]?.[key] ?? ECO.es[key] ?? key;
  if (vars) for (const k in vars) s = s.replaceAll(`{${k}}`, vars[k]);
  return s;
}
function getLang() { try { return localStorage.getItem('pel-lang'); } catch { return null; } }
function setLang(l) { try { localStorage.setItem('pel-lang', l); } catch { /* storage unavailable */ } }

// ---------- island clock ----------
// Everyone shares the same clock. For rehearsals the address can shift or speed it up, for this visitor only:
//   mundo.html?minuto=49   start at that minute of the island day (0-60)
//   mundo.html?ritmo=8     time runs 8 times faster
//   mundo.html?ensayo=12   add 12 sample penguins (they are not saved anywhere)
const QUERY = new URLSearchParams(location.search);
const RATE = Math.max(0.1, Math.min(60, parseFloat(QUERY.get('ritmo')) || 1));
const T_START = Date.now() / 1000;
const T_SHIFT = QUERY.has('minuto') ? (parseFloat(QUERY.get('minuto')) || 0) * 60 - (T_START % DAY) : 0;
const islandNow = () => T_START + T_SHIFT + (Date.now() / 1000 - T_START) * RATE;
const REHEARSAL = Math.max(0, Math.min(60, parseInt(QUERY.get('ensayo'), 10) || 0));
function sampleColony(n) {
  const names = ['Luna', 'Nilo', 'Mar', 'Tomás', 'Alba', 'Bruno', 'Cielo', 'Dante', 'Eva', 'Félix', 'Gala', 'Hugo', 'Iris', 'Joel', 'Kira', 'León', 'Maia', 'Noa', 'Olmo', 'Paz'];
  const chars = ['tender', 'explorer', 'dreamer', 'curious', 'calm', 'playful'];
  const finishes = ['silver', 'gold', 'onyx', 'emerald', 'ruby'];
  const list = [];
  for (let i = 0; i < n; i++) {
    const summer = i % 5 === 4;
    list.push({
      serial: `ENSAYO-${String(i + 1).padStart(2, '0')}`, arrival: 9000 + i, name: names[i % names.length] + (i >= names.length ? ` ${Math.floor(i / names.length) + 1}` : ''),
      personality: chars[i % 6], trait: i % 3 ? chars[(i + 2) % 6] : null, seed: 7919 * (i + 3), partner: null, rehearsal: true,
      awakened_at: new Date(i === n - 1 ? Date.now() - 600000 : Date.UTC(2026, 8, 1 + i)).toISOString(), // the last one has just arrived
      piece: { collection: summer ? 'summer' : 'love', finish: finishes[i % 5], surface: i % 4 === 3 ? 'matte' : 'gloss', size_cm: [24, 48, 60, 14, 90][i % 5] },
    });
  }
  for (let i = 0; i + 1 < n - 1 && i < 6; i += 3) { list[i].partner = list[i + 1].serial; list[i + 1].partner = list[i].serial; }
  return list;
}

// ---------- renderer & scene ----------
const canvas = $('#worldCanvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.92;

const scene = new THREE.Scene();
scene.environment = buildEnvironment(renderer, ENVS.polar);
const SKY = { top: 0x34495c, mid: 0x9fb3c2, horizon: 0xe2d2bd };
scene.fog = new THREE.Fog(SKY.horizon, 28, 80);

const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 300);

// sky dome: vertical gradient, ignores fog. Its colours follow the island day.
const NIGHT_SKY = { top: 0x04070d, mid: 0x0c1724, horizon: 0x1a2a3c };
const DUSK = { mid: 0xb98a86, horizon: 0xf2a56c };
const skyGeo = new THREE.SphereGeometry(150, 32, 16);
skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(skyGeo.attributes.position.count * 3), 3));
scene.add(new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false })));
const skyCol = { top: new THREE.Color(), mid: new THREE.Color(), hor: new THREE.Color() };
function paintSky(light, warm) {
  const mix = (day, night) => new THREE.Color(night).lerp(new THREE.Color(day), light);
  skyCol.top.copy(mix(SKY.top, NIGHT_SKY.top));
  skyCol.mid.copy(mix(SKY.mid, NIGHT_SKY.mid)).lerp(new THREE.Color(DUSK.mid), warm * 0.45);
  skyCol.hor.copy(mix(SKY.horizon, NIGHT_SKY.horizon)).lerp(new THREE.Color(DUSK.horizon), warm * 0.8);
  const pos = skyGeo.attributes.position, col = skyGeo.attributes.color, c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 150;
    if (y > 0.18) c.copy(skyCol.mid).lerp(skyCol.top, Math.min(1, (y - 0.18) / 0.6)); else c.copy(skyCol.hor).lerp(skyCol.mid, Math.max(0, y / 0.18));
    col.setXYZ(i, c.r, c.g, c.b);
  }
  col.needsUpdate = true;
  scene.fog.color.copy(skyCol.hor);
}
// stars: only at night
const starMat = new THREE.PointsMaterial({ color: 0xdfe8ff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
{
  const pts = [];
  for (let i = 0; i < 420; i++) {
    const a = rand(31, i, 1) * Math.PI * 2, h = 0.12 + rand(31, i, 2) * 0.88, r = Math.sqrt(1 - h * h);
    pts.push(Math.sin(a) * r * 140, h * 140, Math.cos(a) * r * 140);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  scene.add(new THREE.Points(g, starMat));
}

const hemi = new THREE.HemisphereLight(0xdfe8ef, 0x2c3a46, 0.35);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffdcb0, 1.2);
sun.position.set(-12, 9, -8);
scene.add(sun);
const moon = new THREE.DirectionalLight(0x9db8ff, 0);
moon.position.set(9, 12, 6);
scene.add(moon);

// ---------- the island ----------
const iceMat = new THREE.MeshStandardMaterial({ color: 0xd3dee6, roughness: 0.75, metalness: 0, flatShading: true });
const cliffMat = new THREE.MeshStandardMaterial({ color: 0xa9bfcf, roughness: 0.4, metalness: 0, flatShading: true });

function islandTop() {
  // faceted ice plateau: polar grid with gentle random relief
  const rings = 7, seg = 44, R = ISLAND_R + 0.6;
  const verts = [0, 0.02, 0], idx = [];
  for (let r = 1; r <= rings; r++) {
    for (let s = 0; s < seg; s++) {
      const a = (s / seg) * Math.PI * 2;
      const wob = r === rings ? 1 + (rand(11, s, 3) - 0.5) * 0.12 : 1;
      const rad = (r / rings) * R * wob;
      const h = r === rings ? 0 : (rand(7, r, s) - 0.5) * 0.08;
      verts.push(Math.sin(a) * rad, h, Math.cos(a) * rad);
    }
  }
  for (let s = 0; s < seg; s++) idx.push(0, 1 + s, 1 + ((s + 1) % seg));
  for (let r = 1; r < rings; r++) {
    for (let s = 0; s < seg; s++) {
      const a = 1 + (r - 1) * seg + s, b = 1 + (r - 1) * seg + ((s + 1) % seg);
      const c = 1 + r * seg + s, d = 1 + r * seg + ((s + 1) % seg);
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return { mesh: new THREE.Mesh(g, iceMat), rim: verts.slice(-seg * 3) };
}
const top = islandTop();
scene.add(top.mesh);
{
  // cliff: a skirt from the rim down into the water
  const rim = top.rim, seg = rim.length / 3, verts = [], idx = [];
  for (let s = 0; s < seg; s++) {
    const x = rim[s * 3], z = rim[s * 3 + 2];
    verts.push(x, 0, z, x * 1.07, -0.9, z * 1.07);
  }
  for (let s = 0; s < seg; s++) {
    const a = s * 2, b = ((s + 1) % seg) * 2;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  scene.add(new THREE.Mesh(g, cliffMat));
}
// sculptural ice: rocks along the shore and three tall shards
for (let i = 0; i < 14; i++) {
  const a = rand(21, i, 1) * Math.PI * 2, r = ISLAND_R + 0.3 + rand(21, i, 2) * 1.4;
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.35 + rand(21, i, 3) * 0.7, 0), cliffMat);
  m.position.set(Math.sin(a) * r, -0.2, Math.cos(a) * r);
  m.scale.set(1, 0.5 + rand(21, i, 4) * 0.6, 1);
  m.rotation.set(rand(21, i, 5) * 3, rand(21, i, 6) * 3, 0);
  scene.add(m);
}
for (let i = 0; i < 3; i++) {
  const a = (i / 3) * Math.PI * 2 + 0.6, r = ISLAND_R + 0.9;
  const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.7, 0), cliffMat);
  m.position.set(Math.sin(a) * r, 0.9, Math.cos(a) * r);
  m.scale.set(0.8, 3 + i * 0.6, 0.7);
  m.rotation.set(0.12 * (i - 1), a, 0.08);
  scene.add(m);
}
// sea
const waterMat = new THREE.MeshStandardMaterial({ color: 0x1e3140, roughness: 0.18, metalness: 0.3 });
const water = new THREE.Mesh(new THREE.CircleGeometry(160, 64), waterMat);
water.rotation.x = -Math.PI / 2;
water.position.y = -0.35;
scene.add(water);

// ---------- day and night ----------
const SUN_DAY = new THREE.Color(0xffdcb0), SUN_LOW = new THREE.Color(0xff9a5a), WATER_DAY = new THREE.Color(0x1e3140), WATER_NIGHT = new THREE.Color(0x070d15);
let litAt = -1;
function applyDaylight(now) {
  const { light, warm } = daylight(now);
  const key = Math.round(light * 250) + Math.round(warm * 250) * 1000;
  if (key === litAt) return;
  litAt = key;
  paintSky(light, warm);
  sun.intensity = 1.2 * light;
  sun.color.copy(SUN_DAY).lerp(SUN_LOW, warm);
  moon.intensity = 0.5 * (1 - light);
  hemi.intensity = 0.14 + 0.21 * light;
  starMat.opacity = (1 - light) ** 2 * 0.9;
  waterMat.color.copy(WATER_NIGHT).lerp(WATER_DAY, light);
  renderer.toneMappingExposure = 0.5 + 0.42 * light;
  const env = 0.3 + 0.7 * light;                       // reflections dim with the sky
  for (const m of [iceMat, cliffMat, waterMat, heartMat, ...finishMats.values()]) m.envMapIntensity = env;
}

// ---------- penguins ----------
const shadowTex = contactShadowTexture();
const heartMat = new THREE.MeshPhysicalMaterial(FINISHES.heart);
const finishMats = new Map();
function materialFor(piece) {
  if (piece.texture) { // intervened piece: its own paint, baked from the studio's photos
    const id = `obra-${piece.serial}`;
    if (finishMats.has(id)) return finishMats.get(id);
    const m = new THREE.MeshPhysicalMaterial(FINISHES.obra);
    if (piece.surface === 'matte') { m.roughness = 0.62; m.clearcoat = 0; }
    else if (piece.surface === 'satin') { m.roughness = 0.46; m.clearcoat = 0.3; m.clearcoatRoughness = 0.4; }
    const tex = new THREE.TextureLoader().load(piece.texture);
    tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace;
    m.map = tex;
    finishMats.set(id, m);
    return m;
  }
  const key = piece.finish === 'custom' ? `custom${piece.color_hex}` : piece.finish;
  const surf = piece.surface || 'gloss';
  const id = `${key}-${surf}`;
  if (finishMats.has(id)) return finishMats.get(id);
  const f = FINISHES[piece.finish] || FINISHES.silver;
  const m = new THREE.MeshPhysicalMaterial(f);
  if (piece.finish === 'custom' && piece.color_hex) m.color.set(piece.color_hex);
  if (surf === 'matte') { m.roughness = f.metalness > 0.9 ? 0.42 : 0.62; m.clearcoat = 0; }
  else if (surf === 'satin') { m.roughness = f.metalness > 0.9 ? 0.26 : 0.46; m.clearcoat = f.clearcoat ? 0.3 : 0; m.clearcoatRoughness = 0.4; }
  finishMats.set(id, m);
  return m;
}

const countText = () => (REHEARSAL ? `${t('world.count', { n: birds.length })} · ${t('world.rehearsal')}` : birds.length === 0 ? t('world.none') : birds.length === 1 ? t('world.one') : t('world.count', { n: birds.length }));
const H = 0.85; // standing height in world units
let colony, birds = [], mine = null, selected = null, follow = null;

async function build() {
  const [standRig, restRig, heart, list] = await Promise.all([loadRig('standRig'), loadRig('restRig'), loadModel('heart'), listPenguins()]);
  if (REHEARSAL) list.push(...sampleColony(REHEARSAL));
  colony = new Colony(list);
  const wanted = location.hash.slice(1).toUpperCase();
  // both rigs are modelled at 10 cm scale facing +X: scale to world units and turn them to face +Z
  function makeRig(src, mat, k) {
    const root = cloneSkinned(src.scene);
    root.scale.setScalar(10 * H * k);
    root.rotation.y = -Math.PI / 2;
    let mesh = null;
    root.traverse((o) => { if (o.isSkinnedMesh) { o.material = mat; o.frustumCulled = false; mesh = o; } });
    const mixer = new THREE.AnimationMixer(root);
    const actions = {};
    for (const clip of src.animations) {
      const a = mixer.clipAction(clip);
      a.play(); a.paused = true; a.setEffectiveWeight(0);
      actions[clip.name] = a;
    }
    return { root, mesh, mixer, actions, weights: {} };
  }
  for (const p of list) {
    const piece = p.piece || {};
    const sizeK = 0.85 + Math.min(1, (piece.size_cm || 48) / 90) * 0.3;
    const summer = piece.collection === 'summer';   // Endless Summer pieces always live reclining, like their sculpture
    const g = new THREE.Group();
    const body = new THREE.Group();
    const mat = materialFor(piece);
    const stand = summer ? null : makeRig(standRig, mat, sizeK);
    const rest = makeRig(restRig, mat, sizeK);      // also used when a standing penguin sunbathes
    if (stand) body.add(stand.root);
    body.add(rest.root);
    rest.mesh.visible = summer;
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
    sh.rotation.x = -Math.PI / 2; sh.position.y = 0.03; sh.scale.setScalar(H * sizeK * 0.9);
    g.add(body, sh);
    scene.add(g);

    const tag = document.createElement('button');
    tag.type = 'button';
    tag.className = 'tag';
    tag.textContent = p.name;
    tag.addEventListener('click', () => select(bird));
    $('#tags').appendChild(tag);

    const bird = { p, g, body, stand, rest, summer, tag, sh, heading: 0, sizeK };
    if (stand) stand.mesh.userData.bird = bird;
    rest.mesh.userData.bird = bird;
    birds.push(bird);
    if (p.serial === wanted || (!wanted && p.mine)) mine = bird;
  }
  // a small golden heart rises between partners when they are together
  for (const b of birds) {
    if (!b.p.partner) continue;
    const h = new THREE.Mesh(heart, heartMat);
    h.scale.setScalar(0.2);
    h.visible = false;
    scene.add(h);
    b.loveHeart = h;
  }
  if (mine) {
    mine.tag.classList.add('mine');
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.47, 48), new THREE.MeshBasicMaterial({ color: 0xcdbba4, transparent: true, opacity: 0.85, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.035;
    mine.g.add(ring);
    mine.ring = ring;
    $('#mineBtn').hidden = false;
    if (mine.p.piece?.collection === 'summer') document.body.dataset.collection = 'summer';
    select(mine);
    setFollow(mine);
  }
  litAt = -1; // the penguins' materials now exist: light them too
  if (mine) startArrival(mine);
  $('#count').textContent = countText();
  $('#loading').classList.add('done');
}

// ---------- camera control ----------
const cam = { tx: 0, tz: 0, yaw: 0.6, pitch: 0.58, dist: 16, goal: { tx: 0, tz: 0, dist: 16 } };
const pointers = new Map();
let dragMoved = 0, pinchStart = 0, distStart = 0;
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  dragMoved = 0;
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchStart = Math.hypot(a.x - b.x, a.y - b.y); distStart = cam.goal.dist;
  }
});
canvas.addEventListener('pointermove', (e) => {
  const prev = pointers.get(e.pointerId);
  if (!prev) return;
  const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  dragMoved += Math.abs(dx) + Math.abs(dy);
  if (pointers.size === 1) {
    cam.yaw -= dx * 0.005;
    cam.pitch = Math.max(0.22, Math.min(1.25, cam.pitch + dy * 0.004));
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchStart) cam.goal.dist = Math.max(3.5, Math.min(30, distStart * (pinchStart / d)));
  }
});
function endPointer(e) {
  const wasClick = pointers.size === 1 && dragMoved < 6;
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinchStart = 0;
  if (wasClick && e.type === 'pointerup') pick(e);
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  cam.goal.dist = Math.max(3.5, Math.min(30, cam.goal.dist * Math.exp(e.deltaY * 0.0012)));
}, { passive: false });

const raycaster = new THREE.Raycaster();
function pick(e) {
  const r = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const meshes = birds.flatMap((b) => [b.stand?.mesh, b.rest.mesh]).filter((m) => m && m.visible);
  const hit = raycaster.intersectObjects(meshes, false)[0];
  if (hit) { select(hit.object.userData.bird); greet(hit.object.userData.bird); }
}
// A touched penguin turns to the visitor and waves; touched again, it hops. Only this visitor sees it.
function greet(b) {
  const st = b.state;
  if (REDUCED || !st || st.moving || st.sliding || st.wet || b.arrival) return;
  const again = b.react && performance.now() / 1000 - b.react.t0 < 12;
  b.react = { t0: performance.now() / 1000, clip: again && b.react.clip === 'Wave' ? 'Hop' : 'Wave' };
}

// ---------- arrival ----------
// The first time its custodian sees a newly awakened penguin on the island, it comes in from the sea:
// it swims to the shore, shoots out of the water, gets up, hops and waves, then walks to where the colony is.
// (Only this visitor sees it. mundo.html?llegada=1 plays it again.)
function startArrival(b) {
  const key = `pel-arrived-${b.p.serial}`;
  let seen = false;
  try { seen = !!localStorage.getItem(key); } catch { /* storage unavailable */ }
  const fresh = Date.now() - Date.parse(b.p.awakened_at) < 86400000;
  if (REDUCED || (!QUERY.has('llegada') && (seen || !fresh))) return;
  try { localStorage.setItem(key, '1'); } catch { /* storage unavailable */ }
  const st = colony.state(b.p, islandNow());
  const a = Math.hypot(st.x, st.z) > 0.5 ? Math.atan2(st.x, st.z) : cam.yaw;
  b.arrival = { t0: performance.now() / 1000, a };
}
const ARR = { swim: 5, leap: 0.8, up: 1.4, hop: 1.25, wave: 2.5 };
function arrivalState(b, st) {
  const A = b.arrival, e = performance.now() / 1000 - A.t0, dir = { x: Math.sin(A.a), z: Math.cos(A.a) };
  const shore = ISLAND_R * 0.93, sea = ISLAND_R + 1.4, inward = A.a + Math.PI;
  const at = (r) => ({ x: dir.x * r, z: dir.z * r });
  const o = { ...st, y: 0, pitch: 0, wet: false, moving: false, sliding: false, pose: 'stand', act: 'arrive', friend: null, heading: inward };
  let x = e;
  if (x < ARR.swim) {
    const f = x / ARR.swim, ph = x * 2.4, u = Math.sin(ph), out = u > 0.35 ? (u - 0.35) / 0.65 : 0;
    return { ...o, ...at(sea + (1 - f) * 7), y: -0.3 + out * 0.55, pitch: -Math.cos(ph) * (out ? 0.6 : 0.12), wet: true, moving: true, anim: ['Slide', SLIDE_DOWN + (x % SLIDE_HOLD)] };
  }
  x -= ARR.swim;
  if (x < ARR.leap) {
    const f = x / ARR.leap;
    return { ...o, ...at(sea + (shore - sea) * f), y: -0.3 * (1 - f) + Math.sin(Math.PI * f) * 0.7, pitch: -0.9 + f * 0.9, wet: true, anim: ['Slide', SLIDE_DOWN] };
  }
  x -= ARR.leap;
  if (x < ARR.up) return { ...o, ...at(shore), anim: ['Slide', SLIDE_UP + x] };
  x -= ARR.up;
  if (x < ARR.hop) return { ...o, ...at(shore), anim: ['Hop', x] };
  x -= ARR.hop;
  const toCam = Math.atan2(camera.position.x - dir.x * shore, camera.position.z - dir.z * shore);
  if (x < ARR.wave) return { ...o, ...at(shore), heading: toCam, anim: ['Wave', x] };
  x -= ARR.wave;
  // walk to wherever the colony's clock says it should be, then hand over
  const from = at(shore), dist = Math.hypot(st.x - from.x, st.z - from.z);
  A.walk ??= Math.max(1.5, Math.min(14, dist / 0.6));
  if (x >= A.walk || st.wet) { b.arrival = null; return st; }
  const f = x / A.walk, k = f * f * (3 - 2 * f);
  return { ...o, x: from.x + (st.x - from.x) * k, z: from.z + (st.z - from.z) * k, heading: Math.atan2(st.x - from.x, st.z - from.z), moving: true, act: 'going', anim: ['Walk', x * 1.2, true] };
}

function setFollow(b) {
  follow = b;
  $('#followBtn').textContent = t(follow && follow === selected ? 'world.following' : 'world.follow');
  if (b) cam.goal.dist = Math.min(cam.goal.dist, 8);
}

// ---------- selection card ----------
function select(b) {
  selected = b;
  const card = $('#pcard');
  card.hidden = !b;
  if (!b) return;
  const p = b.p;
  $('#pcName').textContent = p.name;
  $('#pcP').textContent = `${t(`p.${p.personality}`)}${p.trait ? ` · ${t(`p.${p.trait}`)}` : ''}. ${t(`p.${p.personality}.d`)}`;
  const coll = p.piece?.collection === 'summer' ? 'Penguin Endless Summer' : 'Penguin Endless Love';
  const partner = p.partner && colony.bySerial.get(p.partner);
  $('#pcMeta').textContent = [p.serial, coll, partner ? t('world.partner', { name: partner.name }) : null].filter(Boolean).join(' · ');
  $('#pcCert').href = `p.html#${p.serial}`;
  $('#pcCert').hidden = !!p.rehearsal;
  $('#followBtn').textContent = t(follow === b ? 'world.following' : 'world.follow');
}
$('#pcClose').addEventListener('click', () => { select(null); });
$('#followBtn').addEventListener('click', () => { if (selected) setFollow(follow === selected ? null : selected); select(selected); });
$('#mineBtn').addEventListener('click', () => { if (mine) { select(mine); setFollow(mine); } });
$('#allBtn').addEventListener('click', () => { setFollow(null); cam.goal = { tx: 0, tz: 0, dist: 16 }; });

// ---------- choreography ----------
// Which clip a penguin plays and at what time. Everything comes from the shared
// island clock (life.js), so every visitor sees the same frame.
const CLIP_LEN = { Idle: 2, Walk: 1, Wave: 2.5, Look: 5, Sleep: 4, Lean: 3, Hop: 1.25, Slide: 4 };
function loop(name, t) { return [name, ((t % CLIP_LEN[name]) + CLIP_LEN[name]) % CLIP_LEN[name]]; }
function resting(p, now) {
  const t = now + (p.seed % 97);
  if (p.personality === 'dreamer') return loop('Sleep', t);
  if (p.personality === 'playful') { const c = t % 7; if (c < CLIP_LEN.Hop) return ['Hop', c]; }
  return loop('Idle', t);
}
function choreo(p, st, now) {
  if (REDUCED) return ['Idle', 0];
  if (st.anim) return st.anim[2] ? loop(st.anim[0], st.anim[1]) : [st.anim[0], Math.min(st.anim[1], CLIP_LEN[st.anim[0]] - 0.01)]; // set by the colony's day
  if (st.pose === 'lie') return loop('Sleep', now + (p.seed % 61)); // sunbathing on the reclining rig
  if (st.sliding) {                                         // lie down, then glide on the belly
    const e = st.elapsed;
    return ['Slide', e < SLIDE_DOWN ? e : SLIDE_DOWN + ((e - SLIDE_DOWN) % SLIDE_HOLD)];
  }
  if (st.moving) return loop('Walk', now * 1.15 * st.speed + (p.seed % 13) * 0.1);
  const since = st.sync ?? st.elapsed - st.travel;          // seconds since arriving (on a date: since both arrived)
  if (since < 0) return loop('Look', now + (p.seed % 89));  // waiting for the other one
  if (st.kind === 'slide' && since < CLIP_LEN.Slide - SLIDE_UP) return ['Slide', SLIDE_UP + since]; // getting up
  if (st.act === 'visit' && st.friend) {
    if (since < CLIP_LEN.Wave) return ['Wave', since];      // hello on arrival
    const c = (since - CLIP_LEN.Wave) % 8;
    if (p.partner === st.friend.serial && c < CLIP_LEN.Lean) return ['Lean', c];
    if (p.personality === 'playful' && c < CLIP_LEN.Hop) return ['Hop', c];
    return resting(p, now);
  }
  if (st.act === 'sea') return loop('Look', now + (p.seed % 89));
  return resting(p, now);
}
// fade between clips so changes never pop
// The same clip names exist on both rigs: standing (Walk = waddle) and Summer (Walk = belly crawl).
function animate(b, r, dt, now) {
  let want = choreo(b.p, b.state, now);
  if (b.react) {                                            // answering this visitor's touch
    const e = performance.now() / 1000 - b.react.t0, st = b.state;
    if (e < CLIP_LEN[b.react.clip] && !st.moving && !st.sliding && !st.wet) want = [b.react.clip, e];
  }
  const k = 1 - Math.exp(-7 * dt);
  for (const [name, a] of Object.entries(r.actions)) {
    const on = want && want[0] === name;
    const w = (r.weights[name] || 0) + ((on ? 1 : 0) - (r.weights[name] || 0)) * k;
    r.weights[name] = w < 0.002 ? 0 : w;
    a.setEffectiveWeight(r.weights[name]);
    if (on) a.time = want[1];
  }
  r.mixer.update(0);
}

function activityText(st) {
  if (st.act === 'visit' && st.friend) return t('act.visit', { name: st.friend.name });
  return t(`act.${st.act}`);
}

// ---------- language ----------
function applyLanguage(l) {
  lang = l; setLang(l);
  document.documentElement.lang = l;
  $$('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  $$('.lang button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === l)));
  if (colony) { $('#count').textContent = countText(); select(selected); }
}
$$('.lang button').forEach((b) => b.addEventListener('click', () => applyLanguage(b.dataset.lang)));

// ---------- loop ----------
function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const clock = new THREE.Clock();
const v = new THREE.Vector3();
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.1);
  const now = islandNow();                  // shared island time
  const ease = (k) => 1 - Math.exp(-k * dt);

  applyDaylight(now);
  if (colony) {
    for (const b of birds) {
      let st = colony.state(b.p, now);
      if (b.arrival) st = arrivalState(b, st);
      b.state = st;
      b.g.position.set(st.x, st.y || 0, st.z);
      b.body.rotation.x = st.pitch || 0;        // nose up or down while diving and leaping
      b.sh.visible = !st.wet;
      if (b.ring) b.ring.visible = !st.wet;
      // turn smoothly toward the heading (shortest way round); a touched penguin turns to the visitor
      const reacting = b.react && performance.now() / 1000 - b.react.t0 < CLIP_LEN[b.react.clip] && !st.moving && !st.wet;
      const goal = reacting ? Math.atan2(camera.position.x - st.x, camera.position.z - st.z) : st.heading;
      let d = goal - b.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      b.heading += d * ease(st.wet ? 12 : st.moving || reacting ? 6 : 2.5);
      b.g.rotation.y = b.heading;
      const reclined = b.summer || st.pose === 'lie';
      if (b.stand) b.stand.mesh.visible = !reclined;
      b.rest.mesh.visible = reclined;
      animate(b, reclined ? b.rest : b.stand, dt, now);   // waddle, crawl, slide and gestures live in the rigs' clips
    }
    // love hearts between partners spending time together
    for (const b of birds) {
      if (!b.loveHeart) continue;
      const other = birds.find((o) => o.p.serial === b.p.partner);
      const together = other && b.state.act === 'visit' && b.state.friend === other.p
        && Math.hypot(b.g.position.x - other.g.position.x, b.g.position.z - other.g.position.z) < 1.4;
      const show = together && b.p.serial < other.p.serial;
      b.loveHeart.visible = show;
      if (show) {
        b.loveHeart.position.set((b.g.position.x + other.g.position.x) / 2, H * 1.35 + Math.sin(now * 2) * 0.05, (b.g.position.z + other.g.position.z) / 2);
        b.loveHeart.rotation.y = now * 0.8;
      }
    }
    if (follow) { cam.goal.tx = follow.g.position.x; cam.goal.tz = follow.g.position.z; }
  }

  cam.tx += (cam.goal.tx - cam.tx) * ease(3);
  cam.tz += (cam.goal.tz - cam.tz) * ease(3);
  cam.dist += (cam.goal.dist - cam.dist) * ease(3);
  if (!REDUCED && !pointers.size && !follow) cam.yaw += dt * 0.02; // the island turns very slowly
  const cy = Math.cos(cam.pitch);
  camera.position.set(cam.tx + Math.sin(cam.yaw) * cy * cam.dist, Math.sin(cam.pitch) * cam.dist + 0.3, cam.tz + Math.cos(cam.yaw) * cy * cam.dist);
  camera.lookAt(cam.tx, 0.3, cam.tz);
  renderer.render(scene, camera);

  // name tags follow their penguins
  if (colony) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    for (const b of birds) {
      const low = b.summer || b.state.pose === 'lie' || b.state.sliding || b.state.wet;
      v.set(b.g.position.x, b.g.position.y + H * b.sizeK * (low ? 0.75 : 1.2), b.g.position.z).project(camera);
      const near = camera.position.distanceTo(b.g.position) < 12;
      const vis = v.z < 1 && (near || b === mine || b === selected);
      b.tag.classList.toggle('dim', !vis);
      if (vis) b.tag.style.transform = `translate(${(v.x * 0.5 + 0.5) * w}px, ${(-v.y * 0.5 + 0.5) * h}px) translate(-50%, -100%)`;
    }
    if (selected) $('#pcAct').textContent = activityText(selected.state);
  }
}

applyLanguage(getLang() || ((navigator.language || 'es').toLowerCase().startsWith('es') ? 'es' : 'en'));
build().catch(() => { $('#loading').textContent = '—'; });
requestAnimationFrame(frame);
