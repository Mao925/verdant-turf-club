import { describe, it, expect } from "vitest";
import {
  applyCommand,
  backup,
  parseBackup,
  createWorld,
  cash,
  horses,
  nextDate,
  validateWorld,
  type World,
  type Horse,
  type Command,
} from "../src/domain/world.ts";
import { createLife, upgradeLife, lifeYearEnd } from "../src/domain/life.ts";
import { createCareer, openConsultation } from "../src/domain/career.ts";
import {
  createSeason,
  allPending,
  raceAward,
  rememberPlan,
} from "../src/domain/season.ts";
import {
  beginEpisode,
  healthDay,
  raceHealth,
  raceCause,
  dailyCause,
} from "../src/domain/health.ts";
import { activeEpisode, trainable } from "../src/domain/life-support.ts";
import { placementReasons, placementDay } from "../src/domain/placements.ts";
import { contracts, dailyCharge, debt } from "../src/domain/finance.ts";
import { calculateRace, progressAt } from "../src/domain/racing.ts";
import { program, seasonEligibility } from "../src/domain/program.ts";
import type { HealthEpisode, Placement } from "../src/domain/life-types.ts";
import type { SeasonRace } from "../src/domain/season-types.ts";
const uuid = () => crypto.randomUUID();
const ids = () => ({
  save: "40000000-0000-4000-8000-000000000004",
  owner: uuid(),
  horse: uuid(),
  contract: uuid(),
});
const settings = {
  name: "生涯試験",
  silk: "#e3bd42",
  goal: "長く共に",
  initialYen: 100000000,
  annualYen: 20000000,
};
const act = (w: World, c: Command, id = uuid()) => applyCommand(w, c, id);
function fresh() {
  let w = createLife(ids(), settings);
  const m = w.entities[w.core.career!.marketId];
  if (m.kind !== "market") throw Error();
  const l = m.lots[0];
  w = act(w, {
    type: "bid",
    horseId: l.horseId,
    limitYen: l.rivalYen + 100000,
    reason: "継続して所有",
  });
  w = act(w, { type: "receive", name: "風の記憶", reason: "初めの願い" });
  return act(w, { type: "board", trainerId: "saeki" });
}
function episode(w: World, cause: HealthEpisode["cause"] = "tendon") {
  return beginEpisode(
    w,
    horses(w)[0],
    cause,
    cause === "colic" ? "illness" : "training",
  );
}
function assessed(w: World, cause: HealthEpisode["cause"] = "tendon") {
  const e = episode(w, cause);
  e.outcome = "recover";
  w.core.date = e.dueDate!;
  healthDay(w);
  return e;
}
function jumpReview(w: World, e: HealthEpisode) {
  e.review = 1;
  w.core.date = e.dueDate!;
  healthDay(w);
  rememberPlan(w);
  validateWorld(w);
  return activeEpisode(w, horses(w)[0])!;
}
describe("P4 診療・生活・人物の履歴", () => {
  it("死亡翌年の年表は死亡年を取り違えない", () => {
    const w = fresh(),
      h = horses(w)[0];
    beginEpisode(w, h, "catastrophic", "training");
    w.core.date = "2027-12-31";
    lifeYearEnd(w);
    const s = w.entities[`annual-life:2027:${h.id}`];
    expect(s.kind).toBe("scene");
    if (s.kind === "scene") {
      expect(s.text).toContain("2026-05-01に亡くなってからも");
      expect(s.text).not.toContain("別れの年になりました");
      expect(s.evidenceIds).toContain(h.life!.deceased!.episodeId);
    }
  });
  it("P1/P2/P3の個体と現金を引き継ぎ、過去に診療を追加しない", () => {
    for (const factory of [
      (id: ReturnType<typeof ids>) => createWorld(id, "試験"),
      (id: ReturnType<typeof ids>) => createCareer(id, settings),
      (id: ReturnType<typeof ids>) => createSeason(id, settings),
    ]) {
      const old = factory(ids());
      const w = upgradeLife(old, "upgrade");
      expect(cash(w)).toBe(cash(old));
      expect(Object.values(w.entities).some((e) => e.kind === "health")).toBe(
        false,
      );
      expect(parseBackup(backup(w, 0))).toEqual(w);
      expect(() => upgradeLife(w, "again")).toThrow();
    }
  });
  it("初期対応は一度だけ請求し、診断と追加所見で転帰を引き直さない", () => {
    let w = fresh();
    const before = cash(w),
      e = episode(w);
    const copy = structuredClone(e);
    episode(w);
    expect(cash(w)).toBe(before - 50000);
    expect(e).toEqual(copy);
    w.core.date = e.dueDate!;
    healthDay(w);
    const outcome = e.outcome;
    w = act(w, {
      type: "second-opinion",
      episodeId: e.id,
      reason: "復帰の見通しを確認",
    });
    const next = w.entities[e.id] as HealthEpisode;
    expect(next.outcome).toBe(outcome);
    expect(next.dueDate).toBe(nextDate(w.core.date, 3));
    w.core.date = next.dueDate!;
    healthDay(w);
    expect(() =>
      act(w, { type: "second-opinion", episodeId: e.id, reason: "再検査" }),
    ).toThrow();
  });
  it("長期療養を保存し、回復後は帰厩と在厩・ゲートの確認が必要", () => {
    let w = fresh();
    const e = assessed(w);
    w = act(w, {
      type: "care-plan",
      episodeId: e.id,
      choice: "rehab",
      providerId: "forest",
      reason: "長期に待つ",
    });
    const r = w.entities[e.id] as HealthEpisode;
    expect(r.dueDate).toBe(nextDate(w.core.date, 180));
    expect(contracts(w)[0].monthlyYen).toBe(350000);
    w.core.date = nextDate(w.core.date, 7);
    placementDay(w);
    const recovered = jumpReview(w, r);
    expect(recovered.phase).toBe("cleared");
    expect(trainable(w, horses(w)[0])).toBe(false);
    w = act(w, {
      type: "move-horse",
      horseId: horses(w)[0].id,
      purpose: "training",
      providerId: "mihara",
      reason: "段階的に再開",
    });
    w.core.date = nextDate(w.core.date, 7);
    placementDay(w);
    healthDay(w);
    const h = horses(w)[0];
    expect(h.details!.enteredDate).toBe(w.core.date);
    expect(h.details!.gateDate).toBe(nextDate(w.core.date, 7));
    expect(
      seasonEligibility(w, program(Number(w.core.date.slice(0, 4)))[0], h.id),
    ).toContain("ゲート試験の通過報告を待っています。");
    validateWorld(w);
  });
  it("競走復帰不可でも生存・個体・請求を保ち、医療管理できない余生先を断る", () => {
    let w = fresh();
    const e = assessed(w);
    e.outcome = "limited";
    w = act(w, {
      type: "care-plan",
      episodeId: e.id,
      choice: "rehab",
      providerId: "forest",
      reason: "予後を見守る",
    });
    w.core.date = nextDate(w.core.date, 7);
    placementDay(w);
    jumpReview(w, w.entities[e.id] as HealthEpisode);
    const h = horses(w)[0];
    expect(h.life!.deceased).toBeUndefined();
    expect(h.life!.racing).toBe("barred");
    const broken = structuredClone(w);
    horses(broken)[0].life!.racing = "active";
    expect(() => validateWorld(broken)).toThrow("競走資格");
    expect(h.details!.registered).toBe(false);
    expect(placementReasons(w, h, "retirement", "haven").join()).toContain(
      "医療管理",
    );
    w = act(w, {
      type: "care-plan",
      episodeId: e.id,
      choice: "retire",
      providerId: "forest",
      reason: "生活を支える",
    });
    expect(contracts(w)[0].monthlyYen).toBe(180000);
    expect(horses(w)[0].life!.deceased).toBeUndefined();
  });
  it("死亡の確定で契約と将来予定を閉じ、既発生債務と過去を残す", () => {
    let w = fresh();
    const h = horses(w)[0];
    contracts(w)[0].accruedYen = 123456;
    const before = cash(w);
    const e = beginEpisode(w, h, "catastrophic", "training");
    expect(e.phase).toBe("dead");
    expect(contracts(w)).toHaveLength(0);
    expect(cash(w)).toBe(before - 123456 - 50000 - 150000);
    expect(h.life!.deceased?.mode).toBe("euthanasia");
    expect(h.details!.gateDate).toBeUndefined();
    expect(h.details!.registered).toBe(false);
    expect(() => beginEpisode(w, h, "catastrophic", "training")).not.toThrow();
    w = act(w, { type: "acknowledge-health", episodeId: e.id });
    const after = cash(w);
    w = act(w, { type: "advance", days: 7 });
    expect(cash(w)).toBe(after);
    expect(
      Object.values(w.entities).some(
        (e) => e.kind === "scene" && e.trigger === "loss",
      ),
    ).toBe(true);
  });
  it("非競走時の疾病でも救命不可の経過を保存し、残高の不足で死亡を生成しない", () => {
    let w = fresh();
    const h = horses(w)[0],
      e = episode(w, "colic");
    e.outcome = "death";
    w.core.date = e.dueDate!;
    healthDay(w);
    expect(h.life!.deceased).toBeTruthy();
    expect(e.origin).toBe("illness");
    w = fresh();
    const capital = w.entities.capital;
    if (capital.kind === "ledger") capital.amountYen -= cash(w);
    const mild = episode(w, "soreness");
    expect(horses(w)[0].life!.deceased).toBeUndefined();
    expect(debt(w)).toBe(50000);
    w.core.date = mild.dueDate!;
    healthDay(w);
    expect(() =>
      act(w, {
        type: "care-plan",
        episodeId: mild.id,
        choice: "rehab",
        providerId: "forest",
        reason: "療養",
      }),
    ).toThrow("現金");
    expect(horses(w)[0].life!.deceased).toBeUndefined();
  });
  it("移動は一契約だけ日割請求し、到着まで出走させない", () => {
    let w = fresh();
    const h = horses(w)[0],
      old = contracts(w)[0];
    old.accruedYen = dailyCharge(old.monthlyYen, w.core.date);
    w.core.date = nextDate(w.core.date);
    const oldDate = w.core.date;
    w = act(w, {
      type: "move-horse",
      horseId: h.id,
      purpose: "rest",
      providerId: "forest",
      reason: "外で休養",
    });
    expect(contracts(w)).toHaveLength(1);
    expect((w.entities[old.id] as typeof old).endDate).toBe(oldDate);
    expect(
      (w.entities[`closing:${old.id}`] as { amountYen: number }).amountYen,
    ).toBe(old.accruedYen);
    expect(trainable(w, horses(w)[0])).toBe(false);
    w = act(w, { type: "advance", days: 7 });
    expect(horses(w)[0].life!.movementId).toBeUndefined();
    expect(horses(w)[0].location).toContain("白樺牧場");
    expect(contracts(w)[0].accruedYen).toBe(
      Array.from({ length: 7 }, (_, i) =>
        dailyCharge(200000, nextDate(oldDate, i)),
      ).reduce((a, b) => a + b),
    );
  });
  it("売却の提示と引渡しを分け、入金後に同じ個体を他馬主へ引き継ぐ", () => {
    let w = fresh();
    const h = horses(w)[0];
    let id = uuid();
    let attempt = 0;
    while (true) {
      w = act(
        w,
        { type: "seek-buyer", horseId: h.id, reason: "新しい所有者を探す" },
        id,
      );
      w.core.date = nextDate(w.core.date, 7);
      placementDay(w);
      const p = w.entities[id] as Placement;
      if (p.status === "offered") break;
      attempt++;
      id = uuid();
      if (attempt > 20) throw Error("no offer");
    }
    const p = w.entities[id] as Placement;
    expect(w.entities[`sale:${p.id}`]).toBeUndefined();
    const cashAtOffer = cash(w);
    w = act(w, {
      type: "sale-response",
      placementId: p.id,
      accept: true,
      reason: "提示条件に合意",
    });
    expect(cash(w)).toBe(cashAtOffer);
    expect(horses(w)).toHaveLength(1);
    w.core.date = nextDate(w.core.date, 7);
    placementDay(w);
    expect(horses(w)).toHaveLength(0);
    expect((w.entities[h.id] as Horse).life!.owners).toHaveLength(3);
    expect(cash(w)).toBe(
      cashAtOffer + p.priceYen! - Math.round(p.priceYen! * 0.05),
    );
    expect(contracts(w)).toHaveLength(0);
    validateWorld(w);
  });
  it("売却中の急変で手続きが取り消され、見込み代金を記帳しない", () => {
    let w = fresh();
    const h = horses(w)[0],
      saleId = uuid();
    w = act(w, { type: "seek-buyer", horseId: h.id, reason: "照会" }, saleId);
    beginEpisode(w, horses(w)[0], "fracture", "pasture");
    expect((w.entities[saleId] as Placement).status).toBe("cancelled");
    expect(w.entities[`sale:${saleId}`]).toBeUndefined();
    expect(horses(w)).toHaveLength(1);
    validateWorld(w);
  });
  it("支払猶予は同意した期限まで一度だけ、終了でも債務と飼養先未解決を残す", () => {
    let w = fresh();
    const h = horses(w)[0];
    w.entities.unpaid = {
      kind: "invoice",
      id: "unpaid",
      horseId: h.id,
      date: w.core.date,
      dueDate: w.core.date,
      amountYen: 1000000,
      category: "care",
      description: "療養",
      paid: false,
    };
    w = act(w, {
      type: "extend-payment",
      invoiceId: "unpaid",
      reason: "入金時期に合わせる",
    });
    expect((w.entities.unpaid as { dueDate: string }).dueDate).toBe(
      nextDate(w.core.date, 14),
    );
    expect(() =>
      act(w, {
        type: "extend-payment",
        invoiceId: "unpaid",
        reason: "もう一度",
      }),
    ).toThrow();
    const capital = w.entities.capital;
    if (capital.kind === "ledger") capital.amountYen -= cash(w);
    w = act(w, { type: "end-career", reason: "支えられる範囲を超えた" });
    expect(w.core.career!.life!.closure?.debtYen).toBe(1000000);
    expect(w.core.career!.life!.closure?.unplacedIds).toEqual([h.id]);
    expect(horses(w)[0].life!.deceased).toBeUndefined();
    expect(() => act(w, { type: "advance", days: 1 })).toThrow();
  });
  it("屈腱損傷の再発は前の診療を参照し、個人の言葉で能力を増やさない", () => {
    let w = fresh();
    const e = assessed(w);
    e.phase = "cleared";
    e.closedDate = w.core.date;
    e.acknowledged = true;
    w.core.date = nextDate(w.core.date);
    healthDay(w);
    const next = episode(w);
    expect(next.recurrenceOf).toBe(e.id);
    expect(raceCause(0.004, 1, false)).toBe("fracture");
    expect(raceCause(0.004, 1, true)).toBe("tendon");
    const s = Object.values(w.entities).find((e) => e.kind === "scene")!;
    const before = structuredClone(horses(w)[0].details);
    w = act(w, {
      type: "remember",
      sceneId: s.id,
      text: "待った時間を覚えていたい",
    });
    expect(horses(w)[0].details).toEqual(before);
    const broken = structuredClone(w);
    (broken.entities[s.id] as { evidenceIds: string[] }).evidenceIds = [
      "missing",
    ];
    expect(() => validateWorld(broken)).toThrow("根拠");
  });
  it("選出で除外された馬の引退は、除外と登録の対応を壊さない", () => {
    let w = fresh();
    const h = horses(w)[0];
    const spec = program(2026).find((r) => r.raceClass === "新馬")!;
    const npc = Object.values(w.entities).find(
      (e): e is Horse => e.kind === "horse" && e.id.startsWith("npc:"),
    )!;
    const race: SeasonRace = {
      ...spec,
      kind: "race",
      seed: 1,
      horseId: h.id,
      status: "selected",
      entries: [h.id, npc.id],
      field: [npc.id],
      ownedIds: [h.id],
      excludedIds: [h.id],
      cancelledIds: [],
      selectionNotes: { [h.id]: "出走枠のため除外" },
      applicantCount: 2,
    };
    w.entities[race.id] = race;
    validateWorld(w);
    w = act(w, {
      type: "move-horse",
      horseId: h.id,
      purpose: "retirement",
      providerId: "forest",
      reason: "次の生活へ",
    });
    expect(w.entities[race.id]).toEqual(race);
    expect(horses(w)[0].life!.racing).toBe("retired");
    expect(() => validateWorld(w)).not.toThrow();
  });
  it("競走中止は固定した診療・進行位置を再生し、賞金と完走時計を付けない", () => {
    const w = fresh(),
      spec = program(2026).find((r) => r.raceClass === "新馬")!;
    w.core.date = spec.date;
    const h = horses(w)[0];
    const npc = Object.values(w.entities).find(
      (e): e is Horse =>
        e.kind === "horse" && e.ownerId.startsWith("npc-owner"),
    )!;
    const r: SeasonRace = {
      ...spec,
      kind: "race",
      seed: 1,
      horseId: h.id,
      status: "selected",
      entries: [h.id, npc.id],
      field: [h.id, npc.id],
      ownedIds: [h.id],
      excludedIds: [],
      cancelledIds: [],
      selectionNotes: {},
      applicantCount: 2,
    };
    w.entities[r.id] = r;
    let outcome: World | undefined;
    for (let seed = 1; seed < 20000; seed++) {
      const copy = structuredClone(w);
      copy.core.worldSeed = seed;
      const rr = copy.entities[r.id] as SeasonRace;
      const rows = raceHealth(copy, rr, calculateRace(copy, rr));
      if (rows.find((x) => x.horseId === h.id)?.stoppedAt) {
        rr.finish = rows.map((x) => x.horseId);
        rr.result = rows;
        outcome = copy;
        break;
      }
    }
    expect(outcome).toBeTruthy();
    const rr = outcome!.entities[r.id] as SeasonRace,
      row = rr.result!.find((x) => x.horseId === h.id)!;
    expect(progressAt(row, 10000)).toBe(row.stoppedAt);
    expect(raceAward(rr, h.id).cashYen).toBe(0);
    const again = structuredClone(w);
    again.core.worldSeed = outcome!.core.worldSeed;
    expect(
      raceHealth(
        again,
        again.entities[r.id] as SeasonRace,
        calculateRace(again, r),
      ),
    ).toEqual(rr.result);
  });
});
