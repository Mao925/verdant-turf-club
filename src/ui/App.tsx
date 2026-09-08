import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { OwnerSession } from "../application/session";
import {
  backup,
  cash,
  createWorld,
  daysToNextMonth,
  horses,
  parseBackup,
  validateWorld,
  type World,
  type LedgerEntry,
  type JournalEvent,
} from "../domain/world";
import { WorldEngine } from "../engine/client";
import { BrowserJournal } from "../persistence/journal";
import { configuredClient, SupabaseCloud } from "../persistence/supabase";
import { HorseView } from "./HorseView";
const yen = (n: number) => new Intl.NumberFormat("ja-JP").format(n) + "円";
function download(text: string, name: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function App() {
  const [client] = useState(configuredClient);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(!!client);
  const [error, setError] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  useEffect(() => {
    if (!client) return;
    let alive = true;
    void client.auth
      .getSession()
      .then(({ data, error }) => {
        if (alive) {
          setUser(data.session?.user ?? null);
          setLoading(false);
          if (error) setError("ログインの再確認が必要です。");
        }
      })
      .catch(() => {
        if (alive) {
          setLoading(false);
          setError("ログイン状態を確認できません。再読み込みしてください。");
        }
      });
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      if (alive) {
        setUser(session?.user ?? null);
        setLoading(false);
      }
    });
    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, [client]);
  async function signIn() {
    if (!client || loggingIn) return;
    setLoggingIn(true);
    setError("");
    try {
      const { error } = await client.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.origin + "/" },
      });
      if (error) throw error;
    } catch {
      setError(
        "ログインを開始できませんでした。接続と設定を確認してください。",
      );
      setLoggingIn(false);
    }
  }
  return (
    <>
      <header className="masthead">
        <a href="/" className="brand">
          VERDANT<span>OWNER’S JOURNAL</span>
        </a>
        <div className="masthead-right">
          <span className="edition">開発中の試作</span>
          {user && (
            <button
              className="quiet"
              onClick={() => {
                void client?.auth
                  .signOut({ scope: "local" })
                  .then(({ error }) => {
                    if (error) setError("ログアウトを確認できません。");
                  });
              }}
            >
              ログアウト
            </button>
          )}
        </div>
      </header>
      {loading ? (
        <main className="login">
          <p role="status">経歴を確認しています…</p>
        </main>
      ) : user && client ? (
        <OwnerHome key={user.id} accountId={user.id} client={client} />
      ) : (
        <main className="login">
          <p className="eyebrow">あなたの一頭と、まだ見ぬ景色へ。</p>
          <h1>
            夢は、一度のレースでは
            <br />
            終わらない。
          </h1>
          <p className="intro">
            選び、名付け、人に託す。
            <br />
            愛馬と積み重ねる年月を、ここに残していきましょう。
          </p>
          <button
            className="primary"
            disabled={!client || loggingIn}
            onClick={() => void signIn()}
          >
            {loggingIn ? "ログインへ移動中…" : "Googleでログイン"}
          </button>
          <p className="fine">
            {client
              ? "経歴は自動保存され、別の端末でも続けられます。"
              : "ログインの準備中です。接続設定が整うと経歴を始められます。"}
          </p>
          <div className="login-rule">
            所有する喜び。人に託す覚悟。待つことの重さ。
          </div>
        </main>
      )}
      {error && (
        <p className="global-error" role="alert">
          {error}
        </p>
      )}
      <footer>
        VERDANT · 馬主の物語　
        <span>
          基盤の試作です。市場・競走・継続相談は次の段階で加わります。
        </span>
      </footer>
    </>
  );
}
function OwnerHome({
  accountId,
  client,
}: {
  accountId: string;
  client: SupabaseClient;
}) {
  const resources = useMemo(() => {
    const engine = new WorldEngine(),
      cloud = new SupabaseCloud(client),
      session = new OwnerSession(
        accountId,
        cloud,
        new BrowserJournal(),
        (w, c, id) => engine.run(w, c, id),
      );
    return { engine, cloud, session };
  }, [accountId, client]);
  const { session, cloud } = resources;
  const view = useSyncExternalStore(session.subscribe, session.snapshot);
  const [name, setName] = useState("");
  const [tab, setTab] = useState<"home" | "finance" | "journal">("home");
  const [horseName, setHorseName] = useState("");
  const [goal, setGoal] = useState("");
  const [restore, setRestore] = useState<World | null>(null);
  const [notice, setNotice] = useState("");
  const [history, setHistory] = useState<{ revision: number; state: World }[]>(
    [],
  );
  useEffect(() => {
    void session.load();
    const refresh = () => {
      if (
        document.visibilityState === "visible" &&
        session.snapshot().status === "ready"
      )
        void session.load();
    };
    document.addEventListener("visibilitychange", refresh);
    return () => {
      session.close();
      resources.engine.dispose();
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [session, resources]);
  const world = view.confirmed?.state;
  const horse = world ? horses(world)[0] : null;
  const ready = view.status === "ready" && !view.pending;
  useEffect(() => {
    if (horse) setHorseName(horse.name);
    if (world) setGoal(world.core.owner.goal);
  }, [horse?.name, world?.core.owner.goal]);
  const status = {
    loading: "記録を確認中",
    ready: world ? "クラウド保存済み" : "経歴を開始できます",
    computing: "日程を確認中",
    saving: "保存を確認中",
    offline: "保存を確認できません",
    conflict: "別の端末で更新されています",
    error: "記録を確認してください",
  }[view.status];
  function exportCurrent() {
    if (world)
      download(
        backup(world, view.confirmed!.revision),
        `verdant-${world.core.date}.json`,
      );
  }
  function exportPending() {
    if (view.pending)
      download(backup(view.pending.state, null, true), "verdant-unsent.json");
  }
  async function chooseFile(file?: File) {
    if (!file) return;
    setNotice("");
    try {
      if (file.size > 20 * 1024 * 1024)
        throw new Error("20MB以下のファイルを選んでください。");
      setRestore(parseBackup(await file.text()));
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "読込みに失敗しました。");
    }
  }
  async function loadHistory() {
    try {
      setHistory(await cloud.checkpoints());
      setNotice("");
    } catch {
      setNotice("以前の保存を読み込めませんでした。");
    }
  }
  return (
    <main className="owner-shell">
      <div className={`save-strip ${ready ? "" : "attention"}`} role="status">
        <span className="status-dot" />
        {status}
        {world && (
          <small>
            確定した日付 {world.core.date} · 保存 {view.confirmed!.revision}
          </small>
        )}
      </div>
      {view.message && (
        <div className="notice" role="alert">
          <p>{view.message}</p>
          <p>保存が確認できるまで、次の意思決定と日付の進行を止めています。</p>
          {!["saving", "computing", "loading"].includes(view.status) && (
            <button onClick={() => void session.retry()}>
              同じ処理を再確認
            </button>
          )}
          {view.pending && (
            <button onClick={exportPending}>手元の未送信記録を書き出す</button>
          )}
          {view.status === "conflict" && (
            <button
              onClick={() => {
                if (
                  window.confirm(
                    "未送信の記録をファイルに保管したうえで、クラウドの最新の経歴へ戻りますか？",
                  )
                ) {
                  exportPending();
                  void session.useCloud();
                }
              }}
            >
              クラウドの最新の経歴を使う
            </button>
          )}
        </div>
      )}
      {!world ? (
        <section className="start-card">
          <p className="eyebrow">はじめの一ページ</p>
          <h1>馬主としての経歴を始める</h1>
          <p>
            この基盤試作では、一頭を所有した状態から、記録・日付・費用の保存を確かめられます。
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (ready)
                void session.begin(
                  createWorld(
                    {
                      save: crypto.randomUUID(),
                      owner: crypto.randomUUID(),
                      horse: crypto.randomUUID(),
                      contract: crypto.randomUUID(),
                    },
                    name,
                  ),
                );
            }}
          >
            <label>
              馬主名
              <input
                maxLength={40}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="あなたの名前"
                required
                disabled={!ready}
              />
            </label>
            <button className="primary" disabled={!ready}>
              経歴を始める
            </button>
          </form>
        </section>
      ) : (
        <>
          <nav className="tabs" aria-label="馬主の記録">
            <button
              aria-current={tab === "home" ? "page" : undefined}
              onClick={() => setTab("home")}
            >
              愛馬と予定
            </button>
            <button
              aria-current={tab === "finance" ? "page" : undefined}
              onClick={() => setTab("finance")}
            >
              資金と契約
            </button>
            <button
              aria-current={tab === "journal" ? "page" : undefined}
              onClick={() => setTab("journal")}
            >
              記録室
            </button>
          </nav>
          {tab === "home" && horse && (
            <>
              <section className="page-heading">
                <div>
                  <p className="eyebrow">{world.core.owner.name}の所有馬</p>
                  <h1>{horse.name}</h1>
                  <p>
                    {horse.sex === "mare" ? "牝" : "牡"}
                    {Number(world.core.date.slice(0, 4)) -
                      Number(horse.birthDate.slice(0, 4))}
                    歳 · {horse.location}
                  </p>
                </div>
                <span className="date-card">
                  {world.core.date.replaceAll("-", " / ")}
                </span>
              </section>
              <div className="home-grid">
                <HorseView horse={horse} silk={world.core.owner.silk} />
                <aside className="letter">
                  <p className="eyebrow">この馬と目指す景色</p>
                  <h2>{world.core.owner.goal}</h2>
                  <p>
                    目標を変えても、これまでの願いは記録に残ります。愛馬のために使える時間と資金を、少しずつ確かめていきましょう。
                  </p>
                  <div className="letter-sign">担当調教師　佐伯 修司</div>
                  <p className="fine">
                    現在は所有・保存の基盤確認用の紹介文です。所見と継続相談は次の段階で実装します。
                  </p>
                </aside>
              </div>
              <section className="decision-row">
                <div>
                  <p className="eyebrow">次の時間へ</p>
                  <p>預託料を確認しながら進めます。</p>
                </div>
                <div className="actions">
                  <button
                    disabled={!ready}
                    onClick={() =>
                      void session.act({ type: "advance", days: 7 })
                    }
                  >
                    1週間進める
                  </button>
                  <button
                    className="primary"
                    disabled={!ready}
                    onClick={() =>
                      void session.act({
                        type: "advance",
                        days: daysToNextMonth(world.core.date),
                      })
                    }
                  >
                    1か月進める
                  </button>
                </div>
              </section>
              <div className="forms-grid">
                <form
                  onSubmit={(e: FormEvent) => {
                    e.preventDefault();
                    void session.act({
                      type: "rename",
                      horseId: horse.id,
                      name: horseName,
                    });
                  }}
                >
                  <label>
                    愛馬の名前
                    <input
                      value={horseName}
                      maxLength={40}
                      onChange={(e) => setHorseName(e.target.value)}
                      disabled={!ready}
                    />
                  </label>
                  <button disabled={!ready || !horseName.trim()}>
                    馬名を記録する
                  </button>
                </form>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void session.act({ type: "goal", goal });
                  }}
                >
                  <label>
                    馬主としての目標
                    <input
                      value={goal}
                      maxLength={80}
                      onChange={(e) => setGoal(e.target.value)}
                      disabled={!ready}
                    />
                  </label>
                  <button disabled={!ready || !goal.trim()}>
                    目標を記録する
                  </button>
                </form>
              </div>
            </>
          )}
          {tab === "finance" && (
            <section>
              <p className="eyebrow">夢を続けるための余裕</p>
              <h1>資金と契約</h1>
              <div className="metrics">
                <article>
                  <span>競馬用口座</span>
                  <strong data-testid="balance">{yen(cash(world))}</strong>
                </article>
                <article>
                  <span>年間の拠出予定</span>
                  <strong>{yen(world.core.owner.annualYen)}</strong>
                </article>
                <article>
                  <span>月額預託料・検証用</span>
                  <strong>
                    {yen(
                      Object.values(world.entities).reduce(
                        (n, e) =>
                          n + (e.kind === "contract" ? e.monthlyYen : 0),
                        0,
                      ),
                    )}
                  </strong>
                </article>
              </div>
              <p className="fine">
                P1は日割り計上の基盤検証です。請求期日・引当・12か月予測はP2で具体化します。
              </p>
              <div className="table-scroll">
                <table>
                  <caption>入出金の台帳</caption>
                  <thead>
                    <tr>
                      <th>日付</th>
                      <th>内容</th>
                      <th>金額</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.values(world.entities)
                      .filter((e): e is LedgerEntry => e.kind === "ledger")
                      .sort(
                        (a, b) =>
                          b.date.localeCompare(a.date) ||
                          a.id.localeCompare(b.id),
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
              <p className="fine">
                直近100件を表示。全件は保存・書出しに保持しています。
              </p>
            </section>
          )}
          {tab === "journal" && (
            <section>
              <p className="eyebrow">積み重ねた判断を、一冊に。</p>
              <h1>記録室</h1>
              <ol className="timeline">
                {Object.values(world.entities)
                  .filter((e): e is JournalEvent => e.kind === "event")
                  .sort(
                    (a, b) =>
                      b.date.localeCompare(a.date) || a.id.localeCompare(b.id),
                  )
                  .slice(0, 100)
                  .map((e) => (
                    <li key={e.id}>
                      <time>{e.date}</time>
                      <p>{e.text}</p>
                    </li>
                  ))}
              </ol>
              <section className="backup-panel">
                <h2>経歴の控えを残す</h2>
                <p>クラウド保存に加え、ファイルでも手元に保管できます。</p>
                <div className="actions">
                  <button onClick={exportCurrent}>現在の記録を書き出す</button>
                  <label className="file-button">
                    ファイルから復旧する
                    <input
                      type="file"
                      accept=".json,application/json"
                      disabled={!ready}
                      onChange={(e) => {
                        void chooseFile(e.target.files?.[0]);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  <button disabled={!ready} onClick={() => void loadHistory()}>
                    以前の保存を確認
                  </button>
                </div>
                {history.map((h) => (
                  <button
                    key={h.revision}
                    disabled={!ready}
                    onClick={() => setRestore(h.state)}
                  >
                    保存 {h.revision} · {h.state.core.date} を復旧候補にする
                  </button>
                ))}
                {history.length === 0 && (
                  <p className="fine">
                    以前の保存は一定間隔と復旧前に残し、直近3版を保持します。
                  </p>
                )}
                <button
                  className="quiet"
                  onClick={() => {
                    try {
                      const old = localStorage.getItem("verdant-turf-v1");
                      old
                        ? download(old, "verdant-betting-legacy.json")
                        : setNotice("このブラウザには旧版の記録がありません。");
                    } catch {
                      setNotice("旧記録を読み込めません。");
                    }
                  }}
                >
                  旧ゲームの記録を書き出す
                </button>
              </section>
            </section>
          )}
        </>
      )}
      {notice && (
        <p role="alert" className="notice">
          {notice}
        </p>
      )}
      {restore && (
        <div className="modal-backdrop">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="restore-title"
            className="restore-dialog"
          >
            <h2 id="restore-title">この経歴へ戻しますか？</h2>
            <p>
              {restore.core.date} · {restore.core.owner.name} ·{" "}
              {yen(cash(restore))}
            </p>
            <p>
              現在の記録をファイルへ書き出し、復旧前の版をクラウドにも保護します。未送信の処理がある間は復旧できません。
            </p>
            <button onClick={() => setRestore(null)}>戻らない</button>
            <button
              className="primary"
              disabled={!ready}
              onClick={() => {
                validateWorld(restore);
                exportCurrent();
                void session.restore(restore);
                setRestore(null);
              }}
            >
              現在の記録を保管して復旧する
            </button>
          </section>
        </div>
      )}
    </main>
  );
}
