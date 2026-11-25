// Synthetic self-test: "photograph" a penguin painted with a known 3D pattern from the
// guided poses (off-centre, wrong distance, grey gradient backdrop, moving glare),
// bake the texture and compare it with the pattern. node tools/bake.test.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { parseGLB, VIEWS, renderView, maskFromBackdrop, maskLooksRight, buildAtlas, bake } from '../bake.js';

const paint = (x, y, z, r) => {
  const s = 5 / r; const band = Math.floor(y * s) % 2 === 0;
  const chk = (Math.floor(x * s) + Math.floor(z * s)) % 2 === 0;
  return band ? (chk ? [210, 40, 50] : [245, 235, 220]) : (chk ? [30, 60, 140] : [240, 190, 40]);
};
let fail = false;
for (const file of ['penguin-standing-rig', 'penguin-rest-rig']) {
  const b = readFileSync(new URL(`../${file}.glb`, import.meta.url));
  const geo = parseGLB(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  const atlas = buildAtlas(geo, 512);
  const W = 540, H = 720;
  const shots = VIEWS.filter((v) => !v.optional).map((view, i) => {
    const clean = renderView(geo, view, W, H, (x, y, z) => paint(x, y, z, geo.radius));
    // the photographer: a bit closer/farther and off-centre
    const s = 0.86 + 0.05 * (i % 4), ox = (i % 3 - 1) * 22, oy = (i % 2 ? 18 : -14);
    const data = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const sx = Math.round((x - W / 2 - ox) / s + W / 2), sy = Math.round((y - H / 2 - oy) / s + H / 2);
      const o = (y * W + x) * 4; const g = 150 + 30 * (y / H) + 10 * (x / W);
      let c = [g, g, g + 6];
      if (sx >= 0 && sx < W && sy >= 0 && sy < H && clean.rgba[(sy * W + sx) * 4 + 3]) { const q = (sy * W + sx) * 4; c = [clean.rgba[q], clean.rgba[q + 1], clean.rgba[q + 2]]; 
        const hx = (x - (W * 0.42 + ox)) / 26, hy = (y - (H * 0.4 + oy)) / 70; const gl = Math.exp(-(hx * hx + hy * hy)); // studio glare, fixed on screen
        c = c.map((v) => v + (255 - v) * gl * 0.9); }
      data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = 255;
    }
    const image = { data, width: W, height: H }; const mask = maskFromBackdrop(image);
    if (!maskLooksRight(mask)) { console.log('  mask rejected for view', i, mask.coverage); fail = true; }
    return { view, image, mask };
  });
  const t0 = Date.now(); const out = bake(geo, shots, { atlas });
  let err = 0, n = 0, bad = 0;
  for (let o = 0; o < 512 * 512; o++) if (atlas.has[o]) {
    const want = paint(atlas.P[o * 3], atlas.P[o * 3 + 1], atlas.P[o * 3 + 2], geo.radius);
    const e = (Math.abs(out.data[o * 4] - want[0]) + Math.abs(out.data[o * 4 + 1] - want[1]) + Math.abs(out.data[o * 4 + 2] - want[2])) / 3;
    err += e; n++; if (e > 60) bad++;
  }
  const aligns = out.perShot.map((p) => p.align.s.toFixed(2)).join(' ');
  console.log(`${file}: texels ${atlas.texels}, uv overlaps ${atlas.overlaps}, coverage ${(out.coverage * 100).toFixed(1)}%, mean error ${(err / n).toFixed(1)}/255, wrong texels ${(bad / n * 100).toFixed(1)}%, ${Date.now() - t0} ms, scales [${aligns}]`);
  // PPM dump of the texture for a visual check
  const ppm = Buffer.alloc(15 + 512 * 512 * 3); ppm.write('P6\n512 512\n255\n'); for (let o = 0; o < 512 * 512; o++) for (let k = 0; k < 3; k++) ppm[15 + o * 3 + k] = out.data[o * 4 + k];
  writeFileSync(`/tmp/${file}.ppm`, ppm);
  const sh = shots[1].image; const p2 = Buffer.alloc(15 + W * H * 3); p2.write(`P6\n${W} ${H}\n255\n`); for (let o = 0; o < W * H; o++) for (let k = 0; k < 3; k++) p2[15 + o * 3 + k] = sh.data[o * 4 + k];
  writeFileSync(`/tmp/${file}-shot.ppm`, p2);
  if (out.coverage < 0.8 || err / n > 25) fail = true;
}
process.exit(fail ? 1 : 0);
