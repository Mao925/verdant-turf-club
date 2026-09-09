import { writeFileSync } from "node:fs";
import { raceCause, dailyCause, HEALTH_MODEL } from "../src/domain/health.ts";
import { hash, random } from "../src/domain/catalog.ts";
const N = 1000000;
const rows = [];
for (const scale of [0.5, 1, 2]) {
  const race = {},
    training = {},
    pasture = {};
  let recurrence = 0;
  for (let i = 0; i < N; i++) {
    const x = random(hash(`health-sensitivity:${i}`, 20260909))();
    for (const [target, cause] of [
      [race, raceCause(x, scale)],
      [training, dailyCause(x, true, scale)],
      [pasture, dailyCause(x, false, scale)],
    ])
      if (cause) target[cause] = (target[cause] ?? 0) + 1;
    if (raceCause(x, scale, true) === "tendon") recurrence++;
  }
  const p = (race.catastrophic ?? 0) / N,
    se = Math.sqrt((p * (1 - p)) / N);
  rows.push({
    scale,
    starts: N,
    daysPerDailyScenario: N,
    race,
    training,
    pasture,
    priorTendonRaceEvents: recurrence,
    cmiPer1000: p * 1000,
    cmiApprox95Per1000: [
      Math.max(0, p - 1.96 * se) * 1000,
      (p + 1.96 * se) * 1000,
    ],
  });
}
const result = {
  kind: "Deterministic Monte Carlo of actual pure hazard functions; same random numbers across sensitivity cases, no healing costs or gameplay exposure censoring",
  seed: 20260909,
  model: HEALTH_MODEL,
  rows,
};
writeFileSync(
  "artifacts/p4-health-sensitivity.json",
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result, null, 2));
