import { createLife } from "../src/domain/life.ts";
import { activeEpisode } from "../src/domain/life-support.ts";
import { appendFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import {
  applyCommand,
  diff,
  cash,
  horses,
  nextDate,
} from "../src/domain/world.ts";
import { allPending } from "../src/domain/season.ts";
import { activeRace, openConsultation } from "../src/domain/career.ts";
import {
  seasonOpportunities,
  seasonEligibility,
  program,
} from "../src/domain/program.ts";
const uuid = () => crypto.randomUUID(),
  timings = [],
  monthTimes = [],
  dayTimes = [],
  cloneTimes = [];
let w = createLife(
  {
    save: "40000000-0000-4000-8000-000000000004",
    owner: uuid(),
    horse: uuid(),
    contract: uuid(),
  },
  {
    name: "三年負荷",
    silk: "#e3bd42",
    goal: "通年の比較",
    initialYen: 500000000,
    annualYen: 80000000,
  },
);
const bytes = (w) => Buffer.byteLength(JSON.stringify(w));
const startBytes = bytes(w);
writeFileSync(
  "artifacts/p4-three-year-patches.ndjson",
  JSON.stringify(diff(null, w)) + "\n",
);
let upload = startBytes,
  commands = 0,
  checkpoints = 0;
function act(c) {
  let t = performance.now();
  const next = applyCommand(w, c, uuid());
  const ms = performance.now() - t;
  timings.push(ms);
  if (c.type === "advance") (c.days === 1 ? dayTimes : monthTimes).push(ms);
  t = performance.now();
  structuredClone(next);
  cloneTimes.push(performance.now() - t);
  const patch = diff(w, next);
  upload += bytes(patch);
  appendFileSync(
    "artifacts/p4-three-year-patches.ndjson",
    JSON.stringify(patch) + "\n",
  );
  w = next;
  commands++;
  if (commands % 20 === 0) checkpoints++;
}
for (let i = 0; i < 4; i++) {
  if (i) act({ type: "open-market" });
  const l = w.entities[w.core.career.marketId].lots[i];
  act({
    type: "bid",
    horseId: l.horseId,
    limitYen: l.rivalYen + 100000,
    reason: "同条件測定",
  });
  act({ type: "receive", name: "計測馬" + i, reason: "測定" });
  act({ type: "board", trainerId: i % 2 ? "mihara" : "saeki" });
}
const until = nextDate(w.core.date, 1096);
const start = performance.now();
for (let i = 0; i < 6500 && w.core.date < until; i++) {
  let handled = false;
  if (i % 100 === 0)
    console.log(JSON.stringify({ progress: w.core.date, commands }));
  const health = allPending(w).find((e) => e.kind === "health");
  if (health) {
    act(
      health.phase === "decision"
        ? {
            type: "care-plan",
            episodeId: health.id,
            choice: "rehab",
            providerId: "forest",
            reason: "診療に沿って待つ",
          }
        : { type: "acknowledge-health", episodeId: health.id },
    );
    continue;
  }
  const returning = horses(w).find(
    (h) =>
      h.life.racing === "active" &&
      !h.life.deceased &&
      !h.life.movementId &&
      activeEpisode(w, h)?.phase === "cleared" &&
      !w.core.career.portfolio.plans[h.id].trainerId,
  );
  if (returning) {
    act({
      type: "move-horse",
      horseId: returning.id,
      purpose: "training",
      providerId: "saeki",
      reason: "再評価後に帰厩",
    });
    continue;
  }

  const result = allPending(w).find((e) => e.kind === "race");
  if (result) {
    act({ type: "settle", raceId: result.id });
    handled = true;
  } else
    for (const h of horses(w)) {
      const pending = allPending(w).some(
        (e) => e.kind === "consultation" && e.horseId === h.id,
      );
      if (!pending) continue;
      if (w.core.career.horseId !== h.id)
        act({ type: "select-horse", horseId: h.id });
      const rs = seasonOpportunities(w).filter(
        (r) => seasonEligibility(w, r).length === 0,
      );
      const next = rs.find(
        (r) =>
          r.terms.route === w.core.career.route &&
          ["新馬", "未勝利", "1勝クラス", "2勝クラス", "3勝クラス"].includes(
            r.raceClass,
          ),
      );
      act(
        next
          ? {
              type: "consult",
              choice: "race",
              raceId: next.id,
              reason: "収録路線の一年",
            }
          : { type: "consult", choice: "wait", reason: "回復または次の機会" },
      );
      handled = true;
      break;
    }
  if (!handled)
    act({
      type: "advance",
      days: Math.min(
        i % 5 === 0 ? 1 : 31,
        Math.ceil((Date.parse(until) - Date.parse(w.core.date)) / 86400000),
      ),
    });
}
if (w.core.date !== until)
  throw new Error("three years did not complete " + w.core.date);
const races = Object.values(w.entities).filter(
  (e) => e.kind === "race" && e.terms && e.finish,
);
const sizes = races.map((r) => r.field.length);
const frequency = new Map();
for (const r of races)
  for (const id of r.field) frequency.set(id, (frequency.get(id) ?? 0) + 1);
const percentile = (xs, p = 0.95) =>
  [...xs].sort((a, b) => a - b)[Math.floor(xs.length * p)] ?? 0;
const out = {
  kind: "P4 Mac Node, 1096 simulated days, 4 owned horses, autonomous NPC world; no network/device guarantee",
  date: w.core.date,
  healthEpisodes: Object.values(w.entities).filter((e) => e.kind === "health")
    .length,
  healthPhases: Object.fromEntries(
    ["assessment", "decision", "rehab", "cleared", "limited", "dead"].map(
      (p) => [
        p,
        Object.values(w.entities).filter(
          (e) => e.kind === "health" && e.phase === p,
        ).length,
      ],
    ),
  ),
  recurrences: Object.values(w.entities).filter(
    (e) => e.kind === "health" && e.recurrenceOf,
  ).length,
  deaths: Object.values(w.entities).filter(
    (e) => e.kind === "horse" && e.life?.deceased,
  ).length,
  dnfs: races.reduce((n, r) => n + (r.dnf?.length ?? 0), 0),
  scenes: Object.values(w.entities).filter((e) => e.kind === "scene").length,
  commands,
  totalMs: performance.now() - start,
  p95CommandMs: percentile(timings),
  p95DayMs: percentile(dayTimes),
  p95MonthMs: percentile(monthTimes),
  p95CloneMs: percentile(cloneTimes),
  startBytes,
  saveBytes: bytes(w),
  yearGrowthBytes: bytes(w) - startBytes,
  deltaUploadBytes: upload,
  checkpointWrites: checkpoints,
  readBytesPerResume: bytes(w),
  races: races.length,
  minimumField: Math.min(...sizes),
  medianField: percentile(sizes, 0.5),
  fullFields: races.filter((r) => r.field.length === r.terms.capacity).length,
  npcHorses: Object.values(w.entities).filter(
    (e) => e.kind === "horse" && e.id.startsWith("npc:"),
  ).length,
  npcRepeatRunners: [...frequency.values()].filter((n) => n > 1).length,
  owned: horses(w).map((h) => ({ runs: h.details.runs, wins: h.details.wins })),
  cashYen: cash(w),
  heapMB: process.memoryUsage().heapUsed / 1048576,
};
writeFileSync(
  "artifacts/p4-three-year-metrics.json",
  JSON.stringify(out, null, 2),
);
writeFileSync("artifacts/p4-three-year-world.json", JSON.stringify(w));
console.log(JSON.stringify(out, null, 2));
