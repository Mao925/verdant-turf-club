import { test, expect } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { uploadChunks } from "../src/persistence/upload";
import { validateWorld, type World } from "../src/domain/world";
test.skip(
  !process.env.P5_STORAGE_ONLY,
  "Focused real-service diagnostic runner only",
);
test.use({ trace: "off", screenshot: "off", video: "off" });
test("large real staged restores preserve four complete versions", async () => {
  test.setTimeout(360000);
  const auth = JSON.parse(process.env.P2_LIVE_SESSION!),
    url = process.env.P2_LIVE_URL!;
  const headers = {
    apikey: process.env.P2_LIVE_KEY!,
    Authorization: `Bearer ${auth.access_token}`,
    "Content-Type": "application/json",
  };
  const base: World = JSON.parse(
    readFileSync(process.env.P5_LIVE_WORLD!, "utf8"),
  );
  base.core.saveId = crypto.randomUUID();
  const rows = [];
  const call = async (endpoint: string, args: Record<string, unknown>) => {
    const t = performance.now();
    const r = await fetch(url + "/rest/v1/rpc/" + endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(45000),
    });
    const raw = await r.text();
    if (!r.ok || endpoint === "finish_owner_upload")
      console.log(
        "Focused storage HTTP:",
        endpoint,
        r.status,
        r.headers.get("content-type"),
        performance.now() - t,
      );
    expect(r.headers.get("content-type")).toContain("application/json");
    const data = JSON.parse(raw);
    expect(r.ok, `${endpoint}: ${r.status} ${data.code ?? ""}`).toBe(true);
    return data;
  };
  for (let i = 0; i < 4; i++) {
    const world = structuredClone(base);
    if (i === 1)
      world.entities["restore-proof"] = {
        kind: "event",
        id: "restore-proof",
        date: world.core.date,
        text: "復旧で追加した記録",
      };
    if (i === 2) world.core.owner.goal = "復旧で変えた次の目標";
    validateWorld(world);
    const chunks = uploadChunks(Object.values(world.entities))!,
      id = crypto.randomUUID(),
      t = performance.now();
    await call("begin_owner_upload", {
      p_save_id: world.core.saveId,
      p_command_id: id,
      p_expected_revision: i,
      p_core: world.core,
      p_replace: true,
      p_chunk_count: chunks.length,
    });
    for (let n = 0; n < chunks.length; n++)
      await call("append_owner_upload", {
        p_command_id: id,
        p_part: n,
        p_entities: chunks[n],
      });
    const finish = performance.now(),
      response = await call("finish_owner_upload", { p_command_id: id });
    expect(response.revision).toBe(i + 1);
    rows.push({
      totalMs: performance.now() - t,
      finishMs: performance.now() - finish,
      chunks: chunks.length,
    });
    const saved = await call("load_owner_save", {});
    validateWorld(saved.state);
    expect(saved.state).toEqual(world);
  }
  writeFileSync(
    "artifacts/p5-focused-live-storage.json",
    JSON.stringify(
      {
        kind: "Real isolated Auth/RPC, four staged five-year restores with additions, removals and changed core, full equality each time",
        rows,
      },
      null,
      2,
    ),
  );
});
