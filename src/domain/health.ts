import { contracts } from "./finance.ts";
import { nextDate, type World, type Horse } from "./world.ts";
import { hash, random } from "./catalog.ts";
import type { HealthCause, HealthEpisode } from "./life-types.ts";
import type { RaceResult } from "./career-types.ts";
import type { SeasonRace } from "./season-types.ts";
import {
  activeEpisode,
  bill,
  cancelPlans,
  confirmDeath,
  initializeLife,
  invalidatePlacement,
  scene,
  tracked,
  trainable,
} from "./life-support.ts";

// Rates are experimental game coefficients. The CMI reference is JRA 2013–2017;
// colic is an off-track US 1998–1999 population, not current Japanese racers.
export const HEALTH_MODEL = {
  raceFatal: 0.00114,
  raceSoreness: 0.009,
  raceTendon: 0.0025,
  raceFracture: 0.002,
  colicPerYear: 0.042,
  colicFatality: 0.11,
  trainingSorenessPerYear: 0.06,
  trainingTendonPerYear: 0.015,
  pastureFracturePerYear: 0.003,
} as const;
export const DIAGNOSES: Record<
  HealthCause,
  { name: string; days: number; cost: number }
> = {
  soreness: { name: "運動器の炎症", days: 28, cost: 80000 },
  tendon: { name: "屈腱の損傷", days: 180, cost: 250000 },
  fracture: {
    name: "骨折（生存の見通しと競走復帰は別に評価）",
    days: 120,
    cost: 600000,
  },
  catastrophic: {
    name: "重度の運動器損傷・生命予後不良",
    days: 0,
    cost: 150000,
  },
  colic: { name: "疝痛を伴う疾病", days: 21, cost: 200000 },
  foaling: { name: "分娩時の母馬の診療", days: 42, cost: 300000 },
  neonatal: { name: "出生後の仔の診療", days: 30, cost: 200000 },
  stillbirth: { name: "死産の確認", days: 0, cost: 0 },
  "pregnancy-loss": { name: "妊娠喪失後の母馬の診療", days: 21, cost: 100000 },
  checkup: { name: "状態確認の診察", days: 3, cost: 30000 },
};
export function raceCause(
  value: number,
  scale = 1,
  recurrent = false,
): HealthCause | undefined {
  let edge = 0;
  for (const [cause, rate] of [
    ["catastrophic", HEALTH_MODEL.raceFatal],
    ["tendon", HEALTH_MODEL.raceTendon],
    ["fracture", HEALTH_MODEL.raceFracture],
    ["soreness", HEALTH_MODEL.raceSoreness],
  ] as [HealthCause, number][]) {
    edge += rate * scale * (cause === "tendon" && recurrent ? 1.75 : 1);
    if (value < edge) return cause;
  }
}
export function dailyCause(
  value: number,
  active: boolean,
  scale = 1,
  recurrent = false,
): HealthCause | undefined {
  let edge = 0;
  const rates: [HealthCause, number][] = [
    ["colic", HEALTH_MODEL.colicPerYear],
    ...(active
      ? ([
          ["soreness", HEALTH_MODEL.trainingSorenessPerYear],
          ["tendon", HEALTH_MODEL.trainingTendonPerYear],
        ] as [HealthCause, number][])
      : ([["fracture", HEALTH_MODEL.pastureFracturePerYear]] as [
          HealthCause,
          number,
        ][])),
  ];
  for (const [cause, rate] of rates) {
    edge +=
      1 -
      Math.exp(
        (-rate * scale * (cause === "tendon" && recurrent ? 1.75 : 1)) / 365,
      );
    if (value < edge) return cause;
  }
}
export function beginEpisode(
  w: World,
  h: Horse,
  cause: HealthCause,
  origin: HealthEpisode["origin"],
  raceId?: string,
) {
  const id = `health:${h.id}:${w.core.date}:${origin}`;
  const old = w.entities[id];
  if (old?.kind === "health") return old;
  const roll = random(hash(id + ":outcome", w.core.worldSeed))();
  const outcome =
    cause === "catastrophic" ||
    (cause === "colic" && roll < HEALTH_MODEL.colicFatality)
      ? "death"
      : (cause === "tendon" && roll < 0.55) ||
          (cause === "fracture" && roll < 0.35)
        ? "limited"
        : "recover";
  const e: HealthEpisode = {
    kind: "health",
    id,
    horseId: h.id,
    date: w.core.date,
    origin,
    cause,
    ...(raceId ? { raceId } : {}),
    phase: "assessment",
    outcome,
    dueDate: nextDate(
      w.core.date,
      cause === "colic" ? 1 : cause === "checkup" ? 3 : 2,
    ),
    diagnosis:
      cause === "checkup"
        ? "診察を依頼しました。結果を待っています。"
        : "異常を確認し、委託契約に基づく初期対応を実施しました。診断と予後の確認を待っています。",
    prognosis: "初期所見だけで復帰時期や生命予後を断定しません。",
    review: 0,
    secondOpinion: false,
    acknowledged: false,
  };
  if (cause === "tendon") {
    if (h.life!.tendonHistoryId) e.recurrenceOf = h.life!.tendonHistoryId;
    h.life!.tendonHistoryId = id;
  }
  w.entities[id] = e;
  h.life!.episodeId = id;
  cancelPlans(w, h, "診療のため予定を見直します。", raceId);
  if (cause !== "checkup")
    invalidatePlacement(w, h, "診療のため手続きを見直します。");
  bill(
    w,
    h,
    `${id}:initial`,
    cause === "checkup" ? 30000 : 50000,
    cause === "checkup"
      ? "追加診察（架空契約）"
      : "異常時の初期診察・連絡（架空契約）",
  );
  scene(
    w,
    `${id}:contact`,
    h,
    contracts(w).find((c) => c.horseId === h.id)?.providerId ??
      h.life!.lastTrainer ??
      w.core.career!.portfolio!.plans[h.id]?.trainerId ??
      "forest",
    "care",
    [id],
    `${h.name}の${origin === "race" ? "競走中・競走後" : origin === "pasture" ? "牧場での生活中" : origin === "training" ? "調整中" : origin === "checkup" ? "状態確認" : "体調"}について連絡しました。${e.diagnosis}目標より先に、今分かることと分からないことを共有します。`,
  );
  if (cause === "catastrophic") {
    e.diagnosis = DIAGNOSES[cause].name;
    e.prognosis =
      "獣医師が救命の見通しと苦痛を評価し、生命予後を極めて厳しいと判断しました。";
    confirmDeath(w, h, e, "euthanasia", raceId);
  }
  return e;
}
export function startRehab(
  w: World,
  e: HealthEpisode,
  choice: "rehab" | "retire",
  reason: string,
) {
  const h = w.entities[e.horseId] as Horse;
  e.phase = "rehab";
  e.choice = choice;
  e.reason = reason;
  e.acknowledged = true;
  e.dueDate = nextDate(w.core.date, DIAGNOSES[e.cause].days);
  e.prognosis = `療養後の再評価は${e.dueDate}です。改善・遅延・競走復帰を断念する転帰があり、費用の支払いで復帰は確定しません。`;
  bill(
    w,
    h,
    `${e.id}:treatment`,
    DIAGNOSES[e.cause].cost,
    "診断に基づく治療・療養開始（架空契約）",
  );
}
export function healthDay(w: World) {
  initializeLife(w);
  let stop = false;
  const day = w.core.date;
  for (const h of Object.values(w.entities).filter(
    (e): e is Horse => e.kind === "horse" && tracked(w, e),
  )) {
    if (h.life!.deceased) continue;
    const e = activeEpisode(w, h),
      owned = h.ownerId === w.core.owner.id;
    if (e && ["assessment", "rehab"].includes(e.phase) && e.dueDate! <= day) {
      if (e.phase === "assessment") {
        e.diagnosis =
          DIAGNOSES[e.cause].name +
          (e.recurrenceOf ? "（同じ馬の過去の屈腱損傷後に再発）" : "");
        if (e.outcome === "death") {
          e.prognosis = "病状が急変し、生命予後が極めて厳しい状態です。";
          confirmDeath(w, h, e, hash(e.id) % 2 ? "natural" : "euthanasia");
        } else if (e.cause === "checkup") {
          e.phase = "cleared";
          e.closedDate = day;
          delete e.dueDate;
          e.acknowledged = true;
          e.diagnosis =
            "今回の診察では、追加の出走制限を要する異常は認められませんでした。";
          e.prognosis =
            "観察日時点の所見です。将来の無事故や勝利を保証するものではありません。";
        } else {
          e.phase = "decision";
          delete e.dueDate;
          e.prognosis = `生命を保ったまま療養する見通しがあります。競走復帰は未確定で、目安${DIAGNOSES[e.cause].days}日後に再評価します。`;
          if (!owned)
            startRehab(w, e, "rehab", "NPC馬主が診療提案に沿って療養");
        }
      } else if (
        e.review === 0 &&
        random(hash(e.id + ":delay", w.core.worldSeed))() < 0.25
      ) {
        e.review = 1;
        e.dueDate = nextDate(day, 30);
        e.prognosis = `回復の評価をもう30日継続します。再評価は${e.dueDate}。待機期間の延長で復帰が確定するわけではありません。`;
        bill(w, h, `${e.id}:recheck`, 30000, "療養の再評価（架空契約）");
      } else {
        e.phase = e.outcome === "limited" ? "limited" : "cleared";
        e.closedDate = day;
        delete e.dueDate;
        e.acknowledged = !owned || e.phase === "cleared";
        if (e.phase === "limited") {
          h.life!.racing = "barred";
          h.details!.registered = false;
          e.prognosis =
            "生存して生活を続ける見通しはありますが、競走復帰は勧められません。引退後の継続的なケアと受入先を相談してください。";
        } else
          e.prognosis =
            "今回の再評価で、段階的な調整へ戻ることが可能と判断されました。帰厩・在厩期間と回復を確かめて再開します。";
      }
      scene(
        w,
        `${e.id}:review:${e.phase}:${e.review}:${day}`,
        h,
        "vet",
        "care",
        [e.id],
        `${h.name}の再評価。${e.diagnosis} ${e.prognosis}`,
      );
      stop ||= owned;
      continue;
    }
    if (e && !["cleared", "limited"].includes(e.phase)) continue;
    // NPC retirement limits active fields while retaining every individual and its history.
    const age = Number(day.slice(0, 4)) - Number(h.birthDate.slice(0, 4));
    if (!owned && h.life!.racing === "active" && age >= 7 + (hash(h.id) % 4)) {
      h.life!.racing = "retired";
      h.details!.registered = false;
      h.location = "NPC馬主の余生預託";
      cancelPlans(w, h, "NPC馬主が競走引退を決定");
    }
    // The first 30 days use the separate neonatal model; do not add adult daily hazards.
    if (h.family?.birthCycleId && day <= nextDate(h.birthDate, 30)) continue;
    const training = trainable(w, h);
    const cause = dailyCause(
      random(hash(`${h.id}:${day}:daily-health`, w.core.worldSeed))(),
      training,
      1,
      !!h.life!.tendonHistoryId,
    );
    if (cause) {
      beginEpisode(
        w,
        h,
        cause,
        cause === "colic" ? "illness" : training ? "training" : "pasture",
      );
      stop ||= owned;
    }
  }
  return stop;
}
export function raceHealth(w: World, r: SeasonRace, result: RaceResult[]) {
  if (!w.core.career?.life) return result;
  r.dnf = [];
  for (const row of result) {
    const h = w.entities[row.horseId] as Horse;
    const cause = raceCause(
      random(hash(`${r.id}:${h.id}:race-health`, w.core.worldSeed))(),
      1,
      !!h.life!.tendonHistoryId,
    );
    if (!cause) continue;
    const e = beginEpisode(w, h, cause, "race", r.id);
    if (
      cause === "catastrophic" ||
      cause === "fracture" ||
      random(hash(e.id + ":stop", w.core.worldSeed))() < 0.35
    ) {
      row.stoppedAt =
        0.35 + random(hash(e.id + ":position", w.core.worldSeed))() * 0.45;
      row.episodeId = e.id;
      r.dnf.push({ horseId: h.id, episodeId: e.id, at: row.stoppedAt });
    }
  }
  return result.sort(
    (a, b) =>
      Number(a.stoppedAt !== undefined) - Number(b.stoppedAt !== undefined) ||
      a.seconds - b.seconds ||
      a.horseId.localeCompare(b.horseId),
  );
}
