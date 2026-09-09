import { grow } from "./breeding-model.ts";
import {
  cash,
  createWorld,
  horses,
  nextDate,
  validDate,
  validateWorld,
  type World,
  type Horse,
  type Command,
  type Entity,
} from "./world.ts";
import type {
  CareerCommand,
  Consultation,
  Invoice,
  Market,
  Opportunity,
  Race,
  TrainerId,
} from "./career-types.ts";
import {
  details,
  eligibility,
  hash,
  opportunities,
  ownedHorse,
  ROUTES,
  TRAINERS,
} from "./catalog.ts";
import {
  closeDay,
  contracts,
  debt,
  invoices,
  payDue,
  reserve,
} from "./finance.ts";
import { calculateRace, prizeFor } from "./racing.ts";
function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
function text(value: unknown, max = 200): value is string {
  return (
    typeof value === "string" && value.trim().length > 0 && value.length <= max
  );
}
function money(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= 0 &&
    (value as number) <= 1e12
  );
}
export function event(
  w: World,
  id: string,
  body: string,
  horseId = w.core.career?.horseId,
) {
  w.entities[id] = {
    kind: "event",
    id,
    date: w.core.date,
    text: body,
    ...(horseId ? { horseId } : {}),
  };
}
export function newMarket(w: World) {
  const age = w.core.career?.breeding?.marketAge ?? 2;
  const id = `market:${w.core.date}${age === 1 ? ":yearling" : ""}`;
  const market: Market = {
    kind: "market",
    id,
    date: w.core.date,
    lots: [],
    ...(w.core.career?.breeding ? { age } : {}),
  };
  const names = [
    "アオノシルベ",
    "シロガネロード",
    "ナギノツバサ",
    "ホシノイト",
  ];
  const coats = ["#8f5032", "#b8b3a8", "#44302b", "#be7b49"];
  for (let i = 0; i < 4; i++) {
    const horseId = `${id}:horse:${i}`;
    const seed = hash(horseId, w.core.worldSeed);
    w.entities[horseId] = {
      kind: "horse",
      id: horseId,
      name: names[i],
      birthDate: `${Number(w.core.date.slice(0, 4)) - age}-03-${18 + i}`,
      sex: i % 2 ? "stallion" : "mare",
      ownerId: `seller:${id}`,
      coat: coats[i],
      location: age === 1 ? "1歳育成市場" : "2歳調教公開市場",
      details: details(seed, i),
    };
    const askingYen = (
      age === 1
        ? [3500000, 6500000, 2000000, 4500000]
        : [6000000, 10000000, 3500000, 8000000]
    )[i];
    if (w.core.career?.breeding) {
      const h = w.entities[horseId] as Horse;
      Object.assign(h.details!, {
        earnedYen: 0,
        fans: 0,
        awards: [],
        turn: hash(horseId) % 2 ? "left" : "right",
      });
      if (age === 1) {
        h.family = {
          generation: 0,
          growth: {
            stage: "yearling",
            target: { speed: h.details!.speed, stamina: h.details!.stamina },
          },
        };
        grow(h, "yearling");
        h.details!.unknown =
          "1歳時の外見・歩様の所見です。競走調教の公開はなく、育成・入厩までの費用と待機が必要です。";
      }
    }
    market.lots.push({
      horseId,
      askingYen,
      rivalYen: askingYen + (seed % 9) * 500000,
      status: "open",
    });
  }
  w.entities[id] = market;
  w.core.career!.marketId = id;
  w.core.career!.endDate = `${Number(w.core.date.slice(0, 4)) + 1}-08-31`;
}
export function createCareer(
  ids: { save: string; owner: string; horse: string; contract: string },
  settings: {
    name: string;
    silk: string;
    goal: string;
    initialYen: number;
    annualYen: number;
  },
): World {
  check(
    money(settings.initialYen) &&
      settings.initialYen >= 5000000 &&
      settings.initialYen <= 100000000,
    "初期資金は500万〜1億円にしてください。",
  );
  check(
    money(settings.annualYen) && settings.annualYen <= 20000000,
    "年次拠出は0〜2,000万円にしてください。",
  );
  const w = createWorld(ids, settings.name);
  w.core.engineVersion = "owner-p2";
  w.core.rulesetVersion = "prototype-2026";
  w.core.worldSeed = hash(ids.save);
  w.core.owner = {
    ...w.core.owner,
    name: settings.name,
    silk: settings.silk,
    goal: settings.goal,
    annualYen: settings.annualYen,
  };
  w.core.career = {
    stage: "market",
    marketId: "",
    nextReview: w.core.date,
    route: "turf-mile",
    horseGoal: "この馬と初勝利を",
    annualGoal: "無事にデビューする",
    reserveYen: 1500000,
    endDate: "2027-08-31",
  };
  w.entities = {
    capital: {
      kind: "ledger",
      id: "capital",
      date: w.core.date,
      category: "capital",
      amountYen: settings.initialYen,
      description: "馬主活動への初期拠出",
    },
  };
  newMarket(w);
  event(
    w,
    "first",
    `馬主「${w.core.owner.name}」として、目標「${w.core.owner.goal}」への経歴を始めました。年次拠出は${settings.annualYen.toLocaleString("ja-JP")}円です。`,
  );
  validateWorld(w);
  return w;
}
export function upgradeWorld(world: World, id: string) {
  check(world.core.engineVersion === "owner-p1", "この経歴は移行済みです。");
  const w = structuredClone(world),
    h = horses(w)[0];
  check(h, "移行対象の所有馬がいません。");
  w.core.engineVersion = "owner-p2";
  w.core.rulesetVersion = "prototype-2026";
  const existing = Object.values(w.entities).find((e) => e.kind === "contract");
  h.details = {
    ...details(hash(h.id, w.core.worldSeed)),
    registered: true,
    enteredDate:
      existing?.kind === "contract" ? existing.startDate : w.core.date,
    gateDate: nextDate(w.core.date, 7),
  };
  const endDate = `${Number(h.birthDate.slice(0, 4)) + 3}-08-31`;
  w.core.career = {
    stage: w.core.date >= endDate ? "ended" : "active",
    marketId: "legacy-market",
    horseId: h.id,
    trainerId: "saeki",
    nextReview: nextDate(w.core.date, 7),
    route: "turf-mile",
    horseGoal: w.core.owner.goal,
    annualGoal: "初戦で走りの手がかりを得る",
    reserveYen: 1500000,
    endDate,
    pause:
      w.core.date >= endDate
        ? "この経歴は試作収録期間を過ぎています。記録を保管してP3以降へ引き継げます。"
        : undefined,
  };
  w.entities["legacy-market"] = {
    kind: "market",
    id: "legacy-market",
    date: w.core.date,
    lots: [],
  };
  for (const c of contracts(w)) {
    c.trainerId = "saeki";
    c.accruedYen = 0;
  }
  event(
    w,
    id,
    "P1の愛馬・日付・購入・支払済み台帳を保全してP2へ移行しました。移行日から月末締め翌月7日払いへ切り替え、過去の預託料は再請求しません。市場の購入体験は新しい経歴の機能です。",
    h.id,
  );
  validateWorld(w);
  return w;
}
export function openConsultation(w: World) {
  return Object.values(w.entities).find(
    (e): e is Consultation =>
      e.kind === "consultation" &&
      !e.resolution &&
      (!w.core.career?.portfolio || e.horseId === w.core.career.horseId),
  );
}
export function activeRace(w: World) {
  return Object.values(w.entities).find(
    (e): e is Race =>
      e.kind === "race" &&
      ["registered", "selected", "result"].includes(e.status) &&
      (!w.core.career?.portfolio ||
        ("entries" in e
          ? (e as import("./season-types.ts").SeasonRace).ownedIds.includes(
              w.core.career.horseId!,
            ) &&
            !(e as import("./season-types.ts").SeasonRace).excludedIds.includes(
              w.core.career.horseId!,
            ) &&
            !(
              e as import("./season-types.ts").SeasonRace
            ).cancelledIds.includes(w.core.career.horseId!)
          : e.horseId === w.core.career.horseId)),
  );
}
export function report(w: World, id: string) {
  if (openConsultation(w)) return;
  const h = ownedHorse(w)!;
  const career = w.core.career!;
  const trainer = TRAINERS[career.trainerId!];
  const past = Object.values(w.entities)
    .filter(
      (e): e is Consultation =>
        e.kind === "consultation" && !!e.resolution && e.horseId === h.id,
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  const races = Object.values(w.entities)
    .filter(
      (e): e is Race =>
        e.kind === "race" &&
        e.status === "settled" &&
        !!e.result?.some((r) => r.horseId === h.id),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  const last = races[0];
  const rank = last?.result?.findIndex((r) => r.horseId === h.id);
  const evidence = last
    ? `${last.date} ${last.name}は${last.result?.find((r) => r.horseId === h.id)?.stoppedAt !== undefined ? "競走中止" : `${(rank ?? 0) + 1}着`}。${last.surface}での一戦から、${last.surface === "芝" ? "芝の流れ" : "砂の走り"}を経験しました。`
    : h.details!.gateDate && h.details!.gateDate <= w.core.date
      ? `${h.details!.gateDate}にゲート試験を通過。${h.details!.observation}`
      : `ゲート試験の報告を待っています。${h.details!.observation}`;
  const tired = h.details!.fatigue > 35;
  const conclusion =
    trainer.id === "saeki"
      ? tired
        ? "前走の疲れを残して次へ向かうより、ここは待ちましょう。長く走るための時間にしたい。"
        : "待つ間にも費用はかかります。今の回復と予算を見て、挑む日を一緒に選びましょう。"
      : tired
        ? "もう一度試したい気持ちはあります。ただ、今は回復が先。次の機会までに整えたいです。"
        : "競走でしか分からない反応があります。条件が揃うなら、今の可能性を確かめに行きませんか。";
  w.entities[id] = {
    kind: "consultation",
    id,
    date: w.core.date,
    horseId: h.id,
    trainerId: trainer.id,
    conclusion,
    evidence,
    uncertainty:
      "一戦や調教だけで適性は断定できません。待つことも、別の路線も、勝利の保証にはなりません。",
    previous: past[0]
      ? `${past[0].date}の合意「${past[0].resolution}」。理由は「${past[0].reason}」でした。`
      : "最初の相談です。これからの合意を、この馬の記録に残していきましょう。",
  };
}
export function addInvoice(
  w: World,
  id: string,
  amountYen: number,
  category: Invoice["category"],
  description: string,
  dueDate = w.core.date,
) {
  check(!w.entities[id], "請求が既に存在します。");
  w.entities[id] = {
    kind: "invoice",
    id,
    horseId: w.core.career!.horseId!,
    date: w.core.date,
    dueDate,
    amountYen,
    category,
    description,
    paid: false,
  };
}
export function requireBudget(w: World, amount: number) {
  check(
    cash(w) - debt(w) - reserve(w) >= amount,
    "未払費用と引当を除いた資金が不足します。低い購入上限、出走の見送り、または活動終了を選べます。",
  );
}
function advance(w: World, days: number, id: string) {
  const career = w.core.career!;
  check(
    Number.isInteger(days) && days >= 1 && days <= 31,
    "1〜31日ずつ進めてください。",
  );
  check(
    career.stage === "active",
    "購入・引渡し・預託を先に判断してください。",
  );
  check(!openConsultation(w), "調教師との相談を先に決めてください。");
  check(
    activeRace(w)?.status !== "result",
    "結果を振り返って精算してください。",
  );
  check(
    payDue(w),
    "期日の請求を支払えません。資金と契約で未払いを確認し、活動終了も検討できます。",
  );
  career.pause = undefined;
  let moved = 0;
  for (let i = 0; i < days; i++) {
    if (w.core.date >= career.endDate) {
      career.stage = "ended";
      career.pause =
        "P2の収録期間は3歳8月末までです。この馬と記録は保存されています。続きはP3以降で加わります。";
      break;
    }
    const paid = closeDay(w);
    moved++;
    for (const e of Object.values(w.entities))
      if (e.kind === "horse" && e.details)
        e.details.fatigue = Math.max(0, e.details.fatigue - 2);
    if (!paid) {
      career.pause =
        "預託料の支払資金が不足しています。未払い請求を保存し、日付を止めました。資金と契約を確認してください。";
      break;
    }
    const race = activeRace(w);
    if (race?.status === "registered" && w.core.date >= race.selectionDate) {
      // Selection comes from a fixed field demand, never from display mode or the player's result.
      const excluded =
        hash(race.id + ":selection", w.core.worldSeed) % 10 === 0;
      race.status = excluded ? "excluded" : "selected";
      event(
        w,
        `${race.id}:selection`,
        excluded
          ? `${race.name}は申込多数により除外されました。登録費は返還なし、遠征費は未発生です。`
          : `${race.name}の出走馬に選出されました。状態を見て取消もできます。`,
      );
      if (excluded) {
        career.nextReview = w.core.date;
        report(w, `${race.id}:review`);
      }
      break;
    }
    if (race?.status === "selected" && w.core.date >= race.date) {
      const h = ownedHorse(w)!;
      if (
        (h.details!.unfitUntil && h.details!.unfitUntil >= w.core.date) ||
        h.details!.fatigue > 55
      ) {
        race.status = "cancelled";
        event(
          w,
          `${race.id}:medical`,
          "回復が出走条件に届かず、調教師が出走を取り消しました。",
        );
        report(w, `${race.id}:review`);
        break;
      }
      if (cash(w) < 150000) {
        career.pause =
          "遠征費15万円が不足しています。出走は取消し、未払いの費用は台帳へ残します。";
        race.status = "cancelled";
        report(w, `${race.id}:review`);
        break;
      }
      addInvoice(
        w,
        `${race.id}:transport`,
        150000,
        "transport",
        `${race.name} 遠征・出走費（試作）`,
      );
      payDue(w);
      race.result = calculateRace(w, race);
      race.status = "result";
      race.result.forEach((row, index) => {
        const e = w.entities[row.horseId] as Horse;
        e.details!.runs++;
        if (index === 0) e.details!.wins++;
        e.details!.fatigue = Math.min(100, e.details!.fatigue + 42);
        e.details!.lastRaceDate = w.core.date;
      });
      race.prizeYen = prizeFor(
        race,
        race.result.findIndex((r) => r.horseId === h.id) + 1,
      );
      event(
        w,
        `${race.id}:result`,
        `${race.name}を走り終えました。確定した走りを観戦し、結果と次の方針を振り返れます。`,
      );
      break;
    }
    if (!race && w.core.date >= career.nextReview) {
      report(w, `consult:${w.core.date}:${id}`);
      break;
    }
    if (w.core.date.slice(5) === "12-31") {
      career.nextReview = w.core.date;
      if (!race) report(w, `annual:${w.core.date}`);
      career.pause = "年末です。翌年の固定拠出と目標を資金予測で確認できます。";
      break;
    }
    if (
      Object.values(w.entities).some(
        (e) => e.kind === "invoice" && e.dueDate === w.core.date && e.paid,
      )
    )
      break;
  }
  event(
    w,
    id,
    `${moved}日進み、${w.core.date}で止まりました。${career.pause ?? "報告・請求・競走の予定を確認しました。"}`,
  );
}
export function applyCareer(
  world: World,
  command: Command,
  id: string,
  finalize = true,
): World {
  const w = structuredClone(world),
    c = w.core.career!;
  check(c, "経歴の設定がありません。");
  check(
    c.stage !== "ended" || ["goals", "goal", "rename"].includes(command.type),
    "試作の進行は終了しています。経歴を書き出し、続きの実装に引き継げます。",
  );
  if (command.type === "advance") advance(w, command.days, id);
  else if (command.type === "bid") {
    check(c.stage === "market", "市場で購入候補を選べる状態ではありません。");
    check(
      money(command.limitYen) && text(command.reason),
      "購入上限と理由を入力してください。",
    );
    const market = w.entities[c.marketId] as Market;
    const lot = market.lots.find((l) => l.horseId === command.horseId);
    check(lot && lot.status === "open", "この候補の取引は終了しています。");
    check(
      command.limitYen >= lot.askingYen,
      "開始価格以上の上限を指定してください。",
    );
    requireBudget(w, command.limitYen);
    if (command.limitYen <= lot.rivalYen) {
      lot.status = "lost";
      event(
        w,
        id,
        `${(w.entities[lot.horseId] as Horse).name}は上限${command.limitYen.toLocaleString("ja-JP")}円で競り負けました。理由「${command.reason}」。購入費は発生していません。`,
        undefined,
      );
    } else {
      const price = Math.max(lot.askingYen, lot.rivalYen + 100000);
      lot.status = "won";
      c.horseId = lot.horseId;
      c.stage = "purchase";
      addInvoice(
        w,
        `purchase:${lot.horseId}`,
        price,
        "purchase",
        `${market.age ?? 2}歳市場の取得費（税込・試作）`,
        nextDate(w.core.date, 3),
      );
      event(
        w,
        id,
        `${(w.entities[lot.horseId] as Horse).name}を${price.toLocaleString("ja-JP")}円で落札。購入理由「${command.reason}」。支払・引渡しはこれからです。`,
        lot.horseId,
      );
    }
  } else if (command.type === "next-market") {
    check(c.stage === "market", "未完了の購入があります。");
    const market = w.entities[c.marketId] as Market;
    market.lots.forEach((l) => {
      if (l.status === "open") l.status = "passed";
    });
    for (let i = 0; i < 14; i++) closeDay(w);
    newMarket(w);
    event(
      w,
      id,
      "今回の市場を見送り、14日後の市場へ進みました。前回の候補と購入判断は記録に残っています。",
      undefined,
    );
  } else if (command.type === "receive") {
    check(
      c.stage === "purchase" && text(command.name, 40) && text(command.reason),
      "落札後に馬名と命名理由を入力してください。",
    );
    const invoice = invoices(w).find((i) => i.category === "purchase")!;
    check(invoice && cash(w) >= invoice.amountYen, "購入費を支払えません。");
    invoice.dueDate = w.core.date;
    check(payDue(w), "購入費を支払えません。");
    const h = w.entities[c.horseId!] as Horse;
    h.ownerId = w.core.owner.id;
    h.name = command.name.trim();
    h.location = "引渡し済み・預託先の選択待ち";
    c.stage = "boarding";
    event(
      w,
      id,
      `取得費を支払い「${h.name}」を引き受けました。命名理由「${command.reason}」。`,
    );
  } else if (command.type === "board") {
    check(
      c.stage === "boarding" && Object.hasOwn(TRAINERS, command.trainerId),
      "預託先を選べる状態ではありません。",
    );
    const t = TRAINERS[command.trainerId];
    requireBudget(w, 100000 + t.monthlyYen);
    const h = ownedHorse(w)!;
    const contractId = `contract:${h.id}`;
    w.entities[contractId] = {
      kind: "contract",
      id: contractId,
      horseId: h.id,
      monthlyYen: t.monthlyYen,
      startDate: w.core.date,
      trainer: t.name,
      trainerId: t.id,
      accruedYen: 0,
    };
    c.trainerId = t.id;
    c.stage = "active";
    c.nextReview = nextDate(w.core.date, 15);
    h.location = t.stable;
    h.details!.registered = true;
    h.details!.enteredDate = w.core.date;
    h.details!.gateDate = nextDate(w.core.date, 15);
    addInvoice(
      w,
      `${contractId}:registration`,
      100000,
      "registration",
      "競走馬登録・初期手続き（試作）",
    );
    payDue(w);
    event(
      w,
      id,
      `${t.name}へ預託。月額${t.monthlyYen.toLocaleString("ja-JP")}円、月末締め翌月7日払い。15日後にゲート試験と初戦の相談を予定します。`,
    );
  } else if (command.type === "consult") {
    check(text(command.reason), "判断の理由を記録してください。");
    const consultation = openConsultation(w);
    check(consultation, "未決の相談がありません。");
    check(
      ["race", "wait", "route"].includes(command.choice),
      "相談の選択肢が不正です。",
    );
    if (command.choice === "race") {
      check(!activeRace(w), "既に出走手続き中です。");
      const candidate = opportunities(w).find((r) => r.id === command.raceId);
      check(candidate, "競走候補が見つかりません。");
      const reasons = eligibility(w, candidate);
      check(reasons.length === 0, reasons.join(" "));
      requireBudget(w, 200000);
      const h = ownedHorse(w)!;
      const field = [
        h.id,
        ...Object.values(w.entities)
          .filter(
            (e): e is Horse =>
              e.kind === "horse" && e.id !== h.id && !!e.details,
          )
          .slice(0, 7)
          .map((h) => h.id),
      ];
      while (field.length < 8) {
        const horseId = `rival:${field.length}`;
        if (!w.entities[horseId])
          w.entities[horseId] = {
            kind: "horse",
            id: horseId,
            name: [
              "カゼノタヨリ",
              "ミドリノキセキ",
              "ハルノカナタ",
              "ツキノシズク",
              "ユウヒノミチ",
              "ルリノアサ",
              "オトナシノモリ",
            ][field.length - 1],
            birthDate: h.birthDate,
            sex: "stallion",
            ownerId: "rival-owner",
            coat: "#543d32",
            location: "中央競馬・他厩舎",
            details: {
              ...details(hash(horseId, w.core.worldSeed), field.length),
              registered: true,
            },
          };
        field.push(horseId);
      }
      const race: Race = {
        ...candidate,
        horseId: h.id,
        status: "registered",
        field,
        seed: hash(candidate.id, w.core.worldSeed),
      };
      w.entities[race.id] = race;
      addInvoice(
        w,
        `${race.id}:registration`,
        50000,
        "registration",
        `${race.name} 登録手続費（試作・返還なし）`,
      );
      payDue(w);
      consultation.resolution = `${candidate.date} ${candidate.name}へ出走の意向`;
      c.route = candidate.surface === "芝" ? "turf-mile" : "dirt-middle";
    } else if (command.choice === "route") {
      check(
        command.route && Object.hasOwn(ROUTES, command.route),
        "路線を選んでください。",
      );
      c.route = command.route;
      consultation.resolution = `${ROUTES[c.route]}の路線を検討`;
      c.nextReview = nextDate(w.core.date, 7);
    } else {
      consultation.resolution = "今回は見送り、回復と成長を待つ";
      c.nextReview = nextDate(w.core.date, TRAINERS[c.trainerId!].reviewDays);
    }
    consultation.reason = command.reason.trim();
    event(
      w,
      id,
      `${TRAINERS[c.trainerId!].name}との合意「${consultation.resolution}」。理由「${command.reason}」。`,
    );
  } else if (command.type === "cancel-race") {
    const race = w.entities[command.raceId];
    check(
      race?.kind === "race" &&
        ["registered", "selected"].includes(race.status) &&
        text(command.reason),
      "取消できる出走手続きがありません。",
    );
    race.status = "cancelled";
    event(
      w,
      id,
      `${race.name}を取消。理由「${command.reason}」。支払済み登録費は戻らず、遠征費は発生しません。`,
    );
    report(w, `${id}:review`);
  } else if (command.type === "settle") {
    const race = w.entities[command.raceId];
    check(
      race?.kind === "race" && race.status === "result" && race.result,
      "未精算の結果がありません。",
    );
    const prizeId = `prize:${race.id}`;
    check(!w.entities[prizeId], "賞金は精算済みです。");
    w.entities[prizeId] = {
      kind: "ledger",
      id: prizeId,
      date: w.core.date,
      amountYen: race.prizeYen!,
      category: "prize",
      horseId: race.horseId,
      description: `${race.name} 馬主受取（関係者分20%控除・試作）`,
    };
    race.status = "settled";
    const rank = race.result.findIndex((r) => r.horseId === race.horseId) + 1;
    event(
      w,
      id,
      `${race.name} ${rank}着、馬主受取${race.prizeYen!.toLocaleString("ja-JP")}円を精算。次の方針を担当者と相談します。`,
    );
    report(w, `${id}:review`);
  } else if (command.type === "pay-invoices") {
    check(payDue(w), "支払資金が不足しています。未払い請求を保持しています。");
    c.pause = undefined;
    event(w, id, "期日の請求と入出金を確認しました。");
  } else if (command.type === "end-career") {
    check(text(command.reason), "終了の理由を入力してください。");
    c.stage = "ended";
    c.pause = `活動終了：${command.reason}。所有・未払債務・記録を保管しています。売却・引退後の処理はP4で追加します。`;
    event(w, id, c.pause);
  } else if (command.type === "goals") {
    check(
      text(command.goal, 80) &&
        text(command.horseGoal, 80) &&
        text(command.annualGoal, 80) &&
        text(command.reason),
      "3つの目標と変更理由を入力してください。",
    );
    const prior = `${w.core.owner.goal}／${c.horseGoal}／${c.annualGoal}`;
    w.core.owner.goal = command.goal.trim();
    c.horseGoal = command.horseGoal.trim();
    c.annualGoal = command.annualGoal.trim();
    event(
      w,
      id,
      `目標「${prior}」を「${w.core.owner.goal}／${c.horseGoal}／${c.annualGoal}」へ変更。理由「${command.reason}」。`,
    );
  } else if (command.type === "goal") {
    check(text(command.goal, 80), "目標を入力してください。");
    const prior = w.core.owner.goal;
    w.core.owner.goal = command.goal.trim();
    event(w, id, `目標を「${prior}」から「${w.core.owner.goal}」へ変更。`);
  } else if (command.type === "rename") {
    const h = ownedHorse(w);
    check(
      h && h.id === command.horseId && text(command.name, 40),
      "所有馬名を入力してください。",
    );
    h.name = command.name.trim();
    event(w, id, `愛馬を「${h.name}」と名付けました。`);
  } else throw new Error("未対応の操作です。");
  if (finalize) validateWorld(w);
  return w;
}
// Input validation runs on cloud loads, backups, pending recovery, and after every command.
export function validateCareerEntity(
  raw: Record<string, unknown>,
  entities: Record<string, unknown>,
  date: string,
) {
  const e = raw as unknown as Market | Invoice | Consultation | Race;
  const horse = (id: unknown) =>
    typeof id === "string" && (entities[id] as Horse)?.kind === "horse";
  if (e.kind === "market") {
    check(
      validDate(e.date) &&
        e.date <= date &&
        Array.isArray(e.lots) &&
        e.lots.length <= 4,
      "市場の形式が不正です。",
    );
    check(
      new Set(e.lots.map((l) => l.horseId)).size === e.lots.length,
      "市場の馬が重複しています。",
    );
    for (const l of e.lots)
      check(
        horse(l?.horseId) &&
          money(l.askingYen) &&
          money(l.rivalYen) &&
          l.rivalYen >= l.askingYen &&
          ["open", "won", "lost", "passed"].includes(l.status),
        "市場の候補が不正です。",
      );
  } else if (e.kind === "invoice") {
    check(
      horse(e.horseId) &&
        validDate(e.date) &&
        e.date <= date &&
        validDate(e.dueDate) &&
        e.dueDate >= e.date &&
        money(e.amountYen) &&
        typeof e.paid === "boolean" &&
        text(e.description) &&
        [
          "purchase",
          "boarding",
          "registration",
          "transport",
          "medical",
          "care",
          "sale-fee",
          "stud",
        ].includes(e.category),
      "請求の参照・日付・金額が不正です。",
    );
    if (e.contractId)
      check(
        (entities[e.contractId] as Entity)?.kind === "contract",
        "請求の契約がありません。",
      );
    const paid = entities[`paid:${e.id}`] as Entity | undefined;
    check(
      e.paid
        ? paid?.kind === "ledger" &&
            paid.amountYen === -e.amountYen &&
            paid.horseId === e.horseId &&
            paid.category === e.category
        : !paid,
      "請求と支払台帳が一致しません。",
    );
  } else if (e.kind === "consultation") {
    check(
      horse(e.horseId) &&
        validDate(e.date) &&
        e.date <= date &&
        Object.hasOwn(TRAINERS, e.trainerId) &&
        text(e.conclusion, 1000) &&
        text(e.evidence, 1000) &&
        text(e.uncertainty, 1000) &&
        text(e.previous, 1000),
      "相談の記録が不正です。",
    );
    check(
      e.resolution === undefined
        ? e.reason === undefined
        : text(e.resolution, 200) && text(e.reason),
      "合意と理由が一致しません。",
    );
  } else if (e.kind === "race") {
    check(
      horse(e.horseId) &&
        validDate(e.date) &&
        validDate(e.deadline) &&
        validDate(e.selectionDate) &&
        e.deadline < e.selectionDate &&
        e.selectionDate < e.date &&
        ["東京", "中山"].includes(e.course) &&
        ["芝", "ダート"].includes(e.surface) &&
        [1600, 1800].includes(e.distance) &&
        ["新馬", "未勝利", "1勝クラス", "オープン"].includes(e.raceClass) &&
        text(e.name) &&
        Number.isSafeInteger(e.seed) &&
        [
          "registered",
          "selected",
          "excluded",
          "cancelled",
          "result",
          "settled",
        ].includes(e.status),
      "競走の条件が不正です。",
    );
    check(
      Array.isArray(e.field) &&
        e.field.length === 8 &&
        new Set(e.field).size === 8 &&
        e.field.includes(e.horseId) &&
        e.field.every(horse),
      "出走馬の参照・重複が不正です。",
    );
    const completed = ["result", "settled"].includes(e.status);
    check(
      completed
        ? Array.isArray(e.result) &&
            e.result.length === 8 &&
            e.date <= date &&
            money(e.prizeYen)
        : e.result === undefined && e.prizeYen === undefined,
      "競走結果と状態が一致しません。",
    );
    if (e.result) {
      check(
        new Set(e.result.map((r) => r.horseId)).size === 8,
        "着順が重複しています。",
      );
      e.result.forEach((r, i) =>
        check(
          e.field.includes(r.horseId) &&
            text(r.name, 40) &&
            /^#[\da-f]{6}$/i.test(r.coat) &&
            /^#[\da-f]{6}$/i.test(r.silk) &&
            Number.isFinite(r.seconds) &&
            r.seconds >= 40 &&
            r.seconds < 400 &&
            (i === 0 || e.result![i - 1].seconds <= r.seconds) &&
            Array.isArray(r.splits) &&
            r.splits.length === 21 &&
            r.splits[0] === 0 &&
            r.splits[20] === r.seconds &&
            r.splits.every(
              (t, n) => Number.isFinite(t) && (n === 0 || t > r.splits[n - 1]),
            ),
          "着順・時計・再生経過が不正です。",
        ),
      );
      check(
        e.prizeYen ===
          prizeFor(e, e.result.findIndex((r) => r.horseId === e.horseId) + 1),
        "結果と賞金が一致しません。",
      );
    }
    const prize = entities[`prize:${e.id}`] as Entity | undefined;
    check(
      e.status === "settled"
        ? prize?.kind === "ledger" &&
            prize.amountYen === e.prizeYen &&
            prize.category === "prize"
        : !prize,
      "精算状態と台帳が一致しません。",
    );
  } else throw new Error("未対応の記録種別です。");
}
export function validateCareer(w: World) {
  const c = w.core.career;
  check(
    c &&
      ["market", "purchase", "boarding", "active", "ended"].includes(c.stage) &&
      Object.hasOwn(ROUTES, c.route) &&
      validDate(c.nextReview) &&
      validDate(c.endDate) &&
      text(c.horseGoal, 80) &&
      text(c.annualGoal, 80) &&
      money(c.reserveYen),
    "経歴の進行状態が不正です。",
  );
  check(
    w.entities[c.marketId]?.kind === "market",
    "市場への参照がありません。",
  );
  if (!c.portfolio) {
    const owned = horses(w);
    check(owned.length <= 1, "P2では一頭を所有できます。");
    if (["boarding", "active"].includes(c.stage))
      check(
        owned.length === 1 && owned[0].id === c.horseId,
        "所有と進行状態が一致しません。",
      );
    if (c.stage === "purchase")
      check(
        w.entities[c.horseId!]?.kind === "horse" &&
          owned.length === 0 &&
          invoices(w).some((i) => i.category === "purchase"),
        "落札後の債務がありません。",
      );
    if (c.stage === "market")
      check(!c.horseId && owned.length === 0, "市場と所有が一致しません。");
    if (c.stage === "active")
      check(
        c.trainerId &&
          Object.hasOwn(TRAINERS, c.trainerId) &&
          contracts(w).length === 1 &&
          contracts(w)[0].horseId === c.horseId,
        "預託契約が一致しません。",
      );
    const pending = Object.values(w.entities).filter(
      (e) => e.kind === "consultation" && !e.resolution,
    );
    const racing = Object.values(w.entities).filter(
      (e) =>
        e.kind === "race" &&
        ["registered", "selected", "result"].includes(e.status),
    );
    check(
      pending.length <= 1 &&
        racing.length <= 1 &&
        !(pending.length && racing.length),
      "未決の相談・競走が重複しています。",
    );
  }
  for (const e of Object.values(w.entities)) {
    if (e.kind === "horse") {
      const d = e.details;
      check(d, "馬の継続状態がありません。");
      check(
        [d.speed, d.stamina].every(
          (n) => Number.isFinite(n) && n >= 0 && n <= 100,
        ) &&
          [d.turf, d.dirt].every(
            (n) => Number.isFinite(n) && n >= 0.5 && n <= 1.5,
          ) &&
          Number.isFinite(d.idealDistance) &&
          d.idealDistance >= 1000 &&
          d.idealDistance <= 3600 &&
          Number.isFinite(d.fatigue) &&
          d.fatigue >= 0 &&
          d.fatigue <= 100 &&
          Number.isSafeInteger(d.runs) &&
          d.runs >= 0 &&
          Number.isSafeInteger(d.wins) &&
          d.wins >= 0 &&
          d.wins <= d.runs &&
          typeof d.registered === "boolean" &&
          text(d.pedigree) &&
          text(d.observation) &&
          text(d.unknown),
        "馬の能力・所見が不正です。",
      );
      for (const key of [
        "gateDate",
        "enteredDate",
        "lastRaceDate",
        "unfitUntil",
      ] as const)
        if (d[key] !== undefined)
          check(validDate(d[key]), "馬の予定日が不正です。");
      if (d.lastRaceDate)
        check(d.lastRaceDate <= w.core.date, "未発生の競走履歴です。");
    } else if (e.kind === "contract") {
      check(
        ((e.trainerId && Object.hasOwn(TRAINERS, e.trainerId)) ||
          (w.core.career?.life &&
            e.providerId &&
            ["forest", "haven"].includes(e.providerId))) &&
          money(e.accruedYen),
        "預託の未請求額が不正です。",
      );
      if (e.endDate)
        check(
          validDate(e.endDate) && e.endDate <= w.core.date,
          "契約終了日が不正です。",
        );
    }
  }
}
