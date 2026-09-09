import { seasonOpportunities, seasonEligibility } from "./program.ts";
import type { SeasonOpportunity } from "./season-types.ts";
import type { World, Horse } from "./world.ts";
import { nextDate } from "./world.ts";
import type { HorseDetails, Opportunity, TrainerId } from "./career-types.ts";
export const TRAINERS = {
  saeki: {
    id: "saeki" as TrainerId,
    name: "佐伯修司",
    stable: "美浦・佐伯厩舎",
    monthlyYen: 700000,
    philosophy: "長く走れる一頭に。回復を確かめ、待つ判断を大切にします。",
    constraint: "受入は1頭。早い初戦より継続を優先し、相談は原則3週間ごと。",
    reviewDays: 21,
  },
  mihara: {
    id: "mihara" as TrainerId,
    name: "三原葵",
    stable: "美浦・三原厩舎",
    monthlyYen: 850000,
    philosophy:
      "挑戦から可能性を探す。走れる条件を満たしたら、競走での反応を見たいです。",
    constraint: "受入は1頭。スタッフの遠征枠を考え、相談は原則2週間ごと。",
    reviewDays: 14,
  },
};
export const ROUTES = {
  "turf-sprint": "芝・短距離",
  "turf-mile": "芝・マイル",
  "turf-middle": "芝・中距離",
  "turf-long": "芝・長距離",
  "dirt-sprint": "ダート・短距離",
  "dirt-middle": "ダート・中距離",
} as const;
export function hash(text: string, seed = 2166136261) {
  let h = seed >>> 0;
  for (const char of text)
    h = Math.imul(h ^ char.charCodeAt(0), 16777619) >>> 0;
  return h;
}
export function random(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let a = Math.imul(t ^ (t >>> 15), 1 | t);
    a ^= a + Math.imul(a ^ (a >>> 7), 61 | a);
    return ((a ^ (a >>> 14)) >>> 0) / 4294967296;
  };
}
export function details(seed: number, index = 0): HorseDetails {
  const r = random(seed);
  return {
    speed: 48 + r() * 38,
    stamina: 48 + r() * 38,
    turf: 0.84 + r() * 0.2,
    dirt: 0.84 + r() * 0.2,
    idealDistance: index % 2 ? 1800 : 1600,
    fatigue: 0,
    runs: 0,
    wins: 0,
    registered: false,
    pedigree: [
      "父 ハルノミチ × 母 アオノヒカリ",
      "父 トオヤマ × 母 シロガネ",
      "父 ナギノソラ × 母 ユウナギ",
      "父 オクノカゼ × 母 ホシノイト",
    ][index % 4],
    observation: [
      "伸びやかな歩幅。公開調教では直線で集中して走った。",
      "力強い踏み込み。砂の調教では前向きだが、長く集中できるかは未確認。",
      "小柄で身のこなしが軽い。追われてからの反応にはまだばらつきがある。",
      "落ち着いた歩様。終いまで一定のリズムを保ち、速い追い切りはこれから。",
    ][index % 4],
    unknown:
      "公開調教と外見による所見です。実戦の適性・成長・将来の故障は分かりません。",
  };
}
export function ownedHorse(world: World): Horse | undefined {
  const h = world.entities[world.core.career?.horseId ?? ""];
  return h?.kind === "horse" && h.ownerId === world.core.owner.id
    ? h
    : undefined;
}
export function opportunities(world: World): Opportunity[] {
  if (!!world.core.career?.portfolio) return seasonOpportunities(world);
  const h = ownedHorse(world);
  if (!h?.details) return [];
  const d = h.details;
  const result: Opportunity[] = [];
  for (let i = 1; i <= 70; i++) {
    const date = nextDate(world.core.date, i);
    if (date > world.core.career!.endDate) break;
    const js = new Date(date + "T00:00:00Z");
    const age = js.getUTCFullYear() - Number(h.birthDate.slice(0, 4));
    if (
      js.getUTCDay() !== 0 ||
      (age === 2 && js.getUTCMonth() < 5) ||
      age < 2 ||
      age > 3
    )
      continue;
    const raceClass =
      d.wins >= 2
        ? "オープン"
        : d.wins === 1
          ? "1勝クラス"
          : d.runs === 0 && !(age === 3 && js.getUTCMonth() > 1)
            ? "新馬"
            : "未勝利";
    const deadline = nextDate(date, -7);
    if (deadline < world.core.date) continue;
    for (const route of ["turf-mile", "dirt-middle"] as const) {
      // Two recurring prototype meetings make route comparisons playable before P3's full calendar.
      const course = route === "turf-mile" ? "東京" : "中山";
      const distance = route === "turf-mile" ? 1600 : 1800;
      const surface = route === "turf-mile" ? "芝" : "ダート";
      const id = `race:${date}:${route}:${raceClass === "新馬" ? "maiden" : raceClass === "未勝利" ? "winless" : raceClass === "1勝クラス" ? "one" : "open"}`;
      if (world.entities[id]) continue;
      result.push({
        kind: "race",
        id,
        date,
        deadline,
        selectionDate: nextDate(date, -3),
        course,
        surface,
        distance,
        raceClass,
        name: `${age}歳${raceClass}・${course} ${surface}${distance}m`,
      });
    }
  }
  return result.slice(0, 8);
}
export function eligibility(world: World, race: Opportunity) {
  if (race.terms) return seasonEligibility(world, race as SeasonOpportunity);
  const h = ownedHorse(world);
  const reasons: string[] = [];
  if (!h?.details) return ["所有馬がいません。"];
  const d = h.details;
  const age = Number(race.date.slice(0, 4)) - Number(h.birthDate.slice(0, 4));
  if (age < 2 || age > 3) reasons.push("試作は2〜3歳の競走を収録しています。");
  if (!d.registered) reasons.push("競走馬登録が完了していません。");
  if (!d.gateDate || d.gateDate > world.core.date)
    reasons.push("ゲート試験の通過報告を待っています。");
  const minimum = d.runs === 0 ? 15 : 10;
  if (!d.enteredDate || nextDate(d.enteredDate, minimum) > race.date)
    reasons.push(`必要な在厩期間${minimum}日を満たしません。`);
  if (d.unfitUntil && d.unfitUntil >= race.date)
    reasons.push("調教師の出走不可期間です。");
  if (d.fatigue > 55) reasons.push("回復待ちです。今回の登録はできません。");
  if (d.lastRaceDate && nextDate(d.lastRaceDate, 14) > race.date)
    reasons.push("試作では前走から14日以上の間隔を取ります。");
  if (
    (race.raceClass === "新馬" && d.runs > 0) ||
    (race.raceClass === "未勝利" && d.wins > 0) ||
    (race.raceClass === "1勝クラス" && d.wins !== 1) ||
    (race.raceClass === "オープン" && d.wins < 2)
  )
    reasons.push("現在の出走クラスと一致しません。");
  if (race.deadline < world.core.date) reasons.push("登録期限を過ぎています。");
  return reasons;
}
