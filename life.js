// The daily life of every penguin, computed from its seed and the clock.
// The same function runs for every visitor, so everyone sees the same island
// without a live server: where a penguin is "now" depends only on (seed, time).

export const ISLAND_R = 7;          // walkable radius (world units)
export const SLOT = 45;               // seconds per activity
const WALK_SPEED = 0.42;              // units per second
const SLIDE_SPEED = 1.0;

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

export class Colony {
  constructor(penguins) {
    this.list = penguins;
    this.bySerial = new Map(penguins.map((p) => [p.serial, p]));
    for (const p of penguins) {
      p.phase = rand(p.seed, 1, 1) * SLOT;                     // not everyone changes activity at once
      p.home = rand(p.seed, 2, 2) * Math.PI * 2;               // favourite angle (calm penguins)
      // main personality 65%, optional second trait 35%
      const A = WEIGHTS[p.personality] || WEIGHTS.calm, B = WEIGHTS[p.trait];
      p.weights = B ? Object.fromEntries(Object.keys(A).map((k) => [k, A[k] * 0.65 + B[k] * 0.35])) : A;
    }
  }

  // where the penguin is heading in slot k, ignoring visits (no recursion)
  anchor(p, k) {
    const u = (i) => rand(p.seed, k, i);
    if (p.personality === 'calm') return polar(ISLAND_R * (0.55 + 0.35 * u(3)), p.home + (u(4) - 0.5) * 0.9);
    return polar(ISLAND_R * 0.8 * Math.sqrt(u(3)), u(4) * Math.PI * 2);
  }

  activity(p, k) {
    const u = (i) => rand(p.seed, k, i);
    let type = pick(p.weights, u(0));
    let target, friend = null, outward = null;
    if (type === 'visit') {
      const others = this.list.filter((o) => o !== p);
      const partner = p.partner && this.bySerial.get(p.partner);
      friend = partner && u(5) < 0.75 ? partner : others[Math.floor(u(6) * others.length)];
      if (!friend) type = 'walk';
      else {
        const f = this.anchor(friend, k);
        const a = u(7) * Math.PI * 2;
        target = { x: f.x + Math.sin(a) * 0.5, z: f.z + Math.cos(a) * 0.5 };
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
    return { type, target, friend, outward };
  }

  /**
   * State of a penguin at time t (seconds).
   * returns { x, z, heading, pose: 'stand'|'lie', moving, sliding, act, friend,
   *           kind, elapsed (s since the activity began), travel (s spent getting there), speed }
   */
  state(p, t) {
    const tt = t + p.phase;
    const k = Math.floor(tt / SLOT);
    const local = tt - k * SLOT;
    const from = this.activity(p, k - 1).target;
    const a = this.activity(p, k);
    const dx = a.target.x - from.x, dz = a.target.z - from.z;
    const dist = Math.hypot(dx, dz);
    const sliding = a.type === 'slide';
    let speed = (sliding ? SLIDE_SPEED : WALK_SPEED) * (SPEED[p.personality] || 1);
    let travel = dist / speed;
    if (travel > SLOT * 0.8) { travel = SLOT * 0.8; }
    if (dist <= 0.01) travel = 0;
    // timing shared by every visitor, so the animation frame is the same for all
    const timing = { kind: a.type, elapsed: local, travel, speed: SPEED[p.personality] || 1 };
    if (local < travel) {
      const f = local / travel;
      const ease = f * f * (3 - 2 * f);
      return {
        x: from.x + dx * ease, z: from.z + dz * ease, heading: Math.atan2(dx, dz),
        pose: 'stand', moving: true, sliding, act: sliding ? 'slide' : 'going', friend: a.friend, ...timing,
      };
    }
    let heading = Math.atan2(dx, dz);
    if (a.type === 'sea') heading = a.outward;
    else if (a.type === 'visit' && a.friend) {
      const fs = this.anchor(a.friend, k);
      heading = Math.atan2(fs.x - a.target.x, fs.z - a.target.z);
    } else if (a.type === 'walk' || a.type === 'explore') {
      heading += Math.sin(t * 0.4 + p.seed) * 0.7; // looking around
    }
    // after a slide the penguin gets up and looks around
    const act = a.type === 'slide' ? 'walk' : a.type;
    return {
      x: a.target.x, z: a.target.z, heading,
      pose: act === 'rest' ? 'lie' : 'stand', moving: false, sliding: false, act, friend: a.friend, ...timing,
    };
  }
}
