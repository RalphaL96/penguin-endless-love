// Photo → texture baker for intervened pieces. Plain JS (no WebGL, no three.js) so
// it runs the same on a phone and in the Node tests (tools/bake.test.mjs).
//
// Every sculpture comes out of the same mould, so the shape is known: the photos
// only supply the paint. Each photo is projected onto the model from the pose its
// guide silhouette asked for, and all views are blended into one UV texture.

// ---------- geometry ----------
/** Read POSITION / NORMAL / TEXCOORD_0 / indices of the first mesh of a GLB. */
export function parseGLB(buf) {
  const dv = new DataView(buf);
  const jl = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jl)));
  const bin = 20 + jl + 8;
  const prim = json.meshes[0].primitives[0];
  const read = (i, T, n) => {
    const a = json.accessors[i]; const bv = json.bufferViews[a.bufferView];
    return new T(buf.slice(bin + (bv.byteOffset || 0) + (a.byteOffset || 0), bin + (bv.byteOffset || 0) + (a.byteOffset || 0) + a.count * n * T.BYTES_PER_ELEMENT));
  };
  if (prim.attributes.TEXCOORD_0 == null) throw new Error('model-without-uv');
  const ia = json.accessors[prim.indices];
  const geo = {
    pos: read(prim.attributes.POSITION, Float32Array, 3),
    nor: read(prim.attributes.NORMAL, Float32Array, 3),
    uv: read(prim.attributes.TEXCOORD_0, Float32Array, 2),
    idx: read(prim.indices, ia.componentType === 5125 ? Uint32Array : Uint16Array, 1),
  };
  let mn = [Infinity, Infinity, Infinity]; let mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < geo.pos.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], geo.pos[i + k]); mx[k] = Math.max(mx[k], geo.pos[i + k]); }
  geo.center = mn.map((v, k) => (v + mx[k]) / 2);
  let r = 0;
  for (let i = 0; i < geo.pos.length; i += 3) r = Math.max(r, Math.hypot(geo.pos[i] - geo.center[0], geo.pos[i + 1] - geo.center[1], geo.pos[i + 2] - geo.center[2]));
  geo.radius = r;
  return geo;
}

// ---------- capture plan ----------
const D = Math.PI / 180;
/** The guided session: a ring of 8, three from above, one of the base (optional). */
export const VIEWS = [
  ...[0, 45, 90, 135, 180, 225, 270, 315].map((a) => ({ az: a * D, el: 8 * D, ring: 'around' })),
  ...[30, 150, 270].map((a) => ({ az: a * D, el: 55 * D, ring: 'above' })),
  { az: 0, el: -75 * D, ring: 'base', optional: true },
];

const LONG_FOV = 62 * D; // long side of a phone's main camera
const FILL = 0.78;       // how much of the short side the piece should fill

/** Camera for a pose and a frame aspect (w / h). */
export function camera(geo, view, aspect) {
  const tanLong = Math.tan(LONG_FOV / 2);
  const tanY = aspect >= 1 ? tanLong / aspect : tanLong;
  const tanX = tanY * aspect;
  const ce = Math.cos(view.el);
  const dir = [ce * Math.cos(view.az), Math.sin(view.el), ce * Math.sin(view.az)];
  const f = dir.map((v) => -v);
  const up = Math.abs(f[1]) > 0.99 ? [1, 0, 0] : [0, 1, 0];
  const r = norm(cross(f, up));
  const u = cross(r, f);
  // back off until the piece itself (not its bounding sphere) fills the frame
  let d = geo.radius / (FILL * Math.min(tanX, tanY)); let eye;
  for (let it = 0; it < 3; it++) {
    eye = dir.map((v, k) => geo.center[k] + v * d);
    let m = 0;
    for (let i = 0; i < geo.pos.length; i += 3) {
      const vx = geo.pos[i] - eye[0]; const vy = geo.pos[i + 1] - eye[1]; const vz = geo.pos[i + 2] - eye[2];
      const z = vx * f[0] + vy * f[1] + vz * f[2];
      m = Math.max(m, Math.abs(vx * r[0] + vy * r[1] + vz * r[2]) / (z * tanX), Math.abs(vx * u[0] + vy * u[1] + vz * u[2]) / (z * tanY));
    }
    d *= m / FILL;
  }
  return { eye, f, r, u, tanX, tanY };
}
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

function rasterTri(x0, y0, x1, y1, x2, y2, W, H, cb) {
  const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2))); const maxX = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2)));
  const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2))); const maxY = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2)));
  const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  if (!area) return;
  const ia = 1 / area;
  for (let y = minY; y <= maxY; y++) {
    const py = y + 0.5;
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5;
      const w0 = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) * ia;
      const w1 = ((x2 - px) * (y0 - py) - (x0 - px) * (y2 - py)) * ia;
      const w2 = 1 - w0 - w1;
      if (w0 >= -1e-4 && w1 >= -1e-4 && w2 >= -1e-4) cb(x, y, w0, w1, w2);
    }
  }
}

/** Project every vertex: screen x, y in [0,W]×[0,H] and depth along the view. */
function projectVerts(geo, cam, W, H) {
  const n = geo.pos.length / 3; const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const vx = geo.pos[i * 3] - cam.eye[0]; const vy = geo.pos[i * 3 + 1] - cam.eye[1]; const vz = geo.pos[i * 3 + 2] - cam.eye[2];
    const z = vx * cam.f[0] + vy * cam.f[1] + vz * cam.f[2];
    const x = (vx * cam.r[0] + vy * cam.r[1] + vz * cam.r[2]) / (z * cam.tanX);
    const y = (vx * cam.u[0] + vy * cam.u[1] + vz * cam.u[2]) / (z * cam.tanY);
    out[i * 3] = (x * 0.5 + 0.5) * W; out[i * 3 + 1] = (0.5 - y * 0.5) * H; out[i * 3 + 2] = z;
  }
  return out;
}

/**
 * Software render of one view. Returns the depth buffer and, if `color` is given
 * ((x, y, z) → [r, g, b] 0..255, or an RGBA texture {data, size}), an RGBA image.
 * Used for the guide silhouettes, the occlusion test and the synthetic self-test.
 */
export function renderView(geo, view, W, H, color = null, bg = [0, 0, 0, 0]) {
  const cam = camera(geo, view, W / H);
  const sv = projectVerts(geo, cam, W, H);
  const depth = new Float32Array(W * H).fill(Infinity);
  const rgba = color ? new Uint8ClampedArray(W * H * 4) : null;
  if (rgba) for (let i = 0; i < W * H; i++) rgba.set(bg, i * 4);
  let bx0 = W; let by0 = H; let bx1 = -1; let by1 = -1;
  const { pos, uv, idx } = geo;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t]; const b = idx[t + 1]; const c = idx[t + 2];
    rasterTri(sv[a * 3], sv[a * 3 + 1], sv[b * 3], sv[b * 3 + 1], sv[c * 3], sv[c * 3 + 1], W, H, (x, y, w0, w1, w2) => {
      const z = w0 * sv[a * 3 + 2] + w1 * sv[b * 3 + 2] + w2 * sv[c * 3 + 2];
      const o = y * W + x;
      if (z >= depth[o]) return;
      depth[o] = z;
      if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
      if (!rgba) return;
      let col;
      if (typeof color === 'function') {
        col = color(w0 * pos[a * 3] + w1 * pos[b * 3] + w2 * pos[c * 3], w0 * pos[a * 3 + 1] + w1 * pos[b * 3 + 1] + w2 * pos[c * 3 + 1], w0 * pos[a * 3 + 2] + w1 * pos[b * 3 + 2] + w2 * pos[c * 3 + 2]);
      } else {
        const S = color.size;
        const tx = Math.min(S - 1, Math.max(0, Math.floor((w0 * uv[a * 2] + w1 * uv[b * 2] + w2 * uv[c * 2]) * S)));
        const ty = Math.min(S - 1, Math.max(0, Math.floor((w0 * uv[a * 2 + 1] + w1 * uv[b * 2 + 1] + w2 * uv[c * 2 + 1]) * S)));
        const q = (ty * S + tx) * 4; col = [color.data[q], color.data[q + 1], color.data[q + 2]];
      }
      rgba[o * 4] = col[0]; rgba[o * 4 + 1] = col[1]; rgba[o * 4 + 2] = col[2]; rgba[o * 4 + 3] = 255;
    });
  }
  return { cam, depth, rgba, W, H, bbox: bx1 < 0 ? null : { x0: bx0, y0: by0, x1: bx1 + 1, y1: by1 + 1 } };
}

// ---------- background removal (plain backdrop) ----------
/**
 * Mask of the piece in a photo taken against a plain backdrop. The backdrop colour
 * is read from the frame's border; anything the border colour cannot reach by
 * flooding from the edges is the piece (so reflections inside it stay solid).
 * Returns { alpha: Uint8Array, w, h, bbox, coverage, touchesEdge } at ≤ `max` px.
 */
export function maskFromBackdrop(img, max = 320) {
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const w = Math.max(8, Math.round(img.width * k)); const h = Math.max(8, Math.round(img.height * k));
  const small = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = Math.min(img.width - 1, Math.floor((x + 0.5) / k)); const sy = Math.min(img.height - 1, Math.floor((y + 0.5) / k));
    const q = (sy * img.width + sx) * 4; const o = (y * w + x) * 3;
    small[o] = img.data[q]; small[o + 1] = img.data[q + 1]; small[o + 2] = img.data[q + 2];
  }
  // Backdrop model: the frame border, split in 8 patches so a lighting gradient is tolerated.
  const band = Math.max(2, Math.round(Math.min(w, h) * 0.04));
  const patches = [];
  const addPatch = (x0, y0, x1, y1) => {
    const s = [0, 0, 0]; let n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const o = (y * w + x) * 3; s[0] += small[o]; s[1] += small[o + 1]; s[2] += small[o + 2]; n++; }
    const m = s.map((v) => v / n); let dev = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const o = (y * w + x) * 3; dev += Math.hypot(small[o] - m[0], small[o + 1] - m[1], small[o + 2] - m[2]); }
    patches.push({ m, dev: dev / n });
  };
  const hw = Math.floor(w / 2); const hh = Math.floor(h / 2);
  addPatch(0, 0, hw, band); addPatch(hw, 0, w, band); addPatch(0, h - band, hw, h); addPatch(hw, h - band, w, h);
  addPatch(0, 0, band, hh); addPatch(0, hh, band, h); addPatch(w - band, 0, w, hh); addPatch(w - band, hh, w, h);
  patches.sort((a, b) => a.dev - b.dev);
  const ref = patches.slice(0, 6); // drop the two noisiest (the piece may touch the frame there)
  const tol = 22 + 2.5 * ref.reduce((s, p) => s + p.dev, 0) / ref.length;
  const isBg = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    let d = Infinity;
    for (const p of ref) d = Math.min(d, Math.hypot(small[i * 3] - p.m[0], small[i * 3 + 1] - p.m[1], small[i * 3 + 2] - p.m[2]));
    isBg[i] = d < tol ? 1 : 0;
  }
  // flood the backdrop in from the border
  const reach = new Uint8Array(w * h); const stack = [];
  const push = (x, y) => { const i = y * w + x; if (isBg[i] && !reach[i]) { reach[i] = 1; stack.push(i); } };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (stack.length) {
    const i = stack.pop(); const x = i % w; const y = (i - x) / w;
    if (x > 0) push(x - 1, y); if (x < w - 1) push(x + 1, y); if (y > 0) push(x, y - 1); if (y < h - 1) push(x, y + 1);
  }
  // keep the largest solid blob
  const lab = new Int32Array(w * h); let best = 0; let bestN = 0; let cur = 0;
  for (let s = 0; s < w * h; s++) {
    if (reach[s] || lab[s]) continue;
    cur++; let n = 0; const st = [s]; lab[s] = cur;
    while (st.length) {
      const i = st.pop(); n++; const x = i % w; const y = (i - x) / w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) if (j >= 0 && !reach[j] && !lab[j]) { lab[j] = cur; st.push(j); }
    }
    if (n > bestN) { bestN = n; best = cur; }
  }
  const alpha = new Uint8Array(w * h); let x0 = w; let y0 = h; let x1 = -1; let y1 = -1;
  for (let i = 0; i < w * h; i++) if (lab[i] === best && best) {
    alpha[i] = 255; const x = i % w; const y = (i - x) / w;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const bbox = x1 < 0 ? null : { x0: x0 / w, y0: y0 / h, x1: (x1 + 1) / w, y1: (y1 + 1) / h };
  return { alpha, w, h, bbox, coverage: bestN / (w * h), touchesEdge: bbox ? (x0 === 0 || y0 === 0 || x1 === w - 1 || y1 === h - 1) : false };
}

/** A mask from an alpha channel (e.g. an AI background remover's cut-out). */
export function maskFromAlpha(img, max = 320) {
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const w = Math.max(8, Math.round(img.width * k)); const h = Math.max(8, Math.round(img.height * k));
  const alpha = new Uint8Array(w * h); let x0 = w; let y0 = h; let x1 = -1; let y1 = -1; let n = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const a = img.data[(Math.min(img.height - 1, Math.floor((y + 0.5) / k)) * img.width + Math.min(img.width - 1, Math.floor((x + 0.5) / k))) * 4 + 3];
    if (a > 127) { alpha[y * w + x] = 255; n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  const bbox = x1 < 0 ? null : { x0: x0 / w, y0: y0 / h, x1: (x1 + 1) / w, y1: (y1 + 1) / h };
  return { alpha, w, h, bbox, coverage: n / (w * h), touchesEdge: bbox ? (x0 === 0 || y0 === 0 || x1 === w - 1 || y1 === h - 1) : false };
}

/** Is this mask a believable piece? (not empty, not the whole frame) */
export function maskLooksRight(mask) {
  return !!mask.bbox && mask.coverage > 0.015 && mask.coverage < 0.85;
}

// ---------- baking ----------
/** Rasterise the atlas once: for every texel, the surface point and normal it shows. */
export function buildAtlas(geo, size) {
  const S = size; const { pos, nor, uv, idx } = geo;
  const P = new Float32Array(S * S * 3); const N = new Float32Array(S * S * 3); const has = new Uint8Array(S * S);
  let overlaps = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t]; const b = idx[t + 1]; const c = idx[t + 2];
    rasterTri(uv[a * 2] * S, uv[a * 2 + 1] * S, uv[b * 2] * S, uv[b * 2 + 1] * S, uv[c * 2] * S, uv[c * 2 + 1] * S, S, S, (x, y, w0, w1, w2) => {
      const o = y * S + x;
      if (has[o]) { if (w0 > 0.02 && w1 > 0.02 && w2 > 0.02) overlaps++; return; }
      has[o] = 1;
      for (let k = 0; k < 3; k++) {
        P[o * 3 + k] = w0 * pos[a * 3 + k] + w1 * pos[b * 3 + k] + w2 * pos[c * 3 + k];
        N[o * 3 + k] = w0 * nor[a * 3 + k] + w1 * nor[b * 3 + k] + w2 * nor[c * 3 + k];
      }
      const l = Math.hypot(N[o * 3], N[o * 3 + 1], N[o * 3 + 2]) || 1;
      N[o * 3] /= l; N[o * 3 + 1] /= l; N[o * 3 + 2] /= l;
    });
  }
  let texels = 0; for (let i = 0; i < S * S; i++) texels += has[i];
  return { size: S, P, N, has, texels, overlaps };
}

/**
 * Where a photo sits relative to its guide. The guide (model silhouette at the
 * nominal pose) and the piece's mask give two boxes; matching them absorbs the
 * photographer's distance and framing. Returns { s, dx, dy } in frame fractions:
 * photo = (guide − 0.5) · s + 0.5 + (dx, dy).
 */
export function alignToGuide(geo, view, aspect, mask) {
  if (!mask || !mask.bbox || mask.touchesEdge) return { s: 1, dx: 0, dy: 0, auto: false };
  const H = 200; const W = Math.max(8, Math.round(H * aspect));
  const g = renderView(geo, view, W, H).bbox; if (!g) return { s: 1, dx: 0, dy: 0, auto: false };
  const gb = { x0: g.x0 / W, y0: g.y0 / H, x1: g.x1 / W, y1: g.y1 / H }; const m = mask.bbox;
  // scale measured in pixels so it is uniform, whatever the frame aspect
  const s = (((m.x1 - m.x0) / (gb.x1 - gb.x0)) + ((m.y1 - m.y0) / (gb.y1 - gb.y0))) / 2;
  if (!(s > 0.4 && s < 2.2)) return { s: 1, dx: 0, dy: 0, auto: false };
  const dx = (m.x0 + m.x1) / 2 - 0.5 - ((gb.x0 + gb.x1) / 2 - 0.5) * s;
  const dy = (m.y0 + m.y1) / 2 - 0.5 - ((gb.y0 + gb.y1) / 2 - 0.5) * s;
  return { s, dx, dy, auto: true };
}

/**
 * Blend the photos into one texture.
 * shots: [{ view, image: {data, width, height} (RGBA), mask?, align? }]
 * Returns { data: Uint8ClampedArray (RGBA, size²), size, coverage (0..1 of the surface seen), perShot }.
 */
export function bake(geo, shots, { size = 1024, atlas = null, onProgress = null } = {}) {
  const A = atlas || buildAtlas(geo, size); const S = A.size; const n = S * S;
  const sum = new Float32Array(n * 3); const wsum = new Float32Array(n);
  const prep = shots.map((sh) => {
    const W = sh.image.width; const H = sh.image.height; const aspect = W / H;
    const zh = 384; const zw = Math.max(8, Math.round(zh * aspect));
    const rv = renderView(geo, sh.view, zw, zh);
    return { ...sh, W, H, cam: rv.cam, depth: rv.depth, zw, zh, al: sh.align || alignToGuide(geo, sh.view, aspect, sh.mask), gain: [1, 1, 1], used: 0 };
  });
  const bias = geo.radius * 0.02;
  const sample = (p, o, out) => {
    // → weight, and the photo colour in out[0..2]
    const px = A.P[o * 3]; const py = A.P[o * 3 + 1]; const pz = A.P[o * 3 + 2];
    const c = p.cam; const vx = px - c.eye[0]; const vy = py - c.eye[1]; const vz = pz - c.eye[2];
    const z = vx * c.f[0] + vy * c.f[1] + vz * c.f[2]; if (z <= 0) return 0;
    const dl = Math.hypot(vx, vy, vz);
    const facing = -(A.N[o * 3] * vx + A.N[o * 3 + 1] * vy + A.N[o * 3 + 2] * vz) / dl;
    if (facing < 0.2) return 0;
    const gx = (vx * c.r[0] + vy * c.r[1] + vz * c.r[2]) / (z * c.tanX) * 0.5 + 0.5;
    const gy = 0.5 - (vx * c.u[0] + vy * c.u[1] + vz * c.u[2]) / (z * c.tanY) * 0.5;
    if (gx < 0 || gx >= 1 || gy < 0 || gy >= 1) return 0;
    if (z > p.depth[Math.floor(gy * p.zh) * p.zw + Math.floor(gx * p.zw)] + bias) return 0; // hidden behind another part
    const fx = (gx - 0.5) * p.al.s + 0.5 + p.al.dx; const fy = (gy - 0.5) * p.al.s + 0.5 + p.al.dy;
    if (fx < 0 || fx >= 1 || fy < 0 || fy >= 1) return 0;
    let w = facing * facing * facing;
    if (p.mask) { if (!p.mask.alpha[Math.floor(fy * p.mask.h) * p.mask.w + Math.floor(fx * p.mask.w)]) return 0; }
    const X = fx * p.W - 0.5; const Y = fy * p.H - 0.5;
    const x0 = Math.max(0, Math.floor(X)); const y0 = Math.max(0, Math.floor(Y)); const x1 = Math.min(p.W - 1, x0 + 1); const y1 = Math.min(p.H - 1, y0 + 1);
    const ax = Math.min(1, Math.max(0, X - x0)); const ay = Math.min(1, Math.max(0, Y - y0)); const d = p.image.data;
    const q00 = (y0 * p.W + x0) * 4; const q10 = (y0 * p.W + x1) * 4; const q01 = (y1 * p.W + x0) * 4; const q11 = (y1 * p.W + x1) * 4;
    for (let k = 0; k < 3; k++) out[k] = (d[q00 + k] * (1 - ax) + d[q10 + k] * ax) * (1 - ay) + (d[q01 + k] * (1 - ax) + d[q11 + k] * ax) * ay;
    return w;
  };
  const col = [0, 0, 0];
  // pass 1: plain weighted mean
  for (const p of prep) for (let o = 0; o < n; o++) {
    if (!A.has[o]) continue;
    const w = sample(p, o, col); if (!w) continue;
    sum[o * 3] += col[0] * w; sum[o * 3 + 1] += col[1] * w; sum[o * 3 + 2] += col[2] * w; wsum[o] += w;
  }
  onProgress && onProgress(0.45);
  // exposure: each photo's gain towards the consensus, so seams between shots fade
  for (const p of prep) {
    const a = [0, 0, 0]; const b = [0, 0, 0];
    for (let o = 0; o < n; o += 7) {
      if (!A.has[o] || !wsum[o]) continue;
      const w = sample(p, o, col); if (!w) continue;
      for (let k = 0; k < 3; k++) { a[k] += col[k] * w; b[k] += sum[o * 3 + k] / wsum[o] * w; }
    }
    p.gain = a.map((v, k) => (v > 1 ? Math.min(1.6, Math.max(0.6, b[k] / v)) : 1));
  }
  // pass 2: same, with gains, and with highlights that only one view sees pushed down
  const mean = new Float32Array(n);
  for (let o = 0; o < n; o++) if (wsum[o]) mean[o] = (0.299 * sum[o * 3] + 0.587 * sum[o * 3 + 1] + 0.114 * sum[o * 3 + 2]) / wsum[o];
  sum.fill(0); wsum.fill(0);
  for (const p of prep) for (let o = 0; o < n; o++) {
    if (!A.has[o]) continue;
    let w = sample(p, o, col); if (!w) continue;
    const r = col[0] * p.gain[0]; const g = col[1] * p.gain[1]; const b = col[2] * p.gain[2];
    const over = (0.299 * r + 0.587 * g + 0.114 * b - mean[o]) / 255;
    if (over > 0.03) w *= Math.exp(-14 * (over - 0.03));
    sum[o * 3] += r * w; sum[o * 3 + 1] += g * w; sum[o * 3 + 2] += b * w; wsum[o] += w; p.used++;
  }
  onProgress && onProgress(0.85);
  const data = new Uint8ClampedArray(n * 4); const done = new Uint8Array(n); let seen = 0;
  for (let o = 0; o < n; o++) if (wsum[o] > 1e-4) {
    data[o * 4] = sum[o * 3] / wsum[o]; data[o * 4 + 1] = sum[o * 3 + 1] / wsum[o]; data[o * 4 + 2] = sum[o * 3 + 2] / wsum[o]; data[o * 4 + 3] = 255;
    done[o] = 1; if (A.has[o]) seen++;
  }
  // grow colour into what no photo saw and into the gutters between charts
  let frontier = [];
  for (let o = 0; o < n; o++) if (done[o]) frontier.push(o);
  for (let it = 0; it < S && frontier.length; it++) {
    const next = [];
    for (const o of frontier) {
      const x = o % S; const y = (o - x) / S;
      for (const j of [x > 0 ? o - 1 : -1, x < S - 1 ? o + 1 : -1, y > 0 ? o - S : -1, y < S - 1 ? o + S : -1]) {
        if (j < 0 || done[j]) continue;
        if (!A.has[j] && it > 12) continue; // gutters only need a few texels
        done[j] = 1; data[j * 4] = data[o * 4]; data[j * 4 + 1] = data[o * 4 + 1]; data[j * 4 + 2] = data[o * 4 + 2]; data[j * 4 + 3] = 255; next.push(j);
      }
    }
    frontier = next;
  }
  onProgress && onProgress(1);
  return { data, size: S, coverage: seen / A.texels, perShot: prep.map((p) => ({ used: p.used, gain: p.gain, align: p.al })) };
}
