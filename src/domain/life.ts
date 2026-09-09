import {
  cash,
  horses,
  nextDate,
  validDate,
  validateWorld,
  type World,
  type Horse,
  type Command,
} from "./world.ts";
import {
  createSeason,
  upgradeSeason,
  applySeason,
  focusHorse,
  rememberPlan,
  raceForHorse,
  validateSeasonEntity,
} from "./season.ts";
import { event, openConsultation, validateCareer } from "./career.ts";
import { contracts, debt, invoices, payDue } from "./finance.ts";
import { TRAINERS, ROUTES } from "./catalog.ts";
import {
  activeEpisode,
  assertLife as check,
  bill,
  cancelPlans,
  closeHorseContracts,
  FARMS,
  initializeLife,
  invalidatePlacement,
  livingOwned,
  personName,
  requireCash,
  scene,
} from "./life-support.ts";
import { beginEpisode, DIAGNOSES, healthDay, startRehab } from "./health.ts";
import {
  moveHorse,
  placementDay,
  saleResponse,
  seekBuyer,
  placementReasons,
} from "./placements.ts";
import type { HealthEpisode, Placement, Scene } from "./life-types.ts";
import type { SeasonRace } from "./season-types.ts";
const text = (x: unknown, max = 200): x is string =>
  typeof x === "string" && x.trim().length > 0 && x.length <= max;
const money = (x: unknown): x is number =>
  Number.isSafeInteger(x) && (x as number) >= 0 && (x as number) <= 1e12;
export function upgradeLife(world: World, id: string) {
  check(!world.core.career?.life, "P4へ引継ぎ済みです。");
  const w = world.core.career?.portfolio
    ? structuredClone(world)
    : upgradeSeason(world, `${id}:season`);
  w.core.engineVersion = "owner-p4";
  w.core.rulesetVersion = "life-2026";
  w.core.career!.life = { startedDate: w.core.date };
  initializeLife(w);
  for (const h of horses(w)) {
    const c = contracts(w).find((c) => c.horseId === h.id);
    if (c?.trainerId) h.life!.lastTrainer = c.trainerId;
  }
  event(
    w,
    id,
    "P4へ引継ぎました。今後の診療・進退・人物との場面を記録します。委託先の緊急初期対応と生命予後不良時の専門家判断を事前合意とし、必要費用は契約に従って精算します。過去の健康を遡って抽選しません。",
    undefined,
  );
  if (w.core.career!.stage === "ended")
    closeCareer(w, "以前の活動終了を引継ぎ", `${id}:closure`);
  validateWorld(w);
  return w;
}
export function createLife(...args: Parameters<typeof createSeason>) {
  return upgradeLife(createSeason(...args), "initial-life");
}
export function lifeBeforeDay(w: World) {
  return placementDay(w) || false;
}
export function lifeHealthDay(w: World) {
  return healthDay(w);
}
export function lifeAfterRace(w: World, r: SeasonRace) {
  for (const id of r.ownedIds) {
    if (!r.field.includes(id)) continue;
    const h = w.entities[id] as Horse;
    const past = Object.values(w.entities).filter(
      (e): e is SeasonRace =>
        e.kind === "race" &&
        !!e.terms &&
        e.id !== r.id &&
        e.date < r.date &&
        !!(e as SeasonRace).finish &&
        e.field.includes(id),
    );
    const previous = past
      .sort((a, b) => b.date.localeCompare(a.date))
      .find((p) =>
        p.field.some(
          (pid) =>
            pid !== id &&
            r.field.includes(pid) &&
            w.entities[(w.entities[pid] as Horse).ownerId]?.kind ===
              "npc-owner",
        ),
      );
    if (!previous) continue;
    const rivalId = previous.field.find(
      (pid) =>
        pid !== id &&
        r.field.includes(pid) &&
        w.entities[(w.entities[pid] as Horse).ownerId]?.kind === "npc-owner",
    )!;
    const rival = w.entities[rivalId] as Horse;
    scene(
      w,
      `reunion:${r.date.slice(0, 4)}:${id}:${rivalId}`,
      h,
      rival.ownerId,
      "reunion",
      [previous.id, r.id],
      `${rival.name}と${h.name}は${previous.date}の${previous.name}以来の対戦でした。こちらも同じ馬と日々を重ねています。${r.dnf?.some((x) => x.horseId === id || x.horseId === rivalId) ? "今回は競走を中止した馬がいます。まず診療の報告を待ちましょう。" : "一度の勝敗だけでは、互いの先は決まりません。また条件が合う日に。"}`,
    );
  }
  for (const id of r.field) {
    const h = w.entities[id] as Horse;
    if (
      h.ownerId === w.core.owner.id ||
      !h.life?.owners.some((o) => o.ownerId === w.core.owner.id)
    )
      continue;
    scene(
      w,
      `former:${r.date.slice(0, 7)}:${id}`,
      h,
      h.ownerId,
      "sale",
      [r.id],
      `${h.name}の近況です。${r.date}の${r.name}へ出走しました。${r.dnf?.some((d) => d.horseId === id) ? "競走を中止し、診療を進めています。" : `${r.finish!.indexOf(id) + 1}着でした。`}以前の所有期間もこの馬の経歴として引き継いでいます。`,
    );
  }
}
export function lifeYearEnd(w: World) {
  if (w.core.date.slice(5) !== "12-31") return;
  const year = w.core.date.slice(0, 4);
  for (const h of horses(w)) {
    const events = Object.values(w.entities).filter(
      (e) =>
        "date" in e &&
        e.date.startsWith(year) &&
        "horseId" in e &&
        e.horseId === h.id,
    );
    const decisions = events.filter(
      (e) => e.kind === "consultation" && e.resolution,
    );
    const races = Object.values(w.entities).filter(
      (e) =>
        e.kind === "race" &&
        e.date.startsWith(year) &&
        ["result", "settled"].includes(e.status) &&
        e.field.includes(h.id),
    );
    const care = events.filter((e) => e.kind === "health");
    const paid = events
      .filter((e) => e.kind === "ledger" && e.amountYen < 0)
      .reduce((n, e) => n + (e.kind === "ledger" ? -e.amountYen : 0), 0);
    const p = w.core.career!.portfolio!.plans[h.id];
    const prev = decisions.at(-1);
    scene(
      w,
      `annual-life:${year}:${h.id}`,
      h,
      h.life!.lastTrainer ?? "forest",
      "annual",
      [
        ...new Set(
          [...races.slice(-3), ...decisions.slice(-3), ...care.slice(-3)]
            .map((e) => e.id)
            .concat(h.life!.deceased ? [h.life!.deceased.episodeId] : []),
        ),
      ],
      `${year}年の${h.name}。出走${races.length}回、相談${decisions.length}件、診療${care.length}件。支払った費用は${paid.toLocaleString("ja-JP")}円でした。${prev?.kind === "consultation" ? `最後の合意は「${prev.resolution}」、理由は「${prev.reason}」。` : ""}${h.life!.deceased ? (h.life!.deceased.date.startsWith(year) ? "別れの年になりました。結果から、当時の判断を一律に誤りとは扱いません。" : `${h.life!.deceased.date}に亡くなってからも、共に過ごした日々の記録は残っています。`) : h.life!.racing !== "active" ? "競走を離れた後の生活も、同じ馬の一年です。" : `「${p.horseGoal}」という願いを、来年も継ぐか変えるか、また話しましょう。`}`,
    );
  }
}
function own(w: World, id: string) {
  const h = w.entities[id];
  check(
    h?.kind === "horse" && h.ownerId === w.core.owner.id,
    "現在の所有馬を選んでください。",
  );
  return h;
}
function closeCareer(w: World, reason: string, id: string) {
  for (const h of horses(w)) {
    cancelPlans(w, h, "馬主活動の終了に伴う予定取消");
    invalidatePlacement(w, h, "活動終了時点で未完了");
    closeHorseContracts(w, h);
  }
  payDue(w);
  const c = w.core.career!;
  c.stage = "ended";
  c.pause = "活動終了：" + reason;
  c.life!.closure = {
    date: w.core.date,
    cashYen: cash(w),
    debtYen: debt(w),
    unplacedIds: livingOwned(w).map((h) => h.id),
    reason,
  };
  event(
    w,
    id,
    "馬主活動を終了しました。既発生の債務を保管し、未成立の売却は入金にしていません。所有を続ける馬の今後の飼養先・資金は未解決で、生涯を保証する記録ではありません。",
    undefined,
  );
}
export function applyLife(world: World, command: Command, id: string) {
  let w = structuredClone(world);
  rememberPlan(w);
  check(
    w.core.career!.stage !== "ended" ||
      ["select-horse", "remember"].includes(command.type),
    "活動を終了した経歴です。生涯の記録を閲覧できます。",
  );
  const reason = "reason" in command ? command.reason : "";
  if (
    [
      "examine",
      "second-opinion",
      "care-plan",
      "move-horse",
      "seek-buyer",
      "sale-response",
      "extend-payment",
      "end-career",
    ].includes(command.type)
  )
    check(text(reason), "判断の理由を入力してください。");
  if (command.type === "examine") {
    const h = own(w, command.horseId),
      e = activeEpisode(w, h);
    check(
      !h.life!.deceased &&
        (!e || ["cleared", "limited"].includes(e.phase)) &&
        !raceForHorse(w, h.id),
      "現在の診療と競走手続きを確認してください。",
    );
    requireCash(w, 30000);
    beginEpisode(w, h, "checkup", "checkup");
  } else if (command.type === "second-opinion") {
    const e = w.entities[command.episodeId];
    check(
      e?.kind === "health" && e.phase === "decision" && !e.secondOpinion,
      "追加所見は判断待ちの診療について一度だけ依頼できます。",
    );
    const h = own(w, e.horseId);
    requireCash(w, 50000);
    bill(
      w,
      h,
      `${e.id}:opinion`,
      50000,
      "同じ検査記録への追加所見（架空契約）",
    );
    e.secondOpinion = true;
    e.phase = "assessment";
    e.dueDate = nextDate(w.core.date, 3);
    e.prognosis =
      "同じ診療記録を別の所見で確認しています。健康状態を引き直す検査ではありません。";
  } else if (command.type === "care-plan") {
    const e = w.entities[command.episodeId];
    check(
      e?.kind === "health" && ["decision", "limited"].includes(e.phase),
      "診療の判断待ち・復帰不可の報告を確認してください。",
    );
    const h = own(w, e.horseId);
    check(!h.life!.deceased, "死亡後の療養契約はできません。");
    if (e.phase === "limited")
      check(
        command.choice === "retire",
        "競走復帰を断念した馬は引退後のケアを相談してください。",
      );
    const purpose = command.choice === "rehab" ? "rehab" : "retirement";
    const existing = contracts(w).find(
      (c) =>
        c.horseId === h.id &&
        c.providerId === command.providerId &&
        c.purpose === purpose,
    );
    const farm = FARMS[command.providerId as keyof typeof FARMS];
    check(farm, "療養を受け入れる牧場を選んでください。");
    const reasons = placementReasons(w, h, purpose, command.providerId).filter(
      (x) => !existing || x !== "同じ預託契約で生活しています。",
    );
    check(!reasons.length, reasons.join(" "));
    requireCash(
      w,
      (e.phase === "decision" ? DIAGNOSES[e.cause].cost : 0) +
        (existing
          ? 0
          : 150000 + (purpose === "rehab" ? farm.rehab : farm.limited)),
    );
    if (e.phase === "decision") startRehab(w, e, command.choice, reason);
    else e.acknowledged = true;
    if (existing)
      scene(
        w,
        `${id}:care`,
        h,
        command.providerId,
        "care",
        [e.id, existing.id],
        `${h.name}は現在の預託先で療養を続けます。理由「${reason}」。再評価日と費用を確認しました。`,
      );
    else moveHorse(w, h, purpose, command.providerId, reason, id);
  } else if (command.type === "acknowledge-health") {
    const e = w.entities[command.episodeId];
    check(
      e?.kind === "health" &&
        ["dead", "limited"].includes(e.phase) &&
        !e.acknowledged,
      "未確認の診療報告がありません。",
    );
    own(w, e.horseId);
    e.acknowledged = true;
  } else if (command.type === "move-horse") {
    const h = own(w, command.horseId),
      e = activeEpisode(w, h);
    check(
      !e || ["cleared", "limited"].includes(e.phase),
      "診療方針の相談から療養先を選んでください。",
    );
    moveHorse(w, h, command.purpose, command.providerId, reason, id);
  } else if (command.type === "seek-buyer")
    seekBuyer(w, own(w, command.horseId), reason, id);
  else if (command.type === "sale-response") {
    const p = w.entities[command.placementId];
    check(p?.kind === "placement", "売却手続きがありません。");
    own(w, p.horseId);
    saleResponse(w, p, command.accept, reason);
  } else if (command.type === "extend-payment") {
    const e = w.entities[command.invoiceId];
    check(
      e?.kind === "invoice" &&
        !e.paid &&
        !e.deferral &&
        e.amountYen <= 2000000 &&
        e.dueDate >= nextDate(w.core.date, -14),
      "猶予の条件は未払200万円以内・1請求1回・期限超過14日以内です。",
    );
    const h = w.entities[e.horseId] as Horse,
      contract = w.entities[e.contractId ?? ""];
    const creditor =
      contract?.kind === "contract"
        ? (contract.providerId ?? contract.trainerId ?? "vet")
        : "vet";
    e.deferral = {
      originalDue: e.dueDate,
      agreedDate: w.core.date,
      creditor,
      reason,
    };
    e.dueDate = nextDate(e.dueDate > w.core.date ? e.dueDate : w.core.date, 14);
    scene(
      w,
      `${id}:agreement`,
      h,
      creditor,
      "payment",
      [e.id],
      `請求${e.amountYen.toLocaleString("ja-JP")}円について、${e.dueDate}までの一回の猶予で合意しました。「${reason}」という状況を記録します。免除ではなく、この日に再確認します。`,
    );
  } else if (command.type === "remember") {
    const e = w.entities[command.sceneId];
    check(
      e?.kind === "scene" && text(command.text, 400),
      "場面と400文字以内の言葉を確認してください。",
    );
    e.reply = command.text.trim();
    e.replyDate = w.core.date;
  } else if (command.type === "end-career") closeCareer(w, reason, id);
  else {
    const consultation = openConsultation(w);
    if (command.type === "consult") {
      const h = own(w, w.core.career!.horseId!);
      check(
        !h.life!.deceased && h.life!.racing === "active",
        "この馬の診療・進退を確認してください。",
      );
    }
    w = applySeason(w, command, id, false);
    initializeLife(w);
    if (command.type === "receive") {
      const h = own(w, w.core.career!.horseId!),
        last = h.life!.owners.at(-1)!;
      if (last.ownerId !== h.ownerId) {
        last.to = w.core.date;
        h.life!.owners.push({ ownerId: h.ownerId, from: w.core.date });
      }
    }
    if (command.type === "board") {
      const h = own(w, w.core.career!.horseId!);
      h.life!.lastTrainer = command.trainerId;
    }
    if (command.type === "consult" && consultation) {
      const h = w.entities[consultation.horseId] as Horse;
      const c = w.entities[consultation.id];
      if (c?.kind === "consultation")
        scene(
          w,
          `${id}:scene`,
          h,
          c.trainerId,
          "agreement",
          [c.id, id],
          `${c.trainerId === "saeki" ? "先を急がず、一頭を長く見たいと思っています。" : "この馬が挑める機会を、今の状態から一緒に選びたいです。"}${c.previous} 今回は「${c.resolution}」。理由「${c.reason}」を覚えて、次の所見に繋げます。`,
        );
    }
  }
  w.core.career!.reserveYen = livingOwned(w).length * 1500000;
  rememberPlan(w);
  validateWorld(w);
  return w;
}
export function validateLifeEntity(
  raw: Record<string, unknown>,
  entities: Record<string, unknown>,
  date: string,
) {
  const e = raw as unknown as HealthEpisode | Placement | Scene;
  if (!["health", "placement", "scene"].includes(e.kind)) {
    validateSeasonEntity(raw, entities, date);
    return;
  }
  check(
    (entities[e.horseId] as Horse)?.kind === "horse" &&
      validDate(e.date) &&
      e.date <= date,
    "生涯記録の個体・日付が不正です。",
  );
  if (e.kind === "health") {
    check(
      Object.hasOwn(DIAGNOSES, e.cause) &&
        ["race", "training", "pasture", "illness", "checkup"].includes(
          e.origin,
        ) &&
        [
          "assessment",
          "decision",
          "rehab",
          "cleared",
          "limited",
          "dead",
        ].includes(e.phase) &&
        ["recover", "limited", "death"].includes(e.outcome) &&
        text(e.diagnosis, 1000) &&
        text(e.prognosis, 1000) &&
        [0, 1].includes(e.review) &&
        typeof e.secondOpinion === "boolean" &&
        typeof e.acknowledged === "boolean",
      "診療の状態が不正です。",
    );
    check(
      ["assessment", "rehab"].includes(e.phase)
        ? validDate(e.dueDate) && e.dueDate > date
        : e.dueDate === undefined,
      "診療の再評価日が不正です。",
    );
    if (["cleared", "limited", "dead"].includes(e.phase))
      check(
        validDate(e.closedDate) &&
          e.closedDate >= e.date &&
          e.closedDate <= date,
        "診療転帰の日付が不正です。",
      );
    if (e.raceId)
      check(
        (entities[e.raceId] as SeasonRace)?.kind === "race",
        "診療の競走参照がありません。",
      );
    if (e.phase === "dead")
      check(
        e.outcome === "death" &&
          (entities[e.horseId] as Horse).life?.deceased?.episodeId === e.id,
        "死亡転帰が診療と一致しません。",
      );
    if (e.phase === "cleared")
      check(e.outcome === "recover", "回復転帰が診療と一致しません。");
    if (e.recurrenceOf) {
      const prev = entities[e.recurrenceOf] as HealthEpisode;
      check(
        e.cause === "tendon" &&
          prev?.kind === "health" &&
          prev.cause === "tendon" &&
          prev.horseId === e.horseId &&
          prev.date < e.date,
        "再発の根拠が不正です。",
      );
    }
    if (e.phase === "limited")
      check(e.outcome === "limited", "復帰断念が診療と一致しません。");
  } else if (e.kind === "placement") {
    check(
      ["rest", "rehab", "retirement", "training", "sale"].includes(e.purpose) &&
        [
          "searching",
          "offered",
          "unavailable",
          "moving",
          "completed",
          "cancelled",
        ].includes(e.status) &&
        validDate(e.dueDate) &&
        e.dueDate >= e.date &&
        text(e.reason, 600),
      "移動・売却の契約が不正です。",
    );
    if (e.status === "moving" || e.status === "completed")
      check(text(e.targetId), "引受先がありません。");
    if (
      e.purpose === "sale" &&
      ["offered", "moving", "completed"].includes(e.status)
    )
      check(
        money(e.priceYen) &&
          (entities[e.targetId!] as { kind: string })?.kind === "npc-owner",
        "売却の提示条件が不正です。",
      );
    if (e.purpose === "sale" && e.status === "completed") {
      const ledger = entities[`sale:${e.id}`] as {
        kind: string;
        amountYen: number;
        horseId: string;
      };
      check(
        ledger?.kind === "ledger" &&
          ledger.amountYen === e.priceYen &&
          ledger.horseId === e.horseId,
        "引渡しと売却代金が一致しません。",
      );
    } else check(!entities[`sale:${e.id}`], "未成立の売却代金です。");
  } else {
    check(
      text(e.personId) &&
        text(e.text, 1800) &&
        [
          "care",
          "agreement",
          "transfer",
          "retirement",
          "loss",
          "reunion",
          "annual",
          "sale",
          "payment",
        ].includes(e.trigger) &&
        Array.isArray(e.evidenceIds) &&
        e.evidenceIds.length <= 12 &&
        e.evidenceIds.every((id) => !!entities[id]),
      "人物の記憶の根拠が不正です。",
    );
    if (e.reply !== undefined)
      check(
        text(e.reply, 400) &&
          validDate(e.replyDate) &&
          e.replyDate >= e.date &&
          e.replyDate <= date,
        "場面に残した言葉が不正です。",
      );
  }
}
export function validateLife(w: World) {
  validateCareer(w);
  const c = w.core.career!,
    p = c.portfolio;
  check(
    c.life &&
      validDate(c.life.startedDate) &&
      c.life.startedDate <= w.core.date &&
      p &&
      validDate(p.startedDate) &&
      p.startedDate <= w.core.date &&
      p.plans &&
      typeof p.plans === "object" &&
      p.cohortYear === Number(w.core.date.slice(0, 4)),
    "生涯経営の開始・暦が不正です。",
  );
  const activeContracts = contracts(w);
  const contractsByHorse = new Map<string, typeof activeContracts>();
  for (const c of activeContracts)
    contractsByHorse.set(c.horseId, [
      ...(contractsByHorse.get(c.horseId) ?? []),
      c,
    ]);
  const owned = horses(w);
  check(
    livingOwned(w).length <= 12 && Object.keys(p.plans).length === owned.length,
    "所有馬と個別計画が一致しません。",
  );
  for (const h of Object.values(w.entities).filter(
    (e): e is Horse => e.kind === "horse",
  )) {
    const d = h.details!;
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
      "収得賞金・実績が不正です。",
    );
    const l = h.life;
    check(
      l &&
        ["active", "retired", "barred"].includes(l.racing) &&
        Array.isArray(l.owners) &&
        l.owners.length > 0 &&
        l.owners.at(-1)!.ownerId === h.ownerId,
      "個体の所有・競走状態が不正です。",
    );
    for (const [i, o] of l.owners.entries())
      check(
        text(o.ownerId) &&
          validDate(o.from) &&
          o.from <= w.core.date &&
          (i === l.owners.length - 1
            ? o.to === undefined
            : validDate(o.to) &&
              o.to >= o.from &&
              o.to === l.owners[i + 1].from),
        "所有履歴が不正です。",
      );
    const cs = contractsByHorse.get(h.id) ?? [];
    check(cs.length <= 1, "預託契約が重複しています。");
    if (l.tendonHistoryId) {
      const e = w.entities[l.tendonHistoryId];
      check(
        e?.kind === "health" && e.cause === "tendon" && e.horseId === h.id,
        "屈腱損傷の履歴が不正です。",
      );
    }
    if (l.episodeId)
      check(
        w.entities[l.episodeId]?.kind === "health" &&
          (w.entities[l.episodeId] as HealthEpisode).horseId === h.id,
        "診療の個体参照が不正です。",
      );
    if (activeEpisode(w, h)?.phase === "limited")
      check(
        l.racing === "barred",
        "競走復帰不可の診療と競走資格が一致しません。",
      );
    if (l.deceased) {
      const e = w.entities[l.deceased.episodeId];
      check(
        validDate(l.deceased.date) &&
          l.deceased.date <= w.core.date &&
          ["natural", "euthanasia"].includes(l.deceased.mode) &&
          e?.kind === "health" &&
          e.phase === "dead" &&
          e.closedDate === l.deceased.date &&
          cs.length === 0 &&
          !h.details!.registered &&
          !l.movementId &&
          !l.saleId,
        "死亡・予定・契約が一致しません。",
      );
    }
    if (l.racing !== "active")
      check(
        !h.details!.registered,
        "競走引退・復帰不可の馬が登録されています。",
      );
    for (const key of ["movementId", "saleId"] as const)
      if (l[key]) {
        const e = w.entities[l[key]!];
        check(
          e?.kind === "placement" &&
            e.horseId === h.id &&
            ["searching", "offered", "moving"].includes(e.status),
          "進行中の移動・売却が不正です。",
        );
      }
    if (h.ownerId !== w.core.owner.id) {
      check(cs.length === 0, "他人の馬の預託費を請求しています。");
      continue;
    }
    const plan = p.plans[h.id];
    check(
      plan &&
        validDate(plan.nextReview) &&
        text(plan.horseGoal, 80) &&
        text(plan.annualGoal, 80) &&
        plan.route in ROUTES,
      "個別計画が不正です。",
    );
    check(plan.trainerId === cs[0]?.trainerId, "調教師と契約が一致しません。");
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
      "未決相談と競走が重複しています。",
    );
    if (l.deceased || l.racing !== "active")
      check(
        pending.length === 0,
        "競走を続けない馬に未決の出走相談があります。",
      );
  }
  for (const contract of contracts(w))
    check(
      contract.emergencyConsent === true &&
        ["training", "rest", "rehab", "retirement"].includes(
          contract.purpose!,
        ) &&
        contract.providerId,
      "P4預託の事前合意がありません。",
    );
  for (const id of Object.keys(TRAINERS))
    check(
      contracts(w).filter((c) => c.trainerId === id).length <= 6,
      "厩舎の受入枠を超えています。",
    );
  for (const [id, f] of Object.entries(FARMS))
    check(
      contracts(w).filter((c) => c.providerId === id).length <= f.capacity,
      "牧場の受入枠を超えています。",
    );
  for (const e of Object.values(w.entities))
    if (e.kind === "invoice" && e.deferral)
      check(
        validDate(e.deferral.originalDue) &&
          validDate(e.deferral.agreedDate) &&
          e.deferral.agreedDate <= w.core.date &&
          e.dueDate ===
            nextDate(
              e.deferral.originalDue > e.deferral.agreedDate
                ? e.deferral.originalDue
                : e.deferral.agreedDate,
              14,
            ) &&
          text(e.deferral.creditor) &&
          text(e.deferral.reason),
        "支払猶予の合意が不正です。",
      );
  if (c.stage === "purchase")
    check(
      w.entities[c.horseId!]?.kind === "horse" &&
        invoices(w).some(
          (i) => i.horseId === c.horseId && i.category === "purchase",
        ),
      "購入の未精算がありません。",
    );
  if (c.stage === "market")
    check(!c.horseId && !c.trainerId, "市場と選択馬が不正です。");
  if (c.stage === "active")
    check(c.horseId && p.plans[c.horseId], "選択中の愛馬がいません。");
  if (c.horseId && p.plans[c.horseId]) {
    const a = p.plans[c.horseId];
    check(
      a.route === c.route &&
        a.trainerId === c.trainerId &&
        a.nextReview === c.nextReview &&
        a.horseGoal === c.horseGoal &&
        a.annualGoal === c.annualGoal,
      "選択馬への計画反映が不正です。",
    );
  }
  if (c.life.closure)
    check(
      c.stage === "ended" &&
        c.life.closure.cashYen === cash(w) &&
        c.life.closure.debtYen === debt(w) &&
        contracts(w).length === 0 &&
        c.life.closure.unplacedIds.length === livingOwned(w).length &&
        c.life.closure.unplacedIds.every((id) =>
          livingOwned(w).some((h) => h.id === id),
        ),
      "活動終了時の債務・飼養先の記録が不正です。",
    );
}
