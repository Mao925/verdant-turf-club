import { trainable } from "./life-support.ts";
import type { Horse, World } from "./world.ts";
import { nextDate } from "./world.ts";
import type { Opportunity, Route } from "./career-types.ts";
import type {
  CourseName,
  RaceClass,
  RaceTerms,
  SeasonOpportunity,
  SeasonRace,
} from "./season-types.ts";
import { hash, random } from "./catalog.ts";
// Public measurements: JRA's course pages; coefficient use is a game model.
export const COURSES = {
  東京: {
    direction: "left",
    turf: [2083.1, 525.9, 2.7],
    dirt: [1899, 501.6, 2.5],
    distances: [
      [1400, 1600, 1800, 2000, 2400, 2500, 3400],
      [1400, 1600, 2100],
    ],
    url: "tokyo",
  },
  中山: {
    direction: "right",
    turf: [1667.1, 310, 5.3],
    dirt: [1493, 308, 4.5],
    distances: [
      [1200, 1600, 1800, 2000, 2200, 2500, 3600],
      [1200, 1800],
    ],
    url: "nakayama",
  },
  京都: {
    direction: "right",
    turf: [1782.8, 328.4, 3.1],
    dirt: [1607.6, 329.1, 3],
    distances: [
      [1200, 1400, 1600, 1800, 2000, 2200, 2400, 3000, 3200],
      [1200, 1400, 1800, 1900],
    ],
    url: "kyoto",
  },
  阪神: {
    direction: "right",
    turf: [1689, 356.5, 1.9],
    dirt: [1517.6, 352.7, 1.6],
    distances: [
      [1200, 1400, 1600, 1800, 2000, 2200, 2400, 3000],
      [1200, 1400, 1800, 2000],
    ],
    url: "hanshin",
  },
  中京: {
    direction: "left",
    turf: [1705.9, 412.5, 3.5],
    dirt: [1530, 410.7, 3.4],
    distances: [
      [1200, 1400, 1600, 2000, 2200, 3000],
      [1200, 1400, 1800, 1900],
    ],
    url: "chukyo",
  },
} as const;
export function courseProfile(
  r: Pick<Opportunity, "course" | "surface" | "distance">,
) {
  const c = COURSES[r.course];
  let [lap, straight, rise]: number[] = [
    ...(r.surface === "芝" ? c.turf : c.dirt),
  ];
  if (r.surface === "芝") {
    if (r.course === "中山" && [1200, 1600, 2200].includes(r.distance))
      lap = 1839.7;
    if (
      r.course === "京都" &&
      [1600, 1800, 2200, 2400, 3000, 3200].includes(r.distance)
    ) {
      lap = 1894.3;
      straight = 403.7;
      rise = 4.3;
    }
    if (r.course === "阪神" && [1600, 1800, 2400].includes(r.distance)) {
      lap = 2089;
      straight = 473.6;
      rise = 2.4;
    }
  }
  return {
    direction: c.direction,
    lap,
    straight,
    rise,
    curveRatio: 1 - (2 * straight) / lap,
  };
}
export const ROUTE_ORDER: Route[] = [
  "turf-sprint",
  "turf-mile",
  "turf-middle",
  "turf-long",
  "dirt-sprint",
  "dirt-middle",
];
export function routeFor(surface: string, distance: number): Route {
  return surface === "ダート"
    ? distance <= 1400
      ? "dirt-sprint"
      : "dirt-middle"
    : distance <= 1400
      ? "turf-sprint"
      : distance <= 1800
        ? "turf-mile"
        : distance <= 2200
          ? "turf-middle"
          : "turf-long";
}
export const CLASS_ORDER: RaceClass[] = [
  "新馬",
  "未勝利",
  "1勝クラス",
  "2勝クラス",
  "3勝クラス",
  "オープン",
];
export function classFor(h: Horse): RaceClass {
  const d = h.details!;
  const earned = d.earnedYen ?? 0;
  return earned === 0
    ? d.runs === 0
      ? "新馬"
      : "未勝利"
    : earned <= 5000000
      ? "1勝クラス"
      : earned <= 10000000
        ? "2勝クラス"
        : earned <= 16000000
          ? "3勝クラス"
          : "オープン";
}
// Dates/venues/distances/ages: 2026 JRA calendar and graded-race list. Future years follow the same month/week/day as a fictional recurring calendar.
// key, name, MM-DD, venue, surface, distance, min age, max age, female, grade, first prize (10,000 yen)
type MajorRow = [
  string,
  string,
  string,
  CourseName,
  "芝" | "ダート",
  number,
  number,
  number,
  boolean,
  RaceTerms["grade"],
  number,
];
export const MAJORS: MajorRow[] = [
  [
    "negishi",
    "根岸ステークス",
    "02-01",
    "東京",
    "ダート",
    1400,
    4,
    99,
    false,
    "GIII",
    4000,
  ],
  [
    "silk",
    "シルクロードステークス",
    "02-01",
    "京都",
    "芝",
    1200,
    4,
    99,
    false,
    "GIII",
    4100,
  ],
  [
    "february",
    "フェブラリーステークス",
    "02-22",
    "東京",
    "ダート",
    1600,
    4,
    99,
    false,
    "GI",
    15000,
  ],
  [
    "tulip",
    "チューリップ賞",
    "03-01",
    "阪神",
    "芝",
    1600,
    3,
    3,
    true,
    "GII",
    5200,
  ],
  ["yayoi", "弥生賞", "03-08", "中山", "芝", 2000, 3, 3, false, "GII", 5400],
  [
    "spring",
    "スプリングステークス",
    "03-15",
    "中山",
    "芝",
    1800,
    3,
    3,
    false,
    "GII",
    5400,
  ],
  [
    "hanshin-long",
    "阪神大賞典",
    "03-22",
    "阪神",
    "芝",
    3000,
    4,
    99,
    false,
    "GII",
    6700,
  ],
  [
    "takamatsu",
    "高松宮記念",
    "03-29",
    "中京",
    "芝",
    1200,
    4,
    99,
    false,
    "GI",
    17000,
  ],
  ["osaka", "大阪杯", "04-05", "阪神", "芝", 2000, 4, 99, false, "GI", 30000],
  ["oka", "桜花賞", "04-12", "阪神", "芝", 1600, 3, 3, true, "GI", 14000],
  ["satsuki", "皐月賞", "04-19", "中山", "芝", 2000, 3, 3, false, "GI", 20000],
  ["aoba", "青葉賞", "04-25", "東京", "芝", 2400, 3, 3, false, "GII", 5400],
  [
    "flora",
    "フローラステークス",
    "04-26",
    "東京",
    "芝",
    2000,
    3,
    3,
    true,
    "GII",
    5200,
  ],
  [
    "unicorn",
    "ユニコーンステークス",
    "05-02",
    "京都",
    "ダート",
    1900,
    3,
    3,
    false,
    "GIII",
    3700,
  ],
  [
    "tenno-spring",
    "天皇賞（春）",
    "05-03",
    "京都",
    "芝",
    3200,
    4,
    99,
    false,
    "GI",
    30000,
  ],
  [
    "nhk",
    "NHKマイルカップ",
    "05-10",
    "東京",
    "芝",
    1600,
    3,
    3,
    false,
    "GI",
    13000,
  ],
  [
    "victoria",
    "ヴィクトリアマイル",
    "05-17",
    "東京",
    "芝",
    1600,
    4,
    99,
    true,
    "GI",
    13000,
  ],
  [
    "oaks",
    "優駿牝馬（オークス）",
    "05-24",
    "東京",
    "芝",
    2400,
    3,
    3,
    true,
    "GI",
    15000,
  ],
  [
    "derby",
    "東京優駿（日本ダービー）",
    "05-31",
    "東京",
    "芝",
    2400,
    3,
    3,
    false,
    "GI",
    30000,
  ],
  [
    "yasuda",
    "安田記念",
    "06-07",
    "東京",
    "芝",
    1600,
    3,
    99,
    false,
    "GI",
    18000,
  ],
  [
    "takarazuka",
    "宝塚記念",
    "06-14",
    "阪神",
    "芝",
    2200,
    3,
    99,
    false,
    "GI",
    30000,
  ],
  [
    "tokai",
    "東海ステークス",
    "07-26",
    "中京",
    "ダート",
    1400,
    3,
    99,
    false,
    "GIII",
    3800,
  ],
  ["cbc", "CBC賞", "08-09", "中京", "芝", 1200, 3, 99, false, "GIII", 4300],
  [
    "chukyo-two",
    "中京2歳ステークス",
    "08-30",
    "中京",
    "芝",
    1400,
    2,
    2,
    false,
    "GIII",
    3400,
  ],
  [
    "shion",
    "紫苑ステークス",
    "09-06",
    "中山",
    "芝",
    2000,
    3,
    3,
    true,
    "GII",
    5200,
  ],
  [
    "rose",
    "ローズステークス",
    "09-13",
    "阪神",
    "芝",
    1800,
    3,
    3,
    true,
    "GII",
    5200,
  ],
  [
    "stlite",
    "セントライト記念",
    "09-13",
    "中山",
    "芝",
    2200,
    3,
    3,
    false,
    "GII",
    5400,
  ],
  ["kobe", "神戸新聞杯", "09-20", "阪神", "芝", 2400, 3, 3, false, "GII", 5400],
  [
    "sprinters",
    "スプリンターズステークス",
    "09-27",
    "中山",
    "芝",
    1200,
    3,
    99,
    false,
    "GI",
    17000,
  ],
  ["shuka", "秋華賞", "10-18", "京都", "芝", 2000, 3, 3, true, "GI", 11000],
  ["kikka", "菊花賞", "10-25", "京都", "芝", 3000, 3, 3, false, "GI", 20000],
  [
    "tenno-autumn",
    "天皇賞（秋）",
    "11-01",
    "東京",
    "芝",
    2000,
    3,
    99,
    false,
    "GI",
    30000,
  ],
  [
    "elizabeth",
    "エリザベス女王杯",
    "11-15",
    "京都",
    "芝",
    2200,
    3,
    99,
    true,
    "GI",
    13000,
  ],
  [
    "mile",
    "マイルチャンピオンシップ",
    "11-22",
    "京都",
    "芝",
    1600,
    3,
    99,
    false,
    "GI",
    18000,
  ],
  [
    "japan",
    "ジャパンカップ",
    "11-29",
    "東京",
    "芝",
    2400,
    3,
    99,
    false,
    "GI",
    50000,
  ],
  [
    "champions",
    "チャンピオンズカップ",
    "12-06",
    "中京",
    "ダート",
    1800,
    3,
    99,
    false,
    "GI",
    12000,
  ],
  [
    "hanshin-juvenile",
    "阪神ジュベナイルフィリーズ",
    "12-13",
    "阪神",
    "芝",
    1600,
    2,
    2,
    true,
    "GI",
    7500,
  ],
  [
    "asahi",
    "朝日杯フューチュリティステークス",
    "12-20",
    "阪神",
    "芝",
    1600,
    2,
    2,
    false,
    "GI",
    8000,
  ],
  [
    "hopeful",
    "ホープフルステークス",
    "12-26",
    "中山",
    "芝",
    2000,
    2,
    2,
    false,
    "GI",
    8000,
  ],
  ["arima", "有馬記念", "12-27", "中山", "芝", 2500, 3, 99, false, "GI", 50000],
];
export const TRIALS: Record<string, [string, number][]> = {
  derby: [
    ["satsuki", 5],
    ["aoba", 2],
  ],
  satsuki: [
    ["yayoi", 3],
    ["spring", 3],
  ],
  oka: [["tulip", 3]],
  oaks: [
    ["oka", 5],
    ["flora", 2],
  ],
  kikka: [
    ["stlite", 3],
    ["kobe", 3],
  ],
  shuka: [
    ["shion", 3],
    ["rose", 3],
  ],
  "tenno-spring": [["hanshin-long", 1]],
  february: [["negishi", 1]],
};
function recurring(year: number, md: string) {
  if (year === 2026) return `2026-${md}`;
  const base = new Date(`2026-${md}T00:00:00Z`);
  const first = new Date(Date.UTC(year, base.getUTCMonth(), 1));
  const nth = Math.floor((base.getUTCDate() - 1) / 7);
  return nextDate(
    first.toISOString().slice(0, 10),
    ((base.getUTCDay() - first.getUTCDay() + 7) % 7) + nth * 7,
  );
}
const cached = new Map<number, SeasonOpportunity[]>();
export function program(year: number): SeasonOpportunity[] {
  if (cached.has(year)) return cached.get(year)!;
  const list: SeasonOpportunity[] = [];
  function add(
    date: string,
    key: string,
    name: string,
    course: CourseName,
    surface: "芝" | "ダート",
    distance: number,
    raceClass: RaceClass,
    terms: Omit<RaceTerms, "key" | "route">,
  ) {
    list.push({
      kind: "race",
      id: `p3:${date}:${key}`,
      date,
      deadline: nextDate(date, -7),
      selectionDate: nextDate(date, -3),
      name,
      course,
      surface,
      distance,
      raceClass,
      terms: { ...terms, key, route: routeFor(surface, distance) },
    });
  }
  for (const [
    key,
    name,
    md,
    course,
    surface,
    distance,
    minAge,
    maxAge,
    female,
    grade,
    first,
  ] of MAJORS)
    add(recurring(year, md), key, name, course, surface, distance, "オープン", {
      minAge,
      maxAge,
      female,
      grade,
      firstYen: first * 10000,
      capacity:
        surface === "ダート" ||
        key === "arima" ||
        key === "osaka" ||
        key === "sprinters"
          ? 16
          : 18,
      selection:
        key === "arima" || key === "takarazuka"
          ? "fans"
          : key === "derby"
            ? "derby"
            : "earnings",
    });
  // Reduced ordinary programme: each route/class twice monthly; juvenile opportunities separately.
  const venues: CourseName[] = [
    "中山",
    "東京",
    "中山",
    "阪神",
    "東京",
    "阪神",
    "中京",
    "中京",
    "中山",
    "東京",
    "京都",
    "阪神",
  ];
  for (let m = 1; m <= 12; m++)
    for (const n of [0, 2]) {
      const first = `${year}-${String(m).padStart(2, "0")}-01`;
      const date = nextDate(
        first,
        ((7 - new Date(first + "T00:00:00Z").getUTCDay()) % 7) + n * 7,
      );
      for (let ri = 0; ri < 6; ri++) {
        const course =
          n === 0
            ? venues[m - 1]
            : (
                [
                  "京都",
                  "東京",
                  "中京",
                  "阪神",
                  "京都",
                  "東京",
                  "中京",
                  "中京",
                  "阪神",
                  "京都",
                  "東京",
                  "中山",
                ] as CourseName[]
              )[m - 1];
        const surface = ri < 4 ? "芝" : "ダート";
        const distances =
          course === "東京"
            ? [1400, 1600, 2000, 2400, 1400, 2100]
            : course === "中山"
              ? [1200, 1600, 2000, 2500, 1200, 1800]
              : course === "中京"
                ? [1200, 1600, 2000, 3000, 1400, 1800]
                : [1200, 1600, 2000, 2400, 1400, 1800];
        const distance = distances[ri];
        const classes: RaceClass[] = [
          "1勝クラス",
          "2勝クラス",
          "3勝クラス",
          "オープン",
        ];
        if (m <= 8) classes.unshift("未勝利");
        if (m <= 2) classes.unshift("新馬");
        for (const cls of classes) {
          const ci = CLASS_ORDER.indexOf(cls),
            minor = ci < 2;
          add(
            date,
            `ordinary-${m}-${n}-${ri}-${ci}`,
            `${minor ? "3歳" : m < 6 ? "4歳以上" : "3歳以上"}${cls}・${course}${surface}${distance}m`,
            course,
            surface,
            distance,
            cls,
            {
              minAge: minor ? 3 : m < 6 ? 4 : 3,
              maxAge: minor ? 3 : 99,
              female: false,
              grade: cls === "オープン" ? "OP" : "一般",
              capacity: 14,
              firstYen: [
                7500000, 5900000, 8200000, 11900000, 18400000, 24000000,
              ][ci],
              selection: ci < 5 ? "lottery" : "earnings",
            },
          );
        }
        // Before mixed-age racing starts in June, 3-year-old winners need
        // age-restricted 1-win/open opportunities on every route as well.
        if (m < 6)
          for (const cls of ["1勝クラス", "オープン"] as RaceClass[]) {
            add(
              date,
              `spring-three-${m}-${n}-${ri}-${CLASS_ORDER.indexOf(cls)}`,
              `3歳${cls}・${course}${surface}${distance}m`,
              course,
              surface,
              distance,
              cls,
              {
                minAge: 3,
                maxAge: 3,
                female: false,
                grade: cls === "オープン" ? "OP" : "一般",
                capacity: 14,
                firstYen: cls === "オープン" ? 20000000 : 8200000,
                selection: cls === "オープン" ? "earnings" : "lottery",
              },
            );
          }
        if (m >= 6)
          for (const cls of [
            "新馬",
            "未勝利",
            ...(m >= 9 ? ["1勝クラス"] : []),
          ] as RaceClass[]) {
            // Juvenile long-distance prospects start over 2000m; no invented 2yo 3000m races.
            const dist = ri === 3 ? 2000 : distance;
            if (ri === 3) continue;
            const ci = CLASS_ORDER.indexOf(cls);
            add(
              date,
              `juvenile-${m}-${n}-${ri}-${ci}`,
              `2歳${cls}・${course}${surface}${dist}m`,
              course,
              surface,
              dist,
              cls,
              {
                minAge: 2,
                maxAge: 2,
                female: false,
                grade: "一般",
                capacity: 14,
                firstYen: [7500000, 5900000, 8200000][ci],
                selection: "lottery",
              },
            );
          }
      }
    }
  list.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.terms.grade === "一般" ? 1 : 0) - (b.terms.grade === "一般" ? 1 : 0) ||
      a.id.localeCompare(b.id),
  );
  cached.set(year, list);
  if (cached.size > 3) cached.delete(cached.keys().next().value!);
  return list;
}
export function termsReasons(h: Horse, r: SeasonOpportunity) {
  const d = h.details!,
    t = r.terms,
    age = Number(r.date.slice(0, 4)) - Number(h.birthDate.slice(0, 4)),
    out: string[] = [];
  if (age < t.minAge || age > t.maxAge)
    out.push(
      `${t.minAge}${t.maxAge === t.minAge ? "歳" : `歳以上`}の年齢条件を満たしません。`,
    );
  if (t.female && h.sex !== "mare") out.push("牝馬限定の競走です。");
  const earned = d.earnedYen ?? 0;
  if (r.raceClass === "新馬" && d.runs > 0)
    out.push("既に出走しているため新馬戦には登録できません。");
  if (["新馬", "未勝利"].includes(r.raceClass) && earned > 0)
    out.push("収得賞金があるため未勝利の条件を満たしません。");
  const max = {
    "1勝クラス": 5000000,
    "2勝クラス": 10000000,
    "3勝クラス": 16000000,
  }[r.raceClass as "1勝クラス"];
  if (max !== undefined && earned > max)
    out.push(`収得賞金が${max / 10000}万円以下の条件を超えています。`);
  if (t.grade === "GI" && earned === 0)
    out.push("GⅠは未勝利馬・未出走馬の出走を収録していません。");
  return out;
}
export function seasonEligibility(
  w: World,
  r: SeasonOpportunity,
  horseId = w.core.career?.horseId,
  atSelection = false,
) {
  const h = w.entities[horseId ?? ""];
  if (h?.kind !== "horse" || !h.details) return ["所有馬がいません。"];
  const out = termsReasons(h, r),
    d = h.details;
  if (!trainable(w, h))
    out.push("診療・休養・移動・売却手続きにより出走できません。");
  if (!d.registered) out.push("競走馬登録が未完了です。");
  if (!d.gateDate || d.gateDate > w.core.date)
    out.push("ゲート試験の通過報告を待っています。");
  if (!d.enteredDate || nextDate(d.enteredDate, d.runs ? 10 : 15) > r.date)
    out.push(`必要な在厩期間${d.runs ? 10 : 15}日を満たしません。`);
  if (d.unfitUntil && d.unfitUntil >= r.date) out.push("出走不可の期間です。");
  if (d.fatigue > 55) out.push("回復待ちです。今回の登録はできません。");
  if (d.lastRaceDate && nextDate(d.lastRaceDate, 14) > r.date)
    out.push("ゲームでは前走から14日以上の間隔を取ります。");
  if (!atSelection && r.deadline < w.core.date)
    out.push("登録期限を過ぎています。");
  return out;
}
export function seasonOpportunities(w: World): SeasonOpportunity[] {
  const h = w.entities[w.core.career?.horseId ?? ""];
  if (h?.kind !== "horse") return [];
  const until = nextDate(w.core.date, 90),
    y = Number(w.core.date.slice(0, 4));
  return [
    ...program(y),
    ...(until.slice(0, 4) !== String(y) ? program(y + 1) : []),
  ]
    .filter(
      (r) =>
        r.deadline >= w.core.date &&
        r.date <= until &&
        termsReasons(h, r).length === 0,
    )
    .filter((r) => {
      const e = w.entities[r.id] as SeasonRace | undefined;
      return !e || (e.status === "registered" && !e.entries.includes(h.id));
    });
}
export function selectionMoney(h: Horse, date: string) {
  return (
    (h.details!.earnedYen ?? 0) +
    (h.details!.awards ?? []).reduce(
      (n, a) =>
        n +
        (a.date >= nextDate(date, -365) ? a.amountYen : 0) +
        (a.grade === "GI" && a.date >= nextDate(date, -730) ? a.amountYen : 0),
      0,
    )
  );
}
export function selectField(w: World, r: SeasonOpportunity, ids: string[]) {
  const horses = ids.map((id) => w.entities[id] as Horse);
  const notes: Record<string, string> = {};
  const past = (TRIALS[r.terms.key] ? Object.values(w.entities) : []).filter(
    (e): e is SeasonRace =>
      e.kind === "race" &&
      !!e.terms &&
      e.date < r.date &&
      e.date.slice(0, 4) === r.date.slice(0, 4) &&
      !!(e as SeasonRace).finish,
  );
  const fanRank = (
    r.terms.selection === "fans" ? Object.values(w.entities) : []
  )
    .filter(
      (e): e is Horse =>
        e.kind === "horse" &&
        !!e.details &&
        Number(r.date.slice(0, 4)) - Number(e.birthDate.slice(0, 4)) >= 3,
    )
    .sort(
      (a, b) =>
        (b.details!.fans ?? 0) - (a.details!.fans ?? 0) ||
        a.id.localeCompare(b.id),
    );
  const fanPriority =
    r.terms.selection === "fans"
      ? horses
          .filter((h) => fanRank.findIndex((f) => f.id === h.id) < 50)
          .sort((a, b) => fanRank.indexOf(a) - fanRank.indexOf(b))
          .slice(0, 10)
          .map((h) => h.id)
      : [];
  function priority(h: Horse) {
    if (fanPriority.includes(h.id)) return 3;
    if (
      (TRIALS[r.terms.key] ?? []).some(([key, top]) =>
        past.some(
          (p) => p.terms.key === key && p.finish!.slice(0, top).includes(h.id),
        ),
      )
    )
      return 2;
    return 0;
  }
  horses.sort(
    (a, b) =>
      priority(b) - priority(a) ||
      (r.terms.selection === "lottery"
        ? CLASS_ORDER.indexOf(classFor(b)) - CLASS_ORDER.indexOf(classFor(a))
        : selectionMoney(b, r.date) - selectionMoney(a, r.date)) ||
      random(hash(r.id + a.id, w.core.worldSeed))() -
        random(hash(r.id + b.id, w.core.worldSeed))(),
  );
  const field = horses.slice(0, r.terms.capacity).map((h) => h.id),
    excluded = horses.slice(r.terms.capacity).map((h) => h.id);
  for (const h of horses)
    notes[h.id] =
      `${field.includes(h.id) ? "選出" : "除外"}：${priority(h) === 3 ? "ファン投票上位50頭内・申込上位10頭の優先" : priority(h) === 2 ? "収録前哨戦の優先権" : r.terms.selection === "lottery" ? "クラス一致優先・同順位は固定抽選" : `出走馬決定賞金 ${selectionMoney(h, r.date).toLocaleString("ja-JP")}円・同額は固定抽選`}（申込${ids.length}頭／定員${r.terms.capacity}頭）`;
  return { field, excluded, notes };
}
