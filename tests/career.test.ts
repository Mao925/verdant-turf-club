import { describe, it, expect } from "vitest";
import {
  applyCommand,
  backup,
  cash,
  createWorld,
  horses,
  parseBackup,
  type Command,
  type World,
  validateWorld,
} from "../src/domain/world";
import {
  activeRace,
  createCareer,
  openConsultation,
} from "../src/domain/career";
import { eligibility, opportunities, ownedHorse } from "../src/domain/catalog";
import { contracts, debt, forecast, invoices } from "../src/domain/finance";
import { calculateRace, progressAt } from "../src/domain/racing";
import type { Market, Race } from "../src/domain/career-types";
const ids = {
  save: "10000000-0000-4000-8000-000000000001",
  owner: "20000000-0000-4000-8000-000000000001",
  horse: "30000000-0000-4000-8000-000000000001",
  contract: "40000000-0000-4000-8000-000000000001",
};
function act(w: World, c: Command) {
  return applyCommand(w, c, crypto.randomUUID());
}
function start() {
  return createCareer(ids, {
    name: "試作馬主",
    silk: "#e3bd42",
    goal: "いつか、有馬記念へ",
    initialYen: 30000000,
    annualYen: 6000000,
  });
}
function buy(w = start(), trainerId: "saeki" | "mihara" = "saeki") {
  const market = w.entities[w.core.career!.marketId] as Market;
  const lot = market.lots[0];
  w = act(w, {
    type: "bid",
    horseId: lot.horseId,
    limitYen: lot.rivalYen + 100000,
    reason: "歩様に惹かれた",
  });
  w = act(w, {
    type: "receive",
    name: "テストシルベ",
    reason: "道を照らす馬に",
  });
  return act(w, { type: "board", trainerId });
}
function review(w: World) {
  for (let i = 0; i < 20 && !openConsultation(w); i++)
    w = act(w, { type: "advance", days: 31 });
  return w;
}
function chooseRace(w: World) {
  w = review(w);
  const race = opportunities(w).find((r) => eligibility(w, r).length === 0);
  expect(race).toBeTruthy();
  return act(w, {
    type: "consult",
    choice: "race",
    raceId: race!.id,
    reason: "競走で反応を見たい",
  });
}
function finish(w: World): World {
  for (let i = 0; i < 80; i++) {
    const r = activeRace(w);
    if (r?.status === "result") return w;
    if (openConsultation(w)) {
      w = chooseRace(w);
      continue;
    }
    w = act(w, { type: "advance", days: 31 });
  }
  throw new Error("race did not finish");
}
describe("P2 career", () => {
  it("persists four candidates, rejects unaffordable limits, loses without paying, and retains a purchased horse", () => {
    let w = start();
    const m = w.entities[w.core.career!.marketId] as Market;
    expect(m.lots).toHaveLength(4);
    expect(horses(w)).toHaveLength(0);
    expect(() =>
      act(w, {
        type: "bid",
        horseId: m.lots[0].horseId,
        limitYen: 30000000,
        reason: "資金不足",
      }),
    ).toThrow(/資金/);
    w = act(w, {
      type: "bid",
      horseId: m.lots[0].horseId,
      limitYen: m.lots[0].askingYen,
      reason: "ここまで",
    });
    expect(cash(w)).toBe(30000000);
    expect(() =>
      act(w, {
        type: "bid",
        horseId: m.lots[0].horseId,
        limitYen: 20000000,
        reason: "引き直し",
      }),
    ).toThrow(/終了/);
    expect(parseBackup(backup(w, 2)).entities).toEqual(w.entities);
    const lot = m.lots[2];
    w = act(w, {
      type: "bid",
      horseId: lot.horseId,
      limitYen: lot.rivalYen + 100000,
      reason: "別の可能性",
    });
    expect(horses(w)).toHaveLength(0);
    expect(invoices(w)).toHaveLength(1);
    expect(cash(w)).toBe(30000000);
    w = act(w, { type: "receive", name: "シルベ", reason: "新しい道へ" });
    expect(horses(w)[0].id).toBe(lot.horseId);
    expect(cash(w)).toBe(30000000 - lot.rivalYen - 100000);
  });
  it("migrates P1 without charging earlier days or changing identity/history", () => {
    let legacy = createWorld(ids);
    legacy = act(legacy, { type: "advance", days: 21 });
    const before = structuredClone(legacy);
    const w = act(legacy, { type: "upgrade" });
    expect(cash(w)).toBe(cash(before));
    expect(horses(w)[0].id).toBe(ids.horse);
    expect(w.core.date).toBe(before.core.date);
    expect(contracts(w)[0].accruedYen).toBe(0);
    for (const e of Object.values(before.entities).filter(
      (e) => e.kind === "ledger" || e.kind === "event",
    ))
      expect(w.entities[e.id]).toEqual(e);
    expect(() => act(w, { type: "upgrade" })).toThrow(/移行済み/);
  });
  it("stops on reports, remembers waiting, and gives the two trainers distinct advice and costs", () => {
    const a = review(buy());
    const b = review(buy(start(), "mihara"));
    expect(a.core.date).toBe("2026-05-16");
    expect(openConsultation(a)!.conclusion).not.toBe(
      openConsultation(b)!.conclusion,
    );
    expect(contracts(a)[0].monthlyYen).not.toBe(contracts(b)[0].monthlyYen);
    expect(() => act(a, { type: "advance", days: 7 })).toThrow(/相談/);
    const next = review(
      act(a, { type: "consult", choice: "wait", reason: "回復を優先" }),
    );
    expect(openConsultation(next)!.previous).toContain("回復を優先");
    expect(openConsultation(next)!.evidence).not.toContain("着");
  });
  it("uses the selected route to suggest a different opportunity and retains goal reasons", () => {
    let w = review(buy());
    w = act(w, {
      type: "consult",
      choice: "route",
      route: "dirt-middle",
      reason: "砂を確かめたい",
    });
    expect(w.core.career!.route).toBe("dirt-middle");
    w = act(w, {
      type: "goals",
      goal: "将来は大舞台",
      horseGoal: "砂の初勝利",
      annualGoal: "走りを知る",
      reason: "所見を受けて",
    });
    expect(
      Object.values(w.entities).some(
        (e) => e.kind === "event" && e.text.includes("所見を受けて"),
      ),
    ).toBe(true);
  });
  it("keeps medical restrictions and new/experienced eligibility separate", () => {
    const w = review(buy());
    const r = opportunities(w)[0];
    expect(eligibility(w, r)).toEqual([]);
    ownedHorse(w)!.details!.unfitUntil = r.date;
    expect(eligibility(w, r).join()).toContain("出走不可");
    expect(() =>
      act(w, {
        type: "consult",
        choice: "race",
        raceId: r.id,
        reason: "無理に出す",
      }),
    ).toThrow(/出走不可/);
  });
  it("separates registration, selection, cancellation, results and settlement across multiple races", () => {
    let w = chooseRace(buy());
    const first = activeRace(w)!;
    expect(first.status).toBe("registered");
    expect(ownedHorse(w)!.details!.runs).toBe(0);
    w = act(w, {
      type: "cancel-race",
      raceId: first.id,
      reason: "日程を見直す",
    });
    expect((w.entities[first.id] as Race).status).toBe("cancelled");
    expect(ownedHorse(w)!.details!.runs).toBe(0);
    w = finish(chooseRace(w));
    let r = activeRace(w)!;
    const before = cash(w);
    const identity = r.horseId;
    expect(r.result).toHaveLength(8);
    w = act(w, { type: "settle", raceId: r.id });
    expect(cash(w)).toBe(before + r.prizeYen!);
    expect(() => act(w, { type: "settle", raceId: r.id })).toThrow(/未精算/);
    expect(openConsultation(w)!.evidence).toContain("着");
    w = act(w, { type: "consult", choice: "wait", reason: "走った後の回復" });
    w = finish(chooseRace(w));
    r = activeRace(w)!;
    expect(r.horseId).toBe(identity);
    expect(ownedHorse(w)!.details!.runs).toBe(2);
  });
  it("simulation and replay are reproducible, ability affects results, and rendering cannot mutate results", () => {
    const w = chooseRace(buy()),
      r = activeRace(w)!;
    const a = calculateRace(w, r);
    expect(calculateRace(structuredClone(w), r)).toEqual(a);
    for (const row of a) {
      expect(progressAt(row, 0)).toBe(0);
      expect(progressAt(row, row.seconds)).toBe(1);
      expect(progressAt(row, row.seconds / 2)).toBeGreaterThan(0);
    }
    const changed = structuredClone(w);
    ownedHorse(changed)!.details!.speed = 0;
    const slower = calculateRace(changed, r).find(
      (x) => x.horseId === r.horseId,
    )!;
    expect(slower.seconds).toBeGreaterThan(
      a.find((x) => x.horseId === r.horseId)!.seconds,
    );
    const encoded = JSON.stringify(a);
    for (let i = 0; i < 1000; i++) a.forEach((row) => progressAt(row, i / 10));
    expect(JSON.stringify(a)).toBe(encoded);
  });
  it("matches monthly accrual and keeps insufficient invoices and career-end debt", () => {
    let w = buy();
    for (let i = 0; i < 10 && w.core.date < "2026-06-01"; i++) {
      if (openConsultation(w))
        w = act(w, { type: "consult", choice: "wait", reason: "費用を確認" });
      w = act(w, {
        type: "advance",
        days: Math.min(
          31,
          Math.round(
            (Date.parse("2026-06-01") - Date.parse(w.core.date)) / 86400000,
          ),
        ),
      });
    }
    expect(invoices(w).find((i) => i.category === "boarding")!.amountYen).toBe(
      700000,
    );
    const capital = w.entities.capital;
    if (capital.kind !== "ledger") throw new Error();
    capital.amountYen -= cash(w) - 1000;
    validateWorld(w);
    while (w.core.date < "2026-06-07") {
      if (openConsultation(w))
        w = act(w, { type: "consult", choice: "wait", reason: "費用を確認" });
      w = act(w, { type: "advance", days: 7 });
    }
    expect(w.core.date).toBe("2026-06-07");
    expect(invoices(w).some((i) => i.amountYen === 700000 && !i.paid)).toBe(
      true,
    );
    expect(() => act(w, { type: "advance", days: 7 })).toThrow(/請求/);
    const owing = debt(w);
    w = act(w, { type: "end-career", reason: "予算を守る" });
    expect(debt(w)).toBe(owing);
    expect(horses(w)).toHaveLength(1);
  });
  it("forecast matches real month-end cash when all opportunities are skipped", () => {
    let w = buy();
    const p = forecast(w);
    const target = p.rows[0];
    while (w.core.date < target.date) {
      if (openConsultation(w))
        w = act(w, { type: "consult", choice: "wait", reason: "見送り" });
      w = act(w, { type: "advance", days: 1 });
    }
    expect(cash(w)).toBe(target.balanceYen);
    expect(p.rows).toHaveLength(12);
    expect(p.firstShortage).toBeNull();
  });
  it("rejects broken result references, invoice payment claims and invalid horse state on import", () => {
    const w = finish(chooseRace(buy()));
    const id = activeRace(w)!.id;
    const bad = structuredClone(w);
    (bad.entities[id] as Race).result![0].horseId = "missing";
    expect(() => parseBackup(backup(bad, 1))).toThrow();
    const malformed = structuredClone(w);
    const bill = Object.values(malformed.entities).find(
      (e) => e.kind === "invoice",
    )!;
    if (bill.kind === "invoice") bill.amountYen++;
    expect(() => validateWorld(malformed)).toThrow(/支払/);
    ownedHorse(w)!.details!.fatigue = NaN;
    expect(() => validateWorld(w)).toThrow();
  });
});
