import { useEffect, useRef, useState } from "react";
import type { Race } from "../domain/career-types";
import { progressAt } from "../domain/racing";
export function RaceView({ race }: { race: Race }) {
  const result = race.result!;
  const [mode, setMode] = useState<"light" | "3d">(() =>
    matchMedia("(max-width: 700px), (prefers-reduced-motion: reduce)").matches
      ? "light"
      : "3d",
  );
  const [time, setTime] = useState(0),
    [playing, setPlaying] = useState(false),
    [speed, setSpeed] = useState(4),
    [error, setError] = useState("");
  const host = useRef<HTMLDivElement>(null),
    clock = useRef(0),
    sceneRef = useRef<import("../scene.js").RaceScene | undefined>(undefined);
  const duration = Math.max(...result.map((r) => r.seconds));
  const rows = race.field.map((id) => result.find((r) => r.horseId === id)!);
  useEffect(() => {
    clock.current = time;
  }, [time]);
  useEffect(() => {
    if (!playing) return;
    let last = performance.now(),
      frame = 0;
    const tick = (now: number) => {
      const t = Math.min(
        duration,
        clock.current + Math.min(0.1, (now - last) / 1000) * speed,
      );
      clock.current = t;
      setTime(t);
      last = now;
      if (t >= duration) setPlaying(false);
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, speed, duration]);
  useEffect(() => {
    if (mode !== "3d" || !host.current) return;
    let cancelled = false,
      frame = 0;
    let scene: import("../scene.js").RaceScene | undefined;
    void Promise.all([import("../scene.js"), import("../simulation.js")])
      .then(([{ RaceScene }, { TRACK_LENGTH }]) => {
        if (cancelled || !host.current) return;
        try {
          scene = new RaceScene(
            host.current,
            rows.map((r, i) => ({
              id: i + 1,
              name: r.name,
              coat: r.coat,
              silk: r.silk,
            })),
            "medium",
            (message: string) => {
              setError(message);
              setMode("light");
            },
          );
          sceneRef.current = scene;
          scene.mode = "follow";
          scene.renderer.domElement.setAttribute(
            "aria-label",
            `${race.name}の3D観戦`,
          );
          let last = performance.now();
          const draw = (now: number) => {
            if (cancelled || !scene) return;
            const seconds = clock.current;
            const samples = rows.map((r, i) => ({
              d:
                progressAt(r, seconds) * TRACK_LENGTH +
                (Math.max(0, seconds - r.seconds) * TRACK_LENGTH) / r.seconds,
              lane: ((i % 8) - 3.5) * 0.55,
              v:
                seconds > 0 && seconds < r.seconds
                  ? race.distance / r.seconds
                  : 0,
            }));
            scene.update(
              samples,
              now / 1000,
              Math.min((now - last) / 1000, 0.1),
              seconds > 0 && seconds < duration,
              rows.findIndex((r) => r.horseId === race.horseId) + 1,
              seconds,
            );
            scene.gate.visible = seconds < 5;
            last = now;
            frame = requestAnimationFrame(draw);
          };
          frame = requestAnimationFrame(draw);
        } catch {
          setError("3Dを利用できないため軽量観戦へ切り替えました。");
          setMode("light");
        }
      })
      .catch(() => {
        setError("3Dを読み込めないため軽量観戦へ切り替えました。");
        setMode("light");
      });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      if (scene) {
        const canvas = scene.renderer.domElement;
        scene.dispose();
        canvas.remove();
      }
      sceneRef.current = undefined;
    };
  }, [mode, race.id]);
  return (
    <div className="race-view">
      <p className="fine">
        確定した走りの再生 ·
        コース造形は共通の簡略表現です。表示時計はゲーム内のモデル値です。
      </p>
      <div ref={host} className={mode === "3d" ? "race-scene" : ""}>
        {mode === "light" && (
          <div className="race-lanes" aria-label="軽量観戦">
            {rows.map((r, i) => (
              <div
                key={r.horseId}
                className={`race-lane ${r.horseId === race.horseId ? "my-horse" : ""}`}
              >
                <span>
                  {i + 1} {r.name}
                  {r.horseId === race.horseId ? "・愛馬" : ""}
                </span>
                <div className="race-rail">
                  <i
                    style={{
                      width: `${progressAt(r, time) * 100}%`,
                      background: r.silk,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="replay-toolbar">
        <span>
          {time.toFixed(1)} / {duration.toFixed(1)} 秒
        </span>
        <button
          onClick={() => {
            if (time >= duration) {
              clock.current = 0;
              setTime(0);
            }
            setPlaying(!playing);
          }}
        >
          {playing ? "一時停止" : "観戦を再生"}
        </button>
        <label>
          再生速度
          <select
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
          >
            <option value={1}>1倍</option>
            <option value={4}>4倍</option>
            <option value={12}>12倍</option>
          </select>
        </label>
        <button
          onClick={() => {
            clock.current = duration;
            setTime(duration);
            setPlaying(false);
          }}
        >
          スキップして着順を見る
        </button>
        <button onClick={() => setMode(mode === "3d" ? "light" : "3d")}>
          {mode === "3d" ? "軽量観戦へ" : "3D観戦へ"}
        </button>
      </div>
      {error && <p role="status">{error}</p>}
      {time >= duration && (
        <ol className="race-results">
          {result.map((r, i) => (
            <li
              key={r.horseId}
              className={r.horseId === race.horseId ? "my-horse" : ""}
            >
              <strong>
                {i + 1}着 {r.name}
              </strong>
              <span>
                {r.seconds.toFixed(3)}秒
                {r.horseId === race.horseId ? " · あなたの愛馬" : ""}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
