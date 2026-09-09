import {
  breedingDay,
  reconcileBreeding,
  breedingAfterRace,
} from "./breeding.ts";
import { breedingPending } from "./breeding-support.ts";
import {
  lifeBeforeDay,
  lifeHealthDay,
  lifeAfterRace,
  lifeYearEnd,
} from "./life.ts";
import { trainable, lifePending, livingOwned } from "./life-support.ts";
import { raceHealth } from "./health.ts";
import {
  cash,
  horses,
  nextDate,
  validDate,
  validateWorld,
  type World,
  type Horse,
  type Command,
  type Entity,
} from "./world.ts";
import {
  applyCareer,
  createCareer,
  upgradeWorld,
  validateCareer,
  validateCareerEntity,
  activeRace,
  openConsultation,
  report,
  event,
  newMarket,
  requireBudget,
  addInvoice,
} from "./career.ts";
import { details, hash, ownedHorse, TRAINERS } from "./catalog.ts";
import { closeDay, contracts, debt, payDue } from "./finance.ts";
import { calculateRace, prizeFor } from "./racing.ts";
import {
  CLASS_ORDER,
  COURSES,
  ROUTE_ORDER,
  classFor,
  program,
  routeFor,
  seasonEligibility,
  seasonOpportunities,
  selectField,
  termsReasons,
} from "./program.ts";
import type {
  HorsePlan,
  NpcOwner,
  SeasonOpportunity,
  SeasonRace,
} from "./season-types.ts";
import type { Consultation, Race } from "./career-types.ts";
function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
function money(n: unknown): n is number {
  return Number.isSafeInteger(n) && (n as number) >= 0 && (n as number) <= 1e12;
}
function text(n: unknown, max = 200): n is string {
  return typeof n === "string" && n.trim().length > 0 && n.length <= max;
}
// JSONB can reorder keys. Conditions and awards are flat value objects.
function sameValues(actual: unknown, expected: object) {
  return (
    actual !== null &&
    typeof actual === "object" &&
    !Array.isArray(actual) &&
    Object.keys(actual).length === Object.keys(expected).length &&
    Object.entries(expected).every(
      ([key, value]) =>
        Object.hasOwn(actual, key) &&
        (actual as Record<string, unknown>)[key] === value,
    )
  );
}
function legacyEarned(r: Race, h: Horse) {
  const age = Number(r.date.slice(0, 4)) - Number(h.birthDate.slice(0, 4));
  return {
    新馬: 4000000,
    未勝利: 4000000,
    "1勝クラス": 5000000,
    "2勝クラス": 6000000,
    "3勝クラス": 9000000,
    オープン: age === 2 ? 6000000 : age === 3 ? 10000000 : 12000000,
  }[r.raceClass];
}
export function rememberPlan(w: World) {
  const c = w.core.career!,
    h = ownedHorse(w);
  if (h && c.portfolio)
    c.portfolio.plans[h.id] = {
      nextReview: c.nextReview,
      route: c.route,
      horseGoal: c.horseGoal,
      annualGoal: c.annualGoal,
      ...(c.trainerId ? { trainerId: c.trainerId } : {}),
    };
}
export function focusHorse(w: World, id: string) {
  const c = w.core.career!,
    p = c.portfolio!.plans[id];
  check(p && w.entities[id]?.kind === "horse", "所有馬の計画がありません。");
  c.horseId = id;
  c.nextReview = p.nextReview;
  c.route = p.route;
  c.horseGoal = p.horseGoal;
  c.annualGoal = p.annualGoal;
  c.trainerId = p.trainerId;
}
function reviewHorse(w: World, horseId: string, id: string) {
  if (w.core.career?.life && !trainable(w, w.entities[horseId] as Horse))
    return;
  const old = w.core.career!.horseId;
  focusHorse(w, horseId);
  if (!activeRace(w) && w.core.career!.trainerId) {
    report(w, id);
    rememberPlan(w);
  }
  if (old && w.core.career!.portfolio!.plans[old]) focusHorse(w, old);
}
export function allPending(w: World) {
  return [
    ...Object.values(w.entities).filter(
      (e) =>
        (e.kind === "consultation" && !e.resolution) ||
        (e.kind === "race" && e.status === "result"),
    ),
    ...(w.core.career?.life ? lifePending(w) : []),
    ...(w.core.career?.breeding ? breedingPending(w) : []),
  ];
}
export function raceForHorse(w: World, id: string) {
  return Object.values(w.entities).find(
    (e): e is Race =>
      e.kind === "race" &&
      ["registered", "selected", "result"].includes(e.status) &&
      ("entries" in e
        ? (e as SeasonRace).ownedIds.includes(id) &&
          !(e as SeasonRace).excludedIds.includes(id) &&
          !(e as SeasonRace).cancelledIds.includes(id)
        : e.horseId === id),
  );
}
const NPC_NAMES = [
  "高瀬真一",
  "橘沙織",
  "北野光",
  "青野健",
  "森崎遥",
  "冬木涼",
  "秋山文",
  "山吹圭",
  "花岡律",
  "月岡環",
  "瀬戸悠",
  "朝倉司",
];
export function populate(w: World, year: number, initial = false) {
  for (let i = 0; i < 12; i++) {
    const id = `npc-owner:${i}`;
    if (!w.entities[id])
      w.entities[id] = {
        kind: "npc-owner",
        id,
        name: NPC_NAMES[i],
        silk: ["#5483be", "#df614e", "#4a9774", "#a076ac"][i % 4],
        policy: [
          "距離適性を優先して継続出走",
          "回復を優先し、間隔を取る",
          "大舞台に実績を重ねる",
        ][i % 3],
        spacingDays: [14, 21, 28][i % 3],
      };
  }
  function add(birthYear: number, ri: number, index: number, level: number) {
    const id = `npc:${birthYear}:${ri}:${level}:${index}`;
    if (w.entities[id]) return;
    const d = details(hash(id, w.core.worldSeed), index),
      seed = hash(id, w.core.worldSeed);
    d.idealDistance = [1200, 1600, 2000, 2600, 1400, 1800][ri];
    d.turf = ri < 4 ? 1.02 : 0.83;
    d.dirt = ri >= 4 ? 1.02 : 0.83;
    d.earnedYen = [0, 4000000, 9000000, 15000000, 24000000][level];
    d.runs = level ? level + 2 : 0;
    d.wins = level;
    d.fans = level * 100 + (seed % 70);
    d.turn = seed % 2 ? "left" : "right";
    d.awards = [];
    d.registered = true;
    d.enteredDate = `${birthYear + 2}-01-01`;
    d.gateDate = d.enteredDate;
    w.entities[id] = {
      kind: "horse",
      id,
      name: `${["アカツキ", "ソラ", "ミナモ", "ナギ", "シオン", "カナタ"][ri]}${["ノミチ", "ノホシ", "ノカゼ", "ノユメ", "ノオト", "ノツキ"][index % 6]}${birthYear % 100}-${level}${index}`,
      birthDate: `${birthYear}-03-15`,
      sex: index % 2 ? "stallion" : "mare",
      ownerId: `npc-owner:${seed % 12}`,
      coat: ["#8f5032", "#b8b3a8", "#44302b", "#be7b49"][seed % 4],
      location: "中央競馬・他馬主の厩舎",
      details: d,
    };
  }
  if (initial)
    for (let ri = 0; ri < 6; ri++) {
      for (let i = 0; i < 80; i++) add(year - 3, ri, i, 0);
      for (let level = 1; level <= 4; level++)
        for (let i = 0; i < 40; i++) add(year - 3 - (i % 3), ri, i, level);
    }
  for (let ri = 0; ri < 6; ri++)
    for (let i = 0; i < 100; i++) add(year - 2, ri, i, 0);
  w.core.career!.portfolio!.cohortYear = year;
}
export function upgradeSeason(world: World, id: string): World {
  check(world.core.engineVersion !== "owner-p3", "通年番組へ移行済みです。");
  const w =
    world.core.engineVersion === "owner-p1"
      ? upgradeWorld(world, id)
      : structuredClone(world);
  const c = w.core.career!;
  w.core.engineVersion = "owner-p3";
  w.core.rulesetVersion = "calendar-2026";
  c.portfolio = {
    plans: {},
    startedDate: w.core.date,
    cohortYear: Number(w.core.date.slice(0, 4)),
    marketOpened: (w.entities[c.marketId] as { date: string }).date,
  };
  for (const e of Object.values(w.entities))
    if (e.kind === "horse" && e.details) {
      const d = e.details;
      d.earnedYen =
        d.wins === 0
          ? 0
          : d.wins === 1
            ? 4000000
            : 9000000 + Math.max(0, d.wins - 2) * 6000000;
      d.fans = d.wins * 100;
      d.awards = [];
      d.turn = hash(e.id) % 2 ? "left" : "right";
    }
  // Reconstruct class amounts from preserved P2 races when possible; never change cash or race results.
  for (const e of Object.values(w.entities)) {
    if (e.kind !== "horse" || !e.details) continue;
    const wins = Object.values(w.entities).filter(
      (r): r is Race =>
        r.kind === "race" &&
        ["result", "settled"].includes(r.status) &&
        r.result?.[0]?.horseId === e.id,
    );
    if (!wins.length) continue;
    const priorWins = Math.max(0, e.details.wins - wins.length);
    e.details.earnedYen =
      priorWins === 0
        ? 0
        : priorWins === 1
          ? 4000000
          : 9000000 + Math.max(0, priorWins - 2) * 6000000;
    e.details.awards = wins.map((r) => ({
      date: r.date,
      amountYen: legacyEarned(r, e),
      grade: "一般",
    }));
    e.details.earnedYen += e.details.awards.reduce(
      (n, a) => n + a.amountYen,
      0,
    );
  }
  for (const h of horses(w)) {
    const p: HorsePlan = {
      nextReview: c.nextReview,
      route: c.route,
      horseGoal: c.horseGoal,
      annualGoal: c.annualGoal,
      ...(c.trainerId ? { trainerId: c.trainerId } : {}),
    };
    c.portfolio.plans[h.id] = p;
  }
  if (c.stage === "ended" && !c.pause?.startsWith("活動終了：")) {
    c.stage = horses(w).length ? "active" : "market";
    c.nextReview = w.core.date;
    rememberPlan(w);
    c.pause = undefined;
  }
  c.endDate = "2100-12-31";
  populate(w, Number(w.core.date.slice(0, 4)), true);
  event(
    w,
    id,
    "P3の通年番組へ移行。愛馬・契約・暦・台帳・途中の判断を引き継ぎました。旧競走はP2の確定条件を保持し、新しい申込みから5場の番組を使います。",
  );
  validateWorld(w);
  return w;
}
export function createSeason(
  ids: Parameters<typeof createCareer>[0],
  settings: Parameters<typeof createCareer>[1],
) {
  check(
    money(settings.initialYen) &&
      settings.initialYen >= 5000000 &&
      settings.initialYen <= 500000000,
    "初期資金は500万〜5億円にしてください。",
  );
  check(
    money(settings.annualYen) && settings.annualYen <= 80000000,
    "年次拠出は0〜8,000万円にしてください。",
  );
  const w = createCareer(ids, {
    ...settings,
    initialYen: Math.min(settings.initialYen, 100000000),
    annualYen: Math.min(settings.annualYen, 20000000),
  });
  (w.entities.capital as import("./world.ts").LedgerEntry).amountYen =
    settings.initialYen;
  w.core.owner.annualYen = settings.annualYen;
  (w.entities.first as import("./world.ts").JournalEvent).text =
    `馬主「${settings.name}」の経歴を開始。年間拠出枠は${settings.annualYen.toLocaleString("ja-JP")}円です。`;
  return upgradeSeason(w, "season-start");
}
export function awardFor(r: SeasonOpportunity, rank: number) {
  const mainYen = Math.round(
    r.terms.firstYen * ([1, 0.4, 0.25, 0.15, 0.1][rank - 1] ?? 0),
  );
  // Simplified flat participation allowance; separate from the professional share. Not the full JRA allowances schedule.
  const allowanceYen = rank > 0 ? 500000 : 0;
  const cashYen = Math.round(mainYen * 0.8) + allowanceYen;
  let earnedYen = 0;
  if (rank === 1)
    earnedYen = {
      新馬: 4000000,
      未勝利: 4000000,
      "1勝クラス": 5000000,
      "2勝クラス": 6000000,
      "3勝クラス": 9000000,
      オープン:
        r.terms.maxAge === 2
          ? 6000000
          : r.terms.maxAge === 3
            ? 10000000
            : 12000000,
    }[r.raceClass];
  if (["GI", "GII", "GIII"].includes(r.terms.grade) && rank <= 2)
    earnedYen =
      r.terms.maxAge === 2 && r.terms.grade === "GIII"
        ? rank === 1
          ? 16000000
          : 6000000
        : Math.floor(mainYen / 2 / 100000) * 100000;
  return { mainYen, allowanceYen, cashYen, earnedYen };
}
function makeRace(w: World, r: SeasonOpportunity): SeasonRace {
  return {
    ...r,
    status: "registered",
    horseId: w.core.career!.horseId ?? "",
    field: [],
    seed: hash(r.id, w.core.worldSeed),
    applicantCount: 0,
    entries: [],
    ownedIds: [],
    excludedIds: [],
    cancelledIds: [],
    selectionNotes: {},
  };
}
function selectDay(w: World, date: string) {
  const year = Number(date.slice(0, 4));
  const races = [
    ...program(year),
    ...(nextDate(date, 3).slice(0, 4) !== date.slice(0, 4)
      ? program(year + 1)
      : []),
  ].filter(
    (r) =>
      r.selectionDate === date &&
      r.date > w.core.career!.portfolio!.startedDate,
  );
  if (!races.length) return false;
  const booked = new Set<string>();
  for (const e of Object.values(w.entities))
    if (e.kind === "race" && ["registered", "selected"].includes(e.status)) {
      const ids = "entries" in e ? (e as SeasonRace).entries : e.field;
      for (const id of ids) booked.add(id);
    }
  const applicants = new Map(races.map((r) => [r.id, [] as string[]]));
  for (const e of Object.values(w.entities)) {
    if (
      e.kind !== "horse" ||
      !e.details ||
      e.ownerId === w.core.owner.id ||
      w.entities[e.ownerId]?.kind !== "npc-owner" ||
      !e.details.registered ||
      !trainable(w, e) ||
      booked.has(e.id)
    )
      continue;
    const d = e.details,
      owner = w.entities[e.ownerId] as NpcOwner;
    if (
      d.lastRaceDate &&
      nextDate(d.lastRaceDate, owner.spacingDays) > nextDate(date, 3)
    )
      continue;
    const route = routeFor(d.turf > d.dirt ? "芝" : "ダート", d.idealDistance);
    const candidates = races.filter(
      (r) =>
        (r.terms.route === route ||
          (route === "turf-long" &&
            r.terms.maxAge === 2 &&
            r.terms.route === "turf-middle")) &&
        termsReasons(e, r).length === 0,
    );
    candidates.sort(
      (a, b) =>
        Math.abs(
          CLASS_ORDER.indexOf(a.raceClass) - CLASS_ORDER.indexOf(classFor(e)),
        ) -
          Math.abs(
            CLASS_ORDER.indexOf(b.raceClass) - CLASS_ORDER.indexOf(classFor(e)),
          ) ||
        (b.terms.grade === "GI" ? 1 : 0) - (a.terms.grade === "GI" ? 1 : 0) ||
        hash(a.id + e.id) - hash(b.id + e.id),
    );
    if (candidates[0]) applicants.get(candidates[0].id)!.push(e.id);
  }
  let ownerEvent = false;
  for (const spec of races) {
    const r =
      (w.entities[spec.id] as SeasonRace | undefined) ?? makeRace(w, spec);
    if (r.status !== "registered") continue;
    const validOwners = r.ownedIds.filter(
      (id) =>
        !r.cancelledIds.includes(id) &&
        seasonEligibility(w, spec, id, true).length === 0,
    );
    for (const id of r.ownedIds.filter(
      (id) => !r.cancelledIds.includes(id) && !validOwners.includes(id),
    )) {
      r.cancelledIds.push(id);
      r.selectionNotes[id] = "取消：選出時点の資格・回復条件を満たしません。";
    }
    r.entries = [...validOwners, ...applicants.get(r.id)!];
    const selection = selectField(w, spec, r.entries);
    r.field = selection.field;
    r.applicantCount = r.entries.length;
    r.excludedIds = selection.excluded.filter((id) => r.ownedIds.includes(id));
    r.selectionNotes = {
      ...r.selectionNotes,
      ...Object.fromEntries(
        Object.entries(selection.notes).filter(([id]) =>
          r.ownedIds.includes(id),
        ),
      ),
    };
    r.entries = [...new Set([...r.field, ...validOwners])];
    r.horseId = r.ownedIds[0] ?? r.field[0] ?? r.entries[0] ?? "";
    // Empty meetings are explicitly recorded, not filled with newly invented race-specific horses.
    r.status = r.field.length >= 2 ? "selected" : "cancelled";
    if (!r.horseId) continue;
    w.entities[r.id] = r;
    for (const id of r.ownedIds) {
      ownerEvent = true;
      const note =
        r.status === "cancelled"
          ? "競走不成立：出走可能馬が2頭未満です。"
          : r.selectionNotes[id];
      event(w, `${r.id}:selection:${id}`, `${r.name} ${note}`, id);
      if (!r.field.includes(id) || r.status === "cancelled")
        reviewHorse(w, id, `${r.id}:review:${id}`);
    }
  }
  return ownerEvent;
}
function finishRace(w: World, r: SeasonRace) {
  const original = [...r.field];
  if (w.core.career?.life)
    r.field = r.field.filter((id) => trainable(w, w.entities[id] as Horse));
  for (const id of r.ownedIds.filter((id) => r.field.includes(id))) {
    const h = w.entities[id] as Horse;
    if (
      (h.details!.unfitUntil && h.details!.unfitUntil >= w.core.date) ||
      h.details!.fatigue > 55 ||
      cash(w) - debt(w) < 150000
    ) {
      r.field = r.field.filter((x) => x !== id);
      r.cancelledIds.push(id);
      r.selectionNotes[id] = "取消：出走時の回復または遠征費が不足しました。";
      event(w, `${r.id}:cancel:${id}`, `${r.name} ${r.selectionNotes[id]}`, id);
    }
  }
  if (r.field.length < 2) {
    r.status = "cancelled";
    for (const id of r.ownedIds) reviewHorse(w, id, `${r.id}:review:${id}`);
    return;
  }
  for (const id of r.ownedIds.filter((id) => r.field.includes(id))) {
    const old = w.core.career!.horseId;
    w.core.career!.horseId = id;
    addInvoice(
      w,
      `${r.id}:transport:${id}`,
      150000,
      "transport",
      `${r.name} 遠征・出走費（架空契約）`,
    );
    payDue(w);
    w.core.career!.horseId = old;
  }
  const result = raceHealth(w, r, calculateRace(w, r));
  r.finish = result.map((x) => x.horseId);
  r.times = result.map((x) => x.seconds);
  const owned = r.ownedIds.filter((id) => r.field.includes(id));
  r.awards = {};
  result.forEach((row, i) => {
    const h = w.entities[row.horseId] as Horse,
      d = h.details!,
      award = raceAward(r, row.horseId);
    d.runs++;
    if (i === 0 && row.stoppedAt === undefined) d.wins++;
    d.earnedYen = (d.earnedYen ?? 0) + award.earnedYen;
    d.fans =
      (d.fans ?? 0) +
      (row.stoppedAt !== undefined
        ? 0
        : i < 5
          ? (5 - i) *
            (r.terms.grade === "GI" ? 200 : r.terms.grade === "一般" ? 5 : 40)
          : 1);
    d.fatigue = 42;
    d.lastRaceDate = w.core.date;
    if (award.earnedYen > 0)
      d.awards = [
        ...(d.awards ?? []).filter(
          (a) => a.date >= nextDate(w.core.date, -730),
        ),
        { date: w.core.date, amountYen: award.earnedYen, grade: r.terms.grade },
      ];
    if (owned.includes(h.id)) r.awards![h.id] = award;
  });
  r.status = owned.length ? "result" : "settled";
  if (owned.length) {
    r.result = result;
    r.prizeYen = Object.values(r.awards).reduce((n, a) => n + a.cashYen, 0);
    for (const id of owned)
      event(
        w,
        `${r.id}:result:${id}`,
        `${r.name} ${r.dnf?.some((d) => d.horseId === id) ? "競走中止" : `${r.finish.indexOf(id) + 1}着`}。結果を保存しました。`,
        id,
      );
  }
  if (w.core.career?.life) lifeAfterRace(w, r);
  if (w.core.career?.breeding) breedingAfterRace(w, r);
  for (const id of r.ownedIds.filter(
    (id) => original.includes(id) && !r.field.includes(id),
  ))
    reviewHorse(w, id, `${r.id}:review:${id}`);
}
function legacyDay(w: World) {
  let stop = false;
  for (const e of Object.values(w.entities)) {
    if (e.kind !== "race" || e.terms) continue;
    const r = e;
    if (r.status === "registered" && w.core.date >= r.selectionDate) {
      r.status =
        hash(r.id + ":selection", w.core.worldSeed) % 10 === 0
          ? "excluded"
          : "selected";
      stop = true;
      if (r.status === "excluded")
        reviewHorse(w, r.horseId, `${r.id}:legacy-review`);
      event(
        w,
        `${r.id}:selection`,
        `${r.name} ${r.status === "excluded" ? "P2条件で除外" : "P2条件で選出"}。`,
        r.horseId,
      );
    }
    if (r.status === "selected" && w.core.date >= r.date) {
      const h = w.entities[r.horseId] as Horse;
      if (
        cash(w) - debt(w) < 150000 ||
        h.details!.fatigue > 55 ||
        (h.details!.unfitUntil && h.details!.unfitUntil >= w.core.date)
      ) {
        r.status = "cancelled";
        reviewHorse(w, r.horseId, `${r.id}:legacy-review`);
      } else {
        const old = w.core.career!.horseId;
        w.core.career!.horseId = r.horseId;
        addInvoice(
          w,
          `${r.id}:transport`,
          150000,
          "transport",
          `${r.name} P2遠征費`,
        );
        payDue(w);
        w.core.career!.horseId = old;
        r.result = calculateRace(w, r);
        r.status = "result";
        r.prizeYen = prizeFor(
          r,
          r.result.findIndex((x) => x.horseId === r.horseId) + 1,
        );
        r.result.forEach((x, i) => {
          const d = (w.entities[x.horseId] as Horse).details!;
          d.runs++;
          if (i === 0) {
            d.wins++;
            const amountYen = legacyEarned(r, w.entities[x.horseId] as Horse);
            d.earnedYen = (d.earnedYen ?? 0) + amountYen;
            d.awards = [
              ...(d.awards ?? []),
              { date: w.core.date, amountYen, grade: "一般" },
            ];
            d.fans = (d.fans ?? 0) + 100;
          }
          d.lastRaceDate = w.core.date;
          d.fatigue = 42;
        });
      }
      stop = true;
    }
  }
  return stop;
}
export function advanceSeason(w: World, days: number, id: string) {
  const c = w.core.career!;
  check(
    Number.isInteger(days) && days >= 1 && days <= 31,
    "1〜31日ずつ進めてください。",
  );
  check(
    ["active", "market"].includes(c.stage),
    "購入・引渡し・預託を先に完了してください。",
  );
  check(
    allPending(w).length === 0,
    "全頭の未決相談と未精算結果を先に確認してください。",
  );
  check(payDue(w), "期日の請求を支払えません。資金と契約を確認してください。");
  c.pause = undefined;
  let moved = 0;
  for (let i = 0; i < days; i++) {
    check(w.core.date < "2100-12-31", "保存可能な暦の上限です。");
    const paid = closeDay(w);
    moved++;
    for (const h of horses(w))
      h.details!.fatigue = Math.max(0, h.details!.fatigue - 2);
    if (Number(w.core.date.slice(0, 4)) > c.portfolio!.cohortYear)
      populate(w, Number(w.core.date.slice(0, 4)));
    const lifeEvent = c.life ? lifeBeforeDay(w) : false;
    const breedingEvent = c.breeding ? breedingDay(w) : false;
    const healthEvent = c.life ? lifeHealthDay(w) : false;
    const breedingHealthEvent = c.breeding ? reconcileBreeding(w) : false;
    // Every world's race is processed even when another horse's decision pauses this day.
    const selection = selectDay(w, w.core.date);
    let ownerRaced = false;
    for (const e of Object.values(w.entities))
      if (
        e.kind === "race" &&
        e.terms &&
        e.status === "selected" &&
        e.date === w.core.date
      ) {
        const r = e as SeasonRace;
        finishRace(w, r);
        ownerRaced ||= r.ownedIds.length > 0;
      }
    const legacy = legacyDay(w);
    for (const [horseId, p] of Object.entries(c.portfolio!.plans))
      if (
        p.trainerId &&
        p.nextReview <= w.core.date &&
        !raceForHorse(w, horseId)
      )
        reviewHorse(w, horseId, `review:${w.core.date}:${horseId}`);
    if (c.life) lifeYearEnd(w);
    if (!paid || !payDue(w)) {
      c.pause =
        "預託料が不足したため日付を止めました。未払いと愛馬は保持されています。";
      break;
    }
    if (
      selection ||
      ownerRaced ||
      legacy ||
      lifeEvent ||
      healthEvent ||
      breedingEvent ||
      breedingHealthEvent ||
      allPending(w).length
    )
      break;
    if (w.core.date.slice(5) === "12-31") {
      c.pause = "年末です。全頭の収支と翌年の固定拠出を確認しましょう。";
      break;
    }
    if (
      Object.values(w.entities).some(
        (e) => e.kind === "invoice" && e.dueDate === w.core.date && e.paid,
      )
    )
      break;
  }
  event(
    w,
    id,
    `${moved}日進み、全頭と世界の予定を${w.core.date}まで確認しました。`,
    undefined,
  );
}
export function applySeason(
  world: World,
  command: Command,
  id: string,
  finalize = true,
): World {
  let w = structuredClone(world);
  const c = w.core.career!;
  rememberPlan(w);
  check(
    c.stage !== "ended" ||
      ["goals", "goal", "rename", "select-horse"].includes(command.type),
    "活動を終了した経歴です。記録を保持しています。",
  );
  if (command.type === "select-horse") {
    check(
      !["purchase", "boarding", "market"].includes(c.stage),
      "市場を閉じ、引渡し・預託を終えてから愛馬を切り替えてください。",
    );
    focusHorse(w, command.horseId);
  } else if (command.type === "open-market") {
    check(c.stage === "active", "今は市場へ移動できません。");
    check(
      (c.life ? livingOwned(w) : horses(w)).length < 12,
      "現在の預託受入は合計12頭までです。",
    );
    c.stage = "market";
    delete c.horseId;
    delete c.trainerId;
  } else if (command.type === "close-market") {
    check(
      c.stage === "market" && horses(w).length,
      "所有馬のいる経歴で市場を閉じられます。",
    );
    c.stage = "active";
    focusHorse(w, horses(w)[0].id);
  } else if (command.type === "next-market") {
    check(c.stage === "market", "未完了の購入があります。");
    check(
      w.core.date >=
        nextDate(c.portfolio!.marketOpened ?? c.portfolio!.startedDate, 14),
      "次の市場は前回開催から14日後です。愛馬の予定を確認しながら日付を進めてください。",
    );
    const prior = w.entities[c.marketId] as import("./career-types.ts").Market;
    for (const l of prior.lots) if (l.status === "open") l.status = "passed";
    newMarket(w);
    c.endDate = "2100-12-31";
    c.portfolio!.marketOpened = w.core.date;
    for (const l of (
      w.entities[c.marketId] as import("./career-types.ts").Market
    ).lots) {
      const d = (w.entities[l.horseId] as Horse).details!;
      d.earnedYen = 0;
      d.fans = 0;
      d.awards = [];
      d.turn = hash(l.horseId) % 2 ? "left" : "right";
      d.idealDistance = [1200, 1800, 2400, 1600][
        hash(w.core.date) % 4 === 0 ? 3 : Number(l.horseId.at(-1))
      ];
    }
    event(w, id, "次の2歳市場の所見を受け取りました。", undefined);
  } else if (command.type === "advance") advanceSeason(w, command.days, id);
  else if (command.type === "consult" && command.choice === "race") {
    check(text(command.reason), "判断の理由を入力してください。");
    const consultation = openConsultation(w);
    check(
      consultation && !activeRace(w),
      "相談または出走手続きを確認してください。",
    );
    const spec = seasonOpportunities(w).find((r) => r.id === command.raceId);
    check(spec, "登録できる競走候補がありません。");
    const reasons = seasonEligibility(w, spec);
    check(!reasons.length, reasons.join(" "));
    requireBudget(w, 200000);
    const h = ownedHorse(w)!;
    const r =
      (w.entities[spec.id] as SeasonRace | undefined) ?? makeRace(w, spec);
    check(
      r.status === "registered" && !r.entries.includes(h.id),
      "登録済みまたは選出済みです。",
    );
    r.entries.push(h.id);
    r.ownedIds.push(h.id);
    r.horseId = r.ownedIds[0];
    w.entities[r.id] = r;
    addInvoice(
      w,
      `${r.id}:registration:${h.id}`,
      50000,
      "registration",
      `${r.name} 登録手続費（架空契約・返還なし）`,
    );
    payDue(w);
    consultation.resolution = `${r.date} ${r.name}へ出走の意向`;
    consultation.reason = command.reason.trim();
    c.route = spec.terms.route;
    event(w, id, `${consultation.resolution}。理由「${command.reason}」。`);
  } else if (command.type === "cancel-race") {
    const r = w.entities[command.raceId] as Race;
    check(
      r?.kind === "race" &&
        ["registered", "selected"].includes(r.status) &&
        text(command.reason),
      "取消可能な競走と理由を確認してください。",
    );
    const h = ownedHorse(w)!;
    check(
      raceForHorse(w, h.id)?.id === r.id,
      "この愛馬の出走手続きではありません。",
    );
    if (r.terms) {
      const s = r as SeasonRace;
      s.cancelledIds.push(h.id);
      s.entries = s.entries.filter((x) => x !== h.id);
      s.field = s.field.filter((x) => x !== h.id);
      s.selectionNotes[h.id] = `取消：${command.reason}`;
    } else r.status = "cancelled";
    event(
      w,
      id,
      `${r.name}を取消。理由「${command.reason}」。登録費は返還なし、遠征費は未発生です。`,
    );
    reviewHorse(w, h.id, `${id}:review`);
  } else if (command.type === "settle") {
    const r = w.entities[command.raceId];
    check(
      r?.kind === "race" && r.status === "result" && r.result,
      "未精算の結果がありません。",
    );
    if (r.terms) {
      const s = r as SeasonRace;
      for (const [horseId, award] of Object.entries(s.awards!)) {
        const key = `prize:${r.id}:${horseId}`;
        check(!w.entities[key], "精算済みです。");
        w.entities[key] = {
          kind: "ledger",
          id: key,
          date: w.core.date,
          category: "prize",
          horseId,
          amountYen: award.cashYen,
          description: `${r.name} 本賞金${award.mainYen}円×80%＋架空手当${award.allowanceYen}円`,
        };
        event(
          w,
          `${id}:${horseId}`,
          `${r.name} ${s.dnf?.some((d) => d.horseId === horseId) ? "競走中止" : `${s.finish!.indexOf(horseId) + 1}着`}。収得賞金加算${award.earnedYen.toLocaleString("ja-JP")}円と、馬主受取${award.cashYen.toLocaleString("ja-JP")}円を記録。`,
          horseId,
        );
      }
      r.status = "settled";
      for (const horseId of Object.keys(s.awards!))
        reviewHorse(w, horseId, `${id}:review:${horseId}`);
    } else {
      const selected = c.horseId;
      focusHorse(w, r.horseId);
      w = applyCareer(w, command, id, false);
      rememberPlan(w);
      if (selected) focusHorse(w, selected);
    }
  } else {
    if (command.type === "bid") {
      check(
        (c.life ? livingOwned(w) : horses(w)).length < 12,
        "所有上限12頭です。",
      );
      requireBudget(w, command.limitYen + (horses(w).length ? 1500000 : 0));
    }
    if (command.type === "board")
      check(
        contracts(w).filter((t) => t.trainerId === command.trainerId).length <
          6,
        "この調教師の受入枠6頭が埋まっています。",
      );
    w = applyCareer(w, command, id, false);
    if (command.type === "receive") {
      const cc = w.core.career!;
      cc.route = "turf-mile";
      cc.horseGoal = "この馬と初勝利を";
      cc.annualGoal = "無事にデビューする";
      delete cc.trainerId;
      cc.nextReview = w.core.date;
      cc.reserveYen = horses(w).length * 1500000;
    }
  }
  rememberPlan(w);
  if (finalize) validateWorld(w);
  return w;
}
export function raceAward(r: SeasonRace, id: string) {
  return r.dnf?.some((d) => d.horseId === id)
    ? { mainYen: 0, allowanceYen: 0, cashYen: 0, earnedYen: 0 }
    : awardFor(r, r.finish!.indexOf(id) + 1);
}
export function validateSeasonEntity(
  raw: Record<string, unknown>,
  entities: Record<string, unknown>,
  date: string,
) {
  if (raw.kind === "npc-owner") {
    const e = raw as unknown as NpcOwner;
    check(
      text(e.name, 40) &&
        text(e.policy) &&
        /^#[\da-f]{6}$/i.test(e.silk) &&
        [14, 21, 28].includes(e.spacingDays),
      "NPC馬主が不正です。",
    );
    return;
  }
  if (raw.kind !== "race" || !raw.terms) {
    validateCareerEntity(raw, entities, date);
    return;
  }
  const r = raw as unknown as SeasonRace;
  const spec = program(Number(r.date?.slice(0, 4))).find((p) => p.id === r.id);
  check(spec, "収録番組にない競走です。");
  for (const k of [
    "date",
    "deadline",
    "selectionDate",
    "course",
    "surface",
    "distance",
    "raceClass",
    "name",
  ] as const)
    check(r[k] === spec[k], "競走条件が収録番組と一致しません。");
  check(sameValues(r.terms, spec.terms), "競走条件が収録番組と一致しません。");
  const horse = (id: string) => (entities[id] as Horse)?.kind === "horse";
  for (const ids of [
    r.entries,
    r.field,
    r.ownedIds,
    r.excludedIds,
    r.cancelledIds,
  ])
    check(
      Array.isArray(ids) &&
        new Set(ids).size === ids.length &&
        ids.every(horse),
      "競走の個体参照が不正です。",
    );
  check(
    money(r.applicantCount) &&
      r.field.length <= r.terms.capacity &&
      Number.isSafeInteger(r.seed) &&
      ["registered", "selected", "cancelled", "result", "settled"].includes(
        r.status,
      ) &&
      typeof r.selectionNotes === "object" &&
      r.selectionNotes !== null,
    "競走の状態が不正です。",
  );
  check(
    r.field.every((id) => r.entries.includes(id)) &&
      r.excludedIds.every(
        (id) => r.entries.includes(id) && !r.field.includes(id),
      ) &&
      r.cancelledIds.every(
        (id) => r.ownedIds.includes(id) && !r.field.includes(id),
      ),
    "選出・除外・取消の対応が不正です。",
  );
  check(r.ownedIds.length <= 12 && horse(r.horseId), "所有出走馬が不正です。");
  const done = ["result", "settled"].includes(r.status);
  if (!done) {
    check(
      !r.result &&
        !r.finish &&
        !r.times &&
        !r.awards &&
        r.prizeYen === undefined,
      "未発生の結果です。",
    );
    return;
  }
  check(
    r.date <= date &&
      Array.isArray(r.finish) &&
      r.finish.length === r.field.length &&
      r.finish.length >= 2 &&
      new Set(r.finish).size === r.field.length &&
      r.finish.every((id) => r.field.includes(id)) &&
      Array.isArray(r.times) &&
      r.times.length === r.finish.length &&
      r.times.every(
        (t, i) =>
          Number.isFinite(t) &&
          t >= 40 &&
          t < 400 &&
          (i === 0 ||
            r.dnf?.some((d) => d.horseId === r.finish![i]) ||
            t >= r.times![i - 1]),
      ),
    "着順と時計が不正です。",
  );
  if (r.dnf !== undefined) {
    check(
      Array.isArray(r.dnf) &&
        new Set(r.dnf.map((d) => d.horseId)).size === r.dnf.length &&
        r.dnf.every((d) => {
          const e = entities[
            d.episodeId
          ] as import("./life-types.ts").HealthEpisode;
          return (
            r.field.includes(d.horseId) &&
            Number.isFinite(d.at) &&
            d.at > 0 &&
            d.at < 1 &&
            e?.kind === "health" &&
            e.horseId === d.horseId &&
            e.raceId === r.id
          );
        }) &&
        r.finish
          .slice(r.finish.length - r.dnf.length)
          .every((id) => r.dnf!.some((d) => d.horseId === id)),
      "競走中止の診療記録が不正です。",
    );
  }
  const owned = r.ownedIds.filter((id) => r.field.includes(id));
  check(
    r.awards &&
      typeof r.awards === "object" &&
      Object.keys(r.awards).length === owned.length,
    "賞金の対象が不正です。",
  );
  if (owned.length) {
    check(
      Array.isArray(r.result) &&
        r.result.length === r.field.length &&
        r.result.every(
          (x, i) =>
            x.horseId === r.finish![i] &&
            x.seconds === r.times![i] &&
            x.stoppedAt === r.dnf?.find((d) => d.horseId === x.horseId)?.at &&
            x.episodeId ===
              r.dnf?.find((d) => d.horseId === x.horseId)?.episodeId &&
            text(x.name, 40) &&
            /^#[\da-f]{6}$/i.test(x.coat) &&
            /^#[\da-f]{6}$/i.test(x.silk) &&
            Array.isArray(x.splits) &&
            x.splits.length === 21 &&
            x.splits[0] === 0 &&
            x.splits[20] === x.seconds &&
            x.splits.every(
              (t, j) => Number.isFinite(t) && (j === 0 || t > x.splits[j - 1]),
            ),
        ),
      "再生結果が不正です。",
    );
    check(
      r.prizeYen === owned.reduce((n, id) => n + raceAward(r, id).cashYen, 0),
      "賞金総額が不正です。",
    );
  } else
    check(
      !r.result && r.prizeYen === undefined && r.status === "settled",
      "背景競走の状態が不正です。",
    );
  for (const id of owned) {
    const expected = raceAward(r, id);
    check(sameValues(r.awards[id], expected), "賞金内訳が結果と一致しません。");
    const ledger = entities[`prize:${r.id}:${id}`] as
      import("./world.ts").LedgerEntry | undefined;
    check(
      r.status === "settled"
        ? ledger?.kind === "ledger" &&
            ledger.category === "prize" &&
            ledger.horseId === id &&
            ledger.amountYen === expected.cashYen
        : !ledger,
      "二重精算または賞金台帳の不一致です。",
    );
  }
}
export function validateSeason(w: World) {
  validateCareer(w);
  const c = w.core.career!,
    p = c.portfolio;
  check(
    p &&
      validDate(p.startedDate) &&
      p.startedDate <= w.core.date &&
      Number.isInteger(p.cohortYear) &&
      p.cohortYear === Number(w.core.date.slice(0, 4)) &&
      p.plans &&
      typeof p.plans === "object",
    "通年世界の状態が不正です。",
  );
  const owned = horses(w);
  check(
    owned.length <= 12 && Object.keys(p.plans).length === owned.length,
    "所有と計画が一致しません。",
  );
  for (const h of owned) {
    const plan = p.plans[h.id];
    check(
      plan &&
        validDate(plan.nextReview) &&
        ROUTE_ORDER.includes(plan.route) &&
        text(plan.horseGoal, 80) &&
        text(plan.annualGoal, 80),
      "個別計画が不正です。",
    );
    const cs = contracts(w).filter((x) => x.horseId === h.id);
    check(
      plan.trainerId
        ? cs.length === 1 && cs[0].trainerId === plan.trainerId
        : cs.length === 0,
      "個別預託契約が一致しません。",
    );
    const racing = Object.values(w.entities).filter(
      (e) =>
        e.kind === "race" &&
        ["registered", "selected", "result"].includes(e.status) &&
        (e.terms
          ? (e as SeasonRace).ownedIds.includes(h.id) &&
            !(e as SeasonRace).excludedIds.includes(h.id) &&
            !(e as SeasonRace).cancelledIds.includes(h.id)
          : e.horseId === h.id),
    );
    check(racing.length <= 1, "一頭の出走手続きが重複しています。");
    const pending = Object.values(w.entities).filter(
      (e) => e.kind === "consultation" && e.horseId === h.id && !e.resolution,
    );
    check(
      pending.length <= 1 && !(pending.length && raceForHorse(w, h.id)),
      "未決の相談と出走が重複しています。",
    );
  }
  for (const e of Object.values(w.entities))
    if (e.kind === "horse") {
      const d = e.details!;
      check(
        money(d.earnedYen) &&
          money(d.fans) &&
          ["left", "right"].includes(d.turn!) &&
          Array.isArray(d.awards) &&
          d.awards.every(
            (a) =>
              validDate(a.date) &&
              a.date <= w.core.date &&
              money(a.amountYen) &&
              ["一般", "OP", "GIII", "GII", "GI"].includes(a.grade),
          ),
        "馬の収得賞金・実績が不正です。",
      );
      if (e.id.startsWith("npc:"))
        check(
          w.entities[e.ownerId]?.kind === "npc-owner",
          "NPC所有者が存在しません。",
        );
    }
  if (c.stage === "active" && c.horseId) {
    const plan = p.plans[c.horseId];
    check(
      plan &&
        plan.nextReview === c.nextReview &&
        plan.route === c.route &&
        plan.horseGoal === c.horseGoal &&
        plan.annualGoal === c.annualGoal &&
        plan.trainerId === c.trainerId,
      "選択馬と個別計画が一致しません。",
    );
  }
  if (["active", "boarding"].includes(c.stage))
    check(
      owned.some((h) => h.id === c.horseId),
      "選択中の所有馬がいません。",
    );
  if (c.stage === "purchase")
    check(
      w.entities[c.horseId!]?.kind === "horse" &&
        Object.values(w.entities).some(
          (e) =>
            e.kind === "invoice" &&
            e.category === "purchase" &&
            !e.paid &&
            e.horseId === c.horseId,
        ),
      "購入中の債務がありません。",
    );
  for (const t of Object.keys(TRAINERS))
    check(
      contracts(w).filter((x) => x.trainerId === t).length <= 6,
      "預託枠を超えています。",
    );
  for (const e of Object.values(w.entities))
    if (e.kind === "race" && e.terms)
      check(
        (e as SeasonRace).ownedIds.every((id) =>
          owned.some((h) => h.id === id),
        ),
        "所有馬の出走参照が不正です。",
      );
}
