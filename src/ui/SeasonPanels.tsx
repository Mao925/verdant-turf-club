import { reservedFoals } from "../domain/breeding-support";
import { lifeLabel } from "./LifePanels";
import { livingOwned } from "../domain/life-support";
import { useMemo, useState } from "react";
import {
  cash,
  horses,
  nextDate,
  type World,
  type Horse,
  type Command,
} from "../domain/world";
import { allPending, raceForHorse } from "../domain/season";
import {
  classFor,
  COURSES,
  program,
  routeFor,
  seasonEligibility,
  termsReasons,
  courseProfile,
  CLASS_ORDER,
} from "../domain/program";
import { ROUTES, TRAINERS } from "../domain/catalog";
import type {
  NpcOwner,
  SeasonOpportunity,
  SeasonRace,
} from "../domain/season-types";
import { RaceView } from "./RaceView";
const yen = (n: number) => new Intl.NumberFormat("ja-JP").format(n) + "円";
type Props = {
  world: World;
  ready: boolean;
  act: (c: Command) => Promise<void>;
};
export function PortfolioPanel({ world: w, ready, act }: Props) {
  const owned = horses(w),
    c = w.core.career!,
    pending = allPending(w);
  const locked = ["market", "purchase", "boarding"].includes(c.stage);
  return (
    <section className="portfolio-panel" aria-label="所有馬と全頭の予定">
      <div className="portfolio-heading">
        <div>
          <p className="eyebrow">ひとつの暦、いくつもの夢</p>
          <h2>
            あなたの所有馬 <small>{owned.length}頭</small>
          </h2>
        </div>
        {c.stage === "active" && (
          <button
            disabled={
              !ready || livingOwned(w).length + reservedFoals(w).length >= 12
            }
            onClick={() => void act({ type: "open-market" })}
          >
            もう一頭を探す
          </button>
        )}
        {c.stage === "market" && owned.length > 0 && (
          <button
            className="primary"
            disabled={!ready}
            onClick={() => void act({ type: "close-market" })}
          >
            市場を閉じて愛馬へ
          </button>
        )}
      </div>
      {owned.length > 0 && (
        <div className="horse-roster">
          {owned.map((h) => {
            const p = c.portfolio!.plans[h.id],
              r = raceForHorse(w, h.id),
              consult = pending.some(
                (e) => e.kind === "consultation" && e.horseId === h.id,
              );
            return (
              <button
                key={h.id}
                className={c.horseId === h.id ? "chosen" : ""}
                disabled={!ready || locked}
                aria-pressed={c.horseId === h.id}
                onClick={() =>
                  void act({ type: "select-horse", horseId: h.id })
                }
              >
                <strong>{h.name}</strong>
                <span>
                  {classFor(h)} · {ROUTES[p.route]}
                </span>
                <span>
                  {c.life && !r && !consult
                    ? lifeLabel(w, h)
                    : consult
                      ? "相談への返事待ち"
                      : r
                        ? `${r.status === "result" ? "結果の精算待ち" : r.status === "registered" ? "選出予定" : "競走予定"} ${r.status === "registered" ? r.selectionDate : r.date}`
                        : `次回相談 ${p.nextReview}`}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {pending.length > 0 && (
        <p className="notice" role="status">
          全頭で未決の確認が{pending.length}
          件あります。各愛馬の診療・繁殖報告・売却条件・相談・結果を確認してから、暦を進めます。
        </p>
      )}
      {c.stage === "market" && (
        <div className="actions">
          <span className="fine">
            次回市場{" "}
            {nextDate(
              c.portfolio!.marketOpened ?? c.portfolio!.startedDate,
              14,
            )}
            以降。既存の愛馬の費用と予定も進みます。
          </span>
          <button
            disabled={!ready || pending.length > 0}
            onClick={() => void act({ type: "advance", days: 7 })}
          >
            市場を待ちながら1週間進める
          </button>
        </div>
      )}
    </section>
  );
}
export function RaceTermsPanel({
  race: r,
  world: w,
  showEligibility = true,
}: {
  race: SeasonOpportunity;
  world: World;
  showEligibility?: boolean;
}) {
  const p = courseProfile(r),
    h = w.entities[w.core.career?.horseId ?? ""];
  const errors = h?.kind === "horse" ? seasonEligibility(w, r) : [];
  return (
    <div className="race-terms">
      <p>
        <strong>
          {r.course} {r.surface}
          {r.distance}m
        </strong>{" "}
        · {r.terms.grade} · {r.terms.minAge}
        {r.terms.maxAge === r.terms.minAge ? "歳" : "歳以上"}
        {r.terms.female ? "・牝馬限定" : ""} · 定員{r.terms.capacity}頭
      </p>
      <p className="fine">
        {p.direction === "left" ? "左" : "右"}回り／直線{p.straight}m／高低差
        {p.rise}m。選出は
        {r.terms.selection === "fans"
          ? "ファン上位50頭以内の申込上位10頭を優先し、残枠は出走馬決定賞金順"
          : r.terms.selection === "lottery"
            ? "クラス一致を優先し、同順位は固定抽選"
            : "収録前哨戦の優先権と出走馬決定賞金順"}
        。資格を満たしても除外があります。
      </p>
      <p className="fine">
        本賞金1着{yen(r.terms.firstYen)}
        。馬主受取は本賞金の80%＋完走馬に50万円のゲーム用手当。競走中止時は賞金・手当ともありません。収得賞金は別計算です。
      </p>
      {errors.length > 0 && <p className="fine">現時点：{errors.join(" ")}</p>}
    </div>
  );
}
export function ProgramPanel({ world: w }: { world: World }) {
  const [month, setMonth] = useState(w.core.date.slice(0, 7)),
    [route, setRoute] = useState("all"),
    [course, setCourse] = useState("all"),
    [cls, setClass] = useState("all"),
    [eligible, setEligible] = useState(false),
    [chosen, setChosen] = useState("");
  const year = Number(month.slice(0, 4));
  const calendar = useMemo(() => program(year), [year]);
  const h = w.entities[w.core.career?.horseId ?? ""];
  const rows = calendar.filter(
    (r) =>
      r.date.startsWith(month) &&
      (course === "all" || r.course === course) &&
      (route === "all" || r.terms.route === route) &&
      (cls === "all" ||
        (cls === "重賞"
          ? ["GI", "GII", "GIII"].includes(r.terms.grade)
          : r.raceClass === cls)) &&
      (!eligible ||
        (h?.kind === "horse" && seasonEligibility(w, r).length === 0)),
  );
  const selected = rows.find((r) => r.id === chosen);
  return (
    <details className="program-panel">
      <summary>通年番組を開く · 東京・中山・京都・阪神・中京</summary>
      <h2>夢への道を、暦で見る。</h2>
      <div className="program-filters">
        <label>
          番組の月
          <input
            type="month"
            min="2026-01"
            max="2099-12"
            value={month}
            onChange={(e) => {
              if (
                /^\d{4}-\d{2}$/.test(e.target.value) &&
                e.target.value >= "2026-01" &&
                e.target.value <= "2099-12"
              )
                setMonth(e.target.value);
            }}
          />
        </label>
        <label>
          番組の路線
          <select value={route} onChange={(e) => setRoute(e.target.value)}>
            <option value="all">すべての路線</option>
            {Object.entries(ROUTES).map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          競馬場
          <select value={course} onChange={(e) => setCourse(e.target.value)}>
            <option value="all">全5場</option>
            {Object.keys(COURSES).map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          番組のクラス
          <select value={cls} onChange={(e) => setClass(e.target.value)}>
            <option value="all">すべてのクラス</option>
            <option>重賞</option>
            {CLASS_ORDER.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="inline-check">
        <input
          type="checkbox"
          checked={eligible}
          onChange={(e) => setEligible(e.target.checked)}
        />
        選択中の愛馬が今登録できる条件だけ
      </label>
      <p>
        {month} · {rows.length}競走（年間{calendar.length}競走）
      </p>
      <div className="table-scroll calendar-table">
        <table>
          <thead>
            <tr>
              <th>競走日／登録期限</th>
              <th>競走</th>
              <th>条件／定員</th>
              <th>確認</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  {r.date}
                  <small>締切 {r.deadline}</small>
                </td>
                <td>
                  {r.name}
                  <small>
                    {r.terms.grade} · {r.course}
                  </small>
                </td>
                <td>
                  {r.surface}
                  {r.distance}m
                  <small>
                    {r.terms.minAge}
                    {r.terms.minAge === r.terms.maxAge ? "歳" : "歳以上"}
                    {r.terms.female ? " 牝馬" : ""} · {r.terms.capacity}頭
                  </small>
                </td>
                <td>
                  <button
                    onClick={() => setChosen(r.id)}
                    aria-label={`${r.name}の条件`}
                  >
                    条件
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selected && <RaceTermsPanel race={selected} world={w} />}
      <p className="fine">
        申込みは愛馬の調教師との相談から。2歳の長距離候補は2000m前後でデビューします。一般競走・将来年の開催はゲーム用の編成です。重賞の会場・距離・年齢・性別は2026年を参照。地方・海外・障害・外国招待枠、全重賞、ハンデ重量や地域優先の詳細は収録外です。登録日は7日前、選出は3日前に統一しています。
      </p>
    </details>
  );
}
export function WorldRecords({ world: w }: { world: World }) {
  const [selected, setSelected] = useState(""),
    [replay, setReplay] = useState("");
  const npc = Object.values(w.entities)
    .filter(
      (e): e is Horse =>
        e.kind === "horse" && w.entities[e.ownerId]?.kind === "npc-owner",
    )
    .sort((a, b) => (b.details!.fans ?? 0) - (a.details!.fans ?? 0));
  const races = Object.values(w.entities)
    .filter(
      (e): e is SeasonRace =>
        e.kind === "race" && !!e.terms && !!(e as SeasonRace).finish,
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  const h = w.entities[selected] as Horse | undefined;
  const past = Object.values(w.entities)
    .filter(
      (e): e is SeasonRace =>
        e.kind === "race" && e.status === "settled" && !!e.result,
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  const r = past.find((r) => r.id === replay);
  return (
    <details className="program-panel">
      <summary>世界の戦績と、愛馬の競走記録</summary>
      <h2>同じ相手と、また会う。</h2>
      <p>
        継続するNPC {npc.length}頭／記録済み競走 {races.length}
        。支持は公開実績から増え、購入資金では増やせません。
      </p>
      <div className="npc-grid">
        {npc.slice(0, 12).map((h) => {
          const o = w.entities[h.ownerId] as NpcOwner;
          return (
            <button key={h.id} onClick={() => setSelected(h.id)}>
              <strong>{h.name}</strong>
              <span>
                {o.name} · {h.details!.runs}戦{h.details!.wins}勝
              </span>
              <small>
                {classFor(h)} · 支持{h.details!.fans}
              </small>
            </button>
          );
        })}
      </div>
      {h && (
        <section className="decision-card">
          <h3>{h.name}</h3>
          <p>
            {(w.entities[h.ownerId] as NpcOwner).name}の所有馬。収得賞金
            {yen(h.details!.earnedYen ?? 0)}。
          </p>
          <p className="fine">
            {(w.entities[h.ownerId] as NpcOwner).policy}
            。開始前の戦績も初期世界の設定に含みます。
          </p>
          <ol>
            {races
              .filter((r) => r.field.includes(h.id))
              .slice(0, 8)
              .map((r) => (
                <li key={r.id}>
                  {r.date} {r.name} ·{" "}
                  {r.dnf?.some((d) => d.horseId === h.id)
                    ? "競走中止"
                    : `${r.finish!.indexOf(h.id) + 1}着`}
                </li>
              ))}
          </ol>
        </section>
      )}
      <h3>精算した愛馬の走り</h3>
      <div className="actions">
        {past.slice(0, 12).map((r) => (
          <button key={r.id} onClick={() => setReplay(r.id)}>
            {r.date} {r.name}
          </button>
        ))}
      </div>
      {r && <RaceView key={r.id} race={r} />}
    </details>
  );
}
