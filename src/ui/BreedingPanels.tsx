import { useState } from "react";
import {
  horses,
  nextDate,
  type World,
  type Horse,
  type Command,
} from "../domain/world";
import { contracts } from "../domain/finance";
import { SIRES, REARING_MONTHLY, horseAge } from "../domain/breeding-model";
import {
  activeCycle,
  cycles,
  young,
  farmSpaces,
  mareReasons,
  sireReasons,
  breedingQuote,
  reservedFoals,
} from "../domain/breeding-support";
import { ROUTES } from "../domain/catalog";
import type { BreedingCycle, Growth } from "../domain/breeding-types";
import type { Route } from "../domain/career-types";
type Props = {
  world: World;
  ready: boolean;
  act: (c: Command) => Promise<void>;
};
const yen = (n: number) => n.toLocaleString("ja-JP") + "円";
export const growthLabel = (stage: Growth["stage"]) =>
  ({
    foal: "母仔の哺育",
    weanling: "離乳後の成長",
    yearling: "1歳・育成前",
    breaking: "馴致・育成",
    ready: "入厩準備の確認済み",
  })[stage];
const stateLabel = (s: BreedingCycle["status"]) =>
  ({
    applied: "受入先への照会",
    offered: "条件提示への返事待ち",
    reserved: "種付けの予約",
    covered: "受胎確認を待つ",
    pregnant: "妊娠の継続",
    empty: "不受胎の報告",
    lost: "妊娠喪失の報告",
    foaled: "分娩・出生後の経過",
    completed: "出生後の契約確認済み",
    cancelled: "申込み・予約の終了",
  })[s];
export function BreedingIntro({ world: w, ready, act }: Props) {
  if (w.core.career?.breeding) return null;
  return (
    <section className="decision-card">
      <p className="eyebrow">次の世代へ</p>
      <h2>母と重ねた日々を、仔の物語へ。</h2>
      <p>
        今の愛馬・暦・資金・契約・途中の判断を引き継ぎ、外部繁殖、1歳市場、仔の育成と親子の記録を追加します。旧い経歴では診療と引退後の生活も加わります。
      </p>
      <p className="fine">
        委託先の異常時の初期対応と専門家による緊急判断を継続します。受胎・出産・成長には不確実性があり、これまでの個体や記録は保持します。
      </p>
      <button
        className="primary"
        disabled={!ready}
        onClick={() => void act({ type: "upgrade-breeding" })}
      >
        親子の物語へ引き継ぐ
      </button>
    </section>
  );
}
export function MarketAge({ world: w, ready, act }: Props) {
  if (!w.core.career?.breeding) return null;
  const m = w.entities[w.core.career.marketId];
  const age = m.kind === "market" ? (m.age ?? 2) : 2;
  return (
    <div className="market-age">
      <p className="eyebrow">出会う時期も、馬主の選択</p>
      <div className="actions">
        {([2, 1] as const).map((n) => (
          <button
            key={n}
            aria-pressed={age === n}
            className={age === n ? "primary" : ""}
            disabled={!ready || age === n}
            onClick={() => void act({ type: "market-age", age: n })}
          >
            {n === 1 ? "1歳育成市場" : "2歳調教公開市場"}
          </button>
        ))}
      </div>
      <p>
        {age === 1
          ? "1歳の歩様と成長を見て選びます。公開調教はなく、牧場での育成費と2歳以降のデビューまでの待機が必要です。"
          : "公開調教の所見を比較し、引渡し後は調教師への預託を相談します。"}
      </p>
    </div>
  );
}
export function YoungBoarding({ world: w, ready, act }: Props) {
  const h = w.entities[w.core.career!.horseId!] as Horse;
  return (
    <section className="decision-card">
      <h2>成長を、牧場へ託す。</h2>
      <p>
        白樺牧場・森谷澄が預かります。現在の預託月額
        {yen(REARING_MONTHLY[h.family!.growth!.stage])}
        、移動7日・15万円。1歳9月以降の育成契約は月35万円、最低180日と2歳4月以降の再評価を経て入厩を目指します。
      </p>
      <p>現在の空き枠（出生予約を含む）：{farmSpaces(w, h.id)}頭。</p>
      <button
        className="primary"
        disabled={!ready || farmSpaces(w, h.id) < 1}
        onClick={() =>
          void act({
            type: "rear-young",
            horseId: h.id,
            reason: "成長を見ながら育成と入厩を相談する",
          })
        }
      >
        白樺牧場へ育成預託する
      </button>
    </section>
  );
}
export function MarePortrait({ horse: h }: { horse: Horse }) {
  return (
    <article className="young-portrait">
      <p className="eyebrow">白樺牧場で過ごす日々</p>
      <span aria-hidden="true" style={{ color: h.coat }}>
        ♞
      </span>
      <h2>{h.name}</h2>
      <p>この馬の生活と、次の世代を見守る。</p>
      <p className="fine">{h.location}</p>
    </article>
  );
}
export function YoungPortrait({ horse: h }: { horse: Horse }) {
  return (
    <article className="young-portrait">
      <p className="eyebrow">まだ知らない未来へ</p>
      <span aria-hidden="true" style={{ color: h.coat }}>
        ♞
      </span>
      <h2>{h.name}</h2>
      <p>{growthLabel(h.family!.growth!.stage)}</p>
      <p className="fine">
        生まれた日 {h.birthDate}
        <br />
        成長と健康を確かめて、一歩ずつ。
      </p>
    </article>
  );
}
export function BreedingPanel(props: Props) {
  const h = props.world.entities[props.world.core.career!.horseId ?? ""];
  if (h?.kind !== "horse" || !props.world.core.career!.breeding) return null;
  return <HorseBreeding key={h.id} {...props} h={h} />;
}
function HorseBreeding({ world: w, ready, act, h }: Props & { h: Horse }) {
  const b = activeCycle(w, h),
    exam = h.family?.broodmare,
    closed = w.core.career!.stage === "ended";
  const blocked = !ready || closed,
    dead = !!h.life!.deceased;
  const [reason, setReason] = useState(
    "この馬のこれからと、次の世代の生活を考えたい",
  );
  const [sire, setSire] = useState<string>(SIRES[0].id);
  const [payment, setPayment] = useState<"pregnancy" | "live-foal">(
    "pregnancy",
  );
  const ownChildren = Object.values(w.entities).filter(
    (e): e is Horse => e.kind === "horse" && e.family?.damId === h.id,
  );
  const g = h.family?.growth,
    source = w.entities[h.family?.birthCycleId ?? ""];
  const p = w.core.career!.portfolio!.plans[h.id];
  const [name, setName] = useState(h.name),
    [mode, setMode] = useState<"inherit" | "new">("inherit"),
    [goal, setGoal] = useState(p.horseGoal),
    [route, setRoute] = useState<Route>(p.route);
  const q = breedingQuote(w, h, sire, payment),
    reasons = mareReasons(w, h),
    applyReasons = sireReasons(w, h, sire);
  const isBrood = contracts(w).some(
    (c) => c.horseId === h.id && c.purpose === "breeding",
  );
  return (
    <section className="breeding-panel" aria-label="繁殖と親子の記録">
      <p className="eyebrow">森谷澄 · 白樺牧場から</p>
      <h2>{g ? "この仔自身の、一歩ずつ。" : "母と仔の時間を考える。"}</h2>
      {h.family?.damId && (
        <p className="pedigree-links">
          {(["sireId", "damId"] as const).map((k) => {
            const parent = w.entities[h.family![k]!] as Horse;
            return (
              <span key={k}>
                {k === "damId" ? "母" : "父"}：
                {parent.ownerId === w.core.owner.id ? (
                  <button
                    className="text-button"
                    disabled={blocked || w.core.career!.stage !== "active"}
                    onClick={() =>
                      void act({ type: "select-horse", horseId: parent.id })
                    }
                  >
                    {parent.name}
                  </button>
                ) : (
                  parent.name
                )}
                {parent.life?.deceased &&
                  `（${parent.life.deceased.date}死亡）`}
              </span>
            );
          })}
        </p>
      )}
      {ownChildren.length > 0 && (
        <div className="family-children">
          <h3>この母から生まれた仔</h3>
          {ownChildren.map((f) => (
            <p key={f.id}>
              {f.ownerId === w.core.owner.id ? (
                <button
                  disabled={!ready || w.core.career!.stage !== "active"}
                  onClick={() =>
                    void act({ type: "select-horse", horseId: f.id })
                  }
                >
                  {f.name}の記録へ
                </button>
              ) : (
                <span>{f.name} · 新しい馬主へ引継ぎ済み</span>
              )}{" "}
              <span>
                {f.birthDate}出生 ·{" "}
                {f.life?.deceased
                  ? "生涯の記録"
                  : growthLabel(f.family!.growth!.stage)}
              </span>
            </p>
          ))}
        </div>
      )}
      {g && (
        <>
          {g.orphanSupport && g.stage === "foal" && !dead && (
            <p>離乳までの哺育支援：月10万円を追加しています。</p>
          )}
          <ol className="growth-steps" aria-label="仔の成長段階">
            {(
              ["foal", "weanling", "yearling", "breaking", "ready"] as const
            ).map((s) => (
              <li
                key={s}
                className={g.stage === s ? "current" : ""}
                aria-current={g.stage === s ? "step" : undefined}
              >
                {growthLabel(s)}
              </li>
            ))}
          </ol>
          <p>{h.details!.observation}</p>
          {!dead && (
            <p className="fine">
              離乳の目安 {nextDate(h.birthDate, 180)} ／ 育成開始は
              {Number(h.birthDate.slice(0, 4)) + 1}年9月以降。
              {g.readyDate && `入厩準備の再評価 ${g.readyDate}。`}
              診療が必要な場合は経過を確認して待ちます。
            </p>
          )}
          {!dead && !closed && ["weanling", "yearling"].includes(g.stage) && (
            <button
              disabled={
                blocked ||
                !!h.life!.movementId ||
                w.core.date < `${Number(h.birthDate.slice(0, 4)) + 1}-09-01`
              }
              onClick={() =>
                void act({ type: "start-breaking", horseId: h.id, reason })
              }
            >
              段階的な育成を始める（月35万円）
            </button>
          )}
          {!dead && !closed && g.stage === "ready" && (
            <p>
              「休養・転厩・引退預託を相談する」から調教師を選び、入厩とゲート確認へ進めます。
            </p>
          )}
          {source?.kind === "breeding" && !dead && !closed && (
            <details className="goals-panel">
              <summary>仔を名付け、母の目標を継ぐか考える</summary>
              <p>
                母と目指したのは「{source.motherGoal}
                」。この仔の適性に合わせて別の道を選べます。
              </p>
              <div className="form-grid">
                <label>
                  仔の名前
                  <input
                    value={name}
                    maxLength={40}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <label>
                  目標の継ぎ方
                  <select
                    value={mode}
                    onChange={(e) => setMode(e.target.value as typeof mode)}
                  >
                    <option value="inherit">母の目標を継ぐ</option>
                    <option value="new">この仔の目標を選ぶ</option>
                  </select>
                </label>
                <label>
                  仔と目指す目標
                  <input
                    value={mode === "inherit" ? source.motherGoal : goal}
                    disabled={mode === "inherit"}
                    maxLength={80}
                    onChange={(e) => setGoal(e.target.value)}
                  />
                </label>
                <label>
                  仔の路線
                  <select
                    value={route}
                    onChange={(e) => setRoute(e.target.value as Route)}
                  >
                    {Object.entries(ROUTES).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <button
                disabled={
                  blocked || !name.trim() || !reason.trim() || !goal.trim()
                }
                onClick={() =>
                  void act({
                    type: "foal-goal",
                    horseId: h.id,
                    name,
                    mode,
                    goal,
                    route,
                    reason,
                  })
                }
              >
                名前と目標を記録する
              </button>
            </details>
          )}
        </>
      )}
      {b && (
        <article className="breeding-report">
          <p className="eyebrow">繁殖契約 · {stateLabel(b.status)}</p>
          <h3>{(w.entities[b.sireId] as Horse).name}との配合</h3>
          <p>{b.message}</p>
          <div className="breeding-dates">
            <span>申込み {b.date}</span>
            <span>
              種付け {b.matingDate}
              {["applied", "offered", "reserved"].includes(b.status)
                ? "予定"
                : ""}
            </span>
            {b.nextDate && <span>次の報告 {b.nextDate}</span>}
            {b.status === "pregnant" && <span>出産見込み {b.dueDate}</span>}
          </div>
          <p>
            {paymentText(b.payment)} 種付料{yen(b.feeYen)} · {feeText(w, b)}
          </p>
          {b.status === "offered" ? (
            <div className="actions">
              <button
                className="primary"
                disabled={blocked || !reason.trim()}
                onClick={() =>
                  void act({
                    type: "breeding-response",
                    cycleId: b.id,
                    accept: true,
                    reason,
                  })
                }
              >
                この条件で種付けを予約する
              </button>
              <button
                disabled={blocked || !reason.trim()}
                onClick={() =>
                  void act({
                    type: "breeding-response",
                    cycleId: b.id,
                    accept: false,
                    reason,
                  })
                }
              >
                提示を辞退する
              </button>
            </div>
          ) : b.report ? (
            <button
              className="primary"
              disabled={blocked}
              onClick={() =>
                void act({ type: "acknowledge-breeding", cycleId: b.id })
              }
            >
              母仔の報告を受け取る
            </button>
          ) : (
            ["applied", "reserved"].includes(b.status) && (
              <button
                disabled={blocked || !reason.trim()}
                onClick={() =>
                  void act({
                    type: "breeding-response",
                    cycleId: b.id,
                    accept: false,
                    reason,
                  })
                }
              >
                種付け前の申込みを取り消す
              </button>
            )
          )}
        </article>
      )}
      {h.sex === "mare" && !dead && !young(h) && !closed && (
        <details className="goals-panel" open={!!exam && !b}>
          <summary>外部への繁殖預託と配合を相談する</summary>
          <p>
            競走引退後、健康と繁殖適性を診察します。当牧場の受入は3〜18歳。母の月30万円と、出生した仔の哺育・育成は別契約です。種付けの実施と受胎は同じ結果ではありません。
          </p>
          {exam ? (
            <p className="care-letter">
              {exam.status === "assessment"
                ? `${exam.dueDate}に繁殖診察の報告予定です。`
                : exam.reason}
            </p>
          ) : (
            <>
              <p className="fine">{reasons.join(" ")}</p>
              <button
                disabled={blocked || reasons.length > 0 || !reason.trim()}
                onClick={() =>
                  void act({ type: "broodmare-exam", horseId: h.id, reason })
                }
              >
                繁殖適性の診察を依頼する（5万円）
              </button>
            </>
          )}
          {exam?.status === "suitable" && !isBrood && !b && (
            <button
              disabled={
                blocked ||
                reasons.length > 0 ||
                farmSpaces(w, h.id) < 1 ||
                !reason.trim()
              }
              onClick={() =>
                void act({ type: "broodmare-board", horseId: h.id, reason })
              }
            >
              白樺牧場へ繁殖預託する
            </button>
          )}
          {exam?.status === "suitable" && isBrood && !b && (
            <>
              <div className="sire-grid">
                {SIRES.map((s) => {
                  const h = w.entities[s.id] as Horse;
                  return (
                    <article
                      key={s.id}
                      className={sire === s.id ? "selected" : ""}
                    >
                      <h3>{s.name}</h3>
                      <p>{s.note}</p>
                      <p>
                        受胎後支払 {yen(s.fee)}
                        <br />
                        出生後支払 {yen(Math.round(s.fee * 1.2))}
                      </p>
                      <p className="fine">
                        この契約の季節枠 {s.slots}頭。
                        {h.life!.deceased
                          ? "現在は供用を終了しています。"
                          : "空き枠と健康は照会・実施時に再確認します。"}
                      </p>
                      <button
                        aria-pressed={sire === s.id}
                        disabled={blocked || !!h.life!.deceased}
                        onClick={() => setSire(s.id)}
                      >
                        {s.name}を比較する
                      </button>
                    </article>
                  );
                })}
              </div>
              <label>
                種付料の支払条件
                <select
                  value={payment}
                  onChange={(e) => setPayment(e.target.value as typeof payment)}
                >
                  <option value="pregnancy">受胎確認後支払</option>
                  <option value="live-foal">
                    産駒誕生後支払（種付料20%増）
                  </option>
                </select>
              </label>
              <p className="fine">
                {paymentText(payment)}{" "}
                不受胎では種付料は発生しません。流死産・生後30日以内の死亡では種付料のみ免除・返還し、預託・検査・診療・輸送費は残ります。報告と手続きは牧場が行う架空契約です。
              </p>
              <div className="breeding-budget">
                <h3>順調に進んだ場合、仔のデビューまで</h3>
                <p>
                  種付け {q.cover}頃 → 出生 {q.birth}頃 → 2歳シーズン {q.debut}
                  以降
                </p>
                <dl>
                  <div>
                    <dt>母の預託</dt>
                    <dd>{yen(q.motherYen)}</dd>
                  </div>
                  <div>
                    <dt>仔の哺育・育成</dt>
                    <dd>{yen(q.foalYen)}</dd>
                  </div>
                  <div>
                    <dt>条件付き種付料</dt>
                    <dd>{yen(q.feeYen)}</dd>
                  </div>
                  <div>
                    <dt>種付実施・分娩の基本費</dt>
                    <dd>{yen(q.fixedYen)}</dd>
                  </div>
                </dl>
                <p>
                  母仔合計 約{yen(q.totalYen)}
                  。現在の他馬の契約と固定拠出も含めた残高目安{" "}
                  {yen(q.projectedBalance)}。
                </p>
                <p className="fine">
                  年平均の日割りによる概算。現在から仔の入厩前までの比較で、受胎・出産・デビューの保証はありません。追加診療・難産・乳母・再交配、今後の輸送・入厩後の厩舎費、賞金・売却収入は含みません。実際の開始・請求日と月の日割りで変わります。
                </p>
              </div>
              <p className="fine">
                {applyReasons.join(" ") ||
                  `出生予約を含む牧場の空き ${farmSpaces(w)}頭。母に加え、仔の枠1頭を申込み時に確保します。`}
              </p>
              <button
                className="primary"
                disabled={blocked || applyReasons.length > 0 || !reason.trim()}
                onClick={() =>
                  void act({
                    type: "apply-breeding",
                    horseId: h.id,
                    sireId: sire,
                    payment,
                    reason,
                  })
                }
              >
                この配合の受入条件を照会する
              </button>
            </>
          )}
        </details>
      )}
      {!dead && !closed && (
        <label>
          繁殖・育成と親子を考える理由
          <input
            value={reason}
            maxLength={200}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
      )}
      {dead && (
        <p>
          この馬の生涯と親子の参照を保管しています。生きている仔の飼養・育成は続きます。
        </p>
      )}
    </section>
  );
}
function paymentText(p: BreedingCycle["payment"]) {
  return p === "pregnancy"
    ? "種付年9月30日時点の受胎確認後、10月31日期日。"
    : "出生後30日を経過してから請求、種付翌年10月31日期日。";
}
function feeText(w: World, b: BreedingCycle) {
  const i = w.entities[b.feeInvoiceId ?? ""];
  return b.feeStatus === "conditional"
    ? "条件成立前"
    : b.feeStatus === "waived"
      ? "支払不要"
      : b.feeStatus === "refunded"
        ? "種付料を返還済み"
        : i?.kind === "invoice"
          ? i.paid
            ? "支払済み"
            : `未払い・期日${i.dueDate}`
          : "契約を確認";
}
export function BreedingFinances({ world: w }: { world: World }) {
  if (!w.core.career?.breeding) return null;
  const list = cycles(w);
  return (
    <section className="decision-card">
      <h2>母仔の契約と出生予約</h2>
      <p>
        所有枠 {horses(w).filter((h) => !h.life?.deceased).length}頭 ＋ 出生予約{" "}
        {reservedFoals(w).length}頭 ／ 12頭。白樺牧場の空き {farmSpaces(w)}頭。
      </p>
      {list.length ? (
        list.map((b) => (
          <p key={b.id}>
            {(w.entities[b.horseId] as Horse).name} ·{" "}
            {(w.entities[b.sireId] as Horse).name} · {stateLabel(b.status)}
            <br />
            {yen(b.feeYen)} · {feeText(w, b)}
          </p>
        ))
      ) : (
        <p>
          繁殖契約はまだありません。愛馬ページから母仔別の費用を比較できます。
        </p>
      )}
      <p className="fine">
        下の12か月予測は確定した契約・請求が対象です。条件成立前の種付料と未出生の仔の預託・育成費は、繁殖相談の長期概算で別に確認してください。
      </p>
      {w.core.career.life?.closure?.breedingIds?.length ? (
        <p className="notice">
          活動終了時に引継ぎ先が未解決の繁殖：
          {w.core.career.life.closure.breedingIds
            .map(
              (id) =>
                (w.entities[(w.entities[id] as BreedingCycle).horseId] as Horse)
                  .name,
            )
            .join("、")}
          。終了操作だけで妊娠や将来の負担を解消した扱いにはしません。
        </p>
      ) : null}
    </section>
  );
}
