import { useState } from "react";
import { horses, type World, type Horse, type Command } from "../domain/world";
import {
  activeEpisode,
  FARMS,
  lifePending,
  personName,
  trainable,
} from "../domain/life-support";
import { contracts, invoices } from "../domain/finance";
import { TRAINERS } from "../domain/catalog";
import { placementReasons } from "../domain/placements";
import { DIAGNOSES } from "../domain/health";
import type { Placement, Scene } from "../domain/life-types";
type Props = {
  world: World;
  ready: boolean;
  act: (c: Command) => Promise<void>;
};
const yen = (n: number) => n.toLocaleString("ja-JP") + "円";
export function lifeLabel(w: World, h: Horse) {
  const e = activeEpisode(w, h);
  if (w.core.career?.life?.closure?.unplacedIds.includes(h.id))
    return "今後の飼養先・資金が未解決";
  if (w.core.career?.stage === "boarding" && w.core.career.horseId === h.id)
    return "預託先の選択待ち";
  return h.life?.deceased
    ? "生涯の記録"
    : h.life?.movementId
      ? "移動・受入調整中"
      : h.life?.saleId
        ? "売却先を照会・引継ぎ中"
        : e && !["cleared", "limited"].includes(e.phase)
          ? e.phase === "decision"
            ? "診療方針の返事待ち"
            : e.phase === "rehab"
              ? "療養と再評価"
              : "診断の報告待ち"
          : h.life?.racing === "barred"
            ? "競走復帰不可・生活を継続"
            : h.life?.racing === "retired"
              ? "引退後の生活"
              : trainable(w, h)
                ? "厩舎で調整中"
                : "牧場で休養中";
}
export function LifeIntro({ world: w, ready, act }: Props) {
  if (w.core.career?.life) return null;
  return (
    <section className="decision-card">
      <p className="eyebrow">続きの一ページ</p>
      <h2>走る日も、休む日も、その先も。</h2>
      <p>
        今の愛馬・資金・契約・途中の相談と結果を引き継ぎ、診療、療養、転厩、売却、引退後の生活を始めます。過去の健康は変更しません。
      </p>
      <p>
        委託先は異常時に初期対応を行い、生命予後が極めて厳しい場合は獣医師が事前合意に基づく緊急対応を判断します。診療費は精算し、復帰と生存の見通しを分けてお知らせします。
      </p>
      <button
        className="primary"
        disabled={!ready}
        onClick={() => void act({ type: "upgrade-life" })}
      >
        愛馬の生涯へ引き継ぐ
      </button>
    </section>
  );
}
export function LifePanel({ world: w, ready, act }: Props) {
  const h = w.entities[w.core.career!.horseId ?? ""];
  if (h?.kind !== "horse" || !h.life) return null;
  return <HorseLife key={h.id} {...{ world: w, ready, act, h }} />;
}
function HorseLife({ world: w, ready, act, h }: Props & { h: Horse }) {
  const e = activeEpisode(w, h),
    c = contracts(w).find((c) => c.horseId === h.id),
    pending = lifePending(w).filter((e) => e.horseId === h.id);
  const [reason, setReason] = useState("この馬の生活と回復を大切にしたい"),
    [purpose, setPurpose] = useState<"rest" | "retirement" | "training">(
      "rest",
    ),
    [provider, setProvider] = useState("forest");
  const movement = w.entities[h.life!.movementId ?? ""] as
      Placement | undefined,
    sale = w.entities[h.life!.saleId ?? ""] as Placement | undefined;
  const ended = w.core.career!.stage === "ended",
    blocked = !ready || ended;
  const reasons = placementReasons(w, h, purpose, provider),
    farm = FARMS[provider as keyof typeof FARMS],
    trainer = TRAINERS[provider as keyof typeof TRAINERS];
  const monthly =
    purpose === "training"
      ? trainer?.monthlyYen
      : purpose === "rest"
        ? farm?.rest
        : h.life!.racing === "barred"
          ? farm?.limited
          : farm?.retirement;
  return (
    <section className="life-panel" aria-label="診療とこれからの生活">
      <p className="eyebrow">小野遼 獣医師 · 委託先からの連絡</p>
      <h2>{lifeLabel(w, h)}</h2>
      {c && (
        <p>
          {c.trainer} · 月額{yen(c.monthlyYen)}。月末締め・翌月7日払い。
        </p>
      )}
      {e ? (
        <article className="care-letter">
          <h3>{e.diagnosis}</h3>
          <p>{e.prognosis}</p>
          <p className="fine">
            診療開始 {e.date} {e.dueDate && `／ 次の報告 ${e.dueDate}`}
            {e.closedDate && `／ 転帰の確認 ${e.closedDate}`}
          </p>
          {e.recurrenceOf && (
            <p>以前の屈腱損傷に続く再発として診療記録を引き継いでいます。</p>
          )}
          {["decision", "limited"].includes(e.phase) && !ended && (
            <>
              <p>
                療養先：白樺牧場。療養 月35万円、医療管理を伴う引退預託
                月18万円。移動費15万円。
                {e.phase === "decision" &&
                  `今回の治療開始費 ${yen(DIAGNOSES[e.cause].cost)}。`}
                費用と再評価日は架空契約の設定です。
              </p>
              <div className="actions">
                {e.phase === "decision" && (
                  <button
                    disabled={blocked || !reason.trim()}
                    onClick={() =>
                      void act({
                        type: "care-plan",
                        episodeId: e.id,
                        choice: "rehab",
                        providerId: "forest",
                        reason,
                      })
                    }
                  >
                    白樺牧場で療養を始める
                  </button>
                )}
                <button
                  disabled={blocked || !reason.trim()}
                  onClick={() => {
                    if (
                      window.confirm(
                        "競走生活を終え、必要な療養と引退後のケアを白樺牧場へ託しますか？",
                      )
                    )
                      void act({
                        type: "care-plan",
                        episodeId: e.id,
                        choice: "retire",
                        providerId: "forest",
                        reason,
                      });
                  }}
                >
                  競走を離れ、ケアを続ける
                </button>
                {e.phase === "decision" && !e.secondOpinion && (
                  <button
                    disabled={blocked || !reason.trim()}
                    onClick={() =>
                      void act({
                        type: "second-opinion",
                        episodeId: e.id,
                        reason,
                      })
                    }
                  >
                    追加所見を依頼する（5万円・3日）
                  </button>
                )}
              </div>
            </>
          )}
          {pending.some((p) => p.id === e.id) &&
            ["dead", "limited"].includes(e.phase) && (
              <button
                disabled={blocked}
                onClick={() =>
                  void act({ type: "acknowledge-health", episodeId: e.id })
                }
              >
                報告を受け取り、記録に残す
              </button>
            )}
        </article>
      ) : (
        <p>
          新たな診療報告はありません。異常時は委託先が初期対応し、所見を連絡します。
        </p>
      )}
      {movement && (
        <p className="notice">
          {movement.dueDate}
          に受入予定。移動中は新しい委託先の契約で飼養し、出走は見合わせます。
        </p>
      )}
      {!h.life!.deceased && !ended && (
        <>
          <label>
            診療・進退を考える理由
            <input
              value={reason}
              maxLength={200}
              onChange={(ev) => setReason(ev.target.value)}
            />
          </label>
          <details className="goals-panel">
            <summary>休養・転厩・引退預託を相談する</summary>
            <p>
              休養後の帰厩は受入先と改めて契約し、在厩期間とゲート確認を待ちます。移動は7日、費用15万円。預託料は契約開始日から日割りです。
            </p>
            <div className="form-grid">
              <label>
                これからの過ごし方
                <select
                  value={purpose}
                  onChange={(ev) => {
                    const value = ev.target.value as typeof purpose;
                    setPurpose(value);
                    setProvider(value === "training" ? "saeki" : "forest");
                  }}
                >
                  <option value="rest">牧場で休養</option>
                  <option value="training">転厩・帰厩</option>
                  <option value="retirement">競走引退・余生預託</option>
                </select>
              </label>
              <label>
                相談する相手
                <select
                  value={provider}
                  onChange={(ev) => setProvider(ev.target.value)}
                >
                  {purpose === "training"
                    ? Object.values(TRAINERS).map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} · {yen(t.monthlyYen)}／月
                        </option>
                      ))
                    : Object.entries(FARMS).map(([id, f]) => (
                        <option key={id} value={id}>
                          {f.name} · {f.person}
                        </option>
                      ))}
                </select>
              </label>
            </div>
            <p>{farm?.policy ?? trainer?.philosophy}</p>
            <p>
              受入済み{" "}
              {
                contracts(w).filter(
                  (c) => (c.providerId ?? c.trainerId) === provider,
                ).length
              }
              ／{farm?.capacity ?? 6}頭。
              {monthly !== undefined && `この条件の月額 ${yen(monthly)}。`}
            </p>
            {reasons.length > 0 && <p className="fine">{reasons.join(" ")}</p>}
            <button
              disabled={
                blocked ||
                !reason.trim() ||
                reasons.length > 0 ||
                (!!e && !["cleared", "limited"].includes(e.phase))
              }
              onClick={() => {
                if (
                  purpose !== "retirement" ||
                  window.confirm(
                    "競走生活を終え、提示された費用で余生預託を始めますか？",
                  )
                )
                  void act({
                    type: "move-horse",
                    horseId: h.id,
                    purpose,
                    providerId: provider,
                    reason,
                  });
              }}
            >
              この条件で預託を依頼する
            </button>
          </details>
          <details className="goals-panel">
            <summary>新しい馬主への引継ぎを相談する</summary>
            <p>
              照会は7日。買い手が見つからない場合もあります。提示額に合意してから7日後の引渡し時に代金を受け取り、手数料5%を精算します。それまでは所有と預託費を引き受けます。
            </p>
            {sale ? (
              <>
                <p>
                  {sale.status === "searching"
                    ? `${sale.dueDate}に条件を報告予定`
                    : sale.status === "offered"
                      ? `${personName(w, sale.targetId!)}から ${yen(sale.priceYen!)}の提示`
                      : `${sale.dueDate}に引渡し予定。確定入金はまだありません。`}
                </p>
                <div className="actions">
                  {sale.status === "offered" && (
                    <button
                      disabled={blocked || !reason.trim()}
                      onClick={() => {
                        if (
                          window.confirm(
                            `${yen(sale.priceYen!)}・手数料5%の条件で、所有移転を進めますか？`,
                          )
                        )
                          void act({
                            type: "sale-response",
                            placementId: sale.id,
                            accept: true,
                            reason,
                          });
                      }}
                    >
                      提示条件で引渡しに合意する
                    </button>
                  )}
                  {["searching", "offered"].includes(sale.status) && (
                    <button
                      disabled={blocked || !reason.trim()}
                      onClick={() =>
                        void act({
                          type: "sale-response",
                          placementId: sale.id,
                          accept: false,
                          reason,
                        })
                      }
                    >
                      照会・提示を辞退する
                    </button>
                  )}
                </div>
              </>
            ) : (
              <button
                disabled={blocked || !reason.trim()}
                onClick={() =>
                  void act({ type: "seek-buyer", horseId: h.id, reason })
                }
              >
                買い手の条件を照会する
              </button>
            )}
          </details>
          <button
            disabled={
              blocked ||
              !reason.trim() ||
              (!!e && !["cleared", "limited"].includes(e.phase))
            }
            onClick={() => void act({ type: "examine", horseId: h.id, reason })}
          >
            状態確認の診察を依頼する（3万円・3日）
          </button>
        </>
      )}
    </section>
  );
}
function Memory({ scene: s, ...props }: Props & { scene: Scene }) {
  const [reply, setReply] = useState(s.reply ?? "");
  return (
    <article className="memory-card">
      <p className="eyebrow">
        {s.date} · {personName(props.world, s.personId)}
      </p>
      <h3>{(props.world.entities[s.horseId] as Horse).name}</h3>
      <p>{s.text}</p>
      <details>
        <summary>この場面につながる記録</summary>
        <ul>
          {s.evidenceIds.map((id) => {
            const e = props.world.entities[id];
            return (
              <li key={id}>
                {"date" in e ? e.date : ""} ·{" "}
                {e.kind === "race"
                  ? e.name
                  : e.kind === "health"
                    ? e.diagnosis
                    : e.kind === "consultation"
                      ? e.resolution
                      : e.kind === "contract"
                        ? e.trainer
                        : e.kind === "event"
                          ? e.text
                          : e.kind === "invoice" || e.kind === "ledger"
                            ? e.description
                            : e.kind === "placement"
                              ? e.reason
                              : id}
              </li>
            );
          })}
        </ul>
      </details>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void props.act({ type: "remember", sceneId: s.id, text: reply });
        }}
      >
        <label>
          この場面に残す言葉（任意）
          <textarea
            maxLength={400}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
          />
        </label>
        <button disabled={!props.ready || !reply.trim() || reply === s.reply}>
          言葉を記録する
        </button>
      </form>
    </article>
  );
}
export function LifeMemories({ world: w, ...props }: Props) {
  const [horse, setHorse] = useState("all"),
    [year, setYear] = useState("all");
  const all = Object.values(w.entities)
    .filter((e): e is Scene => e.kind === "scene")
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const past = Object.values(w.entities).filter(
    (e): e is Horse =>
      e.kind === "horse" &&
      !!e.life?.owners.some((o) => o.ownerId === w.core.owner.id),
  );
  const scenes = all.filter(
    (s) =>
      (horse === "all" || s.horseId === horse) &&
      (year === "all" || s.date.startsWith(year)),
  );
  const [limit, setLimit] = useState(12);
  return (
    <details className="life-memories">
      <summary>人物と愛馬の記憶をたどる · {all.length}場面</summary>
      <h2>一緒に決めたこと、受け取った言葉。</h2>
      <div className="form-grid">
        <label>
          記憶をたどる馬
          <select
            value={horse}
            onChange={(e) => {
              setHorse(e.target.value);
              setLimit(12);
            }}
          >
            <option value="all">すべての愛馬・かつての愛馬</option>
            {past.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
                {h.life!.deceased
                  ? " · 生涯の記録"
                  : h.ownerId !== w.core.owner.id
                    ? " · 新しい馬主のもとへ"
                    : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          記憶の年
          <select
            value={year}
            onChange={(e) => {
              setYear(e.target.value);
              setLimit(12);
            }}
          >
            <option value="all">すべての年</option>
            {[...new Set(all.map((s) => s.date.slice(0, 4)))].map((y) => (
              <option key={y}>{y}</option>
            ))}
          </select>
        </label>
      </div>
      {past
        .filter((h) => horse === h.id)
        .map((h) => (
          <p key={h.id}>
            {h.name} · {lifeLabel(w, h)}。
            {h
              .life!.owners.map(
                (o) =>
                  `${o.from}〜${o.to ?? "現在"}：${o.ownerId === w.core.owner.id ? w.core.owner.name : personName(w, o.ownerId)}`,
              )
              .join(" ／ ")}
          </p>
        ))}
      {!scenes.length && (
        <p>これからの相談と出来事が、ここに積み重なります。</p>
      )}
      {scenes.slice(0, limit).map((s) => (
        <Memory key={s.id} scene={s} world={w} {...props} />
      ))}
      {scenes.length > limit && (
        <button onClick={() => setLimit(limit + 12)}>さらに12場面を読む</button>
      )}
    </details>
  );
}
export function PaymentSupport({ world: w, ready, act }: Props) {
  const [reason, setReason] = useState("支払日までに資金計画を見直す");
  const closed = w.core.career!.life!.closure;
  return (
    <section className="decision-card">
      <h2>{closed ? "活動終了時点の記録" : "支払日を相談する"}</h2>
      {closed ? (
        <>
          <p>
            {closed.date} · {closed.reason}
          </p>
          <p>
            残高 {yen(closed.cashYen)} ／ 残る債務 {yen(closed.debtYen)}。
          </p>
          <p>
            今後の飼養先・資金が未解決：
            {closed.unplacedIds
              .map((id) => (w.entities[id] as Horse).name)
              .join("、") || "該当する所有馬なし"}
            。活動終了だけで、生涯の飼養が保証されたことにはなりません。
          </p>
        </>
      ) : (
        <>
          <p>
            架空契約の猶予条件：請求ごとに200万円以内、期限超過14日以内、一度だけ14日延長。合意した期限と相手の記録を残します。債務は減りません。
          </p>
          <label>
            支払猶予を相談する理由
            <input
              value={reason}
              maxLength={200}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          {invoices(w).map((i) => (
            <div className="payment-row" key={i.id}>
              <p>
                {i.description} · {yen(i.amountYen)} · {i.dueDate}
                {i.deferral &&
                  `（${personName(w, i.deferral.creditor)}との猶予合意済み）`}
              </p>
              {!i.deferral && (
                <button
                  disabled={!ready || !reason.trim() || i.amountYen > 2000000}
                  onClick={() =>
                    void act({
                      type: "extend-payment",
                      invoiceId: i.id,
                      reason,
                    })
                  }
                >
                  この請求の猶予を相談する
                </button>
              )}
            </div>
          ))}
        </>
      )}
    </section>
  );
}
