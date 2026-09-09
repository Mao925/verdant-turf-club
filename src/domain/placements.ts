import { activeCycle, young, farmSpaces } from "./breeding-support.ts";
import {
  cash,
  horses,
  nextDate,
  type World,
  type Horse,
  type Contract,
} from "./world.ts";
import { contracts, debt, payDue } from "./finance.ts";
import { hash, random, TRAINERS } from "./catalog.ts";
import { event } from "./career.ts";
import { focusHorse, raceForHorse } from "./season.ts";
import type { Placement } from "./life-types.ts";
import {
  activeEpisode,
  assertLife,
  bill,
  cancelPlans,
  closeHorseContracts,
  FARMS,
  personName,
  requireCash,
  scene,
} from "./life-support.ts";
export function placementReasons(
  w: World,
  h: Horse,
  purpose: Placement["purpose"],
  provider: string,
) {
  const reasons: string[] = [];
  if (activeCycle(w, h))
    reasons.push("繁殖の手続き・母仔の報告を先に終えてください。");
  if (h.family?.growth?.stage === "foal")
    reasons.push(
      "離乳前の仔は哺育契約を続けてください。診療は現在の牧場へ相談できます。",
    );
  if (purpose === "training" && young(h))
    reasons.push("育成の完了報告を待ってから入厩してください。");
  if (
    provider === "forest" &&
    w.core.career?.breeding &&
    farmSpaces(w, h.id) < 1
  )
    reasons.push("出生予約を含む牧場の受入枠が埋まっています。");
  if (h.life?.deceased) reasons.push("死亡した馬の新しい契約はできません。");
  if (h.life?.movementId) reasons.push("移動中の手続きがあります。");
  if (h.life?.saleId) reasons.push("売却の照会・合意を先に終えてください。");
  if (raceForHorse(w, h.id))
    reasons.push("出走手続きの取消または結果精算を先に行ってください。");
  const e = activeEpisode(w, h);
  if (e?.phase === "assessment")
    reasons.push("診断の報告を先に待ってください。");
  const count = contracts(w).filter(
    (c) => c.horseId !== h.id && (c.providerId ?? c.trainerId) === provider,
  ).length;
  if (purpose === "training") {
    if (!(provider in TRAINERS)) reasons.push("調教師を選んでください。");
    if (h.life?.racing !== "active")
      reasons.push("競走引退・復帰不可の馬は帰厩できません。");
    if (e && !["cleared", "limited"].includes(e.phase))
      reasons.push("療養の再評価を先に待ってください。");
    if (count >= 6) reasons.push("調教師の受入枠6頭が埋まっています。");
  } else {
    const farm = FARMS[provider as keyof typeof FARMS];
    if (!farm) reasons.push("牧場を選んでください。");
    else {
      if (count >= farm.capacity)
        reasons.push(`${farm.name}の受入枠が埋まっています。`);
      if (
        purpose === "rest" &&
        (!farm.rest || (e && !["cleared", "limited"].includes(e.phase)))
      )
        reasons.push("この健康状態・預託先では通常休養を契約できません。");
      if (purpose === "rehab" && !farm.rehab)
        reasons.push("療養を受け入れていません。");
      if (
        purpose === "retirement" &&
        !farm.limited &&
        (h.life?.racing === "barred" ||
          (e && e.cause !== "checkup" && e.phase !== "cleared"))
      )
        reasons.push("医療管理が必要な馬を受け入れていません。");
    }
  }
  if (
    contracts(w).some(
      (c) =>
        c.horseId === h.id &&
        (c.providerId ?? c.trainerId) === provider &&
        c.purpose === purpose,
    )
  )
    reasons.push("同じ預託契約で生活しています。");
  return reasons;
}
export function moveHorse(
  w: World,
  h: Horse,
  purpose: "training" | "rehab" | "rest" | "retirement",
  provider: string,
  reason: string,
  id: string,
) {
  const reasons = placementReasons(w, h, purpose, provider);
  assertLife(!reasons.length, reasons.join(" "));
  const trainer = TRAINERS[provider as keyof typeof TRAINERS],
    farm = FARMS[provider as keyof typeof FARMS];
  const e = activeEpisode(w, h);
  const monthly =
    purpose === "training"
      ? trainer.monthlyYen
      : purpose === "rehab"
        ? farm.rehab
        : purpose === "rest"
          ? farm.rest
          : h.life!.racing === "barred" ||
              (e && e.phase !== "cleared" && e.cause !== "checkup")
            ? farm.limited
            : farm.retirement;
  requireCash(w, 150000 + monthly);
  const old = contracts(w).find((c) => c.horseId === h.id);
  const previous = old?.trainerId ?? old?.providerId ?? h.life!.lastTrainer;
  cancelPlans(
    w,
    h,
    `${purpose === "retirement" ? "競走引退" : purpose === "training" ? "転厩・帰厩" : "牧場への移動"}を相談しました。`,
  );
  closeHorseContracts(w, h);
  if (purpose === "retirement") {
    if (h.life!.racing !== "barred") h.life!.racing = "retired";
    h.details!.registered = false;
  }
  const movement: Placement = {
    kind: "placement",
    id,
    horseId: h.id,
    date: w.core.date,
    purpose,
    status: "moving",
    dueDate: nextDate(w.core.date, 7),
    targetId: provider,
    reason,
  };
  w.entities[id] = movement;
  h.life!.movementId = id;
  h.location = `移動・受入調整中（${movement.dueDate}到着予定）`;
  const contract: Contract = {
    kind: "contract",
    id: `contract:${id}`,
    horseId: h.id,
    startDate: w.core.date,
    monthlyYen: monthly,
    accruedYen: 0,
    trainer:
      purpose === "training" ? trainer.name : `${farm.name}・${farm.person}`,
    providerId: provider,
    purpose,
    emergencyConsent: true,
    ...(purpose === "training" ? { trainerId: trainer.id } : {}),
  };
  w.entities[contract.id] = contract;
  const p = w.core.career!.portfolio!.plans[h.id];
  if (trainer && purpose === "training") {
    p.trainerId = trainer.id;
    p.nextReview = nextDate(movement.dueDate, trainer.reviewDays);
    h.life!.lastTrainer = trainer.id;
  }
  if (w.core.career!.horseId === h.id) focusHorse(w, h.id);
  bill(
    w,
    h,
    `${id}:transport`,
    150000,
    "移動と受入調整（架空契約）",
    "transport",
  );
  scene(
    w,
    `${id}:scene`,
    h,
    previous ?? provider,
    purpose === "retirement" ? "retirement" : "transfer",
    [id, contract.id],
    `${h.name}の${purpose === "retirement" ? "競走生活を終え、その後の生活" : purpose === "training" ? "次の厩舎での調整" : "牧場で過ごす期間"}について話し合いました。理由は「${reason}」。${previous === "saeki" ? "ここで待った時間も、この馬の経歴です。" : previous === "mihara" ? "挑戦した結果から、次の道を選んだことを覚えておきます。" : "継続して必要なケアと受入枠を確かめました。"}${personName(w, provider)}へ引き継ぎ、月額${monthly.toLocaleString("ja-JP")}円。移動中も新しい契約で飼養を続けます。`,
  );
}
export function seekBuyer(w: World, h: Horse, reason: string, id: string) {
  assertLife(
    !h.life!.deceased &&
      !h.life!.saleId &&
      !h.life!.movementId &&
      !raceForHorse(w, h.id),
    "健康・出走・移動・売却手続きを先に確認してください。",
  );
  assertLife(
    !activeCycle(w, h),
    "繁殖の手続き・母仔の報告を先に終えてください。",
  );
  assertLife(
    h.family?.growth?.stage !== "foal",
    "離乳を終えるまでは、母仔の哺育を継続してください。",
  );
  const e = activeEpisode(w, h);
  assertLife(
    !e || ["cleared", "limited"].includes(e.phase),
    "診療の経過を確認してから買い手を探してください。",
  );
  w.entities[id] = {
    kind: "placement",
    id,
    horseId: h.id,
    date: w.core.date,
    purpose: "sale",
    status: "searching",
    dueDate: nextDate(w.core.date, 7),
    reason,
  };
  h.life!.saleId = id;
  cancelPlans(w, h, "買い手への照会中は出走を見合わせます。");
  event(
    w,
    `${id}:search`,
    `${h.name}の買い手に照会しました。7日後に条件または不成立を報告します。現時点の入金はなく、預託費は継続します。`,
    h.id,
  );
}
export function saleResponse(
  w: World,
  p: Placement,
  accept: boolean,
  reason: string,
) {
  assertLife(
    p.purpose === "sale" && ["searching", "offered"].includes(p.status),
    "判断できる売却手続きがありません。",
  );
  const h = w.entities[p.horseId] as Horse;
  if (!accept) {
    p.status = "cancelled";
    p.reason += "／辞退：" + reason;
    delete h.life!.saleId;
    return;
  }
  assertLife(
    p.status === "offered" && p.targetId && p.priceYen !== undefined,
    "提示された条件がありません。",
  );
  assertLife(
    !h.life!.deceased && !raceForHorse(w, h.id),
    "出走手続きまたは健康状態を確認してください。",
  );
  p.status = "moving";
  p.dueDate = nextDate(w.core.date, 7);
  p.reason += "／合意：" + reason;
  scene(
    w,
    `${p.id}:agreed`,
    h,
    p.targetId,
    "sale",
    [p.id],
    `${h.name}の引渡しを${p.dueDate}で合意しました。提示額${p.priceYen.toLocaleString("ja-JP")}円、手数料5%。到着と所有移転を確認してから入金します。理由「${reason}」。`,
  );
}
export function placementDay(w: World) {
  let stop = false;
  for (const e of Object.values(w.entities)) {
    if (
      e.kind !== "placement" ||
      e.dueDate > w.core.date ||
      !["searching", "moving"].includes(e.status)
    )
      continue;
    const h = w.entities[e.horseId] as Horse;
    if (h.life!.deceased) {
      e.status = "cancelled";
      continue;
    }
    if (e.status === "searching") {
      const roll = random(hash(`${h.id}:${e.date}:buyer`, w.core.worldSeed))();
      const restricted = h.life!.racing !== "active";
      if (roll < (restricted ? 0.2 : 0.7)) {
        e.status = "offered";
        e.targetId = `npc-owner:${hash(h.id + e.date) % 12}`;
        e.priceYen = restricted
          ? 200000
          : Math.round(
              ((800000 +
                (h.details!.earnedYen ?? 0) * 0.12 +
                h.details!.wins * 250000) *
                (0.7 + roll)) /
                10000,
            ) * 10000;
      } else {
        e.status = "unavailable";
        delete h.life!.saleId;
        event(
          w,
          `${e.id}:none`,
          `${h.name}には今回、条件に合う買い手がありませんでした。所有と預託を継続し、別の時期の照会や引退預託を相談できます。`,
          h.id,
        );
      }
    } else if (e.purpose === "sale") {
      const from = h.ownerId;
      closeHorseContracts(w, h);
      cancelPlans(w, h, "所有移転のため旧馬主の予定を終了");
      const amount = e.priceYen!;
      w.entities[`sale:${e.id}`] = {
        kind: "ledger",
        id: `sale:${e.id}`,
        horseId: h.id,
        date: w.core.date,
        category: "sale",
        amountYen: amount,
        description: `${h.name} 所有移転を確認した売却代金`,
      };
      bill(
        w,
        h,
        `${e.id}:fee`,
        Math.round(amount * 0.05),
        "売却手数料5%（架空契約）",
        "sale-fee",
      );
      const owner = h.life!.owners.at(-1)!;
      owner.to = w.core.date;
      h.ownerId = e.targetId!;
      h.life!.owners.push({ ownerId: h.ownerId, from: w.core.date });
      delete h.life!.saleId;
      h.location =
        h.life!.racing === "active" ? "新馬主の厩舎" : "新馬主の余生預託";
      e.status = "completed";
      delete w.core.career!.portfolio!.plans[h.id];
      scene(
        w,
        `${e.id}:completed`,
        h,
        e.targetId!,
        "sale",
        [e.id, `sale:${e.id}`],
        `${h.name}を引き継ぎました。以前の${from === w.core.owner.id ? "あなたとの" : "馬主との"}競走と判断も、この馬の履歴として残ります。今後の活動は新馬主の方針で続きます。`,
      );
      if (w.core.career!.horseId === h.id) {
        const next = horses(w)[0];
        if (next) focusHorse(w, next.id);
        else {
          w.core.career!.stage = "market";
          delete w.core.career!.horseId;
          delete w.core.career!.trainerId;
        }
      }
      payDue(w);
    } else {
      e.status = "completed";
      delete h.life!.movementId;
      const c = contracts(w).find((c) => c.horseId === h.id)!;
      if (e.purpose === "training") {
        h.location = TRAINERS[e.targetId as keyof typeof TRAINERS].stable;
        h.details!.enteredDate = w.core.date;
        h.details!.registered = true;
        h.details!.gateDate = nextDate(w.core.date, 7);
      } else
        h.location = `${FARMS[e.targetId as keyof typeof FARMS].name}・${e.purpose === "retirement" ? "余生預託" : e.purpose === "rehab" ? "療養" : e.purpose === "breeding" ? "繁殖預託" : e.purpose === "rearing" ? "哺育・育成" : "休養"}`;
      event(
        w,
        `${e.id}:arrival`,
        `${h.name}の到着と受入を確認しました。${c.trainer}への預託を続けます。`,
        h.id,
      );
    }
    stop = true;
  }
  return stop;
}
