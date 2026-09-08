import type { Command, World } from "../domain/world";
export class WorldEngine {
  private worker = new Worker(new URL("./worker.ts", import.meta.url), {
    type: "module",
  });
  private waits = new Map<
    string,
    { resolve: (w: World) => void; reject: (e: Error) => void }
  >();
  constructor() {
    this.worker.onmessage = ({ data }) => {
      const p = this.waits.get(data.id);
      if (!p) return;
      this.waits.delete(data.id);
      data.error ? p.reject(new Error(data.error)) : p.resolve(data.state);
    };
    this.worker.onerror = () => {
      for (const p of this.waits.values())
        p.reject(
          new Error("計算を完了できませんでした。再読み込みしてください。"),
        );
      this.waits.clear();
    };
  }
  run(world: World, command: Command, id: string) {
    return new Promise<World>((resolve, reject) => {
      this.waits.set(id, { resolve, reject });
      this.worker.postMessage({ world, command, id });
    });
  }
  dispose() {
    this.worker.terminate();
    for (const p of this.waits.values())
      p.reject(new Error("計算を終了しました。"));
    this.waits.clear();
  }
}
