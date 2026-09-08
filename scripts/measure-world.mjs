import { performance } from "node:perf_hooks";
import {
  applyCommand,
  createWorld,
  diff,
  daysToNextMonth,
} from "../src/domain/world.ts";
let state = createWorld({
  save: crypto.randomUUID(),
  owner: crypto.randomUUID(),
  horse: crypto.randomUUID(),
  contract: crypto.randomUUID(),
});
state.entities.capital.amountYen = 1000000000; // Large synthetic budget isolates performance from bankruptcy.
const timings = [];
let upload = 0;
const start = performance.now();
for (let i = 0; i < 120; i++) {
  const t = performance.now();
  const next = applyCommand(
    state,
    { type: "advance", days: daysToNextMonth(state.core.date) },
    crypto.randomUUID(),
  );
  timings.push(performance.now() - t);
  upload += Buffer.byteLength(JSON.stringify(diff(state, next)));
  state = next;
}
const rename = applyCommand(
  state,
  { type: "goal", goal: "次の世代へ" },
  crypto.randomUUID(),
);
timings.sort((a, b) => a - b);
console.log(
  JSON.stringify(
    {
      kind: "P1 single-horse synthetic progression; not the P3 world or actual devices",
      months: 120,
      date: state.core.date,
      entities: Object.keys(state.entities).length,
      totalMs: Math.round(performance.now() - start),
      p95MonthMs:
        Math.round(timings[Math.floor(timings.length * 0.95)] * 10) / 10,
      saveBytes: Buffer.byteLength(JSON.stringify(state)),
      totalDeltaUploadBytes: upload,
      goalChangeBytes: Buffer.byteLength(JSON.stringify(diff(state, rename))),
    },
    null,
    2,
  ),
);
