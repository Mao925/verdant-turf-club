import {
  cash,
  horses,
  nextDate,
  type World,
  type Horse,
  type Contract,
} from "./world.ts";
import { contracts, debt } from "./finance.ts";
import {
  activeEpisode,
  assertLife,
  closeHorseContracts,
  cancelPlans,
  bill,
  scene,
  livingOwned,
} from "./life-support.ts";
import { rememberPlan, focusHorse, raceForHorse } from "./season.ts";
import {
  BREEDING_MONTHLY,
  REARING_MONTHLY,
  SIRES,
  horseAge,
} from "./breeding-model.ts";
import type { BreedingCycle } from "./breeding-types.ts";
export function cycles(w: World) {
  return Object.values(w.entities).filter(
    (e): e is BreedingCycle => e.kind === "breeding",
  );
}
export function activeCycle(w: World, h: Horse) {
  const e = w.entities[h.family?.cycleId ?? ""];
  return e?.kind === "breeding" ? e : undefined;
}
export function reservedFoals(w: World) {
  return cycles(w).filter(
    (e) =>
      !e.foalId &&
      ["applied", "offered", "reserved", "covered", "pregnant"].includes(
        e.status,
      ) &&
      !(w.entities[e.horseId] as Horse).life?.deceased,
  );
}
export function breedingPending(w: World) {
  return cycles(w).filter((e) => e.report);
}
export function young(h: Horse) {
  return !!h.family?.growth && h.family.growth.stage !== "ready";
}
export function farmSpaces(w: World, exclude?: string) {
  return (
    6 -
    contracts(w).filter(
      (c) => c.providerId === "forest" && c.horseId !== exclude,
    ).length -
    reservedFoals(w).length
  );
}
export function mareReasons(w: World, h: Horse, requireBoard = false) {
  const reasons: string[] = [];
  if (h.ownerId !== w.core.owner.id)
    reasons.push("現在の所有牝馬を選んでください。");
  if (h.sex !== "mare") reasons.push("繁殖牝馬の外部預託を対象としています。");
  if (h.life?.deceased) reasons.push("死亡した馬の新しい繁殖はできません。");
  if (h.life?.racing === "active")
    reasons.push("競走引退とその後の預託を先に相談してください。");
  if (horseAge(w, h) < 3 || horseAge(w, h) > 18)
    reasons.push("この牧場の繁殖受入は3〜18歳です。");
  if (young(h)) reasons.push("成長・育成を終えてから繁殖を検討してください。");
  const e = activeEpisode(w, h);
  if (e && !["cleared", "limited"].includes(e.phase))
    reasons.push("現在の診療と再評価を先に確認してください。");
  if (h.life?.movementId || h.life?.saleId || raceForHorse(w, h.id))
    reasons.push("移動・売却・出走の手続きを先に終えてください。");
  if (h.family?.cycleId)
    reasons.push("現在の繁殖報告と契約を先に確認してください。");
  if (h.family?.restUntil && h.family.restUntil > w.core.date)
    reasons.push(`${h.family.restUntil}まで繁殖を休む合意です。`);
  if (requireBoard) {
    if (h.family?.broodmare?.status !== "suitable")
      reasons.push("繁殖適性の診察と受入所見が必要です。");
    if (
      !contracts(w).some((c) => c.horseId === h.id && c.purpose === "breeding")
    )
      reasons.push("繁殖預託契約が必要です。");
  }
  return reasons;
}
export function matingDate(date: string) {
  const earliest = nextDate(date, 7),
    year = Number(earliest.slice(0, 4));
  if (earliest < `${year}-02-10`) return `${year}-02-10`;
  return earliest <= `${year}-06-30` ? earliest : `${year + 1}-02-10`;
}
export function sireReasons(w: World, h: Horse, sireId: string) {
  const reasons = mareReasons(w, h, true),
    s = SIRES.find((s) => s.id === sireId),
    sire = w.entities[sireId] as Horse;
  if (!s || sire?.kind !== "horse" || sire.life?.deceased)
    reasons.push("現在供用できる種牡馬を選んでください。");
  const ageAtCover =
    Number(matingDate(nextDate(w.core.date, 3)).slice(0, 4)) -
    Number(h.birthDate.slice(0, 4));
  if (ageAtCover > 18)
    reasons.push("予定する種付け時点で、牧場の受入年齢を超えます。");
  if (sireId === h.family?.sireId || sireId === h.id)
    reasons.push("近い親子の配合はこの契約で受け入れません。");
  if (livingOwned(w).length + reservedFoals(w).length >= 12)
    reasons.push("仔の出生用に所有枠1頭が必要です。");
  if (farmSpaces(w) < 1)
    reasons.push("仔の哺育用に白樺牧場の受入枠1頭が必要です。");
  return reasons;
}
export function setFarmContract(
  w: World,
  h: Horse,
  purpose: "breeding" | "rearing",
  monthly: number,
  id: string,
  move = false,
) {
  const existing = contracts(w).find((c) => c.horseId === h.id);
  if (existing?.purpose === purpose && existing.monthlyYen === monthly && !move)
    return;
  assertLife(farmSpaces(w, h.id) >= 1, "白樺牧場の受入枠が埋まっています。");
  cancelPlans(w, h, "外部牧場での生活・育成へ移るため予定を終了");
  closeHorseContracts(w, h);
  const c: Contract = {
    kind: "contract",
    id: `contract:${id}`,
    horseId: h.id,
    startDate: w.core.date,
    monthlyYen: monthly,
    accruedYen: 0,
    trainer: "白樺牧場・森谷澄",
    providerId: "forest",
    purpose,
    emergencyConsent: true,
  };
  w.entities[c.id] = c;
  h.details!.registered = false;
  if (move) {
    w.entities[id] = {
      kind: "placement",
      id,
      horseId: h.id,
      date: w.core.date,
      purpose,
      status: "moving",
      dueDate: nextDate(w.core.date, 7),
      targetId: "forest",
      reason: "外部牧場の預託・受入契約",
    };
    h.life!.movementId = id;
    h.location = `白樺牧場へ移動中（${nextDate(w.core.date, 7)}到着予定）`;
    bill(
      w,
      h,
      `${id}:transport`,
      150000,
      "牧場への輸送・受入調整（架空契約）",
      "transport",
    );
  } else
    h.location = `白樺牧場・${purpose === "breeding" ? "繁殖預託" : "哺育・育成"}`;
  delete w.core.career!.portfolio!.plans[h.id].trainerId;
  if (w.core.career!.horseId === h.id) focusHorse(w, h.id);
  rememberPlan(w);
}
export function foalMonthly(h: Horse) {
  const g = h.family!.growth!;
  return (
    REARING_MONTHLY[g.stage] +
    (g.orphanSupport && g.stage === "foal" ? 100000 : 0)
  );
}
export function breedingQuote(
  w: World,
  h: Horse,
  sireId: string,
  payment: "pregnancy" | "live-foal",
) {
  const s = SIRES.find((x) => x.id === sireId)!;
  const cover = matingDate(nextDate(w.core.date, 3)),
    birth = nextDate(cover, 340),
    debut = `${Number(birth.slice(0, 4)) + 2}-06-01`;
  const days = (a: string, b: string) =>
    Math.max(0, (Date.parse(b) - Date.parse(a)) / 86400000);
  const motherYen = Math.ceil(
    (days(w.core.date, debut) / 365) * 12 * BREEDING_MONTHLY,
  );
  const breaking = `${Number(birth.slice(0, 4)) + 1}-09-01`,
    wean = nextDate(birth, 180),
    yearling = `${Number(birth.slice(0, 4)) + 1}-01-01`;
  const foalYen = Math.ceil(
    ((days(birth, wean) * 150000 +
      days(wean, yearling) * 200000 +
      days(yearling, breaking) * 250000 +
      days(breaking, debut) * 350000) /
      365) *
      12,
  );
  const feeYen = payment === "live-foal" ? Math.round(s.fee * 1.2) : s.fee;
  const fixedYen = 100000 + 300000;
  const annualCount =
    Number(debut.slice(0, 4)) - Number(w.core.date.slice(0, 4));
  const knownOtherMonthly = contracts(w)
    .filter((c) => c.horseId !== h.id)
    .reduce((n, c) => n + c.monthlyYen, 0);
  const otherYen = Math.ceil(
    (days(w.core.date, debut) / 365) * 12 * knownOtherMonthly,
  );
  return {
    cover,
    birth,
    debut,
    motherYen,
    foalYen,
    feeYen,
    fixedYen,
    otherYen,
    totalYen: motherYen + foalYen + feeYen + fixedYen,
    projectedBalance:
      cash(w) -
      debt(w) +
      annualCount * w.core.owner.annualYen -
      motherYen -
      foalYen -
      feeYen -
      fixedYen -
      otherYen,
  };
}
export function familyScene(
  w: World,
  h: Horse,
  id: string,
  trigger: "breeding" | "birth" | "growth" | "legacy",
  evidence: string[],
  text: string,
) {
  scene(w, id, h, "forest", trigger, evidence, text);
}
