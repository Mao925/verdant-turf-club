import { createSeason, allPending } from "../domain/season";
import { classFor, routeFor } from "../domain/program";
import type { SeasonOpportunity, SeasonRace } from "../domain/season-types";
import {
  PortfolioPanel,
  ProgramPanel,
  RaceTermsPanel,
  WorldRecords,
} from "./SeasonPanels";
import { useEffect, useState } from "react";
import {
  cash,
  daysToNextMonth,
  type Command,
  type Horse,
  type World,
} from "../domain/world";
import { activeRace, createCareer, openConsultation } from "../domain/career";
import {
  eligibility,
  opportunities,
  ownedHorse,
  ROUTES,
  TRAINERS,
} from "../domain/catalog";
import {
  contracts,
  debt,
  forecast,
  invoices,
  reserve,
} from "../domain/finance";
import type { Market, Route } from "../domain/career-types";
import { HorseView } from "./HorseView";
import { RaceView } from "./RaceView";
export const yen = (n: number) =>
  new Intl.NumberFormat("ja-JP").format(n) + "円";
type Props = {
  world: World;
  ready: boolean;
  act: (c: Command) => Promise<void>;
};
export function CareerStart({
  ready,
  begin,
}: {
  ready: boolean;
  begin: (w: World) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [silk, setSilk] = useState("#e3bd42");
  const [goal, setGoal] = useState("いつか、有馬記念へ");
  const [initial, setInitial] = useState(3000);
  const [annual, setAnnual] = useState(600);
  const [error, setError] = useState("");
  return (
    <section className="start-card">
      <p className="eyebrow">はじめの一ページ</p>
      <h1>あなたは、どんな馬主になる。</h1>
      <p>
        夢と使える資金を決めて、2歳市場へ。まずは一頭と、最初の勝利を目指します。
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          try {
            const w = createSeason(
              {
                save: crypto.randomUUID(),
                owner: crypto.randomUUID(),
                horse: crypto.randomUUID(),
                contract: crypto.randomUUID(),
              },
              {
                name,
                silk,
                goal,
                initialYen: initial * 10000,
                annualYen: annual * 10000,
              },
            );
            setError("");
            void begin(w);
          } catch (e) {
            setError(
              e instanceof Error ? e.message : "設定を確認してください。",
            );
          }
        }}
      >
        <fieldset disabled={!ready} className="form-grid">
          <label className="wide">
            資金計画の例
            <select
              defaultValue="small"
              onChange={(e) => {
                const preset =
                  e.target.value === "large"
                    ? [50000, 8000]
                    : e.target.value === "medium"
                      ? [10000, 2000]
                      : [3000, 600];
                setInitial(preset[0]);
                setAnnual(preset[1]);
              }}
            >
              <option value="small">少数の愛馬に託す · 3,000万／年600万</option>
              <option value="medium">数頭で挑む · 1億／年2,000万</option>
              <option value="large">大きな夢に投資 · 5億／年8,000万</option>
            </select>
          </label>
          <label>
            馬主名
            <input
              maxLength={40}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="あなたの名前"
            />
          </label>
          <label>
            勝負服の色
            <input
              type="color"
              value={silk}
              onChange={(e) => setSilk(e.target.value)}
            />
          </label>
          <label className="wide">
            夢の競走
            <input
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              maxLength={80}
              required
            />
          </label>
          <label>
            初期の競馬資金（万円）
            <input
              type="number"
              min={500}
              max={50000}
              step={10}
              value={initial}
              onChange={(e) => setInitial(Number(e.target.value))}
              required
            />
          </label>
          <label>
            毎年1月の拠出（万円）
            <input
              type="number"
              min={0}
              max={8000}
              step={10}
              value={annual}
              onChange={(e) => setAnnual(Number(e.target.value))}
              required
            />
          </label>
          <p className="fine wide">
            150万円を引退後などのために引き当てます。拠出は途中で自由に増やせない固定枠です。すべてゲーム内の仮想資金です。
          </p>
          <button className="primary">経歴を始める</button>
        </fieldset>
      </form>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
export function CareerHome({ world: w, ready, act }: Props) {
  const c = w.core.career;
  const horse = ownedHorse(w);
  if (!c)
    return (
      <section className="start-card">
        <p className="eyebrow">続きの一ページへ</p>
        <h1>通年番組で、愛馬との経歴を続ける</h1>
        <p>
          現在の馬・日付・資金・履歴を残して、新しい競走と相談へ進みます。今後の預託料は月末締め・翌月7日払いへ変わります。
        </p>
        <p>移行後は既存の愛馬を残したまま、市場で追加の所有馬を探せます。</p>
        <button
          className="primary"
          disabled={!ready}
          onClick={() => void act({ type: "upgrade-season" })}
        >
          愛馬と記録を引き継ぐ
        </button>
      </section>
    );
  return (
    <>
      {!c.portfolio && (
        <section className="decision-card">
          <p className="eyebrow">P3 · 続きの一ページ</p>
          <h2>5場の通年番組と、複数の愛馬へ</h2>
          <p>
            愛馬・契約・日付・途中の相談・未精算結果を残して引き継ぎます。P2で登録した競走は当時の条件を保ちます。
          </p>
          <button
            className="primary"
            disabled={!ready}
            onClick={() => void act({ type: "upgrade-season" })}
          >
            通年番組へ引き継ぐ
          </button>
        </section>
      )}
      {c.portfolio && <PortfolioPanel {...{ world: w, ready, act }} />}
      <section className="page-heading">
        <div>
          <p className="eyebrow">{w.core.owner.name}の馬主手帳</p>
          <h1>
            {horse?.name ??
              (c.stage === "market"
                ? "まだ見ぬ、一頭に出会う。"
                : "出会いを、愛馬へ。")}
          </h1>
          <p>
            {horse
              ? `${horse.sex === "mare" ? "牝" : "牡"}${Number(w.core.date.slice(0, 4)) - Number(horse.birthDate.slice(0, 4))}歳 · ${horse.location}`
              : "2歳調教公開市場 · 架空の馬と人物"}
          </p>
        </div>
        <span className="date-card">{w.core.date.replaceAll("-", " / ")}</span>
      </section>
      {c.pause && (
        <div className="notice" role="status">
          {c.pause}
        </div>
      )}
      {c.stage === "market" && <MarketPanel {...{ world: w, ready, act }} />}
      {c.stage === "purchase" && <ReceivePanel {...{ world: w, ready, act }} />}
      {c.stage === "boarding" && <TrainerPanel {...{ world: w, ready, act }} />}
      {horse && (
        <>
          <div className="home-grid">
            <HorseView horse={horse} silk={w.core.owner.silk} />
            <aside className="letter">
              <p className="eyebrow">この馬と目指す景色</p>
              <h2>{c.horseGoal}</h2>
              <p>今年は「{c.annualGoal}」。</p>
              <p>{horse.details!.observation}</p>
              <p className="fine">{horse.details!.unknown}</p>
              <div className="letter-sign">
                {c.trainerId
                  ? `担当調教師 ${TRAINERS[c.trainerId].name}`
                  : "預託先の選択を待っています"}
              </div>
              <p>
                {horse.details!.runs}戦 {horse.details!.wins}勝 ·{" "}
                {horse.details!.fatigue > 35
                  ? "回復を待つ時期"
                  : "調整を継続中"}
              </p>
              {c.portfolio && (
                <p>
                  {classFor(horse)} · 収得賞金{" "}
                  {yen(horse.details!.earnedYen ?? 0)}
                </p>
              )}
              <p className="fine">
                登録：{horse.details!.registered ? "完了" : "未完了"} ／
                ゲート試験：
                {horse.details!.gateDate &&
                horse.details!.gateDate <= w.core.date
                  ? `${horse.details!.gateDate} 通過`
                  : `${horse.details!.gateDate ?? "未定"} 報告予定`}
              </p>
            </aside>
          </div>
          {c.stage === "active" && (
            <ActivePanel key={horse.id} {...{ world: w, ready, act }} />
          )}
          <GoalsPanel {...{ world: w, ready, act }} />
        </>
      )}
      {c.portfolio && (
        <>
          <ProgramPanel world={w} />
          <WorldRecords world={w} />
        </>
      )}
      <p className="fine scope-note">
        {c.portfolio
          ? "P3試作：主要5場・芝4路線とダート2路線・通年番組・複数所有。契約と費用はゲーム用の設定です。健康・死亡・売却・引退はP4、繁殖はP5以降で加わります。"
          : "P2試作：一頭・2歳市場〜3歳8月。通年番組へ引き継ぐと、複数所有と主要5場の競走が加わります。"}
      </p>
    </>
  );
}
function MarketPanel({ world: w, ready, act }: Props) {
  const market = w.entities[w.core.career!.marketId] as Market;
  const [selected, setSelected] = useState(market.lots[0]?.horseId ?? "");
  const [limit, setLimit] = useState(1000);
  const [reason, setReason] = useState(
    "歩様と所見から、この馬の可能性に賭けたい",
  );
  useEffect(() => setSelected(market.lots[0]?.horseId ?? ""), [market.id]);
  const lot = market.lots.find((l) => l.horseId === selected);
  const projected = forecast(
    w,
    (w.core.career?.portfolio
      ? contracts(w).reduce((n, c) => n + c.monthlyYen, 0)
      : 0) + 700000,
    limit * 10000,
  );
  return (
    <section>
      <p className="intro">
        走りの所見、まだ分からないこと、買った後の余裕。価格だけでは決められない、最初の選択です。
      </p>
      <div className="market-grid">
        {market.lots.map((l, i) => {
          const h = w.entities[l.horseId] as Horse;
          return (
            <button
              className={`lot-card ${selected === h.id ? "selected" : ""}`}
              key={h.id}
              onClick={() => setSelected(h.id)}
              aria-pressed={selected === h.id}
            >
              <span className="eyebrow">
                LOT 0{i + 1} · {h.sex === "mare" ? "牝" : "牡"}2歳
              </span>
              <span
                className="lot-coat"
                style={{ background: h.coat }}
                aria-hidden="true"
              >
                ♞
              </span>
              <strong>{h.name}</strong>
              <span>{h.details!.pedigree}</span>
              <p>{h.details!.observation}</p>
              <small>{h.details!.unknown}</small>
              <b>開始価格 {yen(l.askingYen)}</b>
              <span>
                {
                  {
                    open: "入札できます",
                    lost: "競り負け・取引終了",
                    won: "落札済み",
                    passed: "見送り",
                  }[l.status]
                }
              </span>
            </button>
          );
        })}
      </div>
      <div className="decision-card">
        <h2>
          {lot ? (w.entities[lot.horseId] as Horse).name : "候補"}
          に、いくらまで託すか。
        </h2>
        <p>
          相手の上限は市場の開始時に決まっています。あなたの上限まで相手を引き上げることはありません。落札額は相手の提示に10万円を上乗せした額です。同額では競り負けます。
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (lot)
              void act({
                type: "bid",
                horseId: lot.horseId,
                limitYen: limit * 10000,
                reason,
              });
          }}
        >
          <fieldset
            disabled={!ready || lot?.status !== "open"}
            className="form-grid"
          >
            <label>
              入札上限（万円）
              <input
                type="number"
                min={lot ? lot.askingYen / 10000 : 0}
                max={50000}
                step={10}
                required
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
              />
            </label>
            <label>
              購入を考えた理由
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={200}
                required
              />
            </label>
            <button className="primary">この上限で入札する</button>
          </fieldset>
        </form>
        <p>
          現在の残高 {yen(cash(w))} ／ 引当 {yen(reserve(w))}
        </p>
        <p className="fine">
          上限額で取得し月額70万円で預託する想定：12か月目の口座残高{" "}
          {yen(projected.rows.at(-1)!.balanceYen)}
          。別途、登録10万円、出走ごとに登録5万円・遠征15万円。購入額は税込、引渡し費を含む試作の見積りです。
        </p>
        <p className="fine">
          預託候補：佐伯修司 月70万円（長く走るため慎重に）／三原葵
          月85万円（実戦で反応を探る）。
          {w.core.career?.portfolio
            ? "受入枠は各6頭、合計12頭です。"
            : "ともに1頭の受入枠があります。"}
        </p>
        <button
          disabled={!ready}
          onClick={() => void act({ type: "next-market" })}
        >
          {w.core.career?.portfolio
            ? "次回市場の所見を受け取る（開催日以降）"
            : "今回は見送り、次の市場へ（14日後）"}
        </button>
      </div>
    </section>
  );
}
function ReceivePanel({ world: w, ready, act }: Props) {
  const h = w.entities[w.core.career!.horseId!] as Horse;
  const [name, setName] = useState(h.name);
  const [reason, setReason] = useState("この馬と進む道の目印に");
  const bill = invoices(w).find((i) => i.category === "purchase")!;
  return (
    <section className="decision-card">
      <p className="eyebrow">落札から、あなたの一頭へ</p>
      <h2>名前と願いを、手渡す。</h2>
      <p>
        取得費 {yen(bill.amountYen)} · 支払期限 {bill.dueDate}
        。支払と引渡しが完了して所有馬になります。
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void act({ type: "receive", name, reason });
        }}
      >
        <fieldset disabled={!ready} className="form-grid">
          <label>
            愛馬の名前
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              required
            />
          </label>
          <label>
            命名の理由
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={200}
              required
            />
          </label>
          <button className="primary">支払い、愛馬を迎える</button>
        </fieldset>
      </form>
    </section>
  );
}
function TrainerPanel({ world: w, ready, act }: Props) {
  return (
    <section>
      <h2>誰に、この馬を託す。</h2>
      <div className="trainer-grid">
        {Object.values(TRAINERS).map((t) => (
          <article className="decision-card" key={t.id}>
            <p className="eyebrow">{t.stable}</p>
            <h3>{t.name}</h3>
            <p>{t.philosophy}</p>
            <p>
              {w.core.career?.portfolio
                ? `現在の受入 ${contracts(w).filter((c) => c.trainerId === t.id).length}/6頭。相談は原則${t.reviewDays}日ごと。`
                : t.constraint}
            </p>
            <strong>月額 {yen(t.monthlyYen)}</strong>
            <p className="fine">
              月末締め・翌月7日払い。開始時の登録手続き10万円。初回報告は入厩15日後。
            </p>
            <p>
              賞金ゼロの12か月後の残高{" "}
              {yen(
                forecast(
                  w,
                  (w.core.career?.portfolio
                    ? contracts(w).reduce((n, c) => n + c.monthlyYen, 0)
                    : 0) + t.monthlyYen,
                  100000,
                ).rows.at(-1)!.balanceYen,
              )}
            </p>
            <button
              className="primary"
              disabled={!ready}
              onClick={() => void act({ type: "board", trainerId: t.id })}
            >
              {t.name}に預ける
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
function ActivePanel({ world: w, ready, act }: Props) {
  const c = w.core.career!,
    consult = openConsultation(w),
    race = activeRace(w);
  const [candidateRoute, setCandidateRoute] = useState<string>("plan");
  const allCandidates = opportunities(w);
  const candidates = c.portfolio
    ? allCandidates
        .filter(
          (r) =>
            candidateRoute === "all" ||
            routeFor(r.surface, r.distance) ===
              (candidateRoute === "plan" ? c.route : candidateRoute) ||
            (candidateRoute === "plan" &&
              c.route === "turf-long" &&
              r.terms?.maxAge === 2 &&
              r.terms.route === "turf-middle"),
        )
        .sort((a, b) => {
          const h = ownedHorse(w)!;
          return (
            Math.abs(
              [
                "新馬",
                "未勝利",
                "1勝クラス",
                "2勝クラス",
                "3勝クラス",
                "オープン",
              ].indexOf(a.raceClass) -
                [
                  "新馬",
                  "未勝利",
                  "1勝クラス",
                  "2勝クラス",
                  "3勝クラス",
                  "オープン",
                ].indexOf(classFor(h)),
            ) -
            Math.abs(
              [
                "新馬",
                "未勝利",
                "1勝クラス",
                "2勝クラス",
                "3勝クラス",
                "オープン",
              ].indexOf(b.raceClass) -
                [
                  "新馬",
                  "未勝利",
                  "1勝クラス",
                  "2勝クラス",
                  "3勝クラス",
                  "オープン",
                ].indexOf(classFor(h)),
            )
          );
        })
    : allCandidates;
  const waitingForOthers = !!c.portfolio && allPending(w).length > 0;
  const [raceId, setRaceId] = useState("");
  const [reason, setReason] = useState("愛馬の回復と今年の目標を大切にしたい");
  const [route, setRoute] = useState<Route>(c.route);
  const proposed =
    candidates.find((r) => r.id === raceId) ??
    candidates.find((r) => routeFor(r.surface, r.distance) === c.route) ??
    candidates[0];
  const reasons = proposed
    ? eligibility(w, proposed)
    : ["収録期間内に登録できる候補がありません。"];
  return (
    <>
      {race && (
        <section className="decision-card">
          <p className="eyebrow">
            {
              {
                registered: "登録を受け付けました",
                selected: "出走馬に選出されました",
                result: "愛馬の走りを振り返る",
                settled: "精算済み",
                excluded: "除外",
                cancelled: "取消",
              }[race.status]
            }
          </p>
          <h2>{race.name}</h2>
          <p>
            登録期限 {race.deadline} ／ 選出 {race.selectionDate} ／ 競走日{" "}
            {race.date}
          </p>
          {race.terms && (
            <>
              <RaceTermsPanel
                race={race as SeasonOpportunity}
                world={w}
                showEligibility={false}
              />
              <p className="fine">
                {(race as SeasonRace).selectionNotes[c.horseId!] ??
                  "締切後に他馬主の申込みと照合します。"}
              </p>
            </>
          )}
          {race.result ? (
            <>
              <RaceView key={race.id} race={race} />
              <p>
                馬主受取 {yen(race.prizeYen!)}
                。結果は保存済みです。観戦方法で結果は変わりません。
              </p>
              <button
                className="primary"
                disabled={!ready}
                onClick={() => void act({ type: "settle", raceId: race.id })}
              >
                結果を精算し、次の相談へ
              </button>
            </>
          ) : (
            <>
              <p>
                登録費5万円は支払済み。選出後の出走で遠征費15万円が発生します。選出前の除外、出走前の取消を区別します。
              </p>
              <label>
                取消を考える理由
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={200}
                />
              </label>
              <button
                disabled={!ready || !reason.trim()}
                onClick={() =>
                  void act({ type: "cancel-race", raceId: race.id, reason })
                }
              >
                この出走を取り消す
              </button>
            </>
          )}
        </section>
      )}
      {consult && (
        <section className="consultation">
          <p className="eyebrow">
            {consult.date} · {TRAINERS[consult.trainerId].name}からの相談
          </p>
          <h2>{consult.conclusion}</h2>
          <p>{consult.evidence}</p>
          <blockquote>{consult.previous}</blockquote>
          <p className="fine">{consult.uncertainty}</p>
          <p>
            今の路線：{ROUTES[c.route]} ／ 口座残高 {yen(cash(w))} ／
            次の相談までの預託料目安{" "}
            {yen(
              Math.ceil(
                (contracts(w).find((t) => t.horseId === c.horseId)!.monthlyYen *
                  TRAINERS[c.trainerId!].reviewDays) /
                  30,
              ),
            )}
          </p>
          <label>
            今回の判断の理由
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={200}
              required
              disabled={!ready}
            />
          </label>
          <div className="choice-grid">
            <article>
              <h3>競走で確かめる</h3>
              {c.portfolio && (
                <label>
                  候補の路線
                  <select
                    value={candidateRoute}
                    disabled={!ready}
                    onChange={(e) => {
                      setCandidateRoute(e.target.value);
                      setRaceId("");
                    }}
                  >
                    <option value="plan">今の計画に沿う候補</option>
                    <option value="all">全路線を比較</option>
                    {Object.entries(ROUTES).map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                次の競走候補
                <select
                  value={proposed?.id ?? ""}
                  onChange={(e) => setRaceId(e.target.value)}
                  disabled={!ready}
                >
                  {candidates.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.date} {r.name}
                    </option>
                  ))}
                </select>
              </label>
              {proposed && (
                <p className="fine">
                  登録期限 {proposed.deadline}
                  。登録5万円・出走時15万円。走った後は回復期間が必要です。
                </p>
              )}
              {proposed?.terms && (
                <RaceTermsPanel
                  race={proposed as SeasonOpportunity}
                  world={w}
                />
              )}
              {reasons.map((s) => (
                <p key={s} className="fine">
                  {s}
                </p>
              ))}
              <button
                className="primary"
                disabled={!ready || !reason.trim() || reasons.length > 0}
                onClick={() =>
                  void act({
                    type: "consult",
                    choice: "race",
                    raceId: proposed!.id,
                    reason,
                  })
                }
              >
                この競走への意向を伝える
              </button>
            </article>
            <article>
              <h3>今は、待つ</h3>
              <p>
                今回の機会を見送り、{TRAINERS[c.trainerId!].reviewDays}
                日後に回復と成長を確認。預託料は続きます。
              </p>
              <button
                disabled={!ready || !reason.trim()}
                onClick={() =>
                  void act({ type: "consult", choice: "wait", reason })
                }
              >
                今回は見送り、待つ
              </button>
            </article>
            <article>
              <h3>違う路線を探る</h3>
              <label>
                検討する路線
                <select
                  value={route}
                  onChange={(e) => setRoute(e.target.value as Route)}
                  disabled={!ready}
                >
                  {Object.entries(ROUTES).map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <p>
                7日後に改めて相談します。別条件の機会と、もとの目標への距離を考えます。
              </p>
              <button
                disabled={!ready || !reason.trim()}
                onClick={() =>
                  void act({ type: "consult", choice: "route", route, reason })
                }
              >
                この路線を相談する
              </button>
            </article>
          </div>
        </section>
      )}
      <section className="decision-row">
        <div>
          <p className="eyebrow">次の時間へ</p>
          <p>
            {waitingForOthers && !consult && race?.status !== "result"
              ? "別の愛馬に未決の確認があります。所有馬の一覧から切り替えてください。"
              : consult
                ? "相談を決めてから日付を進めます。"
                : race?.status === "result"
                  ? "精算後に次の方針を相談します。"
                  : `次の確認：${race ? (race.status === "registered" ? race.selectionDate : race.date) : c.nextReview}。請求・選出・競走でも止まります。`}
          </p>
        </div>
        <div className="actions">
          <button
            disabled={
              !ready ||
              !!consult ||
              race?.status === "result" ||
              waitingForOthers
            }
            onClick={() => void act({ type: "advance", days: 7 })}
          >
            1週間進める
          </button>
          <button
            className="primary"
            disabled={
              !ready ||
              !!consult ||
              race?.status === "result" ||
              waitingForOthers
            }
            onClick={() =>
              void act({ type: "advance", days: daysToNextMonth(w.core.date) })
            }
          >
            1か月進める
          </button>
        </div>
      </section>
    </>
  );
}
function GoalsPanel({ world: w, ready, act }: Props) {
  const c = w.core.career!;
  const [goal, setGoal] = useState(w.core.owner.goal),
    [horseGoal, setHorseGoal] = useState(c.horseGoal),
    [annualGoal, setAnnualGoal] = useState(c.annualGoal),
    [reason, setReason] = useState("");
  useEffect(() => {
    setGoal(w.core.owner.goal);
    setHorseGoal(c.horseGoal);
    setAnnualGoal(c.annualGoal);
  }, [w.core.owner.goal, c.horseGoal, c.annualGoal]);
  return (
    <details className="goals-panel">
      <summary>目標と、その理由を見直す</summary>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void act({ type: "goals", goal, horseGoal, annualGoal, reason });
        }}
      >
        <fieldset disabled={!ready} className="form-grid">
          <label>
            馬主としての夢
            <input
              maxLength={80}
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              required
            />
          </label>
          <label>
            この馬の目標
            <input
              maxLength={80}
              value={horseGoal}
              onChange={(e) => setHorseGoal(e.target.value)}
              required
            />
          </label>
          <label>
            今年の目標
            <input
              maxLength={80}
              value={annualGoal}
              onChange={(e) => setAnnualGoal(e.target.value)}
              required
            />
          </label>
          <label>
            目標を変える理由
            <input
              maxLength={200}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
            />
          </label>
          <button>目標と理由を記録する</button>
        </fieldset>
      </form>
    </details>
  );
}
export function FinancePanel({ world: w, ready, act }: Props) {
  const p = forecast(w);
  const [reason, setReason] = useState("");
  return (
    <section>
      <p className="eyebrow">夢を続けるための余裕</p>
      <h1>資金と契約</h1>
      <div className="metrics">
        <article>
          <span>競馬用口座</span>
          <strong data-testid="balance">{yen(cash(w))}</strong>
        </article>
        <article>
          <span>未請求・未払い</span>
          <strong>{yen(debt(w))}</strong>
        </article>
        <article>
          <span>引当後の自由資金</span>
          <strong>{yen(cash(w) - debt(w) - reserve(w))}</strong>
        </article>
      </div>
      <p>
        毎年1月の拠出 {yen(w.core.owner.annualYen)} ／ 将来のための引当{" "}
        {yen(reserve(w))}
      </p>
      {contracts(w).map((c) => (
        <p key={c.id}>
          {(w.entities[c.horseId] as Horse).name} · {c.trainer}：月額{" "}
          {yen(c.monthlyYen)} · 未請求 {yen(c.accruedYen ?? 0)} ·
          月末締め、翌月7日払い
        </p>
      ))}
      <h2>賞金ゼロの12か月予測</h2>
      <p className="fine">
        現在の契約・請求・固定拠出が続く前提。登録済みの競走は遠征費も仮置きします（除外・取消で変動）。将来の未登録レースや新しい支出は含みません。引当後の資金は、まだ支払っていない請求も差し引きます。
      </p>
      {p.firstShortage && (
        <p className="notice">
          {p.firstShortage}に支払資金が不足する見込みです。
        </p>
      )}
      <div className="table-scroll">
        <table>
          <caption>月末の資金見通し</caption>
          <thead>
            <tr>
              <th>月末</th>
              <th>口座残高</th>
              <th>債務・引当後</th>
            </tr>
          </thead>
          <tbody>
            {p.rows.map((r) => (
              <tr key={r.date}>
                <td>{r.date}</td>
                <td>{yen(r.balanceYen)}</td>
                <td className={r.freeYen < 0 ? "expense" : ""}>
                  {yen(r.freeYen)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {invoices(w).length > 0 && (
        <section className="decision-card">
          <h2>未払いの請求</h2>
          {invoices(w).map((i) => (
            <p key={i.id}>
              {(w.entities[i.horseId] as Horse).name} · {i.description} · 期限{" "}
              {i.dueDate} · {yen(i.amountYen)}
            </p>
          ))}
          <button
            disabled={!ready || w.core.career?.stage === "ended"}
            onClick={() => void act({ type: "pay-invoices" })}
          >
            期日の請求を支払う
          </button>
        </section>
      )}
      <div className="table-scroll">
        <table>
          <caption>入出金の台帳（直近100件）</caption>
          <thead>
            <tr>
              <th>日付</th>
              <th>内容</th>
              <th>金額</th>
            </tr>
          </thead>
          <tbody>
            {Object.values(w.entities)
              .filter((e) => e.kind === "ledger")
              .sort(
                (a, b) =>
                  b.date.localeCompare(a.date) || a.id.localeCompare(b.id),
              )
              .slice(0, 100)
              .map((e) => (
                <tr key={e.id}>
                  <td>{e.date}</td>
                  <td>{e.description}</td>
                  <td className={e.amountYen < 0 ? "expense" : ""}>
                    {yen(e.amountYen)}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {w.core.career && w.core.career.stage !== "ended" && (
        <details className="goals-panel">
          <summary>資金不足で続けられないとき</summary>
          <p>
            購入・出走の見送りを検討できます。期日の費用を支払えない場合、日付は止まります。活動終了では所有・債務・記録を残します。売却や引退後の実務は後続段階で加わります。
          </p>
          <label>
            活動を終える理由
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={200}
            />
          </label>
          <button
            disabled={!ready || !reason.trim()}
            onClick={() => {
              if (
                window.confirm(
                  "この試作での進行を終え、所有と未払いの記録を保管しますか？",
                )
              )
                void act({ type: "end-career", reason });
            }}
          >
            活動終了を記録する
          </button>
        </details>
      )}
    </section>
  );
}
