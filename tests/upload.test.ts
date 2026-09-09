import { expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createWorld, diff } from "../src/domain/world";
import { SupabaseCloud, uploadChunks } from "../src/persistence/supabase";
import { ConflictError } from "../src/application/session";
import type { Pending } from "../src/persistence/journal";
function pending(large = true): Pending {
  const state = createWorld({
    save: crypto.randomUUID(),
    owner: crypto.randomUUID(),
    horse: crypto.randomUUID(),
    contract: crypto.randomUUID(),
  });
  if (large)
    for (let i = 0; i < 2000; i++)
      state.entities[`event:${i}`] = {
        kind: "event",
        id: `event:${i}`,
        date: state.core.date,
        text: "あ".repeat(1000),
      };
  return {
    id: crypto.randomUUID(),
    expectedRevision: 0,
    state,
    patch: diff(null, state, true),
  };
}
it("日本語のUTF-8バイト数で分割し、順序と全記録を保つ", () => {
  const p = pending(),
    chunks = uploadChunks(p.patch.upserts)!;
  expect(chunks.length).toBeGreaterThan(4);
  expect(chunks.flat()).toEqual(p.patch.upserts);
  for (const chunk of chunks)
    expect(
      new TextEncoder().encode(JSON.stringify(chunk)).length,
    ).toBeLessThanOrEqual(1000000);
  expect(uploadChunks(pending(false).patch.upserts)).toBeNull();
});
it("途中失敗では最終確定せず、同じ命令・全データから再送できる", async () => {
  const p = pending(),
    calls: { name: string; args: Record<string, any> }[] = [];
  let fail = true;
  const client = {
    rpc(name: string, args: Record<string, any>) {
      calls.push({ name, args });
      return {
        retry: async () => {
          if (name === "append_owner_upload" && args.p_part === 1 && fail) {
            fail = false;
            return { data: null, error: { code: "network" } };
          }
          return { data: { revision: 1 }, error: null };
        },
      };
    },
  } as unknown as SupabaseClient;
  const cloud = new SupabaseCloud(client),
    before = JSON.stringify(p);
  await expect(cloud.commit(p)).rejects.toThrow("保存を確認できません");
  expect(calls.some((c) => c.name === "finish_owner_upload")).toBe(false);
  const firstCount = calls.length;
  expect(await cloud.commit(p)).toEqual({ revision: 1, state: p.state });
  expect(JSON.stringify(p)).toBe(before);
  const retry = calls.slice(firstCount);
  expect(retry[0].args.p_command_id).toBe(p.id);
  expect(
    retry
      .filter((c) => c.name === "append_owner_upload")
      .flatMap((c) => c.args.p_entities),
  ).toEqual(p.patch.upserts);
  expect(retry.at(-1)!.name).toBe("finish_owner_upload");
});
it("最終確定の応答消失も同一IDで再確認し、競合は明示する", async () => {
  const p = pending(),
    finals: string[] = [];
  let response = "lost";
  const client = {
    rpc(name: string, args: Record<string, any>) {
      return {
        retry: async () => {
          if (name === "finish_owner_upload") {
            finals.push(args.p_command_id);
            if (response !== "ok")
              return {
                data: null,
                error: { code: response === "conflict" ? "PT409" : "network" },
              };
          }
          return { data: { revision: 1 }, error: null };
        },
      };
    },
  } as unknown as SupabaseClient;
  const cloud = new SupabaseCloud(client);
  await expect(cloud.commit(p)).rejects.toThrow("保存を確認できません");
  response = "ok";
  expect((await cloud.commit(p)).revision).toBe(1);
  expect(finals).toEqual([p.id, p.id]);
  response = "conflict";
  await expect(cloud.commit(p)).rejects.toBeInstanceOf(ConflictError);
});
it("小さな変更は従来の一括RPCを維持する", async () => {
  const names: string[] = [];
  const client = {
    rpc(name: string) {
      names.push(name);
      return { retry: async () => ({ data: { revision: 1 }, error: null }) };
    },
  } as unknown as SupabaseClient;
  await new SupabaseCloud(client).commit(pending(false));
  expect(names).toEqual(["commit_owner_save"]);
});
