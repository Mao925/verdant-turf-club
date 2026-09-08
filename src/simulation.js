export const STEP = 1 / 60;
export const STRAIGHT = 116;
export const RADIUS = 40;
export const TRACK_LENGTH = STRAIGHT * 2 + Math.PI * RADIUS * 2;
export const RACE_METERS = 1600;
export const COUNTDOWN = 3;
export const LANE_GAP = 1.7;
export const NAMES = ['アオバブリーズ', 'ルミナスアロー', 'コハクノカゼ', 'ミドリノキセキ', 'ナギサブルー', 'アカツキフレア', 'ツキノシズク', 'ハルノカナタ'];
export const SILKS = ['#f4eee0', '#414b56', '#df614e', '#5483be', '#e3bd42', '#4a9774', '#d68943', '#c77caa'];
export const COATS = ['#8f5032', '#44302b', '#be7b49', '#543d32', '#b8b3a8', '#6f3525', '#d2b89c', '#272b2c'];
const STYLES = ['先行', '逃げ', '差し', '追込', '先行', '逃げ', '差し', '追込'];
const RACE_NAMES = ['青葉の風ステークス', '陽だまりターフカップ', '碧空グリーン記念', '夕凪スプリント', '若草クラシック'];

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6D2B79F5;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function makeCard(seed, round = 1) {
  const random = rng(seed);
  const horses = NAMES.map((name, i) => ({
    id: i + 1, name, silk: SILKS[i], coat: COATS[i], style: STYLES[i],
    speed: 75 + Math.floor(random() * 22), stamina: 73 + Math.floor(random() * 24),
    condition: 2 + Math.floor(random() * 4),
  }));
  const weights = horses.map(h => Math.exp(((h.speed * .6 + h.stamina * .4) + h.condition * 2.8 - 90) / 9));
  const sum = weights.reduce((a, b) => a + b, 0);
  horses.forEach((h, i) => { h.odds = Math.max(1.2, Math.round(.9 * sum / weights[i] * 10) / 10); });
  return { seed, round, name: RACE_NAMES[(round - 1) % RACE_NAMES.length], horses };
}

// Arc-length parameterized oval: horses travel equal physical distances on straights and bends.
export function trackPoint(distance, lane = 0) {
  let s = ((distance + STRAIGHT / 2) % TRACK_LENGTH + TRACK_LENGTH) % TRACK_LENGTH;
  let x, z, dx, dz, nx, nz;
  if (s < STRAIGHT) {
    x = -STRAIGHT / 2 + s; z = RADIUS; dx = 1; dz = 0; nx = 0; nz = 1;
  } else if ((s -= STRAIGHT) < Math.PI * RADIUS) {
    const a = Math.PI / 2 - s / RADIUS;
    nx = Math.cos(a); nz = Math.sin(a);
    x = STRAIGHT / 2 + RADIUS * nx; z = RADIUS * nz; dx = nz; dz = -nx;
  } else if ((s -= Math.PI * RADIUS) < STRAIGHT) {
    x = STRAIGHT / 2 - s; z = -RADIUS; dx = -1; dz = 0; nx = 0; nz = -1;
  } else {
    s -= STRAIGHT;
    const a = -Math.PI / 2 - s / RADIUS;
    nx = Math.cos(a); nz = Math.sin(a);
    x = -STRAIGHT / 2 + RADIUS * nx; z = RADIUS * nz; dx = nz; dz = -nx;
  }
  return { x: x + nx * lane, z: z + nz * lane, dx, dz, nx, nz, angle: Math.atan2(dx, dz) };
}

// The complete race is calculated once at a fixed 60 Hz, independently of rendering.
export function simulateRace(card, seed) {
  const random = rng(seed);
  const runners = card.horses.map((horse, i) => ({
    id: horse.id, d: 0, lane: (i - 3.5) * LANE_GAP, target: (i - 3.5) * LANE_GAP,
    v: 0, luck: (random() - .5) * .115, phase: random() * Math.PI * 2,
    kick: .02 + random() * .13, finish: null, horse,
  }));
  const frames = [runners.map(r => ({ d: r.d, lane: r.lane, v: 0 }))];
  let tick = 0;
  while (tick < 60 * 55 && runners.some(r => r.finish === null)) {
    tick++;
    const time = tick * STEP;
    const order = [...runners].sort((a, b) => b.d - a.d || a.id - b.id);
    for (const r of order) {
      const p = Math.min(r.d / TRACK_LENGTH, 1);
      const h = r.horse;
      const tactics = {
        '逃げ': p < .32 ? .095 : p > .72 ? -.065 : .005,
        '先行': p < .48 ? .038 : p > .76 ? .025 : .006,
        '差し': p < .45 ? -.036 : p > .65 ? .095 : .005,
        '追込': p < .55 ? -.055 : p > .73 ? .15 : -.005,
      }[h.style];
      const fatigue = p > .57 ? (96 - h.stamina) * .0024 * (p - .57) / .43 : 0;
      const burst = p > .7 ? r.kick * Math.sin((p - .7) / .3 * Math.PI / 2) : 0;
      const rhythm = Math.sin(time * .67 + r.phase) * .021 + Math.sin(time * .29 + r.phase) * .015;
      let targetV = 12.55 * (.94 + (h.speed - 75) * .0033 + (h.condition - 3) * .015 + r.luck + tactics + rhythm + burst - fatigue);
      if (r.finish !== null) targetV *= .83;
      r.v += (targetV - r.v) * STEP * 1.8;
      if (tick % 24 === r.id * 3 % 24 && r.finish === null) {
        const ahead = runners.some(o => o !== r && o.d > r.d && o.d - r.d < 10 && Math.abs(o.lane - r.lane) < 1.6);
        const options = ahead ? [r.lane + LANE_GAP, r.lane - LANE_GAP] : [r.lane - LANE_GAP];
        const target = options.find(lane => lane >= -5.95 && lane <= 5.95 && !runners.some(o => o !== r && Math.abs(o.d - r.d) < 7 && Math.abs(o.lane - lane) < 1.55));
        if (target !== undefined) r.target = target;
      }
      let nextLane = r.lane + Math.max(-.9 * STEP, Math.min(.9 * STEP, r.target - r.lane));
      if (runners.some(o => o !== r && Math.abs(o.d - r.d) < 4.9 && Math.abs(o.lane - nextLane) < 1.35)) nextLane = r.lane;
      let nextD = r.d + r.v * STEP;
      for (const o of runners) {
        if (o !== r && o.d > r.d && Math.abs(o.lane - nextLane) < 1.35) {
          nextD = Math.min(nextD, Math.max(r.d, o.d - 4.75));
        }
      }
      const oldD = r.d;
      r.v = (nextD - oldD) / STEP;
      r.d = nextD; r.lane = nextLane;
      if (r.finish === null && nextD >= TRACK_LENGTH) {
        r.finish = (tick - 1 + (TRACK_LENGTH - oldD) / (nextD - oldD)) * STEP;
      }
    }
    frames.push(runners.map(r => ({ d: r.d, lane: r.lane, v: r.v })));
  }
  if (runners.some(r => r.finish === null)) throw new Error('レース計算を完了できませんでした。');
  const results = [...runners].sort((a, b) => a.finish - b.finish || a.id - b.id).map((r, i) => ({ id: r.id, rank: i + 1, time: r.finish }));
  return { frames, results, duration: tick * STEP, seed };
}

export function sampleRace(race, time) {
  const t = Math.max(0, Math.min(time / STEP, race.frames.length - 1));
  const index = Math.floor(t), alpha = t - index;
  const a = race.frames[index], b = race.frames[Math.min(index + 1, race.frames.length - 1)];
  return a.map((r, i) => ({ d: r.d + (b[i].d - r.d) * alpha, lane: r.lane + (b[i].lane - r.lane) * alpha, v: r.v + (b[i].v - r.v) * alpha }));
}
