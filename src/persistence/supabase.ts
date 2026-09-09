import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ConflictError, type Cloud } from "../application/session";
import { validateWorld, type Envelope } from "../domain/world";
import type { Pending } from "./journal";
import { uploadChunks } from "./upload";
export { uploadChunks } from "./upload";
export function configuredClient(): SupabaseClient | null {
  const url = import.meta.env.VITE_SUPABASE_URL,
    key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  try {
    const u = new URL(url);
    if (
      u.protocol !== "https:" &&
      !(
        u.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(u.hostname)
      )
    )
      return null;
    return createClient(url, key, {
      auth: {
        flowType: "pkce",
        detectSessionInUrl: true,
        persistSession: true,
        autoRefreshToken: true,
      },
      global: {
        fetch: async (input, init) => {
          // Long-history restore/read has a bounded 30 s database budget plus transfer time.
          const timeout = AbortSignal.timeout(45000);
          const signal = init?.signal
            ? AbortSignal.any([init.signal, timeout])
            : timeout;
          return fetch(input, { ...init, signal });
        },
      },
    });
  } catch {
    return null;
  }
}
function envelope(data: unknown): Envelope | null {
  if (data === null) return null;
  const d = data as Envelope;
  if (!Number.isSafeInteger(d?.revision) || d.revision < 1)
    throw new Error("保存の版番号が不正です。");
  validateWorld(d.state);
  return d;
}
export class SupabaseCloud implements Cloud {
  constructor(private client: SupabaseClient) {}
  async checkpoints() {
    const { data, error } = await this.client
      .from("owner_checkpoints")
      .select("revision,state")
      .order("revision", { ascending: false })
      .limit(3);
    if (error) throw new Error("履歴を読み込めません。");
    return (data ?? []).map((row) => {
      validateWorld(row.state);
      return { revision: Number(row.revision), state: row.state };
    });
  }
  async load() {
    const { data, error } = await this.client.rpc("load_owner_save");
    if (error)
      throw new Error(
        "クラウドの読込みに失敗しました。ログインと接続を確認してください。",
      );
    return envelope(data);
  }
  async commit(p: Pending) {
    const send = async (name: string, args: Record<string, unknown>) => {
      const response = await this.client.rpc(name, args).retry(false);
      if (response.error) {
        if (["40001", "PT409"].includes(response.error.code))
          throw new ConflictError(
            "別の端末で記録が更新されています。手元の結果を保護してクラウドの最新状態を確認してください。",
          );
        throw new Error(
          "保存を確認できませんでした。接続・ログイン・保存容量を確認し、同じ結果を再送してください。",
        );
      }
      return response.data;
    };
    const chunks = uploadChunks(p.patch.upserts);
    let data;
    if (chunks) {
      await send("begin_owner_upload", {
        p_save_id: p.state.core.saveId,
        p_command_id: p.id,
        p_expected_revision: p.expectedRevision,
        p_core: p.patch.core,
        p_replace: p.patch.replace,
        p_chunk_count: chunks.length,
      });
      for (let part = 0; part < chunks.length; part++)
        await send("append_owner_upload", {
          p_command_id: p.id,
          p_part: part,
          p_entities: chunks[part],
        });
      data = await send("finish_owner_upload", { p_command_id: p.id });
    } else {
      data = await send("commit_owner_save", {
        p_save_id: p.state.core.saveId,
        p_command_id: p.id,
        p_expected_revision: p.expectedRevision,
        p_core: p.patch.core,
        p_upserts: p.patch.upserts,
        p_replace: p.patch.replace,
      });
    }
    const revision = data?.revision;
    if (!Number.isSafeInteger(revision) || revision < p.expectedRevision + 1)
      throw new Error("保存の応答が不正です。");
    if (revision === p.expectedRevision + 1)
      return { revision, state: p.state };
    const latest = await this.load();
    if (!latest) throw new Error("最新の保存を確認できません。");
    return latest;
  }
}
