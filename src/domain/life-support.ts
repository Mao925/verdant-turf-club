import {
  cash,
  horses,
  nextDate,
  type World,
  type Horse,
  type Contract,
} from "./world.ts";
import { contracts, debt, payDue } from "./finance.ts";
import { TRAINERS } from "./catalog.ts";
import { event } from "./career.ts";
import type { Scene, HealthEpisode, Placement } from "./life-types.ts";
import type { SeasonRace } from "./season-types.ts";
export function assertLife(ok: unknown, message: string): asserts ok {
  if (!ok) throw Error(message);
}
export const FARMS = {
  forest: {
    name: "白樺牧場",
    person: "森谷澄",
    capacity: 6,
    rest: 200000,
    rehab: 350000,
    retirement: 80000,
    limited: 180000,
    policy: "療養の再評価を続け、競走を離れた後の生活も引き受けます。",
  },
  haven: {
    name: "凪の丘",
    person: "野崎渉",
    capacity: 4,
    rest: 0,
    rehab: 0,
    retirement: 60000,
    limited: 0,
    policy:
      "余生の預託先です。継続的な医療管理が必要な馬は受け入れられません。",
  },
} as const;
export function personName(w: World, id: string) {
  if (id === "vet") return "小野遼（獣医師）";
  if (id in TRAINERS) return TRAINERS[id as keyof typeof TRAINERS].name;
  if (id in FARMS) return FARMS[id as keyof typeof FARMS].person;
  const e = w.entities[id];
  return e?.kind === "npc-owner" ? e.name : "関係者";
}
export function livingOwned(w: World) {
  return horses(w).filter((h) => !h.life?.deceased);
}
export function tracked(w: World, h: Horse) {
  return (
    h.ownerId === w.core.owner.id || w.entities[h.ownerId]?.kind === "npc-owner"
  );
}
export function activeEpisode(w: World, h: Horse) {
  const e = w.entities[h.life?.episodeId ?? ""];
  return e?.kind === "health" ? e : undefined;
}
export function trainable(w: World, h: Horse) {
  if (!w.core.career?.life) return true;
  const e = activeEpisode(w, h);
  return (
    !!h.life &&
    !h.life.deceased &&
    h.life.racing === "active" &&
    !h.life.movementId &&
    !h.life.saleId &&
    (!e || ["cleared", "limited"].includes(e.phase)) &&
    (h.ownerId !== w.core.owner.id ||
      contracts(w).some((c) => c.horseId === h.id && !!c.trainerId))
  );
}
export function lifePending(w: World) {
  return Object.values(w.entities).filter(
    (e): e is HealthEpisode | Placement =>
      ((e.kind === "health" &&
        (e.phase === "decision" ||
          (["dead", "limited"].includes(e.phase) && !e.acknowledged))) ||
        (e.kind === "placement" && e.status === "offered")) &&
      (w.entities[e.horseId] as Horse)?.ownerId === w.core.owner.id,
  );
}
export function initializeLife(w: World) {
  for (const e of Object.values(w.entities)) {
    if (e.kind === "horse" && !e.life)
      e.life = {
        racing: "active",
        owners: [{ ownerId: e.ownerId, from: w.core.date }],
      };
    if (e.kind === "contract") {
      e.purpose ??= "training";
      e.providerId ??= e.trainerId;
      e.emergencyConsent = true;
    }
  }
}
export function scene(
  w: World,
  id: string,
  h: Horse,
  personId: string,
  trigger: Scene["trigger"],
  evidenceIds: string[],
  text: string,
) {
  if (w.entities[id]) return;
  // Keep scenes for current and former owned horses only.
  if (!h.life?.owners.some((o) => o.ownerId === w.core.owner.id)) return;
  w.entities[id] = {
    kind: "scene",
    id,
    horseId: h.id,
    date: w.core.date,
    personId,
    trigger,
    evidenceIds,
    text,
  };
}
export function clearConsultations(w: World, h: Horse, reason: string) {
  for (const e of Object.values(w.entities))
    if (e.kind === "consultation" && e.horseId === h.id && !e.resolution) {
      e.resolution = reason;
      e.reason = reason;
    }
}
export function cancelPlans(
  w: World,
  h: Horse,
  reason: string,
  exceptRace?: string,
) {
  clearConsultations(w, h, reason);
  for (const e of Object.values(w.entities)) {
    if (
      e.kind === "race" &&
      e.id !== exceptRace &&
      ["registered", "selected"].includes(e.status)
    ) {
      if (e.terms) {
        const r = e as SeasonRace;
        if (!r.entries.includes(h.id) && !r.field.includes(h.id)) continue;
        r.entries = r.entries.filter((id) => id !== h.id);
        r.field = r.field.filter((id) => id !== h.id);
        if (r.ownedIds.includes(h.id)) {
          if (!r.cancelledIds.includes(h.id)) r.cancelledIds.push(h.id);
          r.selectionNotes[h.id] = reason;
        }
        if (!r.field.length && r.status === "selected") r.status = "cancelled";
      } else if (e.horseId === h.id) e.status = "cancelled";
    }
  }
}
export function closeContract(w: World, c: Contract) {
  if (c.endDate) return;
  c.endDate = w.core.date;
  if (c.accruedYen) {
    const id = `closing:${c.id}`;
    assertLife(!w.entities[id], "契約精算が重複しています。");
    w.entities[id] = {
      kind: "invoice",
      id,
      horseId: c.horseId,
      contractId: c.id,
      date: w.core.date,
      dueDate: w.core.date,
      amountYen: c.accruedYen,
      category: c.purpose === "training" ? "boarding" : "care",
      description: `${c.trainer} 終了日前日までの未請求分`,
      paid: false,
    };
    c.accruedYen = 0;
  }
}
export function closeHorseContracts(w: World, h: Horse) {
  for (const c of contracts(w).filter((c) => c.horseId === h.id)) {
    if (c.trainerId) h.life!.lastTrainer = c.trainerId;
    closeContract(w, c);
  }
  const p = w.core.career!.portfolio!.plans[h.id];
  if (p) delete p.trainerId;
  if (w.core.career!.horseId === h.id) delete w.core.career!.trainerId;
}
export function bill(
  w: World,
  h: Horse,
  id: string,
  amountYen: number,
  description: string,
  category: "medical" | "transport" | "sale-fee" = "medical",
) {
  if (h.ownerId !== w.core.owner.id) return;
  assertLife(!w.entities[id], "費用の重複です。");
  w.entities[id] = {
    kind: "invoice",
    id,
    horseId: h.id,
    date: w.core.date,
    dueDate: w.core.date,
    amountYen,
    description,
    category,
    paid: false,
  };
  payDue(w);
}
export function requireCash(w: World, amount: number) {
  assertLife(
    cash(w) - debt(w) >= amount,
    "確定債務を除いた現金が不足します。支払猶予・売却の相談、活動終了を確認してください。",
  );
}
export function invalidatePlacement(w: World, h: Horse, reason: string) {
  for (const key of ["saleId", "movementId"] as const) {
    const p = w.entities[h.life?.[key] ?? ""];
    if (
      p?.kind === "placement" &&
      !["completed", "cancelled", "unavailable"].includes(p.status)
    ) {
      p.status = "cancelled";
      p.reason += "／" + reason;
    }
  }
  if (h.life) {
    if (h.life.movementId && !h.life.deceased) {
      const c = contracts(w).find((c) => c.horseId === h.id);
      h.location = `${c?.trainer ?? "委託先"}・診療のため移動を中断し受入先管理で待機`;
    }
    delete h.life.saleId;
    delete h.life.movementId;
  }
}
export function confirmDeath(
  w: World,
  h: Horse,
  e: HealthEpisode,
  mode: "natural" | "euthanasia",
  exceptRace?: string,
) {
  assertLife(h.life && !h.life.deceased, "死亡の確定が重複しています。");
  e.phase = "dead";
  e.closedDate = w.core.date;
  delete e.dueDate;
  e.acknowledged = h.ownerId !== w.core.owner.id;
  h.life.deceased = { date: w.core.date, episodeId: e.id, mode };
  h.life.episodeId = e.id;
  h.details!.registered = false;
  h.location = "生涯の記録";
  cancelPlans(w, h, "健康上の理由で予定を終了しました。", exceptRace);
  invalidatePlacement(w, h, "健康急変により手続き終了");
  closeHorseContracts(w, h);
  bill(w, h, `${e.id}:final`, 150000, "緊急対応・最終診療の精算（架空契約）");
  const p = w.core.career!.portfolio!.plans[h.id];
  scene(
    w,
    `${e.id}:loss`,
    h,
    h.life.lastTrainer ?? "forest",
    "loss",
    [e.id],
    `${h.name}は${w.core.date}に亡くなりました。${mode === "euthanasia" ? "獣医師が生命予後を極めて厳しいと判断し、事前合意した緊急対応として安楽死を実施しました。" : "初期対応を行いましたが、病状の経過により死亡しました。"}${p ? `目指していた「${p.horseGoal}」と、ここまでの判断は残っています。` : ""}費用や成績を理由にした診断ではありません。`,
  );
  if (h.ownerId === w.core.owner.id)
    event(
      w,
      `${e.id}:death`,
      `${h.name}の死亡を確認。将来の出走・預託請求を止め、既発生費用を精算しました。`,
      h.id,
    );
}
