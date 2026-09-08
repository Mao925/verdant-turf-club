import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCard, simulateRace, sampleRace, TRACK_LENGTH, STEP, trackPoint } from '../src/simulation.js';
import { initialState, GameStore, STORAGE_KEY, validateBet, placeBet, settleBet, nextRace, parseState } from '../src/store.js';

const memoryStorage = () => {
  const data = new Map();
  return { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
};
const card = makeCard(192); const race = simulateRace(card, 11931);

test('all horses finish in about 30–45 seconds, with a unique complete ranking', () => {
  for (let i = 0; i < 24; i++) {
    const r = simulateRace(makeCard(i * 389), i * 993);
    assert.ok(r.results[0].time >= 30 && r.duration <= 45, `seed ${i}: ${r.duration}`);
    assert.equal(new Set(r.results.map(h => h.id)).size, 8);
    assert.deepEqual(r.results.map(h => h.rank), [1, 2, 3, 4, 5, 6, 7, 8]);
  }
});
test('same card and seed reproduce the entire race exactly after reload', () => {
  assert.deepEqual(simulateRace(card, 11931), race);
});
test('different frame rates sample the same simulation, and nose crossing matches results', () => {
  for (const result of race.results) {
    const noseBefore = sampleRace(race, result.time - .00001)[result.id - 1].d;
    const noseAt = sampleRace(race, result.time)[result.id - 1].d;
    const noseAfter = sampleRace(race, result.time + .00001)[result.id - 1].d;
    assert.ok(noseBefore < TRACK_LENGTH);
    assert.ok(Math.abs(noseAt - TRACK_LENGTH) < 1e-8);
    assert.ok(noseAfter > TRACK_LENGTH);
  }
  for (const fps of [12, 30, 60, 120]) {
    let last = 0;
    for (let t = 0; t < race.duration; t += 1 / fps) {
      const d = sampleRace(race, t)[0].d; assert.ok(d >= last); last = d;
    }
    assert.deepEqual(sampleRace(race, 10), sampleRace(simulateRace(card, 11931), 10));
  }
});
test('lane changes are smooth and horses never intersect in physical space', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const r = simulateRace(makeCard(seed * 991), seed * 771);
    for (let t = 1; t < r.frames.length; t++) {
      const frame = r.frames[t];
      for (let i = 0; i < 8; i++) {
        assert.ok(Math.abs(frame[i].lane - r.frames[t - 1][i].lane) <= .9 * STEP + 1e-8);
        assert.ok(Math.abs(frame[i].lane) <= 5.96);
        for (let j = i + 1; j < 8; j++) {
          assert.ok(Math.abs(frame[i].d - frame[j].d) >= 4.7 || Math.abs(frame[i].lane - frame[j].lane) >= 1.34,
            `overlap seed ${seed}, frame ${t}, horses ${i + 1},${j + 1}`);
        }
      }
    }
  }
});
test('track is continuous at every straight/curve boundary and finish line', () => {
  for (const d of [-58, 58, 58 + 40 * Math.PI, 174 + 40 * Math.PI, TRACK_LENGTH]) {
    const a = trackPoint(d - .0001), b = trackPoint(d + .0001);
    assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < .001);
    assert.ok(Math.hypot(a.dx - b.dx, a.dz - b.dz) < .001);
  }
  assert.ok(Math.abs(trackPoint(0).x) < 1e-9);
  assert.ok(Math.abs(trackPoint(TRACK_LENGTH).x) < 1e-9);
});
test('ability, condition and tactics affect racing; luck can change the winner', () => {
  const winners = new Set(Array.from({ length: 20 }, (_, seed) => simulateRace(card, seed * 971).results[0].id));
  assert.ok(winners.size >= 2);
  const altered = structuredClone(card); altered.horses[0].speed = 99; altered.horses[0].stamina = 99; altered.horses[0].condition = 5; altered.horses[0].style = '逃げ';
  assert.notDeepEqual(simulateRace(altered, 11931).frames[900][0], race.frames[900][0]);
});
test('new save is immediately persisted so the first purchase keeps the displayed card', async () => {
  const storage = memoryStorage(), store = new GameStore(storage);
  const original = store.state.card;
  const s = await store.update(current => placeBet(current, 1, 500, 74, 1000));
  assert.deepEqual(s.card, original); assert.equal(s.balance, 9500);
  const reloaded = new GameStore(storage); assert.deepEqual(reloaded.state, s);
});
test('unselected, invalid denomination, noninteger and unaffordable bets are rejected', () => {
  const state = initialState(73);
  for (const [id, amount] of [[null, 500], [9, 500], [1, 0], [1, -100], [1, 150], [1, NaN], [1, Infinity], [1, 100.1], [1, 10100]]) {
    assert.ok(validateBet(state, id, amount)); assert.throws(() => placeBet(state, id, amount, 3, 0));
  }
  assert.equal(validateBet(state, 1, 10000), '');
});
test('purchase is debited once and cannot be changed during racing', () => {
  const state = placeBet(initialState(82), 1, 500, 23, 1000);
  assert.equal(state.balance, 9500);
  assert.throws(() => placeBet(state, 1, 500, 24, 1001));
  assert.throws(() => placeBet(state, 2, 100, 24, 1001));
  assert.throws(() => nextRace(state, 7));
});
test('payout includes the stake, floors decimals, and settles only once', () => {
  const state = initialState(711); state.card.horses[0].odds = 3.333;
  const paid = placeBet(state, 1, 100, 42, 1000);
  const results = [{ id: 1, rank: 1, time: 38 }, ...[2, 3, 4, 5, 6, 7, 8].map((id, i) => ({ id, rank: i + 2, time: 39 + i * .1 }))];
  const settled = settleBet(paid, paid.pending.id, results, 50000);
  assert.equal(settled.balance, 10233); assert.equal(settled.history[0].payout, 333); assert.equal(settled.pending, null);
  assert.equal(settleBet(settled, paid.pending.id, results, 51000), settled);
  assert.equal(settleBet(paid, 'another-ticket', results, 50000), paid);
});
test('losing bets, next race, ten-result history and reset remain consistent', async () => {
  const storage = memoryStorage(); const store = new GameStore(storage);
  let state = initialState(711);
  for (let i = 0; i < 12; i++) {
    state = placeBet(state, 2, 100, i, 1000 + i);
    state = settleBet(state, state.pending.id, [{ id: 1, rank: 1, time: 38 }, ...[2, 3, 4, 5, 6, 7, 8].map((id, i) => ({ id, rank: i + 2, time: 39 + i * .1 }))], 50000 + i);
    state = nextRace(state, i);
  }
  assert.equal(state.balance, 8800); assert.equal(state.history.length, 10); assert.equal(state.round, 13);
  storage.setItem(STORAGE_KEY, JSON.stringify(state));
  assert.deepEqual(parseState(storage.getItem(STORAGE_KEY)), state);
  const reset = await store.reset(); assert.equal(reset.balance, 10000); assert.equal(reset.history.length, 0); assert.equal(reset.pending, null);
});
test('failed writes do not alter the balance or pending purchase', async () => {
  const storage = memoryStorage(); const store = new GameStore(storage), old = structuredClone(store.state);
  storage.setItem = () => { throw new Error('QuotaExceededError'); };
  await assert.rejects(store.update(current => placeBet(current, 1, 500, 42, 1000)));
  assert.deepEqual(store.state, old); assert.deepEqual(store.read(), old);
});
test('corrupt data is rejected instead of silently changing coins', () => {
  assert.throws(() => parseState('{'));
  const s = initialState(8); s.balance = -100; assert.throws(() => parseState(JSON.stringify(s)));
  const s2 = initialState(8); s2.card.horses.length = 7; assert.throws(() => parseState(JSON.stringify(s2)));
});
