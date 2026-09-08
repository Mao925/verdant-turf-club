import {
  diff,
  validateWorld,
  type Command,
  type Envelope,
  type World,
} from "../domain/world";
import type { Journal, Pending } from "../persistence/journal";
export class ConflictError extends Error {}
export interface Cloud {
  load(): Promise<Envelope | null>;
  commit(p: Pending): Promise<Envelope>;
}
export type Status =
  | "loading"
  | "ready"
  | "computing"
  | "saving"
  | "offline"
  | "conflict"
  | "error";
export type View = {
  status: Status;
  confirmed: Envelope | null;
  pending: Pending | null;
  message: string;
};
export class OwnerSession {
  private view: View = {
    status: "loading",
    confirmed: null,
    pending: null,
    message: "",
  };
  private listeners = new Set<() => void>();
  private closed = false;
  constructor(
    readonly accountId: string,
    private cloud: Cloud,
    private journal: Journal,
    private calculate: (w: World, c: Command, id: string) => Promise<World>,
  ) {}
  snapshot = () => this.view;
  subscribe = (f: () => void) => {
    this.listeners.add(f);
    return () => {
      this.listeners.delete(f);
    };
  };
  private set(v: Partial<View>) {
    if (this.closed) return;
    this.view = { ...this.view, ...v };
    this.listeners.forEach((f) => f());
  }
  close() {
    this.closed = true;
    this.listeners.clear();
  }
  async load() {
    if (["saving", "computing"].includes(this.view.status)) return;
    this.set({ status: "loading", message: "" });
    try {
      const local = await this.journal.read(this.accountId);
      if (this.closed) return;
      if (local.confirmed) validateWorld(local.confirmed.state);
      if (local.pending) validateWorld(local.pending.state);
      this.set({ confirmed: local.confirmed, pending: local.pending });
      if (local.pending) {
        await this.send(local.pending);
        return;
      }
      const remote = await this.cloud.load();
      if (this.closed) return;
      if (remote) {
        validateWorld(remote.state);
        await this.journal.confirm(this.accountId, remote);
      }
      // A cached save disappearing from the cloud must never be treated as an empty new account.
      if (!remote && local.confirmed)
        throw new Error(
          "クラウドの記録を確認できません。端末の記録を書き出して接続先を確認してください。",
        );
      this.set({ confirmed: remote, status: "ready" });
    } catch (e) {
      this.fail(e);
    }
  }
  private fail(e: unknown) {
    this.set({
      status: e instanceof ConflictError ? "conflict" : "offline",
      message: e instanceof Error ? e.message : "保存を確認できませんでした。",
    });
  }
  async begin(state: World) {
    if (this.view.status !== "ready" || this.view.confirmed) return;
    await this.prepare(state, diff(null, state));
  }
  async act(command: Command) {
    if (
      this.view.status !== "ready" ||
      !this.view.confirmed ||
      this.view.pending
    )
      return;
    this.set({ status: "computing", message: "" });
    try {
      const id = crypto.randomUUID();
      const before = this.view.confirmed.state;
      const next = await this.calculate(before, command, id);
      if (!this.closed) await this.prepare(next, diff(before, next), id);
    } catch (e) {
      this.set({
        status: "ready",
        message: e instanceof Error ? e.message : "操作に失敗しました。",
      });
    }
  }
  async restore(world: World) {
    if (this.view.status !== "ready" || !this.view.confirmed) return;
    const next = structuredClone(world);
    next.core.saveId = this.view.confirmed.state.core.saveId;
    await this.prepare(next, diff(null, next, true));
  }
  private async prepare(
    state: World,
    patch: Pending["patch"],
    id = crypto.randomUUID(),
  ) {
    if (this.closed) return;
    validateWorld(state);
    const pending: Pending = {
      id,
      expectedRevision: this.view.confirmed?.revision ?? 0,
      state,
      patch,
    };
    this.set({ status: "saving", message: "" });
    try {
      await this.journal.prepare(this.accountId, pending);
      this.set({ pending });
      await this.send(pending);
    } catch (e) {
      this.fail(e);
    }
  }
  private async send(pending: Pending) {
    if (this.closed) return;
    this.set({ status: "saving", message: "" });
    try {
      const result = await this.cloud.commit(pending);
      validateWorld(result.state);
      await this.journal.confirm(this.accountId, result, pending.id);
      this.set({ confirmed: result, pending: null, status: "ready" });
    } catch (e) {
      this.fail(e);
    }
  }
  async retry() {
    if (["saving", "computing", "loading"].includes(this.view.status)) return;
    this.view.pending ? await this.send(this.view.pending) : await this.load();
  }
  // UI requires export/explicit confirmation before abandoning a conflicted candidate.
  async useCloud() {
    if (this.view.status !== "conflict" || !this.view.pending) return;
    const id = this.view.pending.id;
    this.set({ status: "loading" });
    try {
      const remote = await this.cloud.load();
      if (!remote) throw new Error("クラウドの記録がありません。");
      validateWorld(remote.state);
      await this.journal.confirm(this.accountId, remote);
      await this.journal.discard(this.accountId, id);
      this.set({
        confirmed: remote,
        pending: null,
        status: "ready",
        message: "",
      });
    } catch (e) {
      this.fail(e);
    }
  }
}
