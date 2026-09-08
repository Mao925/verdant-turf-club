import { beforeEach, describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import {
  applyCommand,
  backup,
  cash,
  createWorld,
  daysToNextMonth,
  diff,
  horses,
  parseBackup,
  validateWorld,
  type Envelope,
  type World,
} from "../src/domain/world";
import {
  OwnerSession,
  ConflictError,
  type Cloud,
} from "../src/application/session";
import { BrowserJournal, type Pending } from "../src/persistence/journal";
const ids = () => ({
  save: crypto.randomUUID(),
  owner: crypto.randomUUID(),
  horse: crypto.randomUUID(),
  contract: crypto.randomUUID(),
});
const calculate = async (
  w: World,
  c: Parameters<typeof applyCommand>[1],
  id: string,
) => applyCommand(w, c, id);
class FakeCloud implements Cloud {
  current: Envelope | null = null;
  calls = 0;
  applied = 0;
  loseResponse = false;
  unreachable = false;
  seen = new Map<string, string>();
  async load() {
    if (this.unreachable) throw new Error("offline");
    return structuredClone(this.current);
  }
  async commit(p: Pending) {
    this.calls++;
    if (this.unreachable) throw new Error("offline");
    const serialized = JSON.stringify(p);
    if (this.seen.has(p.id)) {
      if (this.seen.get(p.id) !== serialized)
        throw new Error("different command");
      return structuredClone(this.current!);
    }
    if ((this.current?.revision ?? 0) !== p.expectedRevision)
      throw new ConflictError("conflict");
    this.current = {
      revision: p.expectedRevision + 1,
      state: structuredClone(p.state),
    };
    this.seen.set(p.id, serialized);
    this.applied++;
    if (this.loseResponse) {
      this.loseResponse = false;
      throw new Error("response lost");
    }
    return structuredClone(this.current);
  }
}
async function setup() {
  const cloud = new FakeCloud(),
    account = crypto.randomUUID(),
    journal = new BrowserJournal(),
    session = new OwnerSession(account, cloud, journal, calculate);
  await session.load();
  await session.begin(createWorld(ids()));
  return { cloud, account, journal, session };
}
describe("permanent horses, dates and finance", () => {
  it("keeps the same horse and totals a complete month exactly in integer yen", () => {
    const w = createWorld(ids());
    const out = applyCommand(
      w,
      { type: "advance", days: 31 },
      crypto.randomUUID(),
    );
    expect(horses(out)[0].id).toBe(horses(w)[0].id);
    expect(out.core.date).toBe("2026-06-01");
    expect(cash(w) - cash(out)).toBe(700000);
    expect(w.core.date).toBe("2026-05-01");
  });
  it("clamps month progression and leap dates", () => {
    expect(daysToNextMonth("2028-01-31")).toBe(29);
    expect(daysToNextMonth("2027-01-31")).toBe(28);
    expect(daysToNextMonth("2027-12-31")).toBe(31);
  });
  it("contributes capital once when crossing the new year, separately from expense", () => {
    const w = createWorld(ids());
    w.core.date = "2026-12-31";
    const first = applyCommand(
      w,
      { type: "advance", days: 1 },
      crypto.randomUUID(),
    );
    expect(first.entities["capital:2027-01-01"]).toBeDefined();
    const out = applyCommand(
      first,
      { type: "advance", days: 1 },
      crypto.randomUUID(),
    );
    const entry = out.entities["capital:2027-01-01"];
    expect(entry).toMatchObject({
      kind: "ledger",
      amountYen: 6000000,
      category: "capital",
    });
    expect(out.core.date).toBe("2027-01-02");
    expect(
      Object.values(out.entities).filter((e) => e.id === "capital:2027-01-01"),
    ).toHaveLength(1);
  });
  it("does not mutate the confirmed world on insufficient funds or invalid steps", () => {
    const w = createWorld(ids());
    if (w.entities.capital.kind === "ledger")
      w.entities.capital.amountYen = 6000001;
    expect(() =>
      applyCommand(w, { type: "advance", days: 7 }, crypto.randomUUID()),
    ).toThrow("不足");
    expect(w.core.date).toBe("2026-05-01");
    expect(cash(w)).toBe(1);
    expect(() =>
      applyCommand(w, { type: "advance", days: 999 }, crypto.randomUUID()),
    ).toThrow();
  });
  it("preserves decision history and serializes backups without HTML execution", () => {
    const w = createWorld(ids());
    const renamed = applyCommand(
      w,
      {
        type: "rename",
        horseId: horses(w)[0].id,
        name: "<img src=x onerror=alert(1)>",
      },
      crypto.randomUUID(),
    );
    expect(parseBackup(backup(renamed, 2))).toEqual(renamed);
    const next = applyCommand(
      renamed,
      { type: "goal", goal: "母から仔へ、夢をつなぐ" },
      crypto.randomUUID(),
    );
    expect(
      Object.values(next.entities).some(
        (e) => e.kind === "event" && e.text.includes("いつか、有馬記念へ"),
      ),
    ).toBe(true);
  });
  it("rejects corrupt dates, missing references, unknown versions and non-integer money", () => {
    for (const change of [
      (w: any) => (w.core.date = "2026-02-30"),
      (w: any) => (w.core.schemaVersion = 2),
      (w: any) => (w.entities.purchase.horseId = "missing"),
      (w: any) => (w.entities.capital.amountYen = 0.5),
    ]) {
      const w = createWorld(ids());
      change(w);
      expect(() => validateWorld(w)).toThrow();
    }
    expect(() => parseBackup('{"format":"bad"}')).toThrow();
  });
  it("sends changes rather than duplicating every old ledger record", () => {
    const w = createWorld(ids());
    const next = applyCommand(
      w,
      { type: "advance", days: 31 },
      crypto.randomUUID(),
    );
    const again = applyCommand(
      next,
      { type: "goal", goal: "京都の大舞台へ" },
      crypto.randomUUID(),
    );
    const patch = diff(next, again);
    expect(patch.upserts).toHaveLength(1);
    expect(patch.core.owner.goal).toBe("京都の大舞台へ");
  });
});
describe("cloud confirmation and local recovery", () => {
  it("locks another action while cloud confirmation is missing, and retries the identical command after reload", async () => {
    const { cloud, account, journal, session } = await setup();
    cloud.loseResponse = true;
    await session.act({ type: "advance", days: 7 });
    expect(session.snapshot().status).toBe("offline");
    const pending = session.snapshot().pending!;
    const applied = cloud.applied;
    await session.act({ type: "advance", days: 7 });
    expect(cloud.applied).toBe(applied);
    expect(session.snapshot().confirmed!.state.core.date).toBe("2026-05-01");
    session.close();
    const reopened = new OwnerSession(account, cloud, journal, calculate);
    await reopened.load();
    expect(reopened.snapshot().status).toBe("ready");
    expect(reopened.snapshot().confirmed!.state.core.date).toBe("2026-05-08");
    expect(cloud.applied).toBe(applied);
    expect(cloud.seen.has(pending.id)).toBe(true);
    expect((await journal.read(account)).pending).toBeNull();
  });
  it("retains the previous state and pending candidate while disconnected", async () => {
    const { cloud, session } = await setup();
    cloud.unreachable = true;
    await session.act({ type: "goal", goal: "中山へ" });
    expect(session.snapshot().pending!.state.core.owner.goal).toBe("中山へ");
    expect(session.snapshot().confirmed!.state.core.owner.goal).toBe(
      "いつか、有馬記念へ",
    );
    cloud.unreachable = false;
    await session.retry();
    expect(session.snapshot().status).toBe("ready");
    expect(session.snapshot().confirmed!.revision).toBe(2);
  });
  it("detects another device and does not merge or overwrite its result", async () => {
    const { cloud, session } = await setup();
    const remoteDevice = new OwnerSession(
      crypto.randomUUID(),
      cloud,
      new BrowserJournal(),
      calculate,
    );
    await remoteDevice.load();
    await session.act({ type: "advance", days: 7 });
    await remoteDevice.act({ type: "goal", goal: "別端末の目標" });
    expect(remoteDevice.snapshot().status).toBe("conflict");
    expect(remoteDevice.snapshot().pending).not.toBeNull();
    expect(cloud.current!.state.core.owner.goal).toBe("いつか、有馬記念へ");
    await remoteDevice.useCloud();
    expect(remoteDevice.snapshot().pending).toBeNull();
    expect(remoteDevice.snapshot().confirmed!.state.core.date).toBe(
      "2026-05-08",
    );
  });
  it("atomically protects one local pending command from a second tab", async () => {
    const journal = new BrowserJournal();
    const account = crypto.randomUUID(),
      state = createWorld(ids());
    const a = {
        id: crypto.randomUUID(),
        expectedRevision: 0,
        state,
        patch: diff(null, state),
      },
      b = { ...a, id: crypto.randomUUID() };
    const result = await Promise.allSettled([
      journal.prepare(account, a),
      journal.prepare(account, b),
    ]);
    expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await journal.read(account)).pending!.id).toBe(a.id);
    await journal.discard(account, b.id);
    expect((await journal.read(account)).pending!.id).toBe(a.id);
  });
  it("separates account caches and never treats a missing remote save as new", async () => {
    const { cloud, account, journal, session } = await setup();
    expect((await journal.read(crypto.randomUUID())).confirmed).toBeNull();
    session.close();
    cloud.current = null;
    const reopened = new OwnerSession(account, cloud, journal, calculate);
    await reopened.load();
    expect(reopened.snapshot().status).toBe("offline");
    expect(reopened.snapshot().confirmed).not.toBeNull();
  });
  it("keeps the command when caching the acknowledged result fails", async () => {
    const { cloud, account, journal, session } = await setup();
    const original = journal.confirm.bind(journal);
    let fail = true;
    journal.confirm = async (...args) => {
      if (fail) {
        fail = false;
        throw new Error("disk full");
      }
      return original(...args);
    };
    await session.act({ type: "advance", days: 7 });
    expect(session.snapshot().status).toBe("offline");
    expect((await journal.read(account)).pending).not.toBeNull();
    const count = cloud.applied;
    await session.retry();
    expect(cloud.applied).toBe(count);
    expect(session.snapshot().status).toBe("ready");
  });
  it("rejects damaged restore data without changing the confirmed state", async () => {
    const { session, cloud } = await setup();
    const bad = structuredClone(cloud.current!.state);
    bad.core.date = "bad";
    await expect(session.restore(bad)).rejects.toThrow();
    expect(session.snapshot().status).toBe("ready");
    expect(cloud.applied).toBe(1);
  });
});
