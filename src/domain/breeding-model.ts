import { details, hash, random } from "./catalog.ts";
import type { Horse, World } from "./world.ts";
import type { HorseDetails } from "./career-types.ts";
import type { BreedingOutcome, Growth } from "./breeding-types.ts";
export const BREEDING_MODEL = {
  conception: 0.65,
  olderConception: 0.5,
  earlyLoss: 0.058,
  lateLoss: 0.045,
  difficult: 0.08,
  stillbirth: 0.008,
  difficultStillbirth: 0.15,
  maternalDeath: 0.001,
  difficultMaternalDeath: 0.02,
  neonatalDeath: 0.008,
  difficultNeonatalDeath: 0.04,
} as const;
export const REARING_MONTHLY = {
  foal: 150000,
  weanling: 200000,
  yearling: 250000,
  breaking: 350000,
  ready: 350000,
} as const;
export const BREEDING_MONTHLY = 300000;
export const SIRES = [
  {
    id: "stud:harukaze",
    name: "ハルカゼノオト",
    age: 8,
    fee: 800000,
    slots: 4,
    speed: 78,
    stamina: 66,
    turf: 1.04,
    dirt: 0.9,
    distance: 1400,
    note: "芝の短い距離で力を発揮した父。軽快さの傾向を伝える可能性があります。",
  },
  {
    id: "stud:towa",
    name: "トワノミナト",
    age: 10,
    fee: 1500000,
    slots: 3,
    speed: 69,
    stamina: 84,
    turf: 1.02,
    dirt: 0.94,
    distance: 2400,
    note: "芝の長い距離を走った父。持続力を考える配合ですが、仔自身の適性はまだ分かりません。",
  },
  {
    id: "stud:akatsuki",
    name: "アカツキノツチ",
    age: 9,
    fee: 3000000,
    slots: 2,
    speed: 79,
    stamina: 77,
    turf: 0.89,
    dirt: 1.07,
    distance: 1800,
    note: "ダートで実績を残した父。人気と枠の少なさが価格に含まれ、仔の勝利を保証しません。",
  },
] as const;
export function horseAge(w: World, h: Horse) {
  return Number(w.core.date.slice(0, 4)) - Number(h.birthDate.slice(0, 4));
}
export function breedingOutcome(
  seed: number,
  age: number,
  scale = 1,
): BreedingOutcome {
  const r = random(seed),
    m = BREEDING_MODEL;
  const conceived = r() < (age >= 14 ? m.olderConception : m.conception);
  const early = r() < m.earlyLoss * scale,
    late = r() < m.lateLoss * scale;
  const difficult = r() < m.difficult * scale;
  const still =
    r() < (difficult ? m.difficultStillbirth : m.stillbirth) * scale;
  const motherDies =
    r() < (difficult ? m.difficultMaternalDeath : m.maternalDeath) * scale;
  const neonatal =
    r() < (difficult ? m.difficultNeonatalDeath : m.neonatalDeath) * scale;
  return {
    result: !conceived
      ? "empty"
      : early
        ? "early-loss"
        : late
          ? "late-loss"
          : still
            ? "stillbirth"
            : neonatal
              ? "neonatal-death"
              : "live",
    difficult,
    motherDies,
    gestationDays: 330 + Math.floor(r() * 21),
    neonatalDay: 1 + Math.floor(r() * 30),
  };
}
const clamp = (x: number, min: number, max: number) =>
  Math.max(min, Math.min(max, x));
export function foalDetails(
  w: World,
  dam: Horse,
  sire: Horse,
  id: string,
): HorseDetails {
  const r = random(hash(id + ":inherit", w.core.worldSeed));
  const a = dam.details!,
    b = sire.details!;
  const variation = () => r() + r() + r() - 1.5;
  return {
    ...details(hash(id)),
    speed: clamp((a.speed + b.speed) / 2 + variation() * 18, 38, 95),
    stamina: clamp((a.stamina + b.stamina) / 2 + variation() * 18, 38, 95),
    turf: clamp((a.turf + b.turf) / 2 + variation() * 0.12, 0.75, 1.2),
    dirt: clamp((a.dirt + b.dirt) / 2 + variation() * 0.12, 0.75, 1.2),
    idealDistance: clamp(
      Math.round(
        ((a.idealDistance + b.idealDistance) / 2 + variation() * 500) / 100,
      ) * 100,
      1000,
      3200,
    ),
    pedigree: `父 ${sire.name} × 母 ${dam.name}`,
    observation:
      "出生を確認しました。母仔の状態を見守り、成長に沿って所見を更新します。",
    unknown:
      "両親の傾向を参考にした配合です。仔の成長・適性・勝利を保証するものではありません。",
    earnedYen: 0,
    fans: 0,
    awards: [],
    turn: r() < 0.5 ? "left" : "right",
  };
}
export function grow(h: Horse, stage: Growth["stage"]) {
  const g = h.family!.growth!;
  g.stage = stage;
  const fraction = {
    foal: 0.55,
    weanling: 0.65,
    yearling: 0.75,
    breaking: 0.88,
    ready: 1,
  }[stage];
  h.details!.speed = g.target.speed * fraction;
  h.details!.stamina = g.target.stamina * fraction;
  h.details!.observation = {
    foal: "母仔の状態を見ながら哺育を続けています。競走能力を判断する時期ではありません。",
    weanling:
      "離乳を終え、放牧と日々の生活を続けています。馬体の変化を追っていきます。",
    yearling: "1歳の成長期です。歩様と落ち着き、負担への反応を観察しています。",
    breaking:
      "育成契約に沿って馴致と段階的な運動を進めています。負荷をかける時期は現場へ託します。",
    ready:
      "育成期間と健康を確認し、入厩へ進めるとの報告です。実戦の適性は出走後も確かめます。",
  }[stage];
}
