import { startRehab, DIAGNOSES } from "./health.ts";
import {
  cash,
  horses,
  nextDate,
  validateWorld,
  type World,
  type Horse,
  type Command,
} from "./world.ts";
import { createLife, upgradeLife, applyLife } from "./life.ts";
import { event, newMarket } from "./career.ts";
import { hash, random, details, ROUTES } from "./catalog.ts";
import { focusHorse, rememberPlan } from "./season.ts";
import { contracts, invoices, payDue } from "./finance.ts";
import {
  activeEpisode,
  assertLife as check,
  bill,
  confirmDeath,
  initializeLife,
  livingOwned,
  requireCash,
  scene,
} from "./life-support.ts";
import {
  SIRES,
  BREEDING_MONTHLY,
  breedingOutcome,
  foalDetails,
  grow,
  horseAge,
} from "./breeding-model.ts";
import {
  activeCycle,
  cycles,
  reservedFoals,
  breedingPending,
  young,
  farmSpaces,
  mareReasons,
  matingDate,
  sireReasons,
  setFarmContract,
  foalMonthly,
  familyScene,
} from "./breeding-support.ts";
import type { BreedingCycle, Growth } from "./breeding-types.ts";
import type { HealthCause, HealthEpisode } from "./life-types.ts";
import type { Invoice, Market } from "./career-types.ts";
import type { SeasonRace } from "./season-types.ts";
export {
  validateBreeding,
  validateBreedingEntity,
} from "./breeding-validation.ts";
export { breedingPending } from "./breeding-support.ts";
const wording = (s: unknown, max = 200): s is string =>
  typeof s === "string" && s.trim().length > 0 && s.length <= max;
function own(w: World, id: string) {
  const h = w.entities[id];
  check(
    h?.kind === "horse" && h.ownerId === w.core.owner.id,
    "現在の所有馬を選んでください。",
  );
  return h;
}
function initializeSires(w: World) {
  const year = Number(w.core.date.slice(0, 4));
  for (const s of SIRES) {
    if (w.entities[s.id]) continue;
    w.entities[s.id] = {
      kind: "horse",
      id: s.id,
      name: s.name,
      birthDate: `${year - s.age}-03-10`,
      sex: "stallion",
      ownerId: "npc-owner:11",
      coat: "#825b40",
      location: "外部種馬場",
      family: { generation: 0 },
      life: {
        racing: "retired",
        owners: [{ ownerId: "npc-owner:11", from: w.core.date }],
      },
      details: {
        ...details(hash(s.id)),
        speed: s.speed,
        stamina: s.stamina,
        turf: s.turf,
        dirt: s.dirt,
        idealDistance: s.distance,
        registered: false,
        pedigree: "種馬場の公開血統資料（祖先個体は未収録）",
        observation: s.note,
        unknown: "架空の種牡馬と契約です。産駒の適性や成績を保証しません。",
        earnedYen: 0,
        fans: 0,
        awards: [],
        turn: "left",
      },
    };
  }
}
export function upgradeBreeding(world: World, id: string) {
  check(!world.core.career?.breeding, "P5へ引継ぎ済みです。");
  const w = world.core.career?.life
    ? structuredClone(world)
    : upgradeLife(world, `${id}:life`);
  w.core.engineVersion = "owner-p5";
  w.core.rulesetVersion = "breeding-2026";
  w.core.career!.breeding = { startedDate: w.core.date, marketAge: 2 };
  initializeSires(w);
  event(
    w,
    id,
    "P5へ引継ぎました。外部繁殖と母仔の契約、1歳市場、育成と親子の記録を追加します。過去の血統や妊娠を遡って作り替えません。",
  );
  validateWorld(w);
  return w;
}
export function createBreeding(...args: Parameters<typeof createLife>) {
  return upgradeBreeding(createLife(...args), "initial-breeding");
}
function report(w: World, b: BreedingCycle, message: string) {
  b.report = true;
  b.message = message;
  familyScene(
    w,
    w.entities[b.horseId] as Horse,
    `${b.id}:${b.status}:${w.core.date}`,
    "breeding",
    [b.id],
    message,
  );
}
function healthRecord(
  w: World,
  h: Horse,
  cause: HealthCause,
  b: BreedingCycle,
  death = false,
) {
  const id = `repro:${b.id}:${h.id === b.horseId ? "mare" : "foal"}:${cause}`;
  if (w.entities[id]) return w.entities[id] as HealthEpisode;
  const old = activeEpisode(w, h);
  // End the old episode as superseded, retaining its diagnosis and projected outcome; do not label it a recovery.
  if (old && !["cleared", "limited", "dead"].includes(old.phase)) {
    old.phase = "superseded";
    old.closedDate = w.core.date;
    delete old.dueDate;
    old.acknowledged = true;
    old.prognosis += " 生殖・出生時の診療記録へ引き継ぎました。";
  }
  const e: HealthEpisode = {
    kind: "health",
    id,
    horseId: h.id,
    date: w.core.date,
    origin: "breeding",
    cause,
    breedingId: b.id,
    phase: death ? "assessment" : "rehab",
    outcome: death ? "death" : "recover",
    dueDate: nextDate(w.core.date, cause === "foaling" ? 42 : 21),
    diagnosis:
      cause === "stillbirth"
        ? "分娩時に死産を確認しました。"
        : cause === "neonatal"
          ? "出生後の疾病について診療しました。"
          : cause === "pregnancy-loss"
            ? "妊娠の継続が認められず、母馬を診療しました。"
            : "分娩に伴う母馬の異常について診療しました。",
    prognosis: death
      ? "診療を行いましたが、死亡を確認しました。"
      : "母馬の生活と回復を優先し、経過を確認します。",
    review: 1,
    secondOpinion: false,
    acknowledged: !death,
  };
  w.entities[id] = e;
  h.life!.episodeId = id;
  bill(
    w,
    h,
    `${id}:care`,
    cause === "stillbirth"
      ? 30000
      : cause === "neonatal"
        ? 200000
        : cause === "pregnancy-loss"
          ? 100000
          : 300000,
    "繁殖・出生に伴う診療（架空契約）",
  );
  if (death) confirmDeath(w, h, e, "natural");
  else
    scene(
      w,
      `${id}:report`,
      h,
      "vet",
      "care",
      [id, b.id],
      `${h.name}の診療報告。${e.diagnosis}${e.prognosis}`,
    );
  return e;
}
function waiveFee(w: World, b: BreedingCycle, reason: string) {
  if (["waived", "refunded"].includes(b.feeStatus)) return;
  const i = w.entities[b.feeInvoiceId ?? ""];
  if (i?.kind === "invoice" && i.paid) {
    const id = `refund:${b.id}`;
    check(!w.entities[id], "種付料の返還が重複しています。");
    w.entities[id] = {
      kind: "ledger",
      id,
      date: w.core.date,
      amountYen: b.feeYen,
      category: "refund",
      horseId: b.horseId,
      description: "契約条件に基づく種付料のみの返還（預託・診療実費は維持）",
    };
    b.feeStatus = "refunded";
  } else {
    if (i?.kind === "invoice")
      i.cancelled = { date: w.core.date, reason, cycleId: b.id };
    b.feeStatus = "waived";
  }
  event(
    w,
    `${b.id}:fee-waived`,
    `${reason}。種付料は${b.feeStatus === "refunded" ? "返還" : "支払不要"}です。既にかかった母仔の預託・診療・輸送費は残ります。`,
    b.horseId,
  );
}
function invoiceFee(w: World, b: BreedingCycle, due: string) {
  if (b.feeStatus !== "conditional") return;
  const id = `stud-fee:${b.id}`;
  w.entities[id] = {
    kind: "invoice",
    id,
    horseId: b.horseId,
    date: w.core.date,
    dueDate: due,
    amountYen: b.feeYen,
    category: "stud",
    description: `${(w.entities[b.sireId] as Horse).name} 種付料（${b.payment === "pregnancy" ? "受胎確認後" : "生後30日を経過して"}支払条件成立）`,
    paid: false,
  };
  b.feeInvoiceId = id;
  b.feeStatus = "invoiced";
  event(
    w,
    `${b.id}:fee-due`,
    `種付料${b.feeYen.toLocaleString("ja-JP")}円の条件が成立しました。期日${due}。`,
    b.horseId,
  );
}
function pregnancyLost(
  w: World,
  b: BreedingCycle,
  reason: string,
  clinical = true,
) {
  const h = w.entities[b.horseId] as Horse;
  b.status = "lost";
  b.closedDate = w.core.date;
  delete b.nextDate;
  h.family!.restUntil = nextDate(w.core.date, 60);
  if (clinical && !h.life!.deceased) healthRecord(w, h, "pregnancy-loss", b);
  waiveFee(w, b, reason);
  report(
    w,
    b,
    `${h.name}：${reason}。母馬と妊娠の記録、これまでの費用を保管します。今後の繁殖を続けるかは、経過を確認して相談できます。`,
  );
}
function createFoal(w: World, b: BreedingCycle) {
  const dam = w.entities[b.horseId] as Horse,
    sire = w.entities[b.sireId] as Horse;
  const id = `foal:${b.id}`;
  check(!w.entities[id], "仔の出生が重複しています。");
  const d = foalDetails(w, dam, sire, id),
    r = random(hash(id + ":sex", w.core.worldSeed));
  const foal: Horse = {
    kind: "horse",
    id,
    name: `${dam.name.slice(0, 28)}の仔`,
    birthDate: w.core.date,
    sex: r() < 0.5 ? "mare" : "stallion",
    ownerId: w.core.owner.id,
    coat: r() < 0.5 ? dam.coat : sire.coat,
    location: "白樺牧場・哺育",
    details: d,
    life: {
      racing: "active",
      owners: [{ ownerId: w.core.owner.id, from: w.core.date }],
    },
    family: {
      sireId: sire.id,
      damId: dam.id,
      birthCycleId: b.id,
      generation: (dam.family?.generation ?? 0) + 1,
      growth: { stage: "foal", target: { speed: d.speed, stamina: d.stamina } },
    },
  };
  w.entities[id] = foal;
  b.foalId = id;
  w.core.career!.portfolio!.plans[id] = {
    nextReview: w.core.date,
    route: w.core.career!.portfolio!.plans[dam.id].route,
    horseGoal: b.motherGoal,
    annualGoal: "母仔の健康と成長を見守る",
  };
  grow(foal, "foal");
  setFarmContract(w, foal, "rearing", foalMonthly(foal), `birth:${b.id}`);
  bill(
    w,
    dam,
    `${b.id}:delivery`,
    300000,
    "分娩・出生確認と母仔の初期対応（架空契約）",
    "care",
  );
  if (b.outcome!.difficult)
    bill(
      w,
      dam,
      `${b.id}:difficult`,
      500000,
      "難産時の追加対応（事前合意の架空契約）",
    );
  b.status = "foaled";
  b.nextDate = nextDate(w.core.date, 31);
  dam.family!.restUntil = nextDate(w.core.date, 180);
  if (b.outcome!.result === "stillbirth")
    healthRecord(w, foal, "stillbirth", b, true);
  if (b.outcome!.motherDies) healthRecord(w, dam, "foaling", b, true);
  else if (b.outcome!.difficult) healthRecord(w, dam, "foaling", b);
  report(
    w,
    b,
    `${dam.name}の分娩報告です。${foal.life!.deceased ? "仔は死産でした。" : "仔の出生を確認しました。生後の経過と母仔の状態を引き続き確認します。"}${dam.life!.deceased ? "母馬は分娩時の診療を行いましたが、亡くなりました。" : ""}名前と今後の方針は、報告を受け止めてから決められます。`,
  );
  familyScene(
    w,
    foal,
    `${b.id}:birth-scene`,
    "birth",
    [b.id, dam.id, sire.id],
    `${dam.name}と${sire.name}の仔です。母と目指した「${b.motherGoal}」を記録します。この仔自身の成長と適性を見て、新しい目標へ変えることもできます。`,
  );
  return foal;
}
export function reconcileBreeding(w: World) {
  if (!w.core.career?.breeding) return false;
  let stop = false;
  for (const b of cycles(w)) {
    const dam = w.entities[b.horseId] as Horse,
      foal = w.entities[b.foalId ?? ""] as Horse | undefined;
    if (
      dam.life!.deceased &&
      !b.foalId &&
      ["applied", "offered", "reserved", "covered", "pregnant"].includes(
        b.status,
      )
    ) {
      if (["covered", "pregnant"].includes(b.status))
        pregnancyLost(w, b, "母馬の死亡に伴い妊娠の継続を終了しました", false);
      else {
        b.status = "cancelled";
        b.closedDate = w.core.date;
        delete b.nextDate;
        waiveFee(w, b, "種付け前に母馬が亡くなりました");
        report(w, b, "母馬の死亡に伴い、予約と将来の種付けを取り消しました。");
      }
      stop = true;
    }
    if (
      foal?.life?.deceased &&
      foal.life.deceased.date <= nextDate(foal.birthDate, 30)
    ) {
      waiveFee(
        w,
        b,
        foal.birthDate === foal.life.deceased.date
          ? "死産・出生当日の死亡を確認しました"
          : "生後30日以内の死亡を確認しました",
      );
    }
    if (
      dam.life!.deceased &&
      foal &&
      !foal.life!.deceased &&
      foal.family!.growth!.stage === "foal" &&
      !foal.family!.growth!.orphanSupport
    ) {
      foal.family!.growth!.orphanSupport = true;
      setFarmContract(w, foal, "rearing", foalMonthly(foal), `nurse:${b.id}`);
      familyScene(
        w,
        foal,
        `${b.id}:nurse`,
        "growth",
        [b.id, dam.life!.deceased.episodeId],
        `母の${dam.name}が亡くなった後も、${foal.name}の哺育を続けます。離乳までは乳母・哺育支援に月10万円を追加します。`,
      );
      stop = true;
    }
  }
  return stop;
}
export function breedingDay(w: World) {
  if (!w.core.career?.breeding) return false;
  let stop = false;
  for (const h of horses(w)) {
    const exam = h.family?.broodmare;
    if (
      exam?.status === "assessment" &&
      exam.dueDate! <= w.core.date &&
      !h.life!.deceased
    ) {
      const eligible = mareReasons(w, h).filter((s) => !s.includes("繁殖報告"));
      const suitable =
        !eligible.length &&
        random(hash(h.id + ":reproductive-suitability", w.core.worldSeed))() >=
          0.06;
      exam.status = suitable ? "suitable" : "unsuitable";
      delete exam.dueDate;
      exam.reason = suitable
        ? "今回の繁殖診察では受入を検討できます。受胎や母仔の生存は確約できません。"
        : eligible.join(" ") ||
          "今回の生殖器の所見では、当牧場での繁殖は勧められません。競走の成績とは別の判断です。";
      familyScene(
        w,
        h,
        `brood-exam:${h.id}:${exam.date}`,
        "breeding",
        [h.id],
        `${h.name}の繁殖診察。${exam.reason}`,
      );
      stop = true;
    }
  }
  for (const b of cycles(w)) {
    const h = w.entities[b.horseId] as Horse;
    if (h.life!.deceased && !b.foalId) continue;
    if (b.status === "applied" && b.nextDate! <= w.core.date) {
      const sire = w.entities[b.sireId] as Horse,
        s = SIRES.find((s) => s.id === b.sireId)!;
      const taken = cycles(w).filter(
        (x) =>
          x.id !== b.id &&
          x.sireId === b.sireId &&
          x.season === b.season &&
          ["reserved", "covered", "pregnant", "foaled", "completed"].includes(
            x.status,
          ),
      ).length;
      const busy =
        random(hash(`${b.sireId}:${b.season}:bookings`, w.core.worldSeed))() <
        0.08;
      if (sire.life!.deceased || taken >= s.slots || busy) {
        b.status = "cancelled";
        b.closedDate = w.core.date;
        waiveFee(w, b, "供用・受入枠の条件が合わず不成立でした");
        report(
          w,
          b,
          "今回は種牡馬側の受入条件が合わず不成立でした。種付料は発生せず、母の預託を続けます。",
        );
      } else {
        b.status = "offered";
        report(
          w,
          b,
          `${sire.name}の受入提示です。予定${b.matingDate}、種付料${b.feeYen.toLocaleString("ja-JP")}円。契約条件を確認して予約するか、辞退するかを選んでください。`,
        );
      }
      delete b.nextDate;
      stop = true;
    } else if (b.status === "reserved" && b.matingDate! <= w.core.date) {
      const sire = w.entities[b.sireId] as Horse,
        e = activeEpisode(w, h);
      if (
        h.life!.deceased ||
        sire.life!.deceased ||
        (e && !["cleared", "limited"].includes(e.phase)) ||
        h.life!.movementId
      ) {
        b.status = "cancelled";
        b.closedDate = w.core.date;
        delete b.nextDate;
        waiveFee(
          w,
          b,
          "種付け当日の母馬・種牡馬の健康条件を満たせませんでした",
        );
        report(
          w,
          b,
          "健康・受入条件により種付けを取り消しました。繁殖を続けるかは診療後に相談してください。",
        );
      } else {
        b.status = "covered";
        b.outcome = breedingOutcome(
          hash(
            `${h.id}:${b.sireId}:${b.matingDate}:reproduction`,
            w.core.worldSeed,
          ),
          horseAge(w, h),
        );
        b.dueDate = nextDate(b.matingDate!, b.outcome.gestationDays);
        b.nextDate = nextDate(w.core.date, 17);
        bill(
          w,
          h,
          `${b.id}:cover`,
          100000,
          "種付け実施・検査・報告（架空契約）",
          "care",
        );
        report(
          w,
          b,
          `予定に沿って種付けを実施しました。受胎確認は${b.nextDate}。母の体調を確認しながら待ちます。`,
        );
      }
      stop = true;
    } else if (b.status === "covered" && b.nextDate! <= w.core.date) {
      if (b.outcome!.result === "empty") {
        b.status = "empty";
        b.closedDate = w.core.date;
        delete b.nextDate;
        h.family!.restUntil = nextDate(w.core.date, 21);
        waiveFee(w, b, "今回は不受胎でした");
        report(
          w,
          b,
          "今回は受胎を確認できませんでした。種付料は発生しません。状態と季節を確認し、次の周期や翌年の配合を相談できます。",
        );
      } else {
        b.status = "pregnant";
        b.nextDate = nextDate(b.matingDate!, 35);
        report(
          w,
          b,
          `受胎を確認しました。出産見込みは${b.dueDate}頃です。妊娠の継続と母の健康を確認していきます。`,
        );
      }
      stop = true;
    } else if (b.status === "pregnant") {
      const ageDays = Math.round(
        (Date.parse(w.core.date) - Date.parse(b.matingDate!)) / 86400000,
      );
      if (
        (b.outcome!.result === "early-loss" && ageDays >= 35) ||
        (b.outcome!.result === "late-loss" && ageDays >= 180)
      ) {
        pregnancyLost(
          w,
          b,
          ageDays < 70
            ? "早期の妊娠喪失を確認しました"
            : "妊娠中の流産を確認しました",
        );
        stop = true;
      } else if (w.core.date >= b.dueDate!) {
        createFoal(w, b);
        stop = true;
      } else if (b.nextDate! <= w.core.date) {
        b.nextDate =
          ageDays < 70
            ? nextDate(b.matingDate!, 70)
            : ageDays < 180
              ? nextDate(b.matingDate!, 180)
              : b.dueDate;
        report(
          w,
          b,
          `${h.name}の妊娠の継続を確認しました。出産見込み${b.dueDate}。母馬のケアと費用を確かめ、次の報告を待ちます。`,
        );
        stop = true;
      }
      if (
        b.status === "pregnant" &&
        b.payment === "pregnancy" &&
        w.core.date === `${b.season}-09-30`
      )
        invoiceFee(w, b, `${b.season}-10-31`);
    } else if (b.status === "foaled") {
      const f = w.entities[b.foalId!] as Horse;
      if (
        b.outcome!.result === "neonatal-death" &&
        !f.life!.deceased &&
        w.core.date >= nextDate(f.birthDate, b.outcome!.neonatalDay)
      ) {
        healthRecord(w, f, "neonatal", b, true);
        report(
          w,
          b,
          `${f.name}は出生後の診療を行いましたが、亡くなりました。母と仔の記録を保持し、契約の種付料返還・免除を確認します。`,
        );
        stop = true;
      }
      if (w.core.date >= nextDate(f.birthDate, 31)) {
        if (!f.life!.deceased && b.payment === "live-foal")
          invoiceFee(w, b, `${b.season + 1}-10-31`);
        b.status = "completed";
        b.closedDate = w.core.date;
        delete b.nextDate;
        report(
          w,
          b,
          f.life!.deceased
            ? "出生後の報告と契約処理を終えました。生涯の記録は残ります。"
            : "生後30日を経過しました。母仔の報告を続け、離乳・育成の方針を相談していきます。",
        );
        stop = true;
      }
    }
  }
  stop = reconcileBreeding(w) || stop;
  for (const h of Object.values(w.entities).filter(
    (e): e is Horse =>
      e.kind === "horse" && !!e.family?.growth && !e.life!.deceased,
  )) {
    const g = h.family!.growth!,
      owned = h.ownerId === w.core.owner.id;
    let stage: Growth["stage"] | undefined;
    if (g.stage === "foal" && nextDate(h.birthDate, 180) <= w.core.date)
      stage = horseAge(w, h) >= 1 ? "yearling" : "weanling";
    else if (g.stage === "weanling" && horseAge(w, h) >= 1) stage = "yearling";
    else if (g.stage === "breaking" && g.readyDate! <= w.core.date) {
      const e = activeEpisode(w, h);
      if (e && !["cleared", "limited"].includes(e.phase)) {
        g.readyDate = nextDate(w.core.date, 7);
      } else stage = "ready";
    }
    if (stage) {
      grow(h, stage);
      if (
        owned &&
        contracts(w).some((c) => c.horseId === h.id && c.purpose === "rearing")
      )
        setFarmContract(
          w,
          h,
          "rearing",
          foalMonthly(h),
          `growth:${h.id}:${stage}`,
        );
      if (!owned && stage === "ready" && h.life!.racing === "active") {
        h.details!.registered = true;
        h.location = "新馬主の厩舎";
      }
      familyScene(
        w,
        h,
        `growth:${h.id}:${stage}`,
        "growth",
        [h.id, ...(h.family!.birthCycleId ? [h.family!.birthCycleId] : [])],
        `${h.name}：${h.details!.observation}${stage === "ready" ? "担当調教師と入厩・最初の目標を相談できます。" : ""}`,
      );
      stop ||= owned;
    }
  }
  return stop;
}
export function breedingAfterRace(w: World, r: SeasonRace) {
  if (!w.core.career?.breeding) return;
  for (const id of r.ownedIds.filter((id) => r.field.includes(id))) {
    const h = w.entities[id] as Horse,
      b = w.entities[h.family?.birthCycleId ?? ""];
    if (b?.kind !== "breeding") continue;
    const dam = w.entities[b.horseId] as Horse,
      p = w.core.career!.portfolio!.plans[id];
    familyScene(
      w,
      h,
      `legacy-debut:${id}`,
      "legacy",
      [b.id, dam.id, r.id],
      `${dam.name}の仔、${h.name}が${r.name}へ初めて出走しました。母と目指した「${b.motherGoal}」、この仔と選んだ「${p.horseGoal}」。${r.dnf?.some((d) => d.horseId === id) ? "今回は競走を中止し、診療の報告を待ちます。" : `${r.finish!.indexOf(id) + 1}着という、この仔自身の記録が始まりました。`}母を知る私たちも、この先を一緒に考えていきます。`,
    );
  }
}
export function applyBreeding(world: World, command: Command, id: string) {
  let w = structuredClone(world);
  rememberPlan(w);
  const c = w.core.career!;
  check(
    c.stage !== "ended" || ["remember", "select-horse"].includes(command.type),
    "活動を終了した経歴です。母仔と未完了の繁殖の記録を閲覧できます。",
  );
  if (
    [
      "broodmare-exam",
      "broodmare-board",
      "apply-breeding",
      "breeding-response",
      "rear-young",
      "start-breaking",
      "foal-goal",
    ].includes(command.type)
  )
    check(
      "reason" in command && wording(command.reason),
      "判断の理由を200文字以内で記録してください。",
    );
  if (
    command.type === "care-plan" &&
    w.entities[command.episodeId]?.kind === "health" &&
    activeCycle(
      w,
      w.entities[
        (w.entities[command.episodeId] as HealthEpisode).horseId
      ] as Horse,
    )
  ) {
    const e = w.entities[command.episodeId] as HealthEpisode,
      h = own(w, e.horseId);
    check(
      e.phase === "decision" &&
        command.choice === "rehab" &&
        command.providerId === "forest" &&
        wording(command.reason),
      "繁殖中は現在の牧場での療養方針を選び、母仔の診療を続けてください。",
    );
    requireCash(w, DIAGNOSES[e.cause].cost);
    startRehab(w, e, "rehab", command.reason);
    familyScene(
      w,
      h,
      `${id}:clinical`,
      "breeding",
      [e.id, h.family!.cycleId!],
      "現在の繁殖預託を継続しながら療養します。種付け前の健康条件と妊娠の経過は別に確認します。",
    );
  } else if (command.type === "market-age") {
    check(
      c.stage === "market" && [1, 2].includes(command.age),
      "市場で1歳か2歳を選んでください。",
    );
    const marketId = `market:${w.core.date}${command.age === 1 ? ":yearling" : ""}`;
    c.breeding!.marketAge = command.age;
    if (w.entities[marketId]) c.marketId = marketId;
    else newMarket(w);
    c.portfolio!.marketOpened = w.core.date;
    c.endDate = "2100-12-31";
    initializeLife(w);
  } else if (command.type === "broodmare-exam") {
    const h = own(w, command.horseId),
      reasons = mareReasons(w, h);
    check(!reasons.length, reasons.join(" "));
    check(
      !h.family?.broodmare,
      "繁殖診察の所見を記録済みです。報告を確認してください。",
    );
    requireCash(w, 50000);
    h.family ??= { generation: 0 };
    h.family.broodmare = {
      date: w.core.date,
      status: "assessment",
      dueDate: nextDate(w.core.date, 7),
      reason: command.reason,
    };
    bill(w, h, id, 50000, "繁殖適性と受入条件の診察（架空契約）");
    familyScene(
      w,
      h,
      `${id}:exam`,
      "breeding",
      [h.id],
      `競走の結果とは別に、${h.name}の繁殖適性を診察します。理由「${command.reason}」。7日後に所見を報告します。`,
    );
  } else if (command.type === "broodmare-board") {
    const h = own(w, command.horseId),
      reasons = mareReasons(w, h);
    check(!reasons.length, reasons.join(" "));
    check(
      h.family?.broodmare?.status === "suitable",
      "繁殖適性の報告を先に確認してください。",
    );
    check(
      !contracts(w).some((c) => c.horseId === h.id && c.purpose === "breeding"),
      "繁殖預託は契約済みです。",
    );
    requireCash(w, 150000 + BREEDING_MONTHLY);
    setFarmContract(w, h, "breeding", BREEDING_MONTHLY, id, true);
    familyScene(
      w,
      h,
      `${id}:board`,
      "breeding",
      [h.id, `contract:${id}`],
      `${h.name}の繁殖預託を引き受けます。月30万円、移動7日・15万円、仔の哺育は別契約。理由「${command.reason}」。母と次の世代の生活を一緒に考えましょう。`,
    );
  } else if (command.type === "apply-breeding") {
    const h = own(w, command.horseId),
      reasons = sireReasons(w, h, command.sireId);
    check(!reasons.length, reasons.join(" "));
    check(
      ["pregnancy", "live-foal"].includes(command.payment),
      "種付料の支払条件を選んでください。",
    );
    const sire = SIRES.find((s) => s.id === command.sireId)!,
      date = matingDate(nextDate(w.core.date, 3));
    const fee =
      command.payment === "pregnancy" ? sire.fee : Math.round(sire.fee * 1.2);
    requireCash(w, fee + BREEDING_MONTHLY + 100000);
    const p = c.portfolio!.plans[h.id];
    const b: BreedingCycle = {
      kind: "breeding",
      id,
      horseId: h.id,
      sireId: sire.id,
      date: w.core.date,
      season: Number(date.slice(0, 4)),
      status: "applied",
      nextDate: nextDate(w.core.date, 3),
      matingDate: date,
      payment: command.payment,
      feeYen: fee,
      feeStatus: "conditional",
      report: false,
      message: "種牡馬側へ受入条件を照会しています。3日後に回答予定です。",
      reason: command.reason,
      motherGoal: p.horseGoal,
      motherAnnualGoal: p.annualGoal,
    };
    w.entities[id] = b;
    h.family!.cycleId = id;
    familyScene(
      w,
      h,
      `${id}:apply`,
      "breeding",
      [id, sire.id],
      `${sire.name}への配合を照会しました。理由「${command.reason}」。母と目指した「${p.horseGoal}」を覚えながら、仔の適性はこれから見ていきます。`,
    );
  } else if (command.type === "breeding-response") {
    const b = w.entities[command.cycleId];
    check(
      b?.kind === "breeding" &&
        ["applied", "offered", "reserved"].includes(b.status),
      "申込み・提示・予約の記録を確認してください。",
    );
    own(w, b.horseId);
    if (!command.accept) {
      b.status = "cancelled";
      b.closedDate = w.core.date;
      delete b.nextDate;
      b.report = false;
      b.reason += "／辞退：" + command.reason;
      waiveFee(w, b, "種付け前に辞退しました");
      delete (w.entities[b.horseId] as Horse).family!.cycleId;
    } else {
      check(b.status === "offered", "受入提示を待ってから予約してください。");
      requireCash(w, b.feeYen + 100000);
      b.status = "reserved";
      b.report = false;
      b.nextDate = b.matingDate;
      b.reason += "／予約：" + command.reason;
    }
  } else if (command.type === "acknowledge-breeding") {
    const b = w.entities[command.cycleId];
    check(
      b?.kind === "breeding" && b.report && b.status !== "offered",
      "確認待ちの繁殖報告を選んでください。",
    );
    own(w, b.horseId);
    b.report = false;
    if (["empty", "lost", "completed", "cancelled"].includes(b.status))
      delete (w.entities[b.horseId] as Horse).family!.cycleId;
  } else if (command.type === "rear-young") {
    const h = own(w, command.horseId);
    check(
      young(h) && !h.life!.deceased && !h.life!.movementId && !h.life!.saleId,
      "育成前の所有馬と進行中の手続きを確認してください。",
    );
    check(
      !contracts(w).some((x) => x.horseId === h.id && x.purpose === "rearing"),
      "育成預託は契約済みです。",
    );
    requireCash(w, 150000 + foalMonthly(h));
    setFarmContract(w, h, "rearing", foalMonthly(h), id, true);
    c.stage = "active";
    focusHorse(w, h.id);
    familyScene(
      w,
      h,
      `${id}:rear`,
      "growth",
      [h.id, `contract:${id}`],
      `${h.name}を成長段階に合わせて預かります。理由「${command.reason}」。入厩前に育成と健康の確認を行います。`,
    );
  } else if (command.type === "start-breaking") {
    const h = own(w, command.horseId),
      g = h.family?.growth,
      e = activeEpisode(w, h);
    check(
      g &&
        ["yearling", "weanling"].includes(g.stage) &&
        !h.life!.deceased &&
        h.life!.racing === "active" &&
        !h.life!.movementId &&
        !h.life!.saleId,
      "育成を始められる所有馬を選んでください。",
    );
    check(
      w.core.date >= `${Number(h.birthDate.slice(0, 4)) + 1}-09-01`,
      "段階的な育成は1歳9月以降です。",
    );
    check(
      !e || e.phase === "cleared",
      "健康の診療と再評価を先に確認してください。",
    );
    requireCash(w, 350000);
    g.startedDate = w.core.date;
    g.readyDate = [
      nextDate(w.core.date, 180),
      `${Number(h.birthDate.slice(0, 4)) + 2}-04-01`,
    ]
      .sort()
      .at(-1)!;
    grow(h, "breaking");
    setFarmContract(w, h, "rearing", 350000, id);
    familyScene(
      w,
      h,
      `${id}:breaking`,
      "growth",
      [h.id, `contract:${id}`],
      `育成を始めます。月35万円、入厩準備の再評価は${g.readyDate}以降。理由「${command.reason}」。急いで仕上げるより、この仔の反応を見ながら進めます。`,
    );
  } else if (command.type === "foal-goal") {
    const h = own(w, command.horseId),
      b = w.entities[h.family?.birthCycleId ?? ""];
    check(
      b?.kind === "breeding" &&
        !h.life!.deceased &&
        wording(command.name, 40) &&
        wording(command.goal, 80) &&
        Object.hasOwn(ROUTES, command.route) &&
        ["inherit", "new"].includes(command.mode),
      "仔の名前・目標・路線を確認してください。",
    );
    h.name = command.name.trim();
    const p = c.portfolio!.plans[h.id];
    p.horseGoal =
      command.mode === "inherit" ? b.motherGoal : command.goal.trim();
    p.annualGoal = young(h) ? "この仔の成長を見守る" : "この仔と最初の競走へ";
    p.route = command.route;
    if (c.horseId === h.id) focusHorse(w, h.id);
    familyScene(
      w,
      h,
      `${id}:goal`,
      "legacy",
      [h.id, b.id],
      `${h.name}と目指すのは「${p.horseGoal}」。母の願いを${command.mode === "inherit" ? "継ぐ" : "そのまま引き継がず、この仔の道を選ぶ"}と決めました。理由「${command.reason}」。親子でも適性や結果は同じとは限りません。`,
    );
  } else {
    if (["open-market", "bid"].includes(command.type))
      check(
        livingOwned(w).length + reservedFoals(w).length < 12,
        "出生予約を含めた所有上限12頭です。",
      );
    if (command.type === "bid" && (w.entities[c.marketId] as Market).age === 1)
      check(
        farmSpaces(w) > 0,
        "1歳馬の育成預託枠がありません。既存の愛馬と出生予約を先に確認してください。",
      );
    if (command.type === "board")
      check(
        !young(own(w, c.horseId!)),
        "1歳・育成中の馬は先に牧場へ預けてください。",
      );
    w = applyLife(w, command, id);
    if (command.type === "end-career")
      w.core.career!.life!.closure!.breedingIds = cycles(w)
        .filter(
          (b) =>
            !["empty", "lost", "completed", "cancelled"].includes(b.status),
        )
        .map((b) => b.id);
  }
  w.core.career!.reserveYen =
    (livingOwned(w).length + reservedFoals(w).length) * 1500000;
  initializeLife(w);
  rememberPlan(w);
  validateWorld(w);
  return w;
}
