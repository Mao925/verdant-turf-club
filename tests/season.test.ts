import { describe, it, expect } from "vitest";
import {
  createSeason,
  upgradeSeason,
  allPending,
  awardFor,
  advanceSeason,
  rememberPlan,
} from "../src/domain/season.ts";
import {
  createCareer,
  openConsultation,
  activeRace,
} from "../src/domain/career.ts";
import {
  program,
  COURSES,
  routeFor,
  seasonOpportunities,
  seasonEligibility,
  selectField,
  classFor,
  termsReasons,
  courseProfile,
} from "../src/domain/program.ts";
import {
  applyCommand,
  backup,
  parseBackup,
  cash,
  horses,
  diff,
  createWorld,
  validateWorld,
  type World,
  type Horse,
  type Command,
} from "../src/domain/world.ts";
import { contracts, forecast, closeDay, debt } from "../src/domain/finance.ts";
import { calculateRace } from "../src/domain/racing.ts";
import { opportunities, eligibility, hash } from "../src/domain/catalog.ts";
import type {
  SeasonRace,
  SeasonOpportunity,
} from "../src/domain/season-types.ts";
const uuid = () => crypto.randomUUID();
const ids = () => ({
  save: uuid(),
  owner: uuid(),
  horse: uuid(),
  contract: uuid(),
});
const settings = {
  name: "試験馬主",
  silk: "#e3bd42",
  goal: "有馬記念",
  initialYen: 100000000,
  annualYen: 20000000,
};
function fresh() {
  return createSeason(ids(), settings);
}
function act(w: World, c: Command) {
  return applyCommand(w, c, uuid());
}
function buy(w: World, index = 0) {
  if (w.core.career!.stage === "active") w = act(w, { type: "open-market" });
  const market = w.entities[
    w.core.career!.marketId
  ] as import("../src/domain/career-types.ts").Market;
  const lot = market.lots[index];
  w = act(w, {
    type: "bid",
    horseId: lot.horseId,
    limitYen: lot.rivalYen + 100000,
    reason: "比較して継続",
  });
  w = act(w, { type: "receive", name: "愛馬" + index, reason: "願い" });
  return act(w, { type: "board", trainerId: index % 2 ? "mihara" : "saeki" });
}
function resolve(w: World) {
  for (const h of horses(w)) {
    w = act(w, { type: "select-horse", horseId: h.id });
    if (openConsultation(w))
      w = act(w, { type: "consult", choice: "wait", reason: "回復を待つ" });
  }
  return w;
}
function reorderKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reorderKeys);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, item]) => [key, reorderKeys(item)]),
    );
  return value;
}
describe("P3 通年・複数所有", () => {
  it("翌年1月の競走を前年12月に選出し、登録を取り残さない", () => {
    let w = buy(fresh());
    w.core.date = "2026-12-20";
    w.core.career!.nextReview = w.core.date;
    rememberPlan(w);
    w = act(w, { type: "advance", days: 1 });
    const spec = seasonOpportunities(w).find(
      (r) => r.date === "2027-01-03" && r.raceClass === "新馬",
    )!;
    expect(spec).toBeTruthy();
    w = act(w, {
      type: "consult",
      choice: "race",
      raceId: spec.id,
      reason: "年をまたぐ初戦",
    });
    w = act(w, { type: "advance", days: 31 });
    expect(w.core.date).toBe("2026-12-31");
    expect((w.entities[spec.id] as SeasonRace).status).not.toBe("registered");
  });
  it("固定抽選は馬IDの共通接頭辞を優遇せず、異なるシードで当落が変わる", () => {
    const w = fresh(),
      r = program(2026).find((r) => r.raceClass === "新馬")!;
    const pool = Object.values(w.entities)
      .filter((e): e is Horse => e.kind === "horse" && e.details?.runs === 0)
      .slice(0, 25);
    const seen = new Set<string>();
    for (let i = 0; i < 30; i++) {
      w.core.worldSeed = i;
      for (const id of selectField(
        w,
        r,
        pool.map((h) => h.id),
      ).field)
        seen.add(id);
    }
    expect(seen.size).toBe(pool.length);
  });

  it("5場の実在距離で6路線の通年昇級と年齢限定機会を編成する", () => {
    for (const y of [2026, 2027, 2028]) {
      const p = program(y);
      expect(new Set(p.map((r) => r.id)).size).toBe(p.length);
      expect(new Set(p.map((r) => r.course)).size).toBe(5);
      for (const r of p)
        expect(
          (
            COURSES[r.course].distances[
              r.surface === "芝" ? 0 : 1
            ] as readonly number[]
          ).includes(r.distance),
        ).toBe(true);
      for (let m = 1; m <= 12; m++)
        for (const route of [
          "turf-sprint",
          "turf-mile",
          "turf-middle",
          "turf-long",
          "dirt-sprint",
          "dirt-middle",
        ])
          for (const cls of ["1勝クラス", "2勝クラス", "3勝クラス", "オープン"])
            expect(
              p.filter(
                (r) =>
                  Number(r.date.slice(5, 7)) === m &&
                  r.terms.route === route &&
                  r.raceClass === cls,
              ).length,
            ).toBeGreaterThanOrEqual(2);
      expect(p.some((r) => r.terms.female)).toBe(true);
      for (let month = 1; month < 6; month++)
        for (const route of [
          "turf-sprint",
          "turf-mile",
          "turf-middle",
          "turf-long",
          "dirt-sprint",
          "dirt-middle",
        ])
          for (const cls of ["1勝クラス", "オープン"])
            expect(
              p.filter(
                (r) =>
                  Number(r.date.slice(5, 7)) === month &&
                  r.terms.route === route &&
                  r.raceClass === cls &&
                  r.terms.minAge === 3 &&
                  r.terms.maxAge === 3,
              ).length,
            ).toBeGreaterThanOrEqual(2);
    }
  });
  it("P1/P2の購入前・落札中・預託待ち・相談中を同一ID/債務/台帳で移行", () => {
    let w = createCareer(ids(), settings);
    const stages = [w];
    const m = w.entities[
      w.core.career!.marketId
    ] as import("../src/domain/career-types.ts").Market;
    w = act(w, {
      type: "bid",
      horseId: m.lots[0].horseId,
      limitYen: 15000000,
      reason: "理由",
    });
    stages.push(w);
    w = act(w, { type: "receive", name: "移行馬", reason: "理由" });
    stages.push(w);
    w = act(w, { type: "board", trainerId: "saeki" });
    stages.push(w);
    w = act(w, { type: "advance", days: 31 });
    stages.push(w);
    for (const old of stages) {
      const next = upgradeSeason(old, uuid());
      expect(next.core.date).toBe(old.core.date);
      expect(next.core.saveId).toBe(old.core.saveId);
      expect(cash(next)).toBe(cash(old));
      expect(debt(next)).toBe(debt(old));
      expect(horses(next).map((h) => h.id)).toEqual(
        horses(old).map((h) => h.id),
      );
      expect(parseBackup(backup(next, 4)).core.engineVersion).toBe("owner-p3");
    }
    const p1 = createWorld(ids());
    expect(cash(upgradeSeason(p1, uuid()))).toBe(cash(p1));
  });
  it("任意終了を保ち、P2の収録期間終了のみ解除する", () => {
    let w = buy(fresh());
    w = act(w, { type: "end-career", reason: "保管" });
    expect(() => act(w, { type: "advance", days: 1 })).toThrow();
    let old = createCareer(ids(), settings);
    old.core.career!.stage = "ended";
    old.core.career!.pause = "P2の収録期間は終了";
    expect(upgradeSeason(old, uuid()).core.career!.stage).toBe("market");
  });
  it("P2の登録・選出・未精算・精算済を移行し、旧条件と現金を保つ", () => {
    let old = buy(createCareer(ids(), settings));
    old = act(old, { type: "advance", days: 31 });
    const spec = opportunities(old).find(
      (r) => eligibility(old, r).length === 0,
    )!;
    old = act(old, {
      type: "consult",
      choice: "race",
      raceId: spec.id,
      reason: "旧番組",
    });
    // Choose a selection seed that admits the horse so all four phases are exercised.
    while (hash(spec.id + ":selection", old.core.worldSeed) % 10 === 0)
      old.core.worldSeed++;
    const stages = [old];
    old = act(old, { type: "advance", days: 31 });
    expect(activeRace(old)?.status).toBe("selected");
    stages.push(old);
    for (let i = 0; i < 5 && activeRace(old)?.status !== "result"; i++)
      old = act(old, { type: "advance", days: 31 });
    expect(activeRace(old)?.status).toBe("result");
    stages.push(old);
    old = act(old, { type: "settle", raceId: spec.id });
    stages.push(old);
    for (const before of stages) {
      let after = upgradeSeason(before, uuid());
      expect(after.entities[spec.id]).toEqual(before.entities[spec.id]);
      expect(cash(after)).toBe(cash(before));
      for (
        let i = 0;
        i < 8 &&
        ["registered", "selected"].includes(
          (after.entities[spec.id] as SeasonRace).status,
        );
        i++
      )
        after = act(after, { type: "advance", days: 31 });
      const race = after.entities[spec.id] as SeasonRace;
      if (race.status === "result") {
        const moneyBefore = cash(after);
        after = act(after, { type: "settle", raceId: spec.id });
        expect(cash(after) - moneyBefore).toBe(race.prizeYen);
      }
      expect(() => act(after, { type: "settle", raceId: spec.id })).toThrow();
      validateWorld(after);
    }
  });
  it("収得賞金で昇級し、現金受取・手当・重賞2着の加算を分ける", () => {
    const r = program(2026).find((r) => r.raceClass === "未勝利")!;
    expect(awardFor(r, 1)).toEqual({
      mainYen: 5900000,
      allowanceYen: 500000,
      cashYen: 5220000,
      earnedYen: 4000000,
    });
    expect(awardFor(r, 8).cashYen).toBe(500000);
    const h = horses(buy(fresh()))[0];
    h.details!.earnedYen = 5000000;
    expect(classFor(h)).toBe("1勝クラス");
    h.details!.earnedYen = 5000001;
    expect(classFor(h)).toBe("2勝クラス");
    const gi = program(2026).find((r) => r.terms.key === "derby")!;
    expect(awardFor(gi, 2).earnedYen).toBe(60000000);
    expect(termsReasons(h, gi)).not.toHaveLength(0);
  });
  it("定員の実需から除外し、固定抽選とファン上位50頭内の優先を再現する", () => {
    const w = fresh(),
      r = program(2026).find((r) => r.terms.key === "arima")!;
    const pool = Object.values(w.entities)
      .filter(
        (e): e is Horse =>
          e.kind === "horse" &&
          e.id.startsWith("npc:") &&
          Number(e.birthDate.slice(0, 4)) < 2024,
      )
      .slice(0, 25);
    pool.forEach((h, i) => {
      h.details!.fans = i === 24 ? 999999 : 0;
      h.details!.earnedYen = i === 24 ? 4000000 : 100000000;
    });
    const result = selectField(
      w,
      r,
      pool.map((h) => h.id),
    );
    expect(result.field.length).toBe(16);
    expect(result.excluded.length).toBe(9);
    expect(result.field).toContain(pool[24].id);
    expect(
      selectField(
        w,
        r,
        pool.map((h) => h.id),
      ),
    ).toEqual(result);
    expect(
      selectField(
        w,
        r,
        pool.slice(0, 3).map((h) => h.id),
      ).excluded,
    ).toHaveLength(0);
  });
  it("同じ競走の複数愛馬・別々の相談・精算を混同せず再送を拒否する", () => {
    let w = buy(buy(fresh()), 1);
    for (const e of Object.values(w.entities))
      if (e.kind === "horse" && e.id.startsWith("npc:"))
        e.details!.registered = false;
    w = act(w, { type: "advance", days: 31 });
    expect(allPending(w)).toHaveLength(2);
    const [a, b] = horses(w);
    w = act(w, { type: "select-horse", horseId: a.id });
    const candidate = seasonOpportunities(w).find(
      (r) =>
        r.terms.maxAge === 2 &&
        r.raceClass === "新馬" &&
        r.surface === "芝" &&
        r.distance === 1600,
    )!;
    expect(candidate).toBeTruthy();
    w = act(w, {
      type: "consult",
      choice: "race",
      raceId: candidate.id,
      reason: "2頭を比較",
    });
    expect(() => act(w, { type: "advance", days: 31 })).toThrow("全頭");
    w = act(w, { type: "select-horse", horseId: b.id });
    w = act(w, {
      type: "consult",
      choice: "race",
      raceId: candidate.id,
      reason: "同一条件で確認",
    });
    for (let i = 0; i < 15; i++) {
      const r = w.entities[candidate.id] as SeasonRace;
      if (r.status === "result") break;
      w = resolve(w);
      w = act(w, { type: "advance", days: 31 });
    }
    const r = w.entities[candidate.id] as SeasonRace;
    expect(r.ownedIds).toEqual([a.id, b.id]);
    expect(r.status).toBe("result");
    expect([...r.field].sort()).toEqual([a.id, b.id].sort());
    {
      const before = cash(w);
      w = act(w, { type: "settle", raceId: r.id });
      expect(cash(w) - before).toBe(r.prizeYen);
      expect(() => act(w, { type: "settle", raceId: r.id })).toThrow();
      expect(parseBackup(backup(w, 5))).toEqual(w);
    }
    validateWorld(w);
    // Both race terms and completed awards must survive PostgreSQL JSONB ordering.
    const reloaded = reorderKeys(w) as World;
    expect(reloaded).toEqual(w);
    expect(() => validateWorld(reloaded)).not.toThrow();
    const damaged = structuredClone(reloaded);
    (damaged.entities[r.id] as SeasonRace).awards![a.id].cashYen++;
    expect(() => validateWorld(damaged)).toThrow("賞金内訳");
    (reloaded.entities[r.id] as SeasonRace).terms = {
      ...r.terms,
      extra: true,
    } as SeasonRace["terms"];
    expect(() => validateWorld(reloaded)).toThrow("競走条件");
  });
  it("複数契約の日割り予測が賞金ゼロの12か月実績と円単位で一致", () => {
    const w = buy(buy(fresh()), 1);
    const f = forecast(w);
    const clone = structuredClone(w);
    const results = [];
    for (let i = 0; results.length < 12; i++) {
      const day = clone.core.date;
      closeDay(clone);
      if (day.slice(0, 7) !== clone.core.date.slice(0, 7))
        results.push({
          date: day,
          balanceYen:
            cash(clone) -
            (clone.core.date.slice(5) === "01-01"
              ? clone.core.owner.annualYen
              : 0),
        });
    }
    expect(results).toEqual(
      f.rows.map(({ date, balanceYen }) => ({ date, balanceYen })),
    );
  });
  it("予算帯ごとの取得費・全頭引当・合算預託・年次拠出を混同しない", () => {
    const cases = [
      { initialYen: 30000000, annualYen: 6000000, count: 1 },
      { initialYen: 100000000, annualYen: 20000000, count: 3 },
      { initialYen: 500000000, annualYen: 80000000, count: 4 },
    ];
    for (const c of cases) {
      let w = createSeason(ids(), { ...settings, ...c });
      const m = w.entities[
        w.core.career!.marketId
      ] as import("../src/domain/career-types.ts").Market;
      const price = m.lots
        .slice(0, c.count)
        .reduce((n, l) => n + l.rivalYen + 100000, 0);
      for (let i = 0; i < c.count; i++) w = buy(w, i);
      expect(cash(w)).toBe(c.initialYen - price - c.count * 100000);
      expect(w.core.career!.reserveYen).toBe(c.count * 1500000);
      expect(contracts(w)).toHaveLength(c.count);
      expect(w.core.owner.annualYen).toBe(c.annualYen);
      expect(forecast(w).rows).toHaveLength(12);
      expect(debt(w)).toBe(0);
      validateWorld(w);
    }
  });
  it("背景競走でもNPCの所有と個体が継続し、番組/結果の破損を拒否", () => {
    let w = buy(fresh());
    const owned = horses(w)[0];
    const owners = Object.values(w.entities).filter(
      (e) => e.kind === "npc-owner",
    );
    for (let i = 0; i < 10; i++) {
      w = resolve(w);
      w = act(w, { type: "advance", days: 31 });
    }
    const races = Object.values(w.entities).filter(
      (e): e is SeasonRace =>
        e.kind === "race" && !!e.terms && !!(e as SeasonRace).finish,
    );
    expect(races.length).toBeGreaterThan(40);
    expect(races.some((r) => !r.result)).toBe(true);
    const count = new Map<string, number>();
    for (const r of races)
      for (const id of r.field) count.set(id, (count.get(id) ?? 0) + 1);
    expect([...count.values()].some((n) => n > 1)).toBe(true);
    expect(horses(w)[0].id).toBe(owned.id);
    expect(
      Object.values(w.entities).filter((e) => e.kind === "npc-owner"),
    ).toEqual(owners);
    const broken = structuredClone(w);
    (broken.entities[races[0].id] as SeasonRace).distance = 9999;
    expect(() => validateWorld(broken)).toThrow();
  });
  it("方向・直線・曲線・高低差の異なるコースは計算に影響し、再生と差分は結果を変更しない", () => {
    const w = buy(fresh()),
      spec = program(2026).find(
        (r) => r.course === "東京" && r.distance === 1600,
      )!;
    const field = Object.values(w.entities)
      .filter((e): e is Horse => e.kind === "horse")
      .slice(0, 18)
      .map((h) => h.id);
    const r = {
      ...spec,
      horseId: field[0],
      field,
      seed: 123,
      status: "selected",
    } as SeasonRace;
    expect(courseProfile(r).direction).toBe("left");
    const a = calculateRace(w, r),
      b = calculateRace(w, { ...r, course: "中山" });
    expect(a).not.toEqual(b);
    expect(calculateRace(w, r)).toEqual(a);
    expect(diff(w, structuredClone(w)).upserts).toHaveLength(0);
  });
});
