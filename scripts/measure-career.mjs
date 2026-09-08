import { performance } from "node:perf_hooks";
import { applyCommand, diff, cash } from "../src/domain/world.ts";
import {
  createCareer,
  activeRace,
  openConsultation,
} from "../src/domain/career.ts";
import {
  opportunities,
  eligibility,
  ownedHorse,
} from "../src/domain/catalog.ts";
import { calculateRace } from "../src/domain/racing.ts";
let state = createCareer(
  {
    save: "10000000-0000-4000-8000-000000000001",
    owner: crypto.randomUUID(),
    horse: crypto.randomUUID(),
    contract: crypto.randomUUID(),
  },
  {
    name: "性能測定",
    silk: "#e3bd42",
    goal: "初勝利",
    initialYen: 100000000,
    annualYen: 12000000,
  },
);
const timings = [],
  copyTimes = [],
  raceTimes = [];
let upload = 0,
  commands = 0;
function act(c) {
  const t = performance.now();
  const next = applyCommand(state, c, crypto.randomUUID());
  timings.push(performance.now() - t);
  const copy = performance.now();
  structuredClone(next);
  copyTimes.push(performance.now() - copy);
  upload += Buffer.byteLength(JSON.stringify(diff(state, next)));
  state = next;
  commands++;
}
const lot = state.entities[state.core.career.marketId].lots[0];
act({
  type: "bid",
  horseId: lot.horseId,
  limitYen: lot.rivalYen + 100000,
  reason: "測定",
});
act({ type: "receive", name: "計測馬", reason: "測定" });
act({ type: "board", trainerId: "saeki" });
const started = performance.now();
for (let i = 0; i < 500 && state.core.career.stage !== "ended"; i++) {
  const race = activeRace(state),
    consult = openConsultation(state);
  if (race?.status === "result") act({ type: "settle", raceId: race.id });
  else if (consult) {
    const candidate = opportunities(state).find(
      (r) => eligibility(state, r).length === 0,
    );
    act(
      candidate
        ? {
            type: "consult",
            choice: "race",
            raceId: candidate.id,
            reason: "測定",
          }
        : { type: "consult", choice: "wait", reason: "回復" },
    );
  } else act({ type: "advance", days: 31 });
  if (activeRace(state)?.status === "registered") {
    const t = performance.now();
    calculateRace(state, activeRace(state));
    raceTimes.push(performance.now() - t);
  }
}
const percentile = (xs) =>
  [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)] ?? 0;
console.log(
  JSON.stringify(
    {
      kind: "P2 deterministic prototype, one owned horse and persistent rivals; Node on this Mac, no network or device guarantee",
      commands,
      date: state.core.date,
      stage: state.core.career.stage,
      races: ownedHorse(state).details.runs,
      totalMs: performance.now() - started,
      p95CommandMs: percentile(timings),
      p95CloneMs: percentile(copyTimes),
      p95RaceMs: percentile(raceTimes),
      saveBytes: Buffer.byteLength(JSON.stringify(state)),
      deltaUploadBytes: upload,
      heapMB: process.memoryUsage().heapUsed / 1048576,
      balanceYen: cash(state),
    },
    null,
    2,
  ),
);
