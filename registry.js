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
const DEMO = [
  ['Luna', 'dreamer', 'curious', 'love', 'silver', '#F1F3F5', 2],
  ['Sol', 'tender', null, 'love', 'gold', '#E2B867', 1],
  ['Bruno', 'explorer', 'calm', 'love', 'onyx', '#050607', null],
  ['Nieve', 'calm', null, 'summer', 'silver', '#F1F3F5', null],
  ['Coco', 'playful', 'curious', 'summer', 'custom', '#E8769A', null],
  ['Amelia', 'curious', null, 'love', 'emerald', '#0A6A44', null],
  ['Kai', 'playful', null, 'love', 'custom', '#3FA7D6', null],
  ['Olivia', 'tender', 'dreamer', 'love', 'silver', '#F1F3F5', 9],
  ['Mateo', 'calm', null, 'love', 'onyx', '#050607', 8],
  ['Pip', 'curious', 'playful', 'summer', 'gold', '#E2B867', null],
  ['Aurora', 'dreamer', null, 'summer', 'custom', '#F2B544', null],
  ['Tomás', 'explorer', null, 'love', 'silver', '#F1F3F5', null],
  ['Vera', 'calm', 'tender', 'love', 'gold', '#E2B867', null],
  ['Hugo', 'playful', null, 'love', 'onyx', '#050607', null],
  ['Mía', 'tender', null, 'summer', 'ruby', '#8C0F26', null],
  ['Bastian', 'explorer', 'curious', 'summer', 'emerald', '#0A6A44', null],
  ['Isla', 'dreamer', null, 'love', 'custom', '#9B8CF2', null],
].map(([name, personality, trait, collection, color_key, color_hex, partnerIdx], i) => {
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
  return { ...p, piece: { serial: p.serial, collection: p.collection, finish: p.color_key, color_hex: p.color_hex, surface: p.surface } };
}

const LOCAL_KEY = 'pel-demo-baptisms';
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
    trait: data.trait || null, collection: data.collection, color_key: data.colorKey, color_hex: data.colorHex.toUpperCase(),
    surface: data.surface, partner: null, seed: Math.floor(Math.random() * 2147483647),
    awakened_at: new Date().toISOString(), chip: ticket,
  };
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
  return all().map(withPiece);
}
