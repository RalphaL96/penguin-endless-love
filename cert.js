// Chip page: every heart opens this page with the same link template.
// New heart → the penguin appears unpainted and the custodian baptises it
// (collection, colour, finish, character, name). The certificate is generated
// on the spot, numbered in order of arrival. A baptised heart shows its certificate.
import { Stage, FINISHES, hsvColor } from './stage.js';
import { STRINGS } from './i18n.js';
import { ECO } from './i18n-eco.js';
import { MODE, PERSONALITIES, verifyTap, claim, serialFor } from './registry.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const COLOR_KEYS = ['silver', 'gold', 'onyx', 'emerald', 'ruby', 'custom'];
const hex = (c) => `#${c.getHexString()}`.toUpperCase();

let lang = 'es';
let result = null;
const form = { collection: 'love', color: null, hsv: { h: 200, s: 0.55, v: 0.7 }, surface: 'gloss', personality: null, trait: null };
let shown = null; // the penguin being displayed (baptised)

function t(key, vars) {
  let s = ECO[lang]?.[key] ?? STRINGS[lang]?.[key] ?? ECO.es[key] ?? STRINGS.es[key] ?? key;
  if (vars) for (const k in vars) s = s.replaceAll(`{${k}}`, vars[k]);
  return s;
}
function getLang() { try { return localStorage.getItem('pel-lang'); } catch { return null; } }
function setLang(l) { try { localStorage.setItem('pel-lang', l); } catch { /* storage unavailable */ } }
const fmtDate = (iso) => new Date(iso).toLocaleDateString(lang === 'es' ? 'es-VE' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric' });
const show = (sel, on = true) => { $(sel).hidden = !on; };

// ---------- 3D ----------
const heart = new Stage($('#certHeart'), {
  model: 'heart', finish: 'heart', shadow: false, spin: true,
  frameHeight: 1.35, baseYaw: Math.PI, yawRange: 0, baseElevation: 0.08, elevationRange: 0,
});
let stage = null;
function ensureStage(model) {
  if (stage) { if (stage.modelKey !== model) stage.setModel(model); return stage; }
  stage = new Stage($('#chipCanvas'), {
    model, finish: 'clay', colorFade: true, frameHeight: model === 'rest' ? 1.6 : 1.2, frameWidth: model === 'rest' ? 1.25 : undefined,
    cameraY: 0.5, baseYaw: model === 'rest' ? 0.85 : 0.3, yawRange: Math.PI, baseElevation: 0.1, elevationRange: 0.3,
  });
  const c = $('#chipCanvas');
  let drag = null;
  c.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, bx: stage.target.x, by: stage.target.y }; c.setPointerCapture(e.pointerId); });
  c.addEventListener('pointermove', (e) => { if (drag) stage.steer(drag.bx + (e.clientX - drag.x) / 220, drag.by + (e.clientY - drag.y) / 300); });
  ['pointerup', 'pointercancel'].forEach((ev) => c.addEventListener(ev, () => { drag = null; }));
  return stage;
}
function modelFor(collection) { return collection === 'summer' ? 'rest' : 'stand'; }
function framing(collection) {
  const summer = collection === 'summer';
  Object.assign(stage.opts, { frameHeight: summer ? 1.45 : 1.2, frameWidth: summer ? 1.05 : undefined, baseYaw: summer ? 0.85 : 0.3 });
  if (stage.sizeCache) stage.frame(stage.sizeCache);
}

// ---------- baptism form ----------
function colorHex() {
  if (form.color === 'custom') return hex(hsvColor(form.hsv.h, form.hsv.s, form.hsv.v));
  return form.color ? `#${FINISHES[form.color].color.toString(16).padStart(6, '0')}`.toUpperCase() : null;
}
function colorLabel(key, hx) { return key === 'custom' ? `${t('finish.custom')} ${hx}` : t(`finish.${key}`); }
function personalityLabel(p, tr) { return tr ? `${t(`p.${p}`)} · ${t(`p.${tr}`)}` : t(`p.${p}`); }

function buildOptions() {
  $('#colorOptions').innerHTML = COLOR_KEYS.map((k) => `
    <label class="finish" title="${t(`finish.${k}`)}">
      <input type="radio" name="color" value="${k}" ${form.color === k ? 'checked' : ''}>
      <span class="swatch swatch-${k}" aria-hidden="true"></span>
      <span class="sr-only">${t(`finish.${k}`)}</span>
    </label>`).join('');
  $('#pGrid').innerHTML = PERSONALITIES.map((p) => {
    const role = form.personality === p ? 'main' : form.trait === p ? 'trait' : '';
    return `
    <button type="button" class="p-card ${role}" data-p="${p}" aria-pressed="${role ? 'true' : 'false'}">
      <span class="p-body">
        <span class="p-name">${t(`p.${p}`)}</span>
        <span class="p-desc">${t(`p.${p}.d`)}</span>
        <span class="p-role">${role === 'main' ? t('bap.main') : role === 'trait' ? t('bap.trait') : ''}</span>
      </span>
    </button>`;
  }).join('');
}

function renderForm() {
  const hx = colorHex();
  $('#colorName').textContent = form.color ? colorLabel(form.color, hx) : '';
  show('#hsvPanel', form.color === 'custom');
  if (form.color === 'custom') {
    const { h, s, v } = form.hsv;
    $('#hsvS').style.setProperty('--track', `linear-gradient(90deg, ${hex(hsvColor(h, 0, v))}, ${hex(hsvColor(h, 1, v))})`);
    $('#hsvV').style.setProperty('--track', `linear-gradient(90deg, #000, ${hex(hsvColor(h, s, 1))})`);
    $('#hsvH').style.setProperty('--thumb', hex(hsvColor(h, 1, 1)));
    $('#hsvChip').style.background = hx;
    $('#hsvHex').textContent = hx;
  }
  const name = $('#penName').value.trim();
  $('#stageName').textContent = name;
  $('#bapBtn').textContent = name ? t('pen.submitNamed', { name }) : t('pen.submit');
  // the stage follows every choice
  stage.setFinish(form.color || 'clay', form.color === 'custom' ? form.hsv : null, form.surface);
  stage.setAnimation(form.personality);
}

$('#bapForm').addEventListener('change', (e) => {
  const { name, value } = e.target;
  if (name === 'collection') {
    form.collection = value;
    document.body.dataset.collection = value;
    framing(value);
    stage.setModel(modelFor(value));
  }
  if (name === 'color') form.color = value;
  if (name === 'surface') form.surface = value;
  renderForm();
});
['hsvH', 'hsvS', 'hsvV'].forEach((id) => $(`#${id}`).addEventListener('input', () => {
  form.hsv = { h: +$('#hsvH').value, s: $('#hsvS').value / 100, v: $('#hsvV').value / 100 };
  renderForm();
}));
$('#penName').addEventListener('input', renderForm);

// Personality: first tap = main character, second = optional trait, tap again to remove.
$('#pGrid').addEventListener('click', (e) => {
  const card = e.target.closest('.p-card');
  if (!card) return;
  const p = card.dataset.p;
  if (form.personality === p) { form.personality = form.trait; form.trait = null; }
  else if (form.trait === p) form.trait = null;
  else if (!form.personality) form.personality = p;
  else form.trait = p;
  buildOptions();
  renderForm();
});
// preview an animation by hovering a card
$('#pGrid').addEventListener('pointerover', (e) => {
  const card = e.target.closest('.p-card');
  if (card && e.pointerType === 'mouse') stage.setAnimation(card.dataset.p);
});
$('#pGrid').addEventListener('pointerleave', () => stage.setAnimation(form.personality));

$('#bapForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#bapError');
  err.hidden = true;
  const name = $('#penName').value.trim();
  const email = $('#penEmail').value.trim();
  const missing = !form.color ? 'bap.needColor' : !form.personality ? 'pen.personalityMissing' : !name ? 'pen.nameMissing' : null;
  if (missing) { err.textContent = t(missing); err.hidden = false; return; }
  if (!email || !$('#penEmail').checkValidity()) { $('#penEmail').reportValidity(); return; }
  const btn = $('#bapBtn');
  btn.disabled = true;
  btn.textContent = t('pen.waking');
  try {
    const penguin = await claim(result.ticket, {
      collection: form.collection, name, colorKey: form.color, colorHex: colorHex(), surface: form.surface,
      personality: form.personality, trait: form.trait, email,
    });
    showCertificate(penguin, { fresh: true, email });
    history.replaceState(null, '', MODE === 'demo' ? `#${penguin.serial}` : location.href);
  } catch {
    err.textContent = t('pen.error');
    err.hidden = false;
  } finally {
    btn.disabled = false;
    renderForm();
  }
});

// ---------- certificate ----------
function showCertificate(p, { fresh = false, email = '' } = {}) {
  shown = { p, fresh, email };
  show('#bapForm', false);
  show('#certView');
  document.body.dataset.collection = p.collection;
  ensureStage(modelFor(p.collection));
  framing(p.collection);
  stage.setFinish(p.color_key, { hex: p.color_hex }, p.surface);
  stage.setAnimation(p.personality);
  renderCertificate();
  if (fresh) $('#certView').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderCertificate() {
  if (!shown) return;
  const { p, fresh, email } = shown;
  $('#stageName').textContent = p.name;
  $('#certKicker').textContent = fresh ? t('cert.born', { name: p.name }) : t('cert.authentic');
  $('#cName').textContent = p.name;
  $('#cSerial').textContent = p.serial;
  $('#cArrival').textContent = t('cert.arrival', { n: p.arrival });
  $('#cCollection').textContent = p.collection === 'summer' ? 'Penguin Endless Summer' : 'Penguin Endless Love';
  $('#cSwatch').style.background = p.color_hex;
  $('#cColor').textContent = colorLabel(p.color_key, p.color_hex);
  $('#cSurface').textContent = t(`surface.${p.surface}`);
  $('#cPersonality').textContent = personalityLabel(p.personality, p.trait);
  $('#cAwake').textContent = fmtDate(p.awakened_at);
  $('#cReads').textContent = result?.counter != null ? `Nº ${result.counter}` : '—';
  $('#visitBtn').textContent = t('pen.visit', { name: p.name });
  $('#visitBtn').href = `mundo.html#${p.serial}`;
  $('#emailNote').textContent = fresh && email ? t('cert.emailNote', { email }) : '';
}

// ---------- language ----------
function applyLanguage(l) {
  lang = l;
  document.documentElement.lang = l;
  setLang(l);
  $$('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  $$('.lang button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === l)));
  $('#penName').placeholder = t('pen.namePh');
  buildOptions();
  if (stage && !$('#bapForm').hidden) renderForm();
  renderCertificate();
}
$$('.lang button').forEach((b) => b.addEventListener('click', () => applyLanguage(b.dataset.lang)));

// ---------- flow ----------
async function run() {
  result = null; shown = null;
  ['#stateFail', '#stateChip'].forEach((s) => show(s, false));
  show('#stateVerifying');
  document.body.dataset.collection = 'love';
  result = await verifyTap();
  show('#stateVerifying', false);

  if (result.status === 'new') {
    Object.assign(form, { collection: 'love', color: null, surface: 'gloss', personality: null, trait: null });
    $('#bapForm').reset();
    show('#stateChip'); show('#bapForm'); show('#certView', false);
    ensureStage('stand');
    framing('love');
    stage.setModel('stand');
    stage.setFinish('clay');
    stage.colorGoal = null; stage.setFinish('clay');
    buildOptions();
    renderForm();
  } else if (result.status === 'authentic') {
    show('#stateChip');
    showCertificate(result.penguin);
  } else {
    show('#stateFail');
    const key = result.status === 'replayed' ? 'cert.replayed' : 'cert.unverified';
    $('#failTitle').textContent = t(key);
    $('#failHelp').textContent = t(`${key}Help`);
  }
}

if (MODE === 'demo') {
  show('#demoNote');
  window.addEventListener('hashchange', () => { if (!shown || location.hash.slice(1) !== shown.p.serial) run(); });
}
applyLanguage(getLang() || ((navigator.language || 'es').toLowerCase().startsWith('es') ? 'es' : 'en'));
run();
export { serialFor };
