// Modo estudio: certify an intervened piece.
// 1 data → 2 guided photos → 3 texture + 3D review → 4 the link for the chip.
// The photo-to-texture work happens here, in the browser (bake.js): no desktop software per piece.
import { Stage } from './stage.js';
import { parseGLB, VIEWS, renderView, maskFromBackdrop, maskLooksRight, buildAtlas, bake } from './bake.js';
import { listObras, saveObra, deleteObra, obraLink } from './registry.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const show = (el, on = true) => { (typeof el === 'string' ? $(el) : el).hidden = !on; };
const TEX = 1024;       // texture side
const PHOTO_MAX = 1024; // photos are scaled down to this long side before baking
const MIN_SHOTS = 8;

const MODEL_URL = { love: 'penguin-standing-rig.glb', summer: 'penguin-rest-rig.glb' };
const geoCache = {};
async function geometry(collection) {
  if (!geoCache[collection]) {
    geoCache[collection] = fetch(MODEL_URL[collection]).then((r) => r.arrayBuffer()).then((b) => { const g = parseGLB(b); g.atlas = buildAtlas(g, TEX); return g; });
  }
  return geoCache[collection];
}

const state = { step: 1, data: null, shots: new Array(VIEWS.length).fill(null), texture: null, result: null, camIndex: 0, stream: null };

function viewLabel(i) {
  const v = VIEWS[i];
  if (v.ring === 'base') return 'La base (opcional)';
  if (v.ring === 'above') return `Desde arriba ${i - 7} de 3`;
  const deg = Math.round(v.az * 180 / Math.PI);
  return deg === 0 ? 'De frente' : deg === 180 ? 'De espalda' : `Alrededor ${i + 1} de 8`;
}

// ---------- home ----------
function renderHome() {
  const list = listObras().slice().reverse();
  show('#emptyNote', !list.length);
  $('#obraList').innerHTML = list.map((o) => `
    <li class="obra">
      <img src="${o.photo || ''}" alt="">
      <div>
        <p class="obra-title"></p>
        <p class="obra-meta">${o.collection === 'summer' ? 'Endless Summer' : 'Endless Love'} · ${o.size_cm} cm · ${{ gloss: 'Brillante', satin: 'Satinado', matte: 'Mate' }[o.surface || 'gloss']}${o.year ? ` · ${o.year}` : ''}</p>
        <p class="obra-meta obra-state"></p>
      </div>
      <div class="obra-actions">
        <button type="button" class="btn btn-ghost btn-small" data-copy="${o.id}">Copiar el enlace</button>
        <a class="btn btn-ghost btn-small" href="${obraLink(o.id)}">${o.serial ? 'Ver el certificado' : 'Probar el bautizo'}</a>
        ${o.serial ? '' : `<button type="button" class="btn btn-ghost btn-small" data-del="${o.id}">Eliminar</button>`}
      </div>
    </li>`).join('');
  // user-entered text goes in as text, never as HTML
  $$('#obraList .obra').forEach((li, i) => {
    li.querySelector('.obra-title').textContent = list[i].title;
    li.querySelector('.obra-state').textContent = list[i].serial ? `Bautizada como ${list[i].name} · ${list[i].serial}` : 'Dormida: esperando a su custodio';
  });
}
$('#obraList').addEventListener('click', async (e) => {
  const copy = e.target.closest('[data-copy]'); const del = e.target.closest('[data-del]');
  if (copy) { await copyText(obraLink(copy.dataset.copy), copy); }
  if (del) {
    if (del.dataset.armed) { deleteObra(del.dataset.del); renderHome(); }
    else { del.dataset.armed = '1'; del.textContent = 'Toca otra vez para eliminar'; }
  }
});
async function copyText(text, btn) {
  const was = btn.textContent;
  try { await navigator.clipboard.writeText(text); btn.textContent = 'Enlace copiado'; }
  catch { btn.textContent = 'Mantén pulsado el enlace para copiarlo'; }
  setTimeout(() => { btn.textContent = was; }, 2200);
}

function goHome() { stopCamera(); show('#viewWizard', false); show('#viewHome'); renderHome(); window.scrollTo(0, 0); }
function goStep(n) {
  state.step = n;
  show('#viewHome', false); show('#viewWizard');
  for (let i = 1; i <= 4; i++) show(`#step${i}`, i === n);
  $$('#stepsNav li').forEach((li) => { const s = +li.dataset.step; li.classList.toggle('on', s === n); li.classList.toggle('done', s < n); });
  window.scrollTo(0, 0);
}
$('#newBtn').addEventListener('click', () => {
  Object.assign(state, { data: null, shots: new Array(VIEWS.length).fill(null), texture: null, result: null });
  $('#step1').reset(); $('#oYear').value = new Date().getFullYear(); show('#sizeOtherField', false);
  $('#surfaceChips input[value=gloss]').checked = true;
  document.body.dataset.collection = 'love';
  goStep(1);
});
$$('[data-cancel]').forEach((b) => b.addEventListener('click', goHome));
$$('[data-back]').forEach((b) => b.addEventListener('click', () => goStep(+b.dataset.back)));
$('#homeBtn').addEventListener('click', goHome);

// ---------- 1. data ----------
$('#step1').addEventListener('change', (e) => {
  if (e.target.name === 'collection') document.body.dataset.collection = e.target.value;
  if (e.target.name === 'size') show('#sizeOtherField', e.target.value === 'other');
});
$('#step1').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target); const title = $('#oTitle').value.trim();
  if (!title) { $('#err1').textContent = 'Escribe el título de la obra.'; show('#err1'); $('#oTitle').focus(); return; }
  show('#err1', false);
  const collection = f.get('collection');
  if (state.data && state.data.collection !== collection) state.shots.fill(null); // other shape: other photos
  const size = f.get('size') === 'other' ? parseInt($('#oSizeOther').value, 10) : +f.get('size');
  if (!(size >= 5 && size <= 300)) { $('#err1').textContent = 'Escribe la medida en centímetros, entre 5 y 300.'; show('#err1'); $('#oSizeOther').focus(); return; }
  state.data = { collection, title, size_cm: size, surface: state.data?.surface || 'gloss', year: $('#oYear').value.trim(), technique: $('#oTech').value.trim(), notes: $('#oNotes').value.trim() };
  goStep(2);
  await renderShots();
});

// ---------- 2. photos ----------
const guideCache = {};
/** The silhouette the piece must match, as a canvas (w × h). */
async function guideCanvas(i, w, h) {
  const key = `${state.data.collection}-${i}-${w}x${h}`;
  if (guideCache[key]) return guideCache[key];
  const geo = await geometry(state.data.collection);
  const r = renderView(geo, VIEWS[i], w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const img = c.getContext('2d').createImageData(w, h);
  const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h && r.depth[y * w + x] !== Infinity;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!inside(x, y)) continue;
    const edge = !(inside(x - 2, y) && inside(x + 2, y) && inside(x, y - 2) && inside(x, y + 2));
    const o = (y * w + x) * 4;
    img.data[o] = 205; img.data[o + 1] = 187; img.data[o + 2] = 164; img.data[o + 3] = edge ? 255 : 70;
  }
  c.getContext('2d').putImageData(img, 0, 0);
  return (guideCache[key] = c);
}

async function renderShots() {
  const grid = $('#shotGrid');
  grid.innerHTML = VIEWS.map((v, i) => `<li><button type="button" class="shot" data-i="${i}"><img class="guide" alt=""><span class="shot-label">${viewLabel(i)}</span></button></li>`).join('');
  for (let i = 0; i < VIEWS.length; i++) {
    const b = grid.querySelector(`[data-i="${i}"]`);
    b.querySelector('.guide').src = (await guideCanvas(i, 150, 200)).toDataURL();
    paintShot(i);
  }
  updateCount();
}
function paintShot(i) {
  const b = $(`#shotGrid [data-i="${i}"]`); if (!b) return;
  const s = state.shots[i];
  b.classList.toggle('has', !!s); b.classList.toggle('warn', !!s && !s.mask);
  b.querySelector('.photo')?.remove(); b.querySelector('.shot-flag')?.remove();
  if (s) {
    const im = document.createElement('img'); im.className = 'photo'; im.alt = ''; im.src = s.thumb; b.prepend(im);
    const fl = document.createElement('span'); fl.className = 'shot-flag'; fl.textContent = s.mask ? 'Lista' : 'Sin recorte'; b.append(fl);
  }
}
function updateCount() {
  const n = state.shots.filter(Boolean).length;
  const warn = state.shots.filter((s) => s && !s.mask).length;
  $('#shotCount').textContent = `${n} de ${VIEWS.length} fotos. Mínimo ${MIN_SHOTS}; cuantas más, mejor la textura.${warn ? ` En ${warn} no se pudo separar el fondo: se usarán tal cual, alineadas con la silueta.` : ''}`;
  $('#bakeBtn').disabled = n < MIN_SHOTS;
}

/** Store a photo (any canvas image source) for view i. */
function addShot(i, source, sw, sh) {
  const k = Math.min(1, PHOTO_MAX / Math.max(sw, sh));
  const c = document.createElement('canvas'); c.width = Math.round(sw * k); c.height = Math.round(sh * k);
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(source, 0, 0, c.width, c.height);
  const image = g.getImageData(0, 0, c.width, c.height);
  let mask = maskFromBackdrop(image);
  if (!maskLooksRight(mask)) mask = null;
  const t = document.createElement('canvas'); t.width = 180; t.height = Math.round(180 * c.height / c.width);
  t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
  state.shots[i] = { view: VIEWS[i], image, mask, thumb: t.toDataURL('image/jpeg', 0.8) };
  state.texture = null;
  paintShot(i); updateCount();
  return !!mask;
}
const nextMissing = (from = 0) => { for (let k = 0; k < VIEWS.length; k++) { const i = (from + k) % VIEWS.length; if (!state.shots[i]) return i; } return -1; };

$('#fileInput').addEventListener('change', async (e) => {
  const files = [...e.target.files]; e.target.value = '';
  let i = state.pickFor ?? nextMissing(); state.pickFor = null;
  for (const f of files) {
    if (i < 0) break;
    try { const bmp = await createImageBitmap(f); addShot(i, bmp, bmp.width, bmp.height); bmp.close?.(); }
    catch { $('#err2').textContent = `No se pudo leer ${f.name}.`; show('#err2'); }
    i = nextMissing(i);
  }
});
$('#shotGrid').addEventListener('click', (e) => {
  const b = e.target.closest('.shot'); if (!b) return;
  openCamera(+b.dataset.i);
});

// camera
async function openCamera(i = nextMissing()) {
  show('#err2', false);
  state.camIndex = i < 0 ? 0 : i;
  try {
    if (!state.stream) state.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } } });
  } catch {
    // no camera (or permission refused): fall back to the gallery for that view
    state.pickFor = state.camIndex;
    $('#err2').textContent = 'No se pudo abrir la cámara. Elige las fotos desde la galería con «Subir fotos».'; show('#err2');
    return;
  }
  const v = $('#camVideo'); v.srcObject = state.stream;
  await v.play().catch(() => {});
  if (!v.videoWidth) await new Promise((r) => v.addEventListener('loadedmetadata', r, { once: true }));
  show('#cam'); document.body.style.overflow = 'hidden';
  await camFrame();
}
async function camFrame() {
  const v = $('#camVideo'); const i = state.camIndex;
  $('#camFrame').style.aspectRatio = `${v.videoWidth} / ${v.videoHeight}`;
  const gh = 320; const gw = Math.round(gh * v.videoWidth / v.videoHeight);
  const guide = await guideCanvas(i, gw, gh);
  const c = $('#camGuide'); c.width = gw; c.height = gh; c.getContext('2d').drawImage(guide, 0, 0);
  $('#camLabel').textContent = viewLabel(i);
  $('#camSkip').textContent = state.shots[i] ? 'Siguiente' : 'Saltar';
}
function stopCamera() {
  if (state.stream) { state.stream.getTracks().forEach((t) => t.stop()); state.stream = null; }
  show('#cam', false); document.body.style.overflow = '';
}
$('#camBtn').addEventListener('click', () => openCamera());
$('#camClose').addEventListener('click', stopCamera);
$('#camSkip').addEventListener('click', async () => { state.camIndex = (state.camIndex + 1) % VIEWS.length; $('#camNote').textContent = ''; await camFrame(); });
$('#camShot').addEventListener('click', async () => {
  const v = $('#camVideo'); const note = $('#camNote');
  const ok = addShot(state.camIndex, v, v.videoWidth, v.videoHeight);
  note.classList.toggle('bad', !ok);
  note.textContent = ok ? 'Foto guardada.' : 'Guardada, pero no pude separar el fondo. Usa un fondo liso o repítela.';
  const nx = nextMissing(state.camIndex);
  if (nx < 0) { stopCamera(); return; }      // every view has its photo
  if (ok) { state.camIndex = nx; await camFrame(); } // a failed one stays on screen to be repeated
});

// synthetic photos: estudio.html?prueba=1 — checks the whole pipeline without a sculpture at hand
if (new URLSearchParams(location.search).has('prueba')) show('#synthBtn');
$('#synthBtn').addEventListener('click', async () => {
  const geo = await geometry(state.data.collection); const W = 600; const H = 800;
  const paint = (x, y, z) => {
    const s = 5 / geo.radius; const band = Math.floor(y * s) % 2 === 0; const chk = (Math.floor(x * s) + Math.floor(z * s)) % 2 === 0;
    return band ? (chk ? [210, 40, 50] : [245, 235, 220]) : (chk ? [30, 60, 140] : [240, 190, 40]);
  };
  for (let i = 0; i < VIEWS.length; i++) {
    if (VIEWS[i].optional) continue;
    const r = renderView(geo, VIEWS[i], W, H, paint);
    const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    const img = g.createImageData(W, H);
    for (let o = 0; o < W * H; o++) {
      const y = Math.floor(o / W); const bg = 150 + 30 * y / H;
      const a = r.rgba[o * 4 + 3];
      img.data[o * 4] = a ? r.rgba[o * 4] : bg; img.data[o * 4 + 1] = a ? r.rgba[o * 4 + 1] : bg; img.data[o * 4 + 2] = a ? r.rgba[o * 4 + 2] : bg + 6; img.data[o * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    // as a hand-held photo: a little off-centre and at a different distance
    const d = document.createElement('canvas'); d.width = W; d.height = H; const dg = d.getContext('2d');
    dg.fillStyle = 'rgb(165,165,171)'; dg.fillRect(0, 0, W, H);
    const s = 0.86 + 0.05 * (i % 4);
    dg.drawImage(c, W / 2 - W * s / 2 + (i % 3 - 1) * 20, H / 2 - H * s / 2 + (i % 2 ? 16 : -12), W * s, H * s);
    addShot(i, d, W, H);
    await new Promise((res) => setTimeout(res));
  }
});

// ---------- 3. texture + review ----------
let stage = null;
function reviewStage(model) {
  const summer = model === 'restTex';
  if (!stage) {
    stage = new Stage($('#reviewCanvas'), {
      model, finish: 'obra', frameHeight: summer ? 1.45 : 1.2, frameWidth: summer ? 1.05 : undefined,
      cameraY: 0.5, baseYaw: 0.3, yawRange: Math.PI, baseElevation: 0.1, elevationRange: 0.3,
    });
    const c = $('#reviewCanvas'); let drag = null;
    c.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, bx: stage.target.x, by: stage.target.y }; c.setPointerCapture(e.pointerId); });
    c.addEventListener('pointermove', (e) => { if (drag) stage.steer(drag.bx + (e.clientX - drag.x) / 220, drag.by + (e.clientY - drag.y) / 300); });
    ['pointerup', 'pointercancel'].forEach((ev) => c.addEventListener(ev, () => { drag = null; }));
  } else if (stage.modelKey !== model) {
    Object.assign(stage.opts, { frameHeight: summer ? 1.45 : 1.2, frameWidth: summer ? 1.05 : undefined });
    stage.setModel(model);
  }
  stage.setFinish('obra', null, state.data.surface);
  return stage;
}

$('#bakeBtn').addEventListener('click', async () => {
  show('#busy'); $('#busyText').textContent = 'Creando la textura…';
  await new Promise((r) => setTimeout(r, 60)); // let the message paint before the heavy work
  try {
    const geo = await geometry(state.data.collection);
    const shots = state.shots.filter(Boolean);
    const out = bake(geo, shots, { atlas: geo.atlas });
    const c = document.createElement('canvas'); c.width = c.height = out.size;
    c.getContext('2d').putImageData(new ImageData(out.data, out.size, out.size), 0, 0);
    state.texture = c; state.result = out;
    goStep(3);
    reviewStage(state.data.collection === 'summer' ? 'restTex' : 'standTex').setTexture(c);
    const used = out.perShot.filter((p) => p.used > 0).length;
    $('#rTitle').textContent = state.data.title; $('#rSize').textContent = `${state.data.size_cm} cm`;
    $('#rShots').textContent = `${used} de ${shots.length}`;
    $('#rCover').textContent = `${Math.round(out.coverage * 100)} %`;
    $('#reviewHelp').textContent = out.coverage < 0.8
      ? 'Quedaron zonas sin foto: se rellenaron con el color vecino. Si se nota, vuelve y añade las fotos que faltan.'
      : 'Gira la obra y compárala con la pieza real. Si una zona no convence, repite esa foto.';
  } catch (err) {
    console.error(err);
    $('#err2').textContent = 'No se pudo crear la textura. Vuelve a intentarlo; si se repite, toma las fotos de nuevo.'; show('#err2');
  } finally { show('#busy', false); }
});

$('#surfaceChips').addEventListener('change', (e) => { state.data.surface = e.target.value; stage.setFinish('obra', null, e.target.value); });

// ---------- 4. certify ----------
$('#certBtn').addEventListener('click', () => {
  show('#err3', false);
  let texture = state.texture.toDataURL('image/webp', 0.86);
  if (!texture.startsWith('data:image/webp')) texture = state.texture.toDataURL('image/jpeg', 0.86);
  const first = state.shots.find(Boolean);
  let obra;
  try { obra = saveObra({ ...state.data, texture, photo: first ? first.thumb : null, shots: state.shots.filter(Boolean).length, coverage: state.result.coverage }); }
  catch (err) {
    console.error(err);
    $('#err3').textContent = 'No queda espacio en este navegador para guardar la obra. Elimina una obra de prueba y vuelve a certificar.'; show('#err3');
    return;
  }
  const link = obraLink(obra.id);
  $('#doneTitle').textContent = obra.title;
  $('#doneLink').value = link;
  $('#openBap').href = link;
  $('#copyBtn').onclick = () => { $('#doneLink').select(); copyText(link, $('#copyBtn')); };
  $('#doneLink').onfocus = () => $('#doneLink').select();
  goStep(4);
});

window.addEventListener('pagehide', stopCamera);
goHome();
