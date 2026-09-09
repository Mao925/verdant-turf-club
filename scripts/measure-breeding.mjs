import { createBreeding } from "../src/domain/breeding.ts";
import { activeEpisode } from "../src/domain/life-support.ts";
import {
  cycles,
  activeCycle,
  mareReasons,
  young,
} from "../src/domain/breeding-support.ts";
import { horseAge, SIRES } from "../src/domain/breeding-model.ts";
import { appendFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import {
  applyCommand,
  diff,
  cash,
  horses,
  nextDate,
  validateWorld,
} from "../src/domain/world.ts";
import { allPending, raceForHorse } from "../src/domain/season.ts";
import { contracts } from "../src/domain/finance.ts";
import {
  seasonOpportunities,
  seasonEligibility,
  routeFor,
} from "../src/domain/program.ts";
const uuid = () => crypto.randomUUID(),
  timings = [],
  dayTimes = [],
  monthTimes = [],
  cloneTimes = [];
let w = createBreeding(
  {
    save: "40000000-0000-4000-8000-000000000005",
    owner: uuid(),
    horse: uuid(),
    contract: uuid(),
  },
  {
    name: "母仔五年の記録",
    silk: "#b89855",
    goal: "母から仔へ託す夢",
    initialYen: 500000000,
    annualYen: 80000000,
  },
);
const bytes = (x) => Buffer.byteLength(JSON.stringify(x)),
  startBytes = bytes(w),
  start = performance.now();
const patchFile = "artifacts/p5-five-year-patches.ndjson";
writeFileSync(patchFile, JSON.stringify(diff(null, w)) + "\n");
let upload = startBytes,
  commands = 0;
const milestones = {};
function act(command) {
  let t = performance.now();
  const next = applyCommand(w, command, uuid()),
    elapsed = performance.now() - t;
  timings.push(elapsed);
  if (command.type === "advance")
    (command.days === 1 ? dayTimes : monthTimes).push(elapsed);
  t = performance.now();
  structuredClone(next);
  cloneTimes.push(performance.now() - t);
  const p = diff(w, next);
  upload += bytes(p);
  appendFileSync(patchFile, JSON.stringify(p) + "\n");
  w = next;
  commands++;
  if (commands % 50 === 0)
    console.log(
      JSON.stringify({
        date: w.core.date,
        commands,
        bytes: bytes(w),
        cycles: cycles(w).map((b) => b.status),
        owned: horses(w).map((h) => ({
          name: h.name,
          runs: h.details.runs,
          life: h.life.racing,
          dead: !!h.life.deceased,
          growth: h.family?.growth?.stage,
        })),
      }),
    );
}
const lot = w.entities[w.core.career.marketId].lots[0];
act({
  type: "bid",
  horseId: lot.horseId,
  limitYen: lot.rivalYen + 100000,
  reason: "この牝馬の競走生活から見守る",
});
act({ type: "receive", name: "ハハノネガイ", reason: "母と仔の記録をつなぐ" });
act({ type: "board", trainerId: "saeki" });
act({
  type: "goals",
  goal: "母から仔へ託す夢",
  horseGoal: "この馬と大きな舞台へ",
  annualGoal: "初勝利を目指しながら状態を確かめる",
  reason: "長く見守る",
});
const motherId = lot.horseId,
  until = "2031-05-01";
try {
  for (let turn = 0; turn < 8000 && w.core.date < until; turn++) {
    const pending = allPending(w),
      health = pending.find((e) => e.kind === "health");
    if (health) {
      act(
        health.phase === "decision"
          ? {
              type: "care-plan",
              episodeId: health.id,
              choice: "rehab",
              providerId: "forest",
              reason: "母仔と愛馬の診療を優先する",
            }
          : { type: "acknowledge-health", episodeId: health.id },
      );
      continue;
    }
    const bred = pending.find((e) => e.kind === "breeding");
    if (bred) {
      act(
        bred.status === "offered"
          ? {
              type: "breeding-response",
              cycleId: bred.id,
              accept: true,
              reason: "費用と将来の飼養を確かめて予約",
            }
          : { type: "acknowledge-breeding", cycleId: bred.id },
      );
      continue;
    }
    const result = pending.find((e) => e.kind === "race");
    if (result) {
      act({ type: "settle", raceId: result.id });
      continue;
    }
    const mother = w.entities[motherId],
      clinical = activeEpisode(w, mother),
      healthy = !clinical || ["cleared", "limited"].includes(clinical.phase);
    const foals = horses(w).filter((h) => h.family?.damId === motherId);
    if (
      !mother.life.deceased &&
      !mother.life.movementId &&
      !raceForHorse(w, motherId) &&
      w.core.date >= "2027-01-01" &&
      mother.details.runs > 0
    ) {
      if (mother.life.racing === "active") {
        act({
          type: "move-horse",
          horseId: motherId,
          purpose: "retirement",
          providerId: "forest",
          reason: "競走で見た姿を覚え、次の生活へ進む",
        });
        continue;
      }
      if (healthy && !foals.length && !activeCycle(w, mother)) {
        if (!mother.family?.broodmare && !mareReasons(w, mother).length) {
          act({
            type: "broodmare-exam",
            horseId: motherId,
            reason: "繁殖適性を専門家へ確認",
          });
          continue;
        }
        if (mother.family?.broodmare?.status === "unsuitable")
          throw Error(
            "This mare was not suitable; the measurement does not override the finding",
          );
        if (mother.family?.broodmare?.status === "suitable") {
          if (
            !contracts(w).some(
              (c) => c.horseId === motherId && c.purpose === "breeding",
            )
          ) {
            act({
              type: "broodmare-board",
              horseId: motherId,
              reason: "母を知る牧場へ仔も託したい",
            });
            continue;
          }
          if (!mareReasons(w, mother, true).length) {
            if (!milestones.prepared) {
              milestones.prepared = w.core.date;
              writeFileSync(
                "artifacts/p5-prepared-world.json",
                JSON.stringify(w),
              );
            }
            const used = cycles(w)
              .filter((b) => b.status === "cancelled")
              .map((b) => b.sireId);
            const sire =
              SIRES.find(
                (s) => !used.includes(s.id) && !w.entities[s.id].life.deceased,
              ) ?? SIRES[0];
            act({
              type: "apply-breeding",
              horseId: motherId,
              sireId: sire.id,
              payment: "pregnancy",
              reason: "受胎後支払の条件と母仔の生活費を確かめる",
            });
            continue;
          }
        }
      }
    }
    const pregnant = cycles(w).find((b) => b.status === "pregnant");
    if (pregnant && !milestones.pregnant) {
      milestones.pregnant = w.core.date;
      writeFileSync("artifacts/p5-pregnant-world.json", JSON.stringify(w));
    }
    let handled = false;
    for (const h of foals) {
      if (h.life.deceased) continue;
      const g = h.family.growth,
        e = activeEpisode(w, h);
      if (!milestones.born) {
        milestones.born = h.birthDate;
        writeFileSync("artifacts/p5-born-world.json", JSON.stringify(w));
      }
      if (h.name.endsWith("の仔")) {
        act({
          type: "foal-goal",
          horseId: h.id,
          name: "アシタノミチ",
          mode: "new",
          goal: "この仔に合う舞台で初勝利を",
          route: routeFor(
            h.details.turf > h.details.dirt ? "芝" : "ダート",
            h.details.idealDistance,
          ),
          reason: "母の思いを残し、この仔自身の適性を見たい",
        });
        handled = true;
        break;
      }
      if (
        !h.life.movementId &&
        !h.life.saleId &&
        (!e || e.phase === "cleared")
      ) {
        if (
          ["weanling", "yearling"].includes(g.stage) &&
          w.core.date >= `${Number(h.birthDate.slice(0, 4)) + 1}-09-01`
        ) {
          act({
            type: "start-breaking",
            horseId: h.id,
            reason: "成長を確かめ、段階的に育成する",
          });
          handled = true;
          break;
        }
        if (
          g.stage === "ready" &&
          !w.core.career.portfolio.plans[h.id].trainerId &&
          h.life.racing === "active"
        ) {
          act({
            type: "move-horse",
            horseId: h.id,
            purpose: "training",
            providerId: "saeki",
            reason: "母を知る調教師へ、この仔の初戦を相談",
          });
          handled = true;
          break;
        }
      }
    }
    if (handled) continue;
    // Before retirement, care for and return the mother when she is eligible.
    if (
      w.core.date < "2027-01-01" &&
      !mother.life.deceased &&
      mother.life.racing === "active" &&
      !mother.life.movementId &&
      clinical?.phase === "cleared" &&
      !w.core.career.portfolio.plans[motherId].trainerId
    ) {
      act({
        type: "move-horse",
        horseId: motherId,
        purpose: "training",
        providerId: "saeki",
        reason: "再評価を受けて帰厩",
      });
      continue;
    }
    for (const h of horses(w)) {
      if (!pending.some((e) => e.kind === "consultation" && e.horseId === h.id))
        continue;
      if (w.core.career.horseId !== h.id)
        act({ type: "select-horse", horseId: h.id });
      const race = seasonOpportunities(w).find(
        (r) =>
          seasonEligibility(w, r).length === 0 &&
          r.terms.route === w.core.career.route &&
          r.terms.grade === "一般",
      );
      act(
        race
          ? {
              type: "consult",
              choice: "race",
              raceId: race.id,
              reason: "この馬に合う競走機会を選ぶ",
            }
          : { type: "consult", choice: "wait", reason: "次の機会と回復を待つ" },
      );
      handled = true;
      break;
    }
    if (!handled)
      act({
        type: "advance",
        days: Math.min(
          turn % 7 === 0 ? 1 : 31,
          Math.ceil((Date.parse(until) - Date.parse(w.core.date)) / 86400000),
        ),
      });
  }
  validateWorld(w);
  if (w.core.date !== until) throw Error("Five years did not complete");
  const mom = w.entities[motherId],
    foals = horses(w).filter((h) => h.family?.damId === motherId);
  if (!mom.details.runs || !foals.some((h) => h.details.runs > 0))
    throw Error("This seed did not complete both generations of racing");
  const values = Object.values(w.entities),
    races = values.filter((e) => e.kind === "race" && e.finish);
  const percentile = (xs, p = 0.95) =>
    [...xs].sort((a, b) => a - b)[Math.floor(xs.length * p)] ?? 0;
  const out = {
    kind: "P5 Mac Node, five full years through unmodified game commands; mother races, breeds, and her foal develops and races; autonomous NPC world",
    date: w.core.date,
    simulatedDays: (Date.parse(until) - Date.parse("2026-05-01")) / 86400000,
    milestones,
    commands,
    totalMs: performance.now() - start,
    p95CommandMs: percentile(timings),
    p95DayMs: percentile(dayTimes),
    p95MonthMs: percentile(monthTimes),
    p95CloneMs: percentile(cloneTimes),
    startBytes,
    saveBytes: bytes(w),
    growthBytes: bytes(w) - startBytes,
    deltaUploadBytes: upload,
    entities: values.length,
    races: races.length,
    npcHorses: values.filter(
      (e) => e.kind === "horse" && e.id.startsWith("npc:"),
    ).length,
    healthEpisodes: values.filter((e) => e.kind === "health").length,
    scenes: values.filter((e) => e.kind === "scene").length,
    breeding: cycles(w).map((b) => ({
      status: b.status,
      matingDate: b.matingDate,
      result: b.outcome?.result,
      feeYen: b.feeYen,
      feeStatus: b.feeStatus,
      foalId: b.foalId,
    })),
    owned: horses(w).map((h) => ({
      id: h.id,
      name: h.name,
      damId: h.family?.damId,
      birthDate: h.birthDate,
      runs: h.details.runs,
      wins: h.details.wins,
      dead: !!h.life.deceased,
    })),
    cashYen: cash(w),
    heapMB: process.memoryUsage().heapUsed / 1048576,
  };
  writeFileSync(
    "artifacts/p5-five-year-metrics.json",
    JSON.stringify(out, null, 2),
  );
  writeFileSync("artifacts/p5-five-year-world.json", JSON.stringify(w));
  console.log(JSON.stringify(out, null, 2));
} finally {
  writeFileSync("artifacts/p5-progress-world.json", JSON.stringify(w));
}
