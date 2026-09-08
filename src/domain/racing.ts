import { type World, type Horse } from "./world.ts";
import { hash, random } from "./catalog.ts";
import type { Race, RaceResult } from "./career-types.ts";
export function calculateRace(world: World, race: Race): RaceResult[] {
  const r = random(race.seed);
  const track = race.surface === "芝" ? "turf" : "dirt";
  return race.field
    .map((horseId) => {
      const h = world.entities[horseId] as Horse;
      if (h?.kind !== "horse" || !h.details)
        throw new Error("出走馬が見つかりません。");
      const d = h.details;
      const ageDays =
        (Date.parse(race.date) - Date.parse(h.birthDate)) / 86400000;
      const maturity = Math.min(1.06, 0.92 + Math.max(0, ageDays - 800) / 4000);
      const fit = Math.max(
        0.86,
        1 - Math.abs(race.distance - d.idealDistance) / 9000,
      );
      const ability =
        (d.speed * 0.65 + d.stamina * 0.35) * d[track] * fit * maturity;
      const metersPerSecond =
        13.9 + ability * 0.033 - d.fatigue * 0.006 + (r() - 0.5) * 0.65;
      const seconds =
        Math.round((race.distance / metersPerSecond) * 1000) / 1000;
      const tendency = (r() - 0.5) * 0.28;
      const splits = Array.from({ length: 21 }, (_, i) => {
        const p = i / 20;
        return (
          Math.round(
            seconds * (p + (tendency * Math.sin(Math.PI * p)) / Math.PI) * 1000,
          ) / 1000
        );
      });
      return {
        horseId,
        name: h.name,
        coat: h.coat,
        silk:
          horseId === race.horseId
            ? world.core.owner.silk
            : ["#f4eee0", "#5483be", "#df614e", "#4a9774"][hash(horseId) % 4],
        seconds,
        splits,
      };
    })
    .sort(
      (a, b) => a.seconds - b.seconds || a.horseId.localeCompare(b.horseId),
    );
}
export function progressAt(result: RaceResult, seconds: number) {
  if (seconds <= 0) return 0;
  if (seconds >= result.seconds) return 1;
  const i = result.splits.findIndex((t) => t >= seconds);
  const a = result.splits[i - 1],
    b = result.splits[i];
  return (i - 1 + (seconds - a) / (b - a)) / 20;
}
export function prizeFor(race: Race, rank: number) {
  const first = {
    新馬: 7500000,
    未勝利: 5600000,
    "1勝クラス": 8000000,
    オープン: 16000000,
  }[race.raceClass];
  // Explicit prototype schedule, with a simplified 20% share for professionals.
  return Math.round(first * ([1, 0.4, 0.25, 0.15, 0.1][rank - 1] ?? 0) * 0.8);
}
