import type {
  Career,
  CareerCommand,
  CareerEntity,
  HorseDetails,
  TrainerId,
} from "./career-types.ts";
import {
  applyCareer,
  upgradeWorld,
  validateCareer,
  validateCareerEntity,
} from "./career.ts";
export type Entity =
  Horse | Contract | LedgerEntry | JournalEvent | CareerEntity;
export type Horse = {
  kind: "horse";
  id: string;
  name: string;
  birthDate: string;
  sex: "mare" | "stallion";
  ownerId: string;
  coat: string;
  location: string;
  details?: HorseDetails;
};
export type Contract = {
  kind: "contract";
  id: string;
  horseId: string;
  monthlyYen: number;
  startDate: string;
  trainer: string;
  trainerId?: TrainerId;
  accruedYen?: number;
  endDate?: string;
};
export type LedgerEntry = {
  kind: "ledger";
  id: string;
  date: string;
  amountYen: number;
  category:
    | "capital"
    | "purchase"
    | "boarding"
    | "registration"
    | "transport"
    | "prize";
  horseId?: string;
  contractId?: string;
  description: string;
};
export type JournalEvent = {
  kind: "event";
  id: string;
  date: string;
  text: string;
  horseId?: string;
};
export type Core = {
  schemaVersion: 1;
  engineVersion: "owner-p1" | "owner-p2";
  rulesetVersion: "foundation-2026" | "prototype-2026";
  career?: Career;
  saveId: string;
  worldSeed: number;
  date: string;
  owner: {
    id: string;
    name: string;
    silk: string;
    goal: string;
    annualYen: number;
  };
};
export type World = { core: Core; entities: Record<string, Entity> };
export type Envelope = { revision: number; state: World };
export type Command =
  | CareerCommand
  | { type: "advance"; days: number }
  | { type: "rename"; horseId: string; name: string }
  | { type: "goal"; goal: string };
export type Patch = { core: Core; upserts: Entity[]; replace: boolean };
const ID = /^[a-zA-Z0-9:_-]{1,150}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const n = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(n) && new Date(n).toISOString().slice(0, 10) === value;
}
export function nextDate(date: string, days = 1) {
  return new Date(Date.parse(date + "T00:00:00Z") + days * 86400000)
    .toISOString()
    .slice(0, 10);
}
export function monthDays(date: string) {
  const d = new Date(date + "T00:00:00Z");
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate();
}
export function daysToNextMonth(date: string) {
  const d = new Date(date + "T00:00:00Z");
  const y = d.getUTCFullYear(),
    m = d.getUTCMonth();
  const day = Math.min(
    d.getUTCDate(),
    new Date(Date.UTC(y, m + 2, 0)).getUTCDate(),
  );
  return Math.round((Date.UTC(y, m + 1, day) - d.getTime()) / 86400000);
}
export function cash(world: World) {
  return Object.values(world.entities).reduce(
    (n, e) => n + (e.kind === "ledger" ? e.amountYen : 0),
    0,
  );
}
export function horses(world: World) {
  return Object.values(world.entities).filter(
    (e): e is Horse => e.kind === "horse" && e.ownerId === world.core.owner.id,
  );
}
function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
function record(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}
function refers(es: Record<string, unknown>, id: unknown, kind: string) {
  if (typeof id !== "string") return false;
  const entity = es[id];
  return record(entity) && entity.kind === kind;
}
function short(x: unknown, max = 100): x is string {
  return typeof x === "string" && x.trim().length > 0 && x.length <= max;
}
function money(x: unknown): x is number {
  return Number.isSafeInteger(x) && Math.abs(x as number) <= 1e12;
}
export function validateWorld(value: unknown): asserts value is World {
  check(
    record(value) && record(value.core) && record(value.entities),
    "保存データの形式が違います。",
  );
  const c = value.core,
    es = value.entities;
  check(
    c.schemaVersion === 1 &&
      ((c.engineVersion === "owner-p1" &&
        c.rulesetVersion === "foundation-2026") ||
        (c.engineVersion === "owner-p2" &&
          c.rulesetVersion === "prototype-2026")),
    "この版の保存データには対応していません。",
  );
  check(
    short(c.saveId) &&
      UUID.test(c.saveId) &&
      validDate(c.date) &&
      c.date >= "2026-01-01" &&
      c.date <= "2100-12-31",
    "保存IDまたは日付が不正です。",
  );
  check(
    Number.isSafeInteger(c.worldSeed) && record(c.owner),
    "馬主データが不正です。",
  );
  const o = c.owner;
  check(
    short(o.id) &&
      UUID.test(o.id) &&
      short(o.name, 40) &&
      short(o.goal, 80) &&
      typeof o.silk === "string" &&
      /^#[\da-f]{6}$/i.test(o.silk) &&
      money(o.annualYen) &&
      o.annualYen >= 0,
    "馬主または予算が不正です。",
  );
  const entries = Object.entries(es);
  check(
    entries.length > 0 && entries.length <= 100000,
    "保存件数の上限を超えています。",
  );
  let total = 0,
    horseCount = 0;
  for (const [id, e] of entries) {
    check(
      ID.test(id) &&
        !["__proto__", "constructor", "prototype"].includes(id) &&
        record(e) &&
        e.id === id,
      "記録IDが不正です。",
    );
    if (e.kind === "horse") {
      horseCount++;
      check(
        short(e.name, 40) &&
          validDate(e.birthDate) &&
          e.birthDate <= c.date &&
          (e.ownerId === o.id ||
            (c.engineVersion === "owner-p2" && short(e.ownerId))) &&
          ["mare", "stallion"].includes(e.sex as string) &&
          short(e.location, 80) &&
          typeof e.coat === "string" &&
          /^#[\da-f]{6}$/i.test(e.coat),
        "馬の記録が不正です。",
      );
    } else if (e.kind === "contract") {
      check(
        refers(es, e.horseId, "horse") &&
          money(e.monthlyYen) &&
          e.monthlyYen >= 0 &&
          validDate(e.startDate) &&
          e.startDate <= c.date &&
          short(e.trainer, 60),
        "契約の参照・日付・金額が不正です。",
      );
    } else if (e.kind === "ledger") {
      check(
        validDate(e.date) &&
          e.date <= c.date &&
          money(e.amountYen) &&
          [
            "capital",
            "purchase",
            "boarding",
            "registration",
            "transport",
            "prize",
          ].includes(e.category as string) &&
          short(e.description, 200),
        "台帳が不正です。",
      );
      check(
        ["capital", "prize"].includes(e.category as string)
          ? e.amountYen >= 0
          : e.amountYen <= 0,
        "台帳の符号が不正です。",
      );
      total += e.amountYen;
      check(Number.isSafeInteger(total), "残高の上限を超えています。");
      if (e.horseId !== undefined)
        check(refers(es, e.horseId, "horse"), "馬の参照がありません。");
      if (e.contractId !== undefined)
        check(refers(es, e.contractId, "contract"), "契約の参照がありません。");
    } else if (e.kind === "event") {
      check(
        validDate(e.date) && e.date <= c.date && short(e.text, 1000),
        "出来事が不正です。",
      );
      if (e.horseId !== undefined)
        check(refers(es, e.horseId, "horse"), "出来事の馬が存在しません。");
    } else if (c.engineVersion === "owner-p2")
      validateCareerEntity(e, es, c.date as string);
    else throw new Error("未対応の記録種別です。");
  }
  check(
    (c.engineVersion === "owner-p2" || horseCount > 0) &&
      total >= 0 &&
      money(total),
    "所有馬または残高が不正です。",
  );
  if (c.engineVersion === "owner-p2") validateCareer(value as World);
}
export function createWorld(
  ids: { save: string; owner: string; horse: string; contract: string },
  name = "新しい馬主",
): World {
  const date = "2026-05-01";
  const world: World = {
    core: {
      schemaVersion: 1,
      engineVersion: "owner-p1",
      rulesetVersion: "foundation-2026",
      saveId: ids.save,
      worldSeed: 20260908,
      date,
      owner: {
        id: ids.owner,
        name: name.trim() || "新しい馬主",
        silk: "#e3bd42",
        goal: "いつか、有馬記念へ",
        annualYen: 6000000,
      },
    },
    entities: {
      [ids.horse]: {
        kind: "horse",
        id: ids.horse,
        name: "アオノシルベ",
        birthDate: "2024-03-18",
        sex: "mare",
        ownerId: ids.owner,
        coat: "#8f5032",
        location: "美浦・佐伯厩舎",
      },
      [ids.contract]: {
        kind: "contract",
        id: ids.contract,
        horseId: ids.horse,
        monthlyYen: 700000,
        startDate: date,
        trainer: "佐伯修司",
      },
      capital: {
        kind: "ledger",
        id: "capital",
        date,
        amountYen: 30000000,
        category: "capital",
        description: "馬主活動への初期拠出",
      },
      purchase: {
        kind: "ledger",
        id: "purchase",
        date,
        amountYen: -6000000,
        category: "purchase",
        horseId: ids.horse,
        description: "基盤検証用の所有馬取得",
      },
      first: {
        kind: "event",
        id: "first",
        date,
        horseId: ids.horse,
        text: "愛馬と目標を持つ経歴を開始しました。現在は保存と所有の基盤検証です。",
      },
    },
  };
  validateWorld(world);
  return world;
}
export function applyCommand(
  world: World,
  command: Command,
  id: string,
): World {
  validateWorld(world);
  check(UUID.test(id), "命令IDが不正です。");
  if (command.type === "upgrade") return upgradeWorld(world, id);
  if (world.core.engineVersion === "owner-p2")
    return applyCareer(world, command, id);
  const next = structuredClone(world);
  const { core, entities } = next;
  if (command.type === "rename") {
    check(short(command.name, 40), "馬名は1〜40文字で入力してください。");
    const h = entities[command.horseId];
    check(h?.kind === "horse", "馬が見つかりません。");
    h.name = command.name.trim();
    entities[id] = {
      kind: "event",
      id,
      date: core.date,
      horseId: h.id,
      text: `愛馬を「${h.name}」と名付けました。`,
    };
  } else if (command.type === "goal") {
    check(short(command.goal, 80), "目標は1〜80文字で入力してください。");
    const previous = core.owner.goal;
    core.owner.goal = command.goal.trim();
    entities[id] = {
      kind: "event",
      id,
      date: core.date,
      text: `目標を「${previous}」から「${core.owner.goal}」へ変更しました。`,
    };
  } else if (command.type === "advance") {
    check(
      Number.isInteger(command.days) && command.days >= 1 && command.days <= 31,
      "1〜31日ずつ進めてください。",
    );
    for (let i = 0; i < command.days; i++) {
      const date = core.date; // Pay for the day being completed, including the starting day.
      if (date.slice(5) === "01-01" && !entities[`capital:${date}`])
        entities[`capital:${date}`] = {
          kind: "ledger",
          id: `capital:${date}`,
          date,
          amountYen: core.owner.annualYen,
          category: "capital",
          description: "本業からの年間拠出",
        };
      const day = Number(date.slice(8)),
        days = monthDays(date);
      for (const contract of Object.values(entities).filter(
        (e): e is Contract => e.kind === "contract",
      )) {
        const charge =
          Math.floor((contract.monthlyYen * day) / days) -
          Math.floor((contract.monthlyYen * (day - 1)) / days);
        check(
          cash(next) >= charge,
          `${date}の預託料が不足します。日付は確定していません。`,
        );
        const key = `${contract.id}:${date}`;
        check(!entities[key], "同じ日の預託料が既に計上されています。");
        entities[key] = {
          kind: "ledger",
          id: key,
          date,
          amountYen: -charge,
          category: "boarding",
          horseId: contract.horseId,
          contractId: contract.id,
          description: "預託料（日割り・検証用契約）",
        };
      }
      core.date = nextDate(date);
      if (core.date.slice(5) === "01-01" && !entities[`capital:${core.date}`])
        entities[`capital:${core.date}`] = {
          kind: "ledger",
          id: `capital:${core.date}`,
          date: core.date,
          amountYen: core.owner.annualYen,
          category: "capital",
          description: "本業からの年間拠出",
        };
    }
    entities[id] = {
      kind: "event",
      id,
      date: core.date,
      text: `${command.days}日を進め、愛馬の預託費を確認しました。`,
    };
  } else throw new Error("未対応の操作です。");
  validateWorld(next);
  return next;
}
export function diff(
  previous: World | null,
  next: World,
  replace = false,
): Patch {
  validateWorld(next);
  return {
    core: next.core,
    replace,
    upserts: Object.values(next.entities).filter(
      (e) =>
        replace ||
        !previous ||
        JSON.stringify(previous.entities[e.id]) !== JSON.stringify(e),
    ),
  };
}
export function parseBackup(text: string): World {
  check(
    new TextEncoder().encode(text).length <= 20 * 1024 * 1024,
    "取込ファイルは20MB以下にしてください。",
  );
  const data: unknown = JSON.parse(text);
  check(
    record(data) && data.format === "verdant-owner-backup-v1",
    "馬主ゲームのバックアップではありません。",
  );
  validateWorld(data.state);
  return data.state;
}
export function backup(state: World, revision: number | null, pending = false) {
  return JSON.stringify(
    {
      format: "verdant-owner-backup-v1",
      exportedAt: new Date().toISOString(),
      revision,
      pending,
      state,
    },
    null,
    2,
  );
}
