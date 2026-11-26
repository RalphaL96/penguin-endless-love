// Registry of heart chips and penguins.
// LIVE mode talks to the Supabase backend (backend/ folder). Until it is deployed
// the site runs in DEMO mode with a sample colony stored in this file, plus the
// visitor's own baptisms saved in their browser.
//
// To go live, set window.PEL_CONFIG before this script loads:
//   window.PEL_CONFIG = { api: 'https://<project>.supabase.co', anonKey: '<anon key>' };

const CONFIG = window.PEL_CONFIG || null;
export const MODE = CONFIG ? 'live' : 'demo';

export const PERSONALITIES = ['tender', 'explorer', 'dreamer', 'curious', 'calm', 'playful'];

// Sample colony (arrival order = list order).
// The sample colony was removed for launch: the island starts empty and PEL-0001 is the first real piece.
const DEMO = [].map(([name, personality, trait, collection, color_key, color_hex, partnerIdx], i) => {
  const arrival = i + 1;
  return {
    serial: serialFor(collection, arrival), arrival, name, personality, trait, collection, color_key, color_hex,
    surface: i % 4 === 3 ? 'matte' : 'gloss', partnerIdx, seed: 7919 * (i + 3),
    awakened_at: new Date(Date.UTC(2026, 8, 1 + i * 2)).toISOString(),
    chip: `demo-${arrival}`,
  };
});
DEMO.forEach((p) => { p.partner = p.partnerIdx ? DEMO[p.partnerIdx - 1].serial : null; delete p.partnerIdx; });

export function serialFor(collection, arrival) {
  return `${collection === 'summer' ? 'PES' : 'PEL'}-${String(arrival).padStart(4, '0')}`;
}

// The island and the old pages read `piece`: keep that shape for every penguin.
function withPiece(p) {
  return { ...p, piece: { serial: p.serial, collection: p.collection, finish: p.color_key, color_hex: p.color_hex, surface: p.surface, texture: p.texture || null, size_cm: p.size_cm } };
}

// ---------- intervened pieces (Modo estudio) ----------
// The studio certifies a hand-painted piece: its data, its texture baked from photos,
// and a link of its own for the chip. DEMO: kept in this browser only.
const OBRAS_KEY = 'pel-obras-v1'; // new key at launch: test pieces saved under the old one are ignored
const obrasMem = [];
export function listObras() { try { return JSON.parse(localStorage.getItem(OBRAS_KEY)) || obrasMem; } catch { return obrasMem; } }
function saveObras(list) {
  obrasMem.splice(0, obrasMem.length, ...list);
  localStorage.setItem(OBRAS_KEY, JSON.stringify(list)); // throws when the browser's storage is full: the caller reports it
}
export function getObra(id) { return listObras().find((o) => o.id === id) || null; }
/** Certify a piece. Returns the record with its id; the chip link is obraLink(id). */
export function saveObra(data) {
  const id = Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 14);
  const obra = { id, created_at: new Date().toISOString(), serial: null, ...data };
  saveObras([...listObras(), obra]);
  return obra;
}
export function deleteObra(id) { saveObras(listObras().filter((o) => o.id !== id)); }
// The link written on the chip. It must outlive any change of domain: this address stays
// alive and will redirect to the final domain once it exists.
export const PUBLIC_BASE = 'https://penguin-endless-love.vercel.app/';
export function obraLink(id) { return `${PUBLIC_BASE}p.html?o=${id}`; }
export function obraLocalLink(id) { return new URL(`p.html?o=${id}`, location.href).href; }

// Published pieces: until the backend exists, a certified piece reaches every phone as a
// static file of the site, obras/<id>.json (the record the studio tool exports), listed in
// obras/index.json. Once its custodian baptises it, the studio adds `penguin` to that file.
async function publishedObra(id) {
  if (!/^[a-z0-9]{6,24}$/.test(id)) return null;
  try {
    const res = await fetch(`obras/${id}.json`, { cache: 'no-store' });
    if (!res.ok) return null;
    return { ...(await res.json()), published: true };
  } catch { return null; }
}
async function findObra(id) { return (await publishedObra(id)) || getObra(id); }
function fromObra(obra, p) {
  return { ...p, collection: obra.collection, color_key: 'obra', color_hex: '#FFFFFF', surface: obra.surface || 'gloss', texture: obra.texture,
    obra_id: obra.id, obra_title: obra.title, size_cm: obra.size_cm, year: obra.year, technique: obra.technique };
}
async function publishedPenguins() {
  try {
    const res = await fetch('obras/index.json', { cache: 'no-store' });
    if (!res.ok) return [];
    const obras = await Promise.all((await res.json()).map(publishedObra));
    return obras.filter((o) => o && o.penguin).map((o) => fromObra(o, o.penguin));
  } catch { return []; }
}
// Tell the studio about a baptism, so it can be published for everyone (best effort).
function notifyStudio(p, email) {
  fetch('https://formsubmit.co/ajax/gerardocampos.estudio@gmail.com', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ _subject: `Bautizo ${p.serial}: ${p.name}`, _template: 'table', obra: p.obra_title, obra_id: p.obra_id, serial: p.serial,
      nombre: p.name, caracter: p.personality, rasgo: p.trait || '', correo: email, despertar: p.awakened_at, semilla: p.seed }),
  }).catch(() => {});
}

const LOCAL_KEY = 'pel-baptisms-v1'; // new key at launch: test baptisms saved under the old one are ignored
const memory = []; // fallback when storage is blocked
function local() { try { return JSON.parse(localStorage.getItem(LOCAL_KEY)) || memory; } catch { return memory; } }
function saveLocal(list) { memory.splice(0, memory.length, ...list); try { localStorage.setItem(LOCAL_KEY, JSON.stringify(list)); } catch { /* storage unavailable */ } }
function all() { return [...DEMO, ...local().map((p) => ({ ...p, mine: true }))]; }

/**
 * Verify the tap that opened the page.
 * → { status: 'new', ticket, counter } for a chip whose penguin has not been baptised
 * → { status: 'authentic', penguin, counter } for a baptised penguin
 * → { status: 'replayed' | 'unverified' }
 */
export async function verifyTap() {
  if (MODE === 'live') {
    const q = new URLSearchParams(location.search);
    const res = await fetch(`${CONFIG.api}/functions/v1/verify?e=${q.get('e') ?? ''}&c=${q.get('c') ?? ''}`, {
      headers: { Authorization: `Bearer ${CONFIG.anonKey}` },
    });
    const r = await res.json();
    if (r.penguin) r.penguin = withPiece(r.penguin);
    return r;
  }
  // DEMO: the link carries what the chip would: #nuevo (unbaptised heart), a serial, #copiado, #falso
  await new Promise((r) => setTimeout(r, 1500));
  const obraId = new URLSearchParams(location.search).get('o');
  if (obraId) { // an intervened piece's own link
    const obra = await findObra(obraId);
    if (!obra) return { status: 'unverified' };
    if (obra.penguin) return { status: 'authentic', penguin: withPiece(fromObra(obra, obra.penguin)), counter: 1 }; // published baptism
    const born = all().find((x) => x.obra_id === obra.id);
    if (born) return { status: 'authentic', penguin: withPiece(born), counter: 1 };
    return { status: 'new', ticket: `obra-${obra.id}`, counter: 1, obra };
  }
  const tag = decodeURIComponent(location.hash.slice(1) || 'nuevo').toUpperCase();
  if (tag === 'COPIADO') return { status: 'replayed' };
  if (tag === 'FALSO') return { status: 'unverified' };
  if (tag === 'NUEVO') return { status: 'new', ticket: `demo-chip-${Date.now()}`, counter: 1 };
  const p = all().find((x) => x.serial === tag);
  if (!p) return { status: 'unverified' };
  return { status: 'authentic', penguin: withPiece(p), counter: 3 + (p.seed % 40) };
}

/** Baptise: returns the new penguin with its arrival number and serial. */
export async function claim(ticket, data) {
  if (MODE === 'live') {
    const res = await fetch(`${CONFIG.api}/functions/v1/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CONFIG.anonKey}` },
      body: JSON.stringify({ ticket, ...data }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'claim-failed');
    return withPiece(body.penguin);
  }
  await new Promise((r) => setTimeout(r, 1100));
  const mine = local();
  const arrival = DEMO.length + mine.length + 1;
  const p = {
    serial: serialFor(data.collection, arrival), arrival, name: data.name, personality: data.personality,
    trait: data.trait || null, collection: data.collection, color_key: data.colorKey, color_hex: (data.colorHex || '#FFFFFF').toUpperCase(),
    surface: data.surface, partner: null, seed: Math.floor(Math.random() * 2147483647),
    awakened_at: new Date().toISOString(), chip: ticket,
  };
  if (data.obraId) {
    const obra = await findObra(data.obraId);
    if (!obra || obra.penguin || mine.some((x) => x.obra_id === obra.id)) throw new Error('obra-unavailable'); // a piece is baptised once
    Object.assign(p, fromObra(obra, {}), { serial: obra.serial_fixed || serialFor(obra.collection, arrival) });
    if (obra.serial_fixed) p.arrival = parseInt(obra.serial_fixed.split('-')[1], 10) || arrival;
    if (getObra(obra.id)) saveObras(listObras().map((o) => (o.id === obra.id ? { ...o, serial: p.serial, name: p.name } : o)));
    notifyStudio(p, data.email);
  }
  saveLocal([...mine, p]);
  return withPiece({ ...p, mine: true });
}

/** Every baptised penguin in the shared world. */
export async function listPenguins() {
  if (MODE === 'live') {
    const res = await fetch(`${CONFIG.api}/rest/v1/penguins?select=*&order=arrival`, {
      headers: { apikey: CONFIG.anonKey, Authorization: `Bearer ${CONFIG.anonKey}` },
    });
    return (await res.json()).map(withPiece);
  }
  const pub = await publishedPenguins();
  const seen = new Set(pub.map((p) => p.obra_id));
  const mineIds = new Set(local().map((p) => p.obra_id).filter(Boolean));
  return [...pub.map((p) => (mineIds.has(p.obra_id) ? { ...p, mine: true } : p)), ...all().filter((p) => !p.obra_id || !seen.has(p.obra_id))].map(withPiece);
}
