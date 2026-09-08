import { useEffect, useRef, useState } from "react";
import type { Horse } from "../domain/world";
export function HorseView({ horse, silk }: { horse: Horse; silk: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"light" | "3d">(() =>
    matchMedia("(max-width: 700px), (prefers-reduced-motion: reduce)").matches
      ? "light"
      : "3d",
  );
  const [error, setError] = useState("");
  useEffect(() => {
    if (mode !== "3d" || !host.current) return;
    let cancelled = false,
      frame = 0;
    let scene: import("../scene.js").RaceScene | undefined;
    void import("../scene.js")
      .then(({ RaceScene }) => {
        if (cancelled || !host.current) return;
        try {
          scene = new RaceScene(
            host.current,
            [{ id: 1, name: horse.name, coat: horse.coat, silk }],
            "medium",
            (message: string) => {
              setError(message);
              setMode("light");
            },
          );
          scene.mode = "follow";
          scene.portrait = true;
          scene.camera.position.set(19, 4.2, 51);
          scene.look.set(16.5, 1.7, 40);
          scene.renderer.domElement.setAttribute(
            "aria-label",
            `${horse.name}の3D表示`,
          );
          let last = performance.now();
          const draw = (now: number) => {
            if (cancelled || !scene) return;
            scene.update(
              [{ d: 18, lane: 0, v: 0 }],
              now / 1000,
              Math.min((now - last) / 1000, 0.1),
              false,
              1,
              0,
            );
            last = now;
            frame = requestAnimationFrame(draw);
          };
          frame = requestAnimationFrame(draw);
        } catch {
          setError("3D表示を利用できないため、軽量表示に切り替えました。");
          setMode("light");
        }
      })
      .catch(() => {
        setError("3D表示を読み込めませんでした。");
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
    };
  }, [mode, horse.id, horse.name, horse.coat, silk]);
  return (
    <div className="horse-visual">
      <div className="scene-host" ref={host}>
        {mode === "light" && (
          <div
            className="light-portrait"
            role="img"
            aria-label={`${horse.name}の軽量表示`}
          >
            <span className="horse-glyph" aria-hidden="true">
              ♞
            </span>
            <p>{horse.name}</p>
            <small>愛馬の記録は、いつでもここから。</small>
          </div>
        )}
      </div>
      <button
        className="visual-toggle"
        onClick={() => setMode(mode === "3d" ? "light" : "3d")}
      >
        {mode === "3d" ? "軽量表示へ" : "3Dで見る"}
      </button>
      {error && <small className="visual-error">{error}</small>}
    </div>
  );
}
