import { writeFileSync } from "node:fs";
import {
  breedingOutcome,
  BREEDING_MODEL,
} from "../src/domain/breeding-model.ts";
import { hash } from "../src/domain/catalog.ts";
const N = 1000000;
const rows = [];
for (const scale of [0.5, 1, 2]) {
  const results = {};
  let conceived = 0,
    deliveries = 0,
    difficult = 0,
    maternalDeaths = 0,
    liveBorn = 0,
    neonatalDeaths = 0;
  for (let i = 0; i < N; i++) {
    const o = breedingOutcome(
      hash(`reproduction-sensitivity:${i}`, 20260909),
      6,
      scale,
    );
    results[o.result] = (results[o.result] ?? 0) + 1;
    if (o.result === "empty") continue;
    conceived++;
    if (["early-loss", "late-loss"].includes(o.result)) continue;
    deliveries++;
    if (o.difficult) difficult++;
    if (o.motherDies) maternalDeaths++;
    if (o.result === "stillbirth") continue;
    liveBorn++;
    if (o.result === "neonatal-death") neonatalDeaths++;
  }
  rows.push({
    scale,
    matingCycles: N,
    results,
    conceived,
    deliveries,
    difficult,
    maternalDeaths,
    liveBorn,
    neonatalDeaths,
    liveDay31PerMating: (results.live ?? 0) / N,
    maternalDeathPerDelivery: maternalDeaths / deliveries,
    neonatalDeathPerLiveBorn: neonatalDeaths / liveBorn,
  });
}
const out = {
  kind: "Actual pure reproductive model, fixed seed and age 6, same random numbers across scenarios. Scale multiplies conditional losses, dystocia and maternal/neonatal rates, not conception. Excludes ordinary clinical hazards, economic constraints and care selection. A sensitivity experiment, not calibration to a real population.",
  seed: 20260909,
  model: BREEDING_MODEL,
  rows,
};
writeFileSync(
  "artifacts/p5-reproduction-sensitivity.json",
  JSON.stringify(out, null, 2),
);
console.log(JSON.stringify(out, null, 2));
