// Synthetic dates and outcomes for boundary/UI fixtures; long simulation uses only game commands.
import {
  createBreeding,
  breedingDay,
  reconcileBreeding,
} from "../src/domain/breeding.ts";
import { lifeBeforeDay } from "../src/domain/life.ts";
import {
  applyCommand,
  horses,
  nextDate,
  validateWorld,
  type World,
  type Command,
} from "../src/domain/world.ts";
import { cycles } from "../src/domain/breeding-support.ts";
import { healthDay } from "../src/domain/health.ts";
import { SIRES } from "../src/domain/breeding-model.ts";
const uuid = () => crypto.randomUUID();
const ids = () => ({
  save: "40000000-0000-4000-8000-000000000005",
  owner: uuid(),
  horse: uuid(),
  contract: uuid(),
});
const settings = {
  name: "世代の馬主",
  silk: "#e3bd42",
  goal: "親子で有馬へ",
  initialYen: 100000000,
  annualYen: 20000000,
};
const act = (w: World, c: Command) => applyCommand(w, c, uuid());
export function at(w: World, date: string) {
  w.core.date = date;
  w.core.career!.portfolio!.cohortYear = Number(date.slice(0, 4));
  lifeBeforeDay(w);
  breedingDay(w);
  healthDay(w);
  reconcileBreeding(w);
  validateWorld(w);
}
export function mare() {
  let w = createBreeding(ids(), settings);
  const m = w.entities[w.core.career!.marketId];
  if (m.kind !== "market") throw Error();
  const l = m.lots[0];
  w = act(w, {
    type: "bid",
    horseId: l.horseId,
    limitYen: l.rivalYen + 100000,
    reason: "母から仔へ",
  });
  w = act(w, {
    type: "receive",
    name: "ハハノネガイ",
    reason: "母になるかは後で相談",
  });
  w = act(w, { type: "board", trainerId: "saeki" });
  const h = horses(w)[0];
  w = act(w, {
    type: "move-horse",
    horseId: h.id,
    purpose: "retirement",
    providerId: "forest",
    reason: "競走の次の生活へ",
  });
  at(w, "2027-02-01");
  return w;
}
export function prepared() {
  let w = mare();
  let h = horses(w)[0];
  w = act(w, {
    type: "broodmare-exam",
    horseId: h.id,
    reason: "受入所見を確認する",
  });
  at(w, "2027-02-08");
  h = horses(w)[0];
  if (h.family!.broodmare!.status !== "suitable")
    throw Error("Fixture must use a suitable mare");
  w = act(w, {
    type: "broodmare-board",
    horseId: h.id,
    reason: "同じ牧場へ母仔を託す",
  });
  at(w, "2027-02-15");
  return w;
}
export function covered(payment: "pregnancy" | "live-foal" = "pregnancy") {
  let w = prepared();
  w = act(w, {
    type: "apply-breeding",
    horseId: horses(w)[0].id,
    sireId: SIRES[0].id,
    payment,
    reason: "仔の適性と予算を考える",
  });
  at(w, "2027-02-18");
  const b = cycles(w)[0];
  if (b.status !== "offered") throw Error("Fixture must reach offered state");
  w = act(w, {
    type: "breeding-response",
    cycleId: b.id,
    accept: true,
    reason: "提示条件で予約する",
  });
  at(w, cycles(w)[0].matingDate!);
  return w;
}
export function normal(w: World) {
  const b = cycles(w)[0];
  b.outcome = {
    result: "live",
    difficult: false,
    motherDies: false,
    gestationDays: 340,
    neonatalDay: 12,
  };
  b.dueDate = nextDate(b.matingDate!, 340);
  return b;
}
