// The daily life of every penguin, computed from its seed and the clock.
// The same function runs for every visitor, so everyone sees the same island
// without a live server: where a penguin is "now" depends only on (seed, time).
//
// On top of each penguin's own routine the colony shares an island day (DAY seconds):
// twice a day it files down to the shore, hesitates, dives and swims a lap around the
// island; at dusk it gathers in a huddle that shuffles like a slow wave through the night.

export const ISLAND_R = 7;          // walkable radius (world units)
export const SLOT = 45;               // seconds per activity
const WALK_SPEED = 0.42;              // units per second
const SLIDE_SPEED = 1.0;

// ---------- the island day ----------
export const DAY = 3 * 3600;          // one island day lasts three hours
const NIGHT_START = 150 * 60;         // the huddle holds from here until the day ends (30 minutes)
const DUSK = 12 * 60;                 // the light fades during this long before night
const DAWN = [4.5 * 60, 3 * 60];      // the light returns from this long before the day ends to this long after
const GATHER = 40;                    // seconds to walk to the huddle before night
const DAWN_EXIT = 40;                 // seconds to walk back to one's own routine at dawn
const STEP = 40;                      // the huddle shuffles one place every STEP seconds
const LAST_STEP = Math.floor((DAY - NIGHT_START) / STEP) - 1;
const HUDDLE_GAP = 0.7;               // distance between neighbours in the huddle
const SEA_TRIPS = [20, 45, 70, 95, 120].map((m) => m * 60); // seconds into the day when the colony goes swimming
const SEA_LEN = 175;                  // a whole trip: file, shore, lap, back to the routine
const ASM = 40;                       // seconds to line up
const FILE_V = 0.55;                  // marching speed
const DIVE = 0.9, LAP = 44, LEAP = 0.8, GETUP = 1.4, HOP = 1.25;
const SWIM_R = ISLAND_R + 1.4;        // where they enter and leave the water
export const SEA_Y = -0.35;           // the surface of the sea
const DEEP = -1.0;                    // they swim under the surface and only break it to leap
// seconds inside the Slide clip (lie down / glide / get up); the swim reuses its belly pose
export const SLIDE_DOWN = 1.2, SLIDE_HOLD = 1.0, SLIDE_UP = 2.6;

// how likely each activity is, per character
const WEIGHTS = {
  tender:   { walk: 0.2, explore: 0.05, rest: 0.15, sea: 0.1, visit: 0.5, slide: 0 },
  explorer: { walk: 0.25, explore: 0.5, rest: 0.05, sea: 0.1, visit: 0.1, slide: 0 },
  dreamer:  { walk: 0.15, explore: 0, rest: 0.6, sea: 0.15, visit: 0.1, slide: 0 },
  curious:  { walk: 0.35, explore: 0.15, rest: 0.05, sea: 0.1, visit: 0.35, slide: 0 },
  calm:     { walk: 0.2, explore: 0, rest: 0.2, sea: 0.5, visit: 0.1, slide: 0 },
  playful:  { walk: 0.25, explore: 0, rest: 0.1, sea: 0.05, visit: 0.15, slide: 0.45 },
};
const SPEED = { tender: 0.9, explorer: 1.2, dreamer: 0.75, curious: 1.05, calm: 0.8, playful: 1.1 };

// deterministic random in [0, 1)
export function rand(seed, k, i) {
  let h = (seed | 0) ^ Math.imul(k | 0, 0x9e3779b1) ^ Math.imul(i | 0, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function pick(weights, u) {
  let acc = 0;
  for (const [k, w] of Object.entries(weights)) { acc += w; if (u < acc) return k; }
  return 'walk';
}

function polar(r, a) { return { x: Math.sin(a) * r, z: Math.cos(a) * r }; }
function smooth(a, b, x) { const f = Math.min(1, Math.max(0, (x - a) / (b - a))); return f * f * (3 - 2 * f); }
function gap(a, b) { return Math.hypot(b.x - a.x, b.z - a.z); }

/** How much daylight there is at time t: light 1 = day, 0 = night; warm peaks at dusk and dawn. */
export function daylight(t) {
  const s = ((t % DAY) + DAY) % DAY;
  const night = s < DAWN[1] ? 1 - smooth(-DAWN[0], DAWN[1], s) : s < DAY - DAWN[0] ? smooth(NIGHT_START - DUSK, NIGHT_START, s) : 1 - smooth(DAY - DAWN[0], DAY + DAWN[1], s);
  return { light: 1 - night, warm: 4 * night * (1 - night) };
}

// places in the huddle: a hexagonal pack, ordered from the centre outwards
function huddleSlots(n) {
  const pts = [];
  const rings = Math.ceil(Math.sqrt(n)) + 1;
  for (let q = -rings; q <= rings; q++) for (let r = -rings; r <= rings; r++) {
    const x = (q + r / 2) * HUDDLE_GAP, z = r * HUDDLE_GAP * 0.866;
    pts.push({ x, z, d: Math.round(Math.hypot(x, z) * 100), a: Math.atan2(x, z) });
  }
  pts.sort((a, b) => a.d - b.d || a.a - b.a);
  return pts.slice(0, n);
}

export class Colony {
  constructor(penguins) {
    this.list = penguins;
    this.bySerial = new Map(penguins.map((p) => [p.serial, p]));
    this.rank = new Map(penguins.map((p, i) => [p, i]));
    this.slots = huddleSlots(penguins.length);
    this.trips = new Map();
    for (const p of penguins) {
      p.phase = rand(p.seed, 1, 1) * SLOT;                     // not everyone changes activity at once
      p.home = rand(p.seed, 2, 2) * Math.PI * 2;               // favourite angle (calm penguins)
      p.born = Date.parse(p.awakened_at) / 1000 || 0;
      // main personality 65%, optional second trait 35%
      const A = WEIGHTS[p.personality] || WEIGHTS.calm, B = WEIGHTS[p.trait];
      p.weights = B ? Object.fromEntries(Object.keys(A).map((k) => [k, A[k] * 0.65 + B[k] * 0.35])) : A;
    }
    // partners keep the same rhythm, so they can meet and greet each other at the same moment
    for (const p of penguins) {
      const q = p.partner && this.bySerial.get(p.partner);
      if (!q || q.partner !== p.serial) { p.mate = null; continue; }
      p.mate = q;
      p.pairSeed = (p.seed ^ q.seed) | 0;
      p.first = p.serial < q.serial;
      if (!p.first) p.phase = rand(q.seed, 1, 1) * SLOT;
    }
  }

  // the penguin that arrived in the last 24 hours, if any: the others go and welcome it
  newcomer(t) {
    let best = null;
    for (const p of this.list) if (p.born <= t && t - p.born < 86400 && (!best || p.born > best.born)) best = p;
    return best;
  }

  // where the penguin is heading in slot k, ignoring visits (no recursion)
  anchor(p, k) {
    const u = (i) => rand(p.seed, k, i);
    if (p.personality === 'calm') return polar(ISLAND_R * (0.55 + 0.35 * u(3)), p.home + (u(4) - 0.5) * 0.9);
    return polar(ISLAND_R * 0.8 * Math.sqrt(u(3)), u(4) * Math.PI * 2);
  }

  // flat = true: where the penguin really is, for someone who wants to visit it (its own visits count as a walk)
  activity(p, k, flat) {
    const u = (i) => rand(p.seed, k, i);
    // a date: both partners walk to the same spot and face each other
    if (p.mate && rand(p.pairSeed, k, 9) < 0.3) {
      const spot = polar(ISLAND_R * 0.75 * Math.sqrt(rand(p.pairSeed, k, 10)), rand(p.pairSeed, k, 11) * Math.PI * 2);
      const b = rand(p.pairSeed, k, 12) * Math.PI * 2, side = p.first ? 0.32 : -0.32;
      const target = { x: spot.x + Math.sin(b) * side, z: spot.z + Math.cos(b) * side };
      const face = { x: spot.x - Math.sin(b) * side, z: spot.z - Math.cos(b) * side };
      return { type: 'visit', target, friend: p.mate, face, date: true, outward: null };
    }
    let type = pick(p.weights, u(0));
    let target, friend = null, outward = null, face = null;
    if (!flat) {
      const fresh = this.newcomer((k + 0.5) * SLOT - p.phase);
      if (fresh && fresh !== p && (type === 'visit' ? u(8) < 0.5 : (type === 'walk' || type === 'explore') && u(8) < 0.3)) { type = 'visit'; friend = fresh; }
    }
    if (type === 'visit' && flat) type = 'walk';
    if (type === 'visit') {
      if (!friend) {
        const others = this.list.filter((o) => o !== p);
        friend = p.mate && u(5) < 0.75 ? p.mate : others[Math.floor(u(6) * others.length)];
      }
      if (!friend) type = 'walk';
      else {
        // go where the friend is halfway through this slot, and stand beside it
        const kf = Math.floor(((k + 0.5) * SLOT - p.phase + friend.phase) / SLOT);
        face = this.activity(friend, kf, true).target;
        const a = u(7) * Math.PI * 2;
        target = { x: face.x + Math.sin(a) * 0.55, z: face.z + Math.cos(a) * 0.55 };
        const r = Math.hypot(target.x, target.z), max = ISLAND_R * 0.95;
        if (r > max) { target.x *= max / r; target.z *= max / r; }
      }
    }
    if (type === 'explore') target = polar(ISLAND_R * (0.82 + 0.13 * u(3)), u(4) * Math.PI * 2);
    if (type === 'sea') {
      const a = p.personality === 'calm' ? p.home + (u(4) - 0.5) * 0.5 : u(4) * Math.PI * 2;
      target = polar(ISLAND_R * 0.94, a);
      outward = a;
    }
    if (type === 'rest' || type === 'slide') target = polar(ISLAND_R * 0.82 * Math.sqrt(u(3)), u(4) * Math.PI * 2);
    if (!target) target = this.anchor(p, k);
    return { type, target, friend, outward, face, date: false };
  }

  // seconds the penguin needs to reach its target of slot k
  travelTime(p, k) {
    const from = this.activity(p, k - 1).target, a = this.activity(p, k);
    const dist = gap(from, a.target);
    const speed = (a.type === 'slide' ? SLIDE_SPEED : WALK_SPEED) * (SPEED[p.personality] || 1);
    return dist <= 0.01 ? 0 : Math.min(SLOT * 0.8, dist / speed);
  }

  /**
   * State of a penguin at time t (seconds).
   * returns { x, z, y, pitch, heading, pose: 'stand'|'lie', moving, sliding, wet, act, friend,
   *           kind, elapsed (s since the activity began), travel (s spent getting there), speed,
   *           sync (s since both partners arrived, on a date), anim ([clip, seconds, loop?], when the colony event sets it) }
   */
  state(p, t) {
    const day = Math.floor(t / DAY), d0 = day * DAY, s = t - d0;
    if (s < DAWN_EXIT) return this.leave(p, t, d0, d0 + DAWN_EXIT, this.huddleSpot(p, day - 1, LAST_STEP));
    if (s >= NIGHT_START - GATHER) return this.huddle(p, t, day);
    for (let i = 0; i < SEA_TRIPS.length; i++) {
      const T0 = d0 + SEA_TRIPS[i];
      if (t < T0 || t >= T0 + SEA_LEN) continue;
      const trip = this.trip(day, i);
      if (trip.info.has(p)) return this.sea(p, t, T0, trip);
    }
    return this.routine(p, t);
  }

  // the penguin's own routine: walk, explore, rest, look at the sea, visit, slide
  routine(p, t) {
    const tt = t + p.phase;
    const k = Math.floor(tt / SLOT);
    const local = tt - k * SLOT;
    const from = this.activity(p, k - 1).target;
    const a = this.activity(p, k);
    const dx = a.target.x - from.x, dz = a.target.z - from.z;
    const dist = Math.hypot(dx, dz);
    const sliding = a.type === 'slide';
    const travel = this.travelTime(p, k);
    // timing shared by every visitor, so the animation frame is the same for all
    const timing = { y: 0, pitch: 0, wet: false, kind: a.type, elapsed: local, travel, speed: SPEED[p.personality] || 1 };
    if (a.date) timing.sync = local - Math.max(travel, this.travelTime(p.mate, k)); // both greet at the same moment
    if (local < travel) {
      const f = local / travel;
      const ease = f * f * (3 - 2 * f);
      return {
        x: from.x + dx * ease, z: from.z + dz * ease, heading: Math.atan2(dx, dz),
        pose: 'stand', moving: true, sliding, act: sliding ? 'slide' : 'going', friend: a.friend, ...timing,
      };
    }
    let heading = dist > 0.01 ? Math.atan2(dx, dz) : p.home;
    if (a.type === 'sea') heading = a.outward;
    else if (a.type === 'visit' && a.face) heading = Math.atan2(a.face.x - a.target.x, a.face.z - a.target.z);
    else if (a.type === 'walk' || a.type === 'explore') heading += Math.sin(t * 0.4 + p.seed) * 0.7; // looking around
    // after a slide the penguin gets up and looks around
    const act = a.type === 'slide' ? 'walk' : a.type;
    return {
      x: a.target.x, z: a.target.z, heading,
      pose: act === 'rest' ? 'lie' : 'stand', moving: false, sliding: false, act, friend: a.friend, ...timing,
    };
  }

  // ---------- shared pieces of the colony events ----------
  walking(p, from, to, f, act, elapsed, travel) {
    return {
      x: from.x + (to.x - from.x) * f, z: from.z + (to.z - from.z) * f, y: 0, pitch: 0, wet: false,
      heading: Math.atan2(to.x - from.x, to.z - from.z), pose: 'stand', moving: true, sliding: false,
      act, friend: null, kind: 'walk', elapsed, travel, speed: (SPEED[p.personality] || 1) * 1.2,
    };
  }

  standing(p, at, heading, act, anim) {
    return {
      x: at.x, z: at.z, y: 0, pitch: 0, wet: false, heading, pose: 'stand', moving: false, sliding: false,
      act, friend: null, kind: 'walk', elapsed: 1e6, travel: 0, speed: SPEED[p.personality] || 1, anim,
    };
  }

  // walk from where a colony event left the penguin back into its own routine, which resumes at tEnd
  leave(p, t, t1, tEnd, from) {
    const to = this.routine(p, tEnd);
    const dist = gap(from, to);
    const travel = Math.min(tEnd - t1, dist / (WALK_SPEED * 1.3 * (SPEED[p.personality] || 1)));
    const local = t - t1;
    if (local < travel) return this.walking(p, from, to, smooth(0, 1, local / travel), 'going', local, travel);
    return this.standing(p, to, to.heading, 'walk');
  }

  // ---------- the night huddle ----------
  huddleSpot(p, day, step) {
    const n = this.list.length;
    const i = (((this.rank.get(p) - step) % n) + n) % n;       // one place inward at every step
    const turn = rand(9001, day, 1) * Math.PI * 2, c = Math.cos(turn), s = Math.sin(turn);
    const q = this.slots[i];
    return { x: q.x * c + q.z * s, z: q.z * c - q.x * s, i };
  }

  huddle(p, t, day) {
    const T0 = day * DAY + NIGHT_START;
    const wind = rand(9001, day, 2) * Math.PI * 2;             // everyone turns its back to the same wind
    const asleep = ['Sleep', t + (p.seed % 61), true];
    if (t < T0) {                                              // dusk: walking to one's place
      const g0 = T0 - GATHER, from = this.routine(p, g0), to = this.huddleSpot(p, day, 0);
      const travel = Math.min(GATHER - 2, gap(from, to) / (WALK_SPEED * 1.3 * (SPEED[p.personality] || 1)));
      const local = t - g0;
      if (local < travel) return this.walking(p, from, to, smooth(0, 1, local / travel), 'huddle', local, travel);
      return this.standing(p, to, wind, 'huddle', asleep);
    }
    const step = Math.min(LAST_STEP, Math.floor((t - T0) / STEP));
    const to = this.huddleSpot(p, day, step);
    if (step > 0 && this.list.length > 1) {                    // the shuffle travels through the huddle like a wave
      const from = this.huddleSpot(p, day, step - 1);
      const dist = gap(from, to);
      const delay = Math.min(6, to.i * 0.18), dur = 1.2 + dist * 1.3;
      const local = t - T0 - step * STEP - delay;
      if (local < 0) return this.standing(p, from, wind, 'huddle', asleep);
      if (local < dur) {
        const st = this.walking(p, from, to, smooth(0, 1, local / dur), 'huddle', local, dur);
        if (dist < 1) st.heading = wind;                       // a small step: keep facing the same way
        return st;
      }
    }
    return this.standing(p, to, wind, 'huddle', asleep);
  }

  // ---------- the swim ----------
  // Everything about one trip: who goes, the file, each one's place on the shore and when it dives.
  trip(day, i) {
    const key = day * 8 + i;
    if (this.trips.has(key)) return this.trips.get(key);
    if (this.trips.size > 6) this.trips.clear();
    const members = this.list.filter((p) => rand(p.seed, key, 31) < 0.8);
    const A = rand(4242, key, 1) * Math.PI * 2, sign = rand(4242, key, 2) < 0.5 ? -1 : 1;
    const dir = { x: Math.sin(A), z: Math.cos(A) }, side = { x: Math.cos(A), z: -Math.sin(A) };
    const cols = Math.max(1, Math.ceil(members.length / 12));  // long colonies walk in several files
    const info = new Map();
    let arrived = 0;
    members.forEach((p, j) => {
      const lat = ((j % cols) - (cols - 1) / 2) * 0.6, along = 1.5 - Math.floor(j / cols) * 0.65;
      const queue = { x: dir.x * along + side.x * lat, z: dir.z * along + side.z * lat };
      const mid = { x: dir.x * ISLAND_R * 0.62 + side.x * lat, z: dir.z * ISLAND_R * 0.62 + side.z * lat };
      const ang = A + (j % 2 ? 1 : -1) * Math.ceil(j / 2) * 0.11;
      const shore = polar(ISLAND_R * 0.93, ang), water = polar(SWIM_R, ang);
      const tMid = ASM + gap(queue, mid) / FILE_V, tArr = tMid + gap(mid, shore) / FILE_V;
      arrived = Math.max(arrived, tArr);
      info.set(p, { queue, mid, ang, shore, water, tMid, tArr, nerve: rand(p.seed, key, 5) });
    });
    // they all hesitate on the edge until the boldest one dives; the rest follow one by one
    const bold = [...info.values()].sort((a, b) => a.nerve - b.nerve);
    bold.forEach((m, order) => {
      m.tJump = arrived + 5 + (order ? Math.min(16, 1.8 + (order - 1) * 1.4) + m.nerve * 0.3 : 0);
      m.tDone = Math.min(SEA_LEN - 20, m.tJump + DIVE + LAP + LEAP + GETUP + HOP + 1);
    });
    const trip = { A, sign, info };
    this.trips.set(key, trip);
    return trip;
  }

  sea(p, t, T0, trip) {
    const m = trip.info.get(p), e = t - T0;
    const base = { pose: 'stand', moving: false, sliding: false, friend: null, kind: 'walk', elapsed: 1e6, travel: 0, speed: 1 };
    if (e < ASM) {                                             // lining up
      const from = this.routine(p, T0);
      const travel = Math.min(ASM - 1, gap(from, m.queue) / FILE_V);
      if (e < travel) return this.walking(p, from, m.queue, smooth(0, 1, e / travel), 'file', e, travel);
      return this.standing(p, m.queue, trip.A, 'file');
    }
    if (e < m.tMid) return this.walking(p, m.queue, m.mid, (e - ASM) / (m.tMid - ASM), 'file', e, 0);
    if (e < m.tArr) return this.walking(p, m.mid, m.shore, (e - m.tMid) / (m.tArr - m.tMid), 'file', e, 0);
    if (e < m.tJump) return this.standing(p, m.shore, m.ang, 'shore', ['Look', t + (p.seed % 89), true]);
    let x = e - m.tJump;
    if (x < DIVE) {                                            // the dive: lie forward in the air, into the water
      const f = x / DIVE;
      return {
        ...base, x: m.shore.x + (m.water.x - m.shore.x) * f, z: m.shore.z + (m.water.z - m.shore.z) * f,
        y: DEEP * f * f + Math.sin(Math.PI * f) * 0.45, pitch: -0.35 + f * 1.25, wet: true, heading: m.ang,
        act: 'swim', anim: ['Slide', f * SLIDE_DOWN],
      };
    }
    x -= DIVE;
    const glide = ['Slide', SLIDE_DOWN + (t % SLIDE_HOLD)];
    if (x < LAP) {                                             // a lap around the island, leaping like a dolphin
      const a = m.ang + trip.sign * Math.PI * 2 * (x / LAP);
      const at = polar(SWIM_R + 1.7 * smooth(0, 3, x) * (1 - smooth(LAP - 3, LAP, x)), a);
      // under the surface most of the time; every few seconds a leap clear of the water
      const ph = x * 1.25 + (p.seed % 7), u = Math.sin(ph), out = smooth(0.45, 1, u);
      const calm = smooth(0, 1.5, x) * (1 - smooth(LAP - 1.5, LAP, x));
      return {
        ...base, x: at.x, z: at.z, y: DEEP + (out * 1.3 + Math.sin(ph * 2.3) * 0.06) * calm,
        pitch: -Math.cos(ph) * (0.15 + 0.65 * smooth(0.2, 0.7, u)) * calm, wet: true, moving: true, heading: a + trip.sign * Math.PI / 2,
        act: 'swim', anim: glide,
      };
    }
    x -= LAP;
    if (x < LEAP) {                                            // shooting out of the water onto the ice
      const f = x / LEAP;
      return {
        ...base, x: m.water.x + (m.shore.x - m.water.x) * f, z: m.water.z + (m.shore.z - m.water.z) * f,
        y: DEEP * (1 - f) * (1 - f) + Math.sin(Math.PI * f) * 0.6, pitch: -1.0 + f * 1.0, wet: true, heading: m.ang + Math.PI,
        act: 'ashore', anim: glide,
      };
    }
    x -= LEAP;
    if (x < GETUP) return this.standing(p, m.shore, m.ang + Math.PI, 'ashore', ['Slide', SLIDE_UP + x]);
    x -= GETUP;
    if (x < HOP) return this.standing(p, m.shore, m.ang + Math.PI, 'ashore', ['Hop', x]);
    if (e < m.tDone) return this.standing(p, m.shore, m.ang + Math.PI, 'ashore');
    return this.leave(p, t, T0 + m.tDone, T0 + SEA_LEN, m.shore);
  }
}
