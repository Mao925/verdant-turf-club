import { describe, it, expect } from "vitest";
import {
  createBreeding,
  upgradeBreeding,
  breedingDay,
  reconcileBreeding,
} from "../src/domain/breeding.ts";
import { createCareer } from "../src/domain/career.ts";
import { createSeason } from "../src/domain/season.ts";
import { createLife, lifeBeforeDay } from "../src/domain/life.ts";
import {
  applyCommand,
  createWorld,
  horses,
  cash,
  nextDate,
  validateWorld,
  type World,
  type Command,
  type Horse,
} from "../src/domain/world.ts";
import {
  cycles,
  activeCycle,
  reservedFoals,
  breedingQuote,
} from "../src/domain/breeding-support.ts";
import { contracts, invoices, payDue } from "../src/domain/finance.ts";
import { healthDay, beginEpisode } from "../src/domain/health.ts";
import { grow, SIRES, breedingOutcome } from "../src/domain/breeding-model.ts";
import type { BreedingCycle } from "../src/domain/breeding-types.ts";
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
function at(w: World, date: string) {
  w.core.date = date;
  w.core.career!.portfolio!.cohortYear = Number(date.slice(0, 4));
  lifeBeforeDay(w);
  breedingDay(w);
  healthDay(w);
  reconcileBreeding(w);
  validateWorld(w);
}
function mare() {
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
function prepared() {
  let w = mare();
  let h = horses(w)[0];
  w = act(w, {
    type: "broodmare-exam",
    horseId: h.id,
    reason: "受入所見を確認する",
  });
  at(w, "2027-02-08");
  h = horses(w)[0];
  expect(h.family!.broodmare!.status).toBe("suitable");
  w = act(w, {
    type: "broodmare-board",
    horseId: h.id,
    reason: "同じ牧場へ母仔を託す",
  });
  at(w, "2027-02-15");
  return w;
}
function covered(payment: "pregnancy" | "live-foal" = "pregnancy") {
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
  expect(b.status).toBe("offered");
  w = act(w, {
    type: "breeding-response",
    cycleId: b.id,
    accept: true,
    reason: "提示条件で予約する",
  });
  at(w, cycles(w)[0].matingDate!);
  return w;
}
function normal(w: World) {
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
describe("P5 繁殖・育成・親子の記録", () => {
  it.each([
    ["P1", () => createWorld(ids())],
    ["P2", () => createCareer(ids(), settings)],
    ["P3", () => createSeason(ids(), settings)],
  ] as const)(
    "%sの保存ID・暦・現金・過去の出来事を保持してP5へ移行する",
    (_version, create) => {
      const old = create(),
        w = upgradeBreeding(old, uuid());
      expect(w.core.engineVersion).toBe("owner-p5");
      expect(w.core.saveId).toBe(old.core.saveId);
      expect(w.core.date).toBe(old.core.date);
      expect(cash(w)).toBe(cash(old));
      for (const e of Object.values(old.entities).filter(
        (e) => e.kind === "event" || e.kind === "ledger",
      ))
        expect(w.entities[e.id]).toEqual(e);
      expect(() => validateWorld(w)).not.toThrow();
    },
  );
  it.each([
    ["early-loss", 35],
    ["late-loss", 180],
  ] as const)(
    "%sは出生個体を作らず、母の療養・費用・次回までの待機を保持する",
    (result, day) => {
      const w = covered(),
        b = normal(w);
      b.outcome!.result = result;
      at(w, nextDate(b.matingDate!, 17));
      at(w, nextDate(b.matingDate!, day));
      expect(b.status).toBe("lost");
      expect(b.foalId).toBeUndefined();
      expect(b.feeStatus).toBe("waived");
      const mother = w.entities[b.horseId] as Horse;
      expect(mother.life!.deceased).toBeUndefined();
      expect(mother.family!.restUntil).toBe(nextDate(w.core.date, 60));
      expect((w.entities[mother.life!.episodeId!] as HealthEpisode).cause).toBe(
        "pregnancy-loss",
      );
      expect(contracts(w).find((c) => c.horseId === mother.id)?.purpose).toBe(
        "breeding",
      );
      expect(reservedFoals(w)).toHaveLength(0);
      expect(() => validateWorld(w)).not.toThrow();
    },
  );
  it("生後30日ちょうどの死亡は既払種付料を一度だけ返還する", () => {
    const w = covered(),
      b = normal(w);
    b.outcome!.result = "neonatal-death";
    b.outcome!.neonatalDay = 30;
    at(w, nextDate(b.matingDate!, 17));
    at(w, "2027-09-30");
    at(w, "2027-10-31");
    payDue(w);
    at(w, b.dueDate!);
    const f = w.entities[b.foalId!] as Horse;
    at(w, nextDate(f.birthDate, 29));
    expect(f.life!.deceased).toBeUndefined();
    at(w, nextDate(f.birthDate, 30));
    expect(b.feeStatus).toBe("refunded");
    expect(f.life!.deceased!.date).toBe(nextDate(f.birthDate, 30));
    const refund = Object.values(w.entities).filter(
      (e) => e.kind === "ledger" && e.category === "refund",
    );
    expect(refund).toHaveLength(1);
    at(w, nextDate(f.birthDate, 31));
    expect(
      Object.values(w.entities).filter(
        (e) => e.kind === "ledger" && e.category === "refund",
      ),
    ).toEqual(refund);
  });
  it("妊娠中の診療は繁殖預託を維持して療養できる", () => {
    let w = covered();
    const b = normal(w);
    at(w, nextDate(b.matingDate!, 17));
    const h = horses(w)[0],
      e = beginEpisode(w, h, "tendon", "pasture");
    e.outcome = "recover";
    at(w, e.dueDate!);
    w = act(w, {
      type: "care-plan",
      episodeId: e.id,
      choice: "rehab",
      providerId: "forest",
      reason: "母の診療を優先し妊娠も確認する",
    });
    expect(contracts(w).find((c) => c.horseId === h.id)?.purpose).toBe(
      "breeding",
    );
    expect(cycles(w)[0].status).toBe("pregnant");
    expect((w.entities[e.id] as HealthEpisode).phase).toBe("rehab");
  });
  it("市場を往復しても落札結果と価格を引き直さない", () => {
    let w = createBreeding(ids(), settings);
    w = act(w, { type: "market-age", age: 1 });
    const m = w.entities[w.core.career!.marketId] as Market,
      l = m.lots[0];
    w = act(w, {
      type: "bid",
      horseId: l.horseId,
      limitYen: l.rivalYen,
      reason: "決めた上限まで",
    });
    w = act(w, { type: "market-age", age: 2 });
    w = act(w, { type: "market-age", age: 1 });
    const again = w.entities[w.core.career!.marketId] as Market;
    expect(again.lots[0].status).toBe("lost");
    expect(again.lots[0].rivalYen).toBe(l.rivalYen);
  });
  it("受入不可の所見でも引退後の生活を継続できる", () => {
    let w = mare();
    w.core.worldSeed = 3907387525;
    const h = horses(w)[0];
    w = act(w, {
      type: "broodmare-exam",
      horseId: h.id,
      reason: "適性を確認する",
    });
    at(w, "2027-02-08");
    expect(horses(w)[0].family!.broodmare!.status).toBe("unsuitable");
    expect(() =>
      act(w, { type: "broodmare-board", horseId: h.id, reason: "契約したい" }),
    ).toThrow();
    expect(contracts(w)[0].purpose).toBe("retirement");
  });
  it("出生予約で最後の牧場枠を確保し、入厩先のない1歳購入を拒否する", () => {
    let w = covered();
    const b = normal(w),
      h = horses(w)[0],
      base = contracts(w)[0];
    for (let i = 0; i < 4; i++) {
      const id = "capacity-mare:" + i,
        copy = structuredClone(h);
      copy.id = id;
      delete copy.family;
      w.entities[id] = copy;
      w.entities["capacity-contract:" + i] = {
        ...structuredClone(base),
        id: "capacity-contract:" + i,
        horseId: id,
      };
      w.core.career!.portfolio!.plans[id] = {
        ...w.core.career!.portfolio!.plans[h.id],
      };
    }
    validateWorld(w);
    expect(reservedFoals(w)).toHaveLength(1);
    w = act(w, { type: "open-market" });
    w = act(w, { type: "market-age", age: 1 });
    const lot = (w.entities[w.core.career!.marketId] as Market).lots[0];
    expect(() =>
      act(w, {
        type: "bid",
        horseId: lot.horseId,
        limitYen: lot.rivalYen + 100000,
        reason: "育成から始めたい",
      }),
    ).toThrow(/育成預託枠/);
    w = act(w, { type: "close-market" });
    const current = cycles(w)[0];
    at(w, nextDate(current.matingDate!, 17));
    at(w, current.dueDate!);
    expect(contracts(w).filter((c) => c.providerId === "forest")).toHaveLength(
      6,
    );
    expect(reservedFoals(w)).toHaveLength(0);
  });
  it("妊娠中の活動終了は未解決の繁殖と費用を残す", () => {
    let w = covered();
    const b = normal(w);
    at(w, nextDate(b.matingDate!, 17));
    w = act(w, {
      type: "end-career",
      reason: "現在の資金では母仔を引き受け続けられない",
    });
    expect(w.core.career!.life!.closure!.breedingIds).toContain(b.id);
    expect(cycles(w)[0].status).toBe("pregnant");
    expect(contracts(w)).toHaveLength(0);
    expect(() => act(w, { type: "advance", days: 1 })).toThrow();
  });

  it("P4を過去の現金・個体・診療を変えずに引き継ぐ", () => {
    const p4 = createLife(ids(), settings),
      before = structuredClone(p4);
    const w = upgradeBreeding(p4, uuid());
    expect(w.core.engineVersion).toBe("owner-p5");
    expect(cash(w)).toBe(cash(p4));
    expect(w.core.date).toBe(p4.core.date);
    for (const [id, e] of Object.entries(before.entities))
      expect(w.entities[id]).toEqual(e);
    expect(p4).toEqual(before);
    expect(() => upgradeBreeding(w, uuid())).toThrow();
  });
  it("1歳市場は育成を要し、入厩を先にできない", () => {
    let w = createBreeding(ids(), settings);
    w = act(w, { type: "market-age", age: 1 });
    const m = w.entities[w.core.career!.marketId];
    if (m.kind !== "market") throw Error();
    const l = m.lots[0];
    expect((w.entities[l.horseId] as Horse).birthDate.startsWith("2025")).toBe(
      true,
    );
    w = act(w, {
      type: "bid",
      horseId: l.horseId,
      limitYen: l.rivalYen + 100000,
      reason: "成長を待つ",
    });
    w = act(w, { type: "receive", name: "ワカイヒ", reason: "将来を考える" });
    expect(() => act(w, { type: "board", trainerId: "saeki" })).toThrow(/育成/);
    w = act(w, {
      type: "rear-young",
      horseId: l.horseId,
      reason: "育成を託す",
    });
    expect(contracts(w)[0].monthlyYen).toBe(250000);
    expect(() =>
      act(w, {
        type: "start-breaking",
        horseId: l.horseId,
        reason: "早く始める",
      }),
    ).toThrow();
    at(w, "2026-09-01");
    w = act(w, {
      type: "start-breaking",
      horseId: l.horseId,
      reason: "成長を確認した",
    });
    at(w, "2027-04-01");
    expect(horses(w)[0].family!.growth!.stage).toBe("ready");
    expect(horses(w)[0].details!.registered).toBe(false);
    w = act(w, {
      type: "move-horse",
      horseId: l.horseId,
      purpose: "training",
      providerId: "saeki",
      reason: "入厩へ進む",
    });
    at(w, "2027-04-08");
    expect(horses(w)[0].details!.registered).toBe(true);
  });
  it("申込・予約・種付けを分け、再読で転帰が変わらない", () => {
    const w = covered(),
      b = cycles(w)[0];
    expect(b.status).toBe("covered");
    expect(reservedFoals(w)).toHaveLength(1);
    const before = JSON.stringify(w);
    const copy = JSON.parse(before);
    breedingDay(copy);
    expect(JSON.stringify(copy)).toBe(before);
    expect(b.outcome).toEqual(breedingOutcome(awaitSeed(w, b), 3));
  });
  it("不受胎は種付料を免除し、実施費と母の預託費を残す", () => {
    let w = covered();
    const b = normal(w);
    b.outcome!.result = "empty";
    const before = cash(w);
    at(w, nextDate(b.matingDate!, 17));
    expect(b.status).toBe("empty");
    expect(b.feeStatus).toBe("waived");
    expect(cash(w)).toBe(before);
    expect(contracts(w).some((c) => c.purpose === "breeding")).toBe(true);
    expect(reservedFoals(w)).toHaveLength(0);
    w = act(w, { type: "acknowledge-breeding", cycleId: b.id });
    expect(activeCycle(w, horses(w)[0])).toBeUndefined();
  });
  it("母と仔・条件付きの種付料をデビューまで別々に見積もる", () => {
    const w = prepared(),
      h = horses(w)[0];
    const a = breedingQuote(w, h, SIRES[0].id, "pregnancy"),
      b = breedingQuote(w, h, SIRES[0].id, "live-foal");
    expect(a.motherYen).toBeGreaterThan(0);
    expect(a.foalYen).toBeGreaterThan(0);
    expect(b.feeYen).toBe(a.feeYen * 1.2);
    expect(a.debut).toBe("2030-06-01");
    expect(a.totalYen).toBe(a.motherYen + a.foalYen + a.feeYen + a.fixedYen);
  });
  it("受胎後支払の死産は種付料のみ返還し、同じ仔の個体を残す", () => {
    const w = covered(),
      b = normal(w);
    b.outcome!.result = "stillbirth";
    at(w, nextDate(b.matingDate!, 17));
    at(w, "2027-09-30");
    expect(b.feeStatus).toBe("invoiced");
    at(w, "2027-10-31");
    payDue(w);
    expect((w.entities[b.feeInvoiceId!] as Invoice).paid).toBe(true);
    const before = cash(w);
    at(w, b.dueDate!);
    expect(b.feeStatus).toBe("refunded");
    expect(cash(w)).toBe(before + b.feeYen - 300000 - 30000 - 150000);
    const f = w.entities[b.foalId!] as Horse;
    expect(f.life!.deceased?.date).toBe(f.birthDate);
    expect(f.family!.damId).toBe(b.horseId);
    expect(contracts(w).some((c) => c.horseId === f.id)).toBe(false);
    const after = cash(w);
    reconcileBreeding(w);
    expect(cash(w)).toBe(after);
    validateWorld(w);
  });
  it("出生後支払は30日以内死亡で請求せず、生存では31日で請求する", () => {
    const w = covered("live-foal"),
      b = normal(w);
    b.outcome!.result = "neonatal-death";
    at(w, nextDate(b.matingDate!, 17));
    at(w, "2027-09-30");
    expect(b.feeStatus).toBe("conditional");
    at(w, b.dueDate!);
    const f = w.entities[b.foalId!] as Horse;
    at(w, nextDate(f.birthDate, 12));
    expect(f.life!.deceased).toBeTruthy();
    expect(b.feeStatus).toBe("waived");
    at(w, nextDate(f.birthDate, 31));
    expect(b.feeInvoiceId).toBeUndefined();
    const other = covered("live-foal"),
      bb = normal(other);
    at(other, nextDate(bb.matingDate!, 17));
    at(other, bb.dueDate!);
    const ff = other.entities[bb.foalId!] as Horse;
    at(other, nextDate(ff.birthDate, 30));
    expect(bb.feeStatus).toBe("conditional");
    at(other, nextDate(ff.birthDate, 31));
    expect(bb.feeStatus).toBe("invoiced");
    expect((other.entities[bb.feeInvoiceId!] as Invoice).dueDate).toBe(
      "2028-10-31",
    );
  });
  it("父死亡で成立した妊娠を消さず、分娩時の母死亡後も仔を哺育する", () => {
    const w = covered(),
      b = normal(w);
    at(w, nextDate(b.matingDate!, 17));
    beginEpisode(w, w.entities[b.sireId] as Horse, "catastrophic", "pasture");
    reconcileBreeding(w);
    expect(b.status).toBe("pregnant");
    b.outcome!.motherDies = true;
    at(w, b.dueDate!);
    const dam = w.entities[b.horseId] as Horse,
      f = w.entities[b.foalId!] as Horse;
    expect(dam.life!.deceased).toBeTruthy();
    expect(f.life!.deceased).toBeUndefined();
    expect(f.family!.growth!.orphanSupport).toBe(true);
    expect(contracts(w).find((c) => c.horseId === f.id)?.monthlyYen).toBe(
      250000,
    );
    validateWorld(w);
  });
  it("妊娠中の母死亡は胎仔の喪失を記録し、未払い種付料を取消す", () => {
    const w = covered(),
      b = normal(w);
    at(w, nextDate(b.matingDate!, 17));
    at(w, "2027-09-30");
    expect(invoices(w).some((i) => i.id === b.feeInvoiceId)).toBe(true);
    beginEpisode(w, w.entities[b.horseId] as Horse, "catastrophic", "pasture");
    reconcileBreeding(w);
    expect(b.status).toBe("lost");
    expect(b.foalId).toBeUndefined();
    expect(b.feeStatus).toBe("waived");
    expect(invoices(w).some((i) => i.id === b.feeInvoiceId)).toBe(false);
    validateWorld(w);
  });
  it("親子参照、請求返還、育成前の登録の改変を拒否する", () => {
    const w = covered(),
      b = normal(w);
    at(w, nextDate(b.matingDate!, 17));
    at(w, b.dueDate!);
    const f = w.entities[b.foalId!] as Horse;
    const corrupt = structuredClone(w);
    (corrupt.entities[f.id] as Horse).family!.damId = f.id;
    expect(() => validateWorld(corrupt)).toThrow();
    const early = structuredClone(w);
    (early.entities[f.id] as Horse).details!.registered = true;
    expect(() => validateWorld(early)).toThrow();
  });
});
import { hash } from "../src/domain/catalog.ts";
import type { Invoice } from "../src/domain/career-types.ts";
function awaitSeed(w: World, b: BreedingCycle) {
  return hash(
    `${b.horseId}:${b.sireId}:${b.matingDate}:reproduction`,
    w.core.worldSeed,
  );
}

import type { HealthEpisode } from "../src/domain/life-types.ts";
import type { Market } from "../src/domain/career-types.ts";
