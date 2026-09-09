import { validDate, nextDate, type World, type Horse } from "./world.ts";
import { validateLife, validateLifeEntity } from "./life.ts";
import { assertLife as check, livingOwned } from "./life-support.ts";
import { contracts } from "./finance.ts";
import { cycles, reservedFoals, young } from "./breeding-support.ts";
import { SIRES } from "./breeding-model.ts";
import type { BreedingCycle } from "./breeding-types.ts";
import type { Invoice } from "./career-types.ts";
const text = (x: unknown, max = 1000): x is string =>
  typeof x === "string" && x.trim().length > 0 && x.length <= max;
const amount = (x: unknown): x is number =>
  Number.isSafeInteger(x) && (x as number) >= 0 && (x as number) <= 1e12;
const states = [
  "applied",
  "offered",
  "reserved",
  "covered",
  "pregnant",
  "empty",
  "lost",
  "foaled",
  "completed",
  "cancelled",
];
export function validateBreedingEntity(
  raw: Record<string, unknown>,
  es: Record<string, unknown>,
  date: string,
) {
  if (raw.kind !== "breeding") {
    validateLifeEntity(raw, es, date);
    return;
  }
  const b = raw as unknown as BreedingCycle,
    dam = es[b.horseId] as Horse,
    sire = es[b.sireId] as Horse;
  check(
    dam?.kind === "horse" &&
      dam.sex === "mare" &&
      sire?.kind === "horse" &&
      sire.sex === "stallion" &&
      b.horseId !== b.sireId,
    "繁殖の父母参照が不正です。",
  );
  check(
    validDate(b.date) &&
      b.date <= date &&
      Number.isInteger(b.season) &&
      b.season >= Number(b.date.slice(0, 4)) &&
      b.season <= Number(b.date.slice(0, 4)) + 1 &&
      states.includes(b.status),
    "繁殖の時点・状態が不正です。",
  );
  check(
    ["pregnancy", "live-foal"].includes(b.payment) &&
      ["conditional", "invoiced", "waived", "refunded"].includes(b.feeStatus) &&
      amount(b.feeYen) &&
      text(b.reason, 600) &&
      text(b.message) &&
      text(b.motherGoal, 80) &&
      text(b.motherAnnualGoal, 80) &&
      typeof b.report === "boolean",
    "繁殖の契約条件・判断が不正です。",
  );
  const spec = SIRES.find((s) => s.id === b.sireId);
  check(
    spec &&
      b.feeYen ===
        (b.payment === "pregnancy" ? spec.fee : Math.round(spec.fee * 1.2)),
    "種付料が合意条件と一致しません。",
  );
  check(
    validDate(b.matingDate) &&
      b.matingDate >= b.date &&
      b.matingDate >= `${b.season}-02-10` &&
      b.matingDate <= `${b.season}-06-30`,
    "種付け日が契約期間外です。",
  );
  if (b.nextDate !== undefined)
    check(
      validDate(b.nextDate) && b.nextDate >= b.date,
      "繁殖の次回報告日が不正です。",
    );
  if (["empty", "lost", "completed", "cancelled"].includes(b.status))
    check(
      validDate(b.closedDate) &&
        b.closedDate >= b.date &&
        b.closedDate <= date &&
        b.nextDate === undefined,
      "繁殖終了の日時が不正です。",
    );
  if (b.outcome) {
    const o = b.outcome;
    check(
      [
        "empty",
        "early-loss",
        "late-loss",
        "stillbirth",
        "neonatal-death",
        "live",
      ].includes(o.result) &&
        typeof o.difficult === "boolean" &&
        typeof o.motherDies === "boolean" &&
        Number.isInteger(o.gestationDays) &&
        o.gestationDays >= 330 &&
        o.gestationDays <= 350 &&
        Number.isInteger(o.neonatalDay) &&
        o.neonatalDay >= 1 &&
        o.neonatalDay <= 30,
      "繁殖の固定転帰が不正です。",
    );
    check(
      b.matingDate <= date &&
        b.dueDate === nextDate(b.matingDate, o.gestationDays),
      "種付けと分娩予定が一致しません。",
    );
  } else
    check(
      ["applied", "offered", "reserved", "cancelled", "lost"].includes(
        b.status,
      ),
      "未実施の種付けから妊娠・出産しています。",
    );
  if (["foaled", "completed"].includes(b.status))
    check(text(b.foalId), "出生した仔の参照がありません。");
  if (b.foalId) {
    const f = es[b.foalId] as Horse;
    check(
      f?.kind === "horse" &&
        f.family?.birthCycleId === b.id &&
        f.family.damId === b.horseId &&
        f.family.sireId === b.sireId &&
        f.birthDate === b.dueDate,
      "仔と母・父・出生記録が一致しません。",
    );
  }
  const invoice = es[b.feeInvoiceId ?? ""] as Invoice | undefined;
  if (b.feeStatus === "invoiced" || b.feeStatus === "refunded")
    check(
      invoice?.kind === "invoice" &&
        invoice.horseId === b.horseId &&
        invoice.category === "stud" &&
        invoice.amountYen === b.feeYen,
      "種付料の請求参照が不正です。",
    );
  if (invoice) {
    check(
      invoice.kind === "invoice" &&
        invoice.category === "stud" &&
        invoice.amountYen === b.feeYen,
      "種付料の請求が不正です。",
    );
    check(invoice.dueDate >= invoice.date, "種付料の期限が不正です。");
    if (b.feeStatus === "waived")
      check(
        !!invoice.cancelled && !invoice.paid,
        "未払いの種付料免除が不正です。",
      );
  }
  const refund = es[`refund:${b.id}`] as
    | { kind: string; amountYen: number; horseId: string; category: string }
    | undefined;
  if (b.feeStatus === "refunded")
    check(
      invoice?.paid &&
        refund?.kind === "ledger" &&
        refund.category === "refund" &&
        refund.amountYen === b.feeYen &&
        refund.horseId === b.horseId,
      "種付料の返還と元の支払が一致しません。",
    );
  else check(!refund, "未成立の種付料返還です。");
}
export function validateBreeding(w: World) {
  validateLife(w);
  const c = w.core.career!;
  check(
    c.breeding &&
      validDate(c.breeding.startedDate) &&
      c.breeding.startedDate <= w.core.date &&
      [1, 2].includes(c.breeding.marketAge),
    "P5の開始・市場区分が不正です。",
  );
  const reserved = reservedFoals(w);
  check(
    livingOwned(w).length + reserved.length <= 12,
    "出生予約を含む所有枠を超えています。",
  );
  check(
    contracts(w).filter((x) => x.providerId === "forest").length +
      reserved.length <=
      6,
    "出生予約を含む牧場枠を超えています。",
  );
  const cycleList = cycles(w);
  for (const e of Object.values(w.entities)) {
    if (e.kind === "horse" && e.family) {
      const f = e.family;
      check(
        Number.isInteger(f.generation) &&
          f.generation >= 0 &&
          f.generation <= 100,
        "親子の世代が不正です。",
      );
      for (const key of ["damId", "sireId"] as const)
        if (f[key]) {
          const parent = w.entities[f[key]!];
          check(
            parent?.kind === "horse" &&
              parent.id !== e.id &&
              parent.birthDate < e.birthDate &&
              parent.sex === (key === "damId" ? "mare" : "stallion"),
            "両親の個体参照・日付が不正です。",
          );
        }
      if (f.birthCycleId) {
        const b = w.entities[f.birthCycleId];
        check(
          b?.kind === "breeding" &&
            b.foalId === e.id &&
            b.horseId === f.damId &&
            b.sireId === f.sireId,
          "出生の循環参照が一致しません。",
        );
        check(
          f.generation ===
            ((w.entities[f.damId!] as Horse).family?.generation ?? 0) + 1,
          "母と仔の世代が一致しません。",
        );
      }
      if (f.cycleId) {
        const b = w.entities[f.cycleId];
        check(
          b?.kind === "breeding" && b.horseId === e.id,
          "現在の繁殖参照が不正です。",
        );
      }
      if (f.restUntil) check(validDate(f.restUntil), "繁殖休止日が不正です。");
      if (f.broodmare) {
        const b = f.broodmare;
        check(
          e.sex === "mare" &&
            validDate(b.date) &&
            b.date <= w.core.date &&
            ["assessment", "suitable", "unsuitable"].includes(b.status) &&
            text(b.reason),
          "繁殖の所見が不正です。",
        );
        if (b.status === "assessment")
          check(validDate(b.dueDate), "繁殖診察の報告日が不正です。");
      }
      if (f.growth) {
        const g = f.growth;
        check(
          ["foal", "weanling", "yearling", "breaking", "ready"].includes(
            g.stage,
          ) &&
            g.target &&
            [g.target.speed, g.target.stamina].every(
              (v) => Number.isFinite(v) && v >= 0 && v <= 100,
            ),
          "仔の成長段階が不正です。",
        );
        if (young(e))
          check(
            !e.details!.registered && !e.details!.runs,
            "育成前の馬に競走登録・出走記録があります。",
          );
        if (g.startedDate)
          check(
            validDate(g.startedDate) &&
              g.startedDate >= `${Number(e.birthDate.slice(0, 4)) + 1}-09-01` &&
              g.startedDate <= w.core.date,
            "育成の開始時点が不正です。",
          );
        if (["breaking", "ready"].includes(g.stage))
          check(
            g.startedDate &&
              validDate(g.readyDate) &&
              g.readyDate >= nextDate(g.startedDate, 180) &&
              g.readyDate >= `${Number(e.birthDate.slice(0, 4)) + 2}-04-01`,
            "育成期間と入厩準備が一致しません。",
          );
        if (g.stage === "ready")
          check(g.readyDate! <= w.core.date, "未来の育成完了です。");
        if (g.stage === "weanling")
          check(
            nextDate(e.birthDate, 180) <= w.core.date,
            "離乳の時点が早すぎます。",
          );
      }
    } else if (e.kind === "invoice" && e.cancelled) {
      const b = w.entities[e.cancelled.cycleId];
      check(
        !e.paid &&
          e.category === "stud" &&
          validDate(e.cancelled.date) &&
          e.cancelled.date >= e.date &&
          e.cancelled.date <= w.core.date &&
          text(e.cancelled.reason) &&
          b?.kind === "breeding" &&
          b.feeInvoiceId === e.id &&
          b.feeStatus === "waived",
        "請求免除の条件と記録が不正です。",
      );
    } else if (e.kind === "health" && e.breedingId) {
      check(
        w.entities[e.breedingId]?.kind === "breeding",
        "繁殖診療の参照がありません。",
      );
    }
  }
  for (const b of cycleList) {
    const h = w.entities[b.horseId] as Horse;
    if (
      ["applied", "offered", "reserved", "covered", "pregnant"].includes(
        b.status,
      )
    ) {
      check(
        h.family?.cycleId === b.id &&
          h.life!.racing !== "active" &&
          !h.details!.registered &&
          !h.life!.deceased,
        "繁殖と競走・生命の状態が一致しません。",
      );
      check(
        c.stage === "ended" ||
          contracts(w).some(
            (x) => x.horseId === h.id && x.purpose === "breeding",
          ),
        "繁殖中の預託契約がありません。",
      );
    }
    check(
      cycleList.filter(
        (x) =>
          x.horseId === b.horseId &&
          [
            "applied",
            "offered",
            "reserved",
            "covered",
            "pregnant",
            "foaled",
          ].includes(x.status),
      ).length <= 1,
      "繁殖の進行が重複しています。",
    );
  }
}
