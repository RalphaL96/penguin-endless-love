import { Stage, hsvColor } from './stage.js';
import { STRINGS, SUMMER } from './i18n.js';

// Requests are delivered to the studio inbox through FormSubmit.
// The first request triggers a one-time activation email to this address.
const FORM_ENDPOINT = 'https://formsubmit.co/ajax/gerardocampos.estudio@gmail.com';

// Each page declares its collection on <body data-collection="love|summer">.
const COLLECTION = document.body.dataset.collection === 'summer' ? 'summer' : 'love';
const COLLECTIONS = {
  love:   { name: 'Penguin Endless Love',   model: 'stand', env: 'polar',  other: 'summer.html' },
  summer: { name: 'Penguin Endless Summer', model: 'rest',  env: 'summer', other: 'index.html' },
};
const C = COLLECTIONS[COLLECTION];

// Commercial line: open editions. Visual scale is for the 3D viewer only.
const SIZES = [
  { cm: 14, scale: 0.5 },
  { cm: 24, scale: 0.62 },
  { cm: 48, scale: 0.78 },
  { cm: 60, scale: 0.88 },
  { cm: 90, scale: 1.0 },
];
const FINISH_KEYS = ['silver', 'gold', 'onyx', 'emerald', 'ruby', 'custom'];

const state = {
  lang: 'es', for: 'love', size: 48, finish: 'silver', surface: 'gloss', engrave: '',
  hsv: { h: 200, s: 0.55, v: 0.7 },
};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// ---------- language ----------
function t(key, vars, lang = state.lang) {
  const over = COLLECTION === 'summer' ? SUMMER[lang] || {} : {};
  let s = over[key] ?? STRINGS[lang]?.[key] ?? STRINGS.es[key] ?? key;
  if (vars) for (const k in vars) s = s.replaceAll(`{${k}}`, vars[k]);
  return s;
}
function storageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function storageSet(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } }

function applyLanguage(lang) {
  state.lang = lang;
  document.documentElement.lang = lang;
  document.title = t('meta.title');
  $$('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  $$('.lang button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
  storageSet('pel-lang', lang);
  renderConfig();
}

// ---------- header ----------
const header = $('#siteHeader');
const onScroll = () => header.classList.toggle('scrolled', window.scrollY > 40);
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();
$('#navOther').setAttribute('href', window.PEL_OTHER_URL || C.other);

$('#menuToggle').addEventListener('click', () => {
  const open = header.classList.toggle('open');
  $('#menuToggle').setAttribute('aria-expanded', String(open));
});
$$('#siteNav a').forEach((a) => a.addEventListener('click', () => {
  header.classList.remove('open');
  $('#menuToggle').setAttribute('aria-expanded', 'false');
}));
$$('.lang button').forEach((b) => b.addEventListener('click', () => applyLanguage(b.dataset.lang)));

// ---------- hero stage ----------
const heroCanvas = $('#heroCanvas');
const hero = new Stage(heroCanvas, {
  model: C.model, env: C.env, intro: true,
  frameHeight: COLLECTION === 'summer' ? 2.1 : 1.22,
  frameWidth: COLLECTION === 'summer' ? 1.05 : undefined,
  cameraY: COLLECTION === 'summer' ? 0.42 : 0.5,
  baseYaw: COLLECTION === 'summer' ? 0.45 : 0, yawRange: 0.7,
  baseElevation: COLLECTION === 'summer' ? 0.16 : 0.1,
  elevationRange: 0.42, // wide, slow vertical orbit
  onReady: () => document.body.classList.add('stage-ready'),
});

let heroInView = true;
new IntersectionObserver(([e]) => { heroInView = e.isIntersecting; }).observe($('.hero'));
window.addEventListener('pointermove', (e) => {
  if (!heroInView || e.pointerType === 'touch') return;
  hero.steer((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
}, { passive: true });

// Touch: dragging on the hero turns the sculpture; vertical page scroll stays native.
let touchStart = null;
heroCanvas.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') touchStart = { x: e.clientX, base: hero.target.x }; });
heroCanvas.addEventListener('pointermove', (e) => {
  if (!touchStart || e.pointerType !== 'touch') return;
  hero.steer(touchStart.base + (e.clientX - touchStart.x) / 160, hero.target.y);
});
['pointerup', 'pointercancel'].forEach((ev) => heroCanvas.addEventListener(ev, () => { touchStart = null; }));

// Gyroscope: Android starts automatically; iOS needs a tap to grant permission.
function onOrientation(e) {
  if (e.gamma == null) return;
  hero.steer(e.gamma / 28, (e.beta - 50) / 30);
}
const motionBtn = $('#motionBtn');
const isTouch = window.matchMedia('(pointer: coarse)').matches;
if (isTouch && 'DeviceOrientationEvent' in window) {
  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    motionBtn.hidden = false;
    motionBtn.addEventListener('click', async () => {
      try {
        const res = await DeviceOrientationEvent.requestPermission();
        if (res === 'granted') {
          window.addEventListener('deviceorientation', onOrientation);
          motionBtn.textContent = t('hero.motionOn');
          motionBtn.disabled = true;
        }
      } catch { motionBtn.hidden = true; }
    });
  } else {
    window.addEventListener('deviceorientation', onOrientation);
  }
}

// ---------- heart (awakening section) ----------
// The penguin with its magnetic heart: the heart floats beside it and snaps onto
// the chest the first time the section comes into view; the button toggles it.
const awakenCanvas = $('#awakenCanvas');
const heartToggle = $('#heartToggle');
const awaken = new Stage(awakenCanvas, {
  model: C.model, env: C.env, heart: true, heartDocked: false,
  frameHeight: COLLECTION === 'summer' ? 1.6 : 1.25, frameWidth: COLLECTION === 'summer' ? 1.25 : 1.7,
  cameraY: 0.5, baseYaw: COLLECTION === 'summer' ? 0.95 : 0.25, yawRange: 0.5,
  baseElevation: 0.1, elevationRange: 0.2,
});
function syncHeartToggle() {
  const on = awaken.heartDocked;
  heartToggle.setAttribute('aria-pressed', String(on));
  heartToggle.textContent = t(on ? 'heart.undock' : 'heart.dock');
}
heartToggle.addEventListener('click', () => { awaken.setHeartDocked(!awaken.heartDocked); syncHeartToggle(); });
let awakenShown = false;
new IntersectionObserver(([e]) => {
  if (e.isIntersecting && !awakenShown) {
    awakenShown = true;
    setTimeout(() => { awaken.setHeartDocked(true); syncHeartToggle(); }, 1400);
  }
}, { threshold: 0.5 }).observe(awakenCanvas);
awakenCanvas.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch') return;
  const r = awakenCanvas.getBoundingClientRect();
  awaken.steer(((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1);
});

// ---------- configurator ----------
const configCanvas = $('#configCanvas');
const config = new Stage(configCanvas, {
  model: C.model, env: C.env, heart: true, frameHeight: 1.16, cameraY: 0.5,
  yawRange: Math.PI, baseYaw: COLLECTION === 'summer' ? 0.85 : 0.35, baseElevation: 0.1, elevationRange: 0.3,
});

let drag = null;
configCanvas.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY, bx: config.target.x, by: config.target.y };
  configCanvas.setPointerCapture(e.pointerId);
});
configCanvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  config.steer(drag.bx + (e.clientX - drag.x) / 220, drag.by + (e.clientY - drag.y) / 300);
});
['pointerup', 'pointercancel'].forEach((ev) => configCanvas.addEventListener(ev, () => { drag = null; }));

const viewerHeart = $('#viewerHeart');
function syncViewerHeart() {
  viewerHeart.setAttribute('aria-pressed', String(config.heartDocked));
  viewerHeart.textContent = t(config.heartDocked ? 'viewer.heartOff' : 'viewer.heartOn');
}
viewerHeart.addEventListener('click', () => { config.setHeartDocked(!config.heartDocked); syncViewerHeart(); });

const sizeWrap = $('#sizeOptions');
const finishWrap = $('#finishOptions');

function buildOptions() {
  sizeWrap.innerHTML = SIZES.map((s) => `
    <label class="size">
      <input type="radio" name="size" value="${s.cm}" ${s.cm === state.size ? 'checked' : ''}>
      <span class="size-body">
        <span class="size-cm">${s.cm}<small> cm</small></span>
        <span class="size-place" data-size-place="${s.cm}"></span>
        <span class="size-ed" data-size-in="${s.cm}"></span>
      </span>
    </label>`).join('');
  finishWrap.innerHTML = FINISH_KEYS.map((k) => `
    <label class="finish">
      <input type="radio" name="finish" value="${k}" ${k === state.finish ? 'checked' : ''}>
      <span class="swatch swatch-${k}" aria-hidden="true"></span>
      <span class="sr-only" data-finish-name="${k}"></span>
    </label>`).join('');
}

const hex = (c) => `#${c.getHexString()}`;
function hsvHex() { const { h, s, v } = state.hsv; return hex(hsvColor(h, s, v)).toUpperCase(); }

function renderHsv() {
  const { h, s, v } = state.hsv;
  const full = hex(hsvColor(h, 1, 1));
  const cur = hsvHex();
  $('#hsvS').style.setProperty('--track', `linear-gradient(90deg, ${hex(hsvColor(h, 0, v))}, ${hex(hsvColor(h, 1, v))})`);
  $('#hsvV').style.setProperty('--track', `linear-gradient(90deg, #000, ${hex(hsvColor(h, s, 1))})`);
  $('#hsvH').style.setProperty('--thumb', full);
  $('#hsvChip').style.background = cur;
  $('#hsvHex').textContent = cur;
  const sw = $('.swatch-custom');
  if (sw && state.finish === 'custom') sw.style.background = `radial-gradient(circle at 34% 28%, #ffffff 0, ${cur} 30%, ${hex(hsvColor(h, s, v * 0.45))} 100%)`;
}

function finishLabel(lang = state.lang) {
  return state.finish === 'custom' ? `${t('finish.custom', null, lang)} ${hsvHex()}` : t(`finish.${state.finish}`, null, lang);
}

function penguinPath(cx, h) {
  const g = 110;
  if (COLLECTION === 'summer') { // resting body: h is the LENGTH here
    const w = h / 2, top = h * 0.62;
    return `M${cx - w} ${g} C${cx - w} ${g - top * 0.35} ${cx - w * 0.1} ${g - top * 0.45} ${cx + w * 0.5} ${g - top * 0.85}` +
      ` C${cx + w * 0.7} ${g - top} ${cx + w} ${g - top * 0.7} ${cx + w * 0.8} ${g} Z`;
  }
  const w = h * 0.2;
  return `M${cx} ${g - h} C${cx + w * 1.1} ${g - h} ${cx + w * 1.5} ${g - h * 0.45} ${cx + w * 0.95} ${g}` +
    ` L${cx - w * 0.95} ${g} C${cx - w * 1.5} ${g - h * 0.45} ${cx - w * 1.1} ${g - h} ${cx} ${g - h} Z`;
}

function renderConfig() {
  const size = SIZES.find((s) => s.cm === state.size);
  $$('[data-size-place]').forEach((el) => { el.textContent = t(`size.${el.dataset.sizePlace}`); });
  $$('[data-size-in]').forEach((el) => {
    el.textContent = state.lang === 'en' ? `${(+el.dataset.sizeIn / 2.54).toFixed(1)} in` : '';
  });
  $$('[data-finish-name]').forEach((el) => {
    el.textContent = t(`finish.${el.dataset.finishName}`);
    el.closest('label').title = t(`finish.${el.dataset.finishName}`);
  });
  $('#finishName').textContent = finishLabel();
  $('#finishLine').textContent = t(`finishline.${state.finish}`);
  $('#hsvPanel').hidden = state.finish !== 'custom';
  renderHsv();

  $('#engraveInput').placeholder = t(`engrave.${state.for}`);
  const words = state.engrave.trim() || t(`engrave.${state.for}`);
  $('#plinthWords').textContent = `“${words}”`;
  $('#plinthWords').classList.toggle('is-example', !state.engrave.trim());
  $('#plinthLine').textContent = t(`forline.${state.for}`);
  $('#summaryText').textContent = summary();

  const h = (state.size / 175) * 96; // person = 96 units = 175 cm
  $('#scalePenguinPath').setAttribute('d', penguinPath(160, h));
  const label = $('#scalePenguinLabel');
  label.textContent = `${state.size} cm`;
  label.setAttribute('y', String(Math.max(16, 110 - h * (COLLECTION === 'summer' ? 0.62 : 1) - 6)));
  $('#scalePersonLabel').textContent = t('scale.person');

  syncViewerHeart();
  if (typeof syncHeartToggle === 'function') syncHeartToggle();
  config.setScale(size.scale);
  config.setFinish(state.finish, state.hsv, state.surface);
}

// lang defaults to the visitor's language; the studio email always uses Spanish.
function summary(lang = state.lang) {
  return t('summary.text', {
    collection: C.name,
    size: state.size,
    finish: finishLabel(lang),
    surface: t(`surface.${state.surface}`, null, lang).toLowerCase(),
  }, lang);
}

$('#configForm').addEventListener('change', (e) => {
  const { name, value } = e.target;
  if (name === 'for') state.for = value;
  if (name === 'size') state.size = +value;
  if (name === 'finish') state.finish = value;
  if (name === 'surface') state.surface = value;
  renderConfig();
});
['hsvH', 'hsvS', 'hsvV'].forEach((id) => $(`#${id}`).addEventListener('input', () => {
  state.hsv = { h: +$('#hsvH').value, s: $('#hsvS').value / 100, v: $('#hsvV').value / 100 };
  renderConfig();
}));
$('#engraveInput').addEventListener('input', (e) => { state.engrave = e.target.value; renderConfig(); });

// ---------- request dialog ----------
const dialog = $('#requestDialog');
const form = $('#requestForm');
const errorBox = $('#formError');

let merchItem = null; // set when the dialog was opened from the merch section
function requestPiece(lang = state.lang) {
  return merchItem ? t('merch.request', { item: t(`merch.${merchItem}`, null, lang) }, lang) : summary(lang);
}
function openRequest() {
  $('#requestPiece').textContent = requestPiece();
  $('#requestEngrave').textContent = !merchItem && state.engrave.trim() ? `“${state.engrave.trim()}”` : '';
  $('#fGift').checked = !merchItem && state.for !== 'self';
  $('#requestFormWrap').hidden = false;
  $('#requestSuccess').hidden = true;
  errorBox.hidden = true;
  dialog.showModal();
  document.body.classList.add('dialog-open');
}
function closeRequest() { dialog.close(); }
dialog.addEventListener('close', () => document.body.classList.remove('dialog-open'));
$$('.js-open-request').forEach((b) => b.addEventListener('click', () => { merchItem = null; openRequest(); }));
$$('.js-merch').forEach((b) => b.addEventListener('click', () => { merchItem = b.dataset.item; openRequest(); }));
$('#dialogClose').addEventListener('click', closeRequest);
$('#successClose').addEventListener('click', closeRequest);
dialog.addEventListener('click', (e) => { if (e.target === dialog) closeRequest(); });

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorBox.hidden = true;
  if (!form.checkValidity()) { form.reportValidity(); return; }
  if ($('#fHoney').value) return;

  const btn = $('#submitBtn');
  btn.disabled = true;
  btn.textContent = t('form.sending');
  const piece = requestPiece('es');
  const { h, s, v } = state.hsv;
  const payload = {
    _subject: t('form.subject', { piece }, 'es'),
    _template: 'table',
    _captcha: 'false',
    _autoresponse: t('form.autoresponse'),
    Nombre: $('#fName').value.trim(),
    email: $('#fEmail').value.trim(),
    Telefono: $('#fPhone').value.trim(),
    Ubicacion: $('#fLocation').value.trim(),
    Coleccion: C.name,
    Pieza: piece,
    Tamano: `${state.size} cm${COLLECTION === 'summer' ? ' de largo' : ''}`,
    Acabado: t(`finish.${state.finish}`, null, 'es'),
    Color: state.finish === 'custom' ? `${hsvHex()} (H ${h}°, S ${Math.round(s * 100)}%, V ${Math.round(v * 100)}%)` : '—',
    Superficie: t(`surface.${state.surface}`, null, 'es'),
    Para: t(`for.${state.for}`, null, 'es'),
    Grabado: merchItem ? '—' : (state.engrave.trim() || t('form.none', null, 'es')),
    Regalo: $('#fGift').checked ? 'Sí' : 'No',
    Mensaje: $('#fMessage').value.trim(),
    Idioma: state.lang.toUpperCase(),
  };
  try {
    const res = await fetch(FORM_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || String(data.success) !== 'true') throw new Error(data.message || res.status);
    $('#successBody').textContent = t('form.successBody', { email: payload.email });
    $('#requestFormWrap').hidden = true;
    $('#requestSuccess').hidden = false;
    form.reset();
  } catch {
    errorBox.textContent = t('form.error');
    errorBox.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = t('form.submit');
  }
});

// ---------- boot ----------
buildOptions();
const saved = storageGet('pel-lang');
applyLanguage(saved || ((navigator.language || 'es').toLowerCase().startsWith('es') ? 'es' : 'en'));
