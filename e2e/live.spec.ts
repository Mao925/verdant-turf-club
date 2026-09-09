import { readFileSync, writeFileSync } from "node:fs";
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { activeRace, openConsultation } from "../src/domain/career";
import { backup, validateWorld, type Envelope } from "../src/domain/world";
test.skip(
  !process.env.P2_LIVE_SESSION,
  "Requires the temporary real-service test runner",
);
test.use({ trace: "off", screenshot: "off", video: "off" });
const url = process.env.P2_LIVE_URL ?? "";
async function session(context: BrowserContext) {
  const value = process.env.P2_LIVE_SESSION!;
  const ref = new URL(url).hostname.split(".")[0];
  await context.addInitScript(
    ({ value, ref }) => {
      localStorage.setItem(`sb-${ref}-auth-token`, value);
    },
    { value, ref },
  );
}
async function saved(p: Page) {
  await expect(p.getByText("クラウド保存済み", { exact: false })).toBeVisible({
    timeout: 30000,
  });
}
test("real Auth/RPC: acquisition, race, loss of response, offline recovery, conflict and restore", async ({
  browser,
}) => {
  test.setTimeout(150000);
  const parsed = JSON.parse(process.env.P2_LIVE_SESSION!);
  const headers = {
    apikey: process.env.P2_LIVE_KEY!,
    Authorization: `Bearer ${parsed.access_token}`,
    "Content-Type": "application/json",
  };
  const load = async () => {
    const response = await fetch(url + "/rest/v1/rpc/load_owner_save", {
      method: "POST",
      headers,
      body: "{}",
    });
    expect(response.ok).toBe(true);
    const envelope = (await response.json()) as Envelope;
    validateWorld(envelope.state);
    return envelope;
  };
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  await session(context);
  const page = await context.newPage();
  await page.goto("/");
  await page.getByLabel("馬主名", { exact: true }).fill("クラウド検証用馬主");
  await page.getByRole("button", { name: "経歴を始める", exact: true }).click();
  await saved(page);
  await page.getByLabel("入札上限（万円）").fill("1500");
  await page
    .getByRole("button", { name: "この上限で入札する", exact: true })
    .click();
  await saved(page);
  // Commit succeeds at the actual server; the browser receives no response.
  let drop = true;
  await context.route(url + "/rest/v1/rpc/commit_owner_save", async (route) => {
    if (drop) {
      drop = false;
      await route.fetch();
      await route.abort("connectionreset");
    } else await route.continue();
  });
  await page
    .getByRole("button", { name: "支払い、愛馬を迎える", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "同じ処理を再確認" }),
  ).toBeVisible();
  const committed = await load();
  await page.reload();
  await saved(page);
  expect((await load()).revision).toBe(committed.revision);
  await context.unroute(url + "/rest/v1/rpc/commit_owner_save");
  await page.getByRole("button", { name: "佐伯修司に預ける" }).click();
  await saved(page);
  // Real network outage, followed by retry of the same locally protected command.
  const beforeOffline = await load();
  await context.setOffline(true);
  await page.getByRole("button", { name: "1週間進める", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "同じ処理を再確認" }),
  ).toBeVisible();
  expect((await load()).revision).toBe(beforeOffline.revision);
  await context.setOffline(false);
  await page.reload();
  await saved(page);
  expect((await load()).revision).toBe(beforeOffline.revision + 1);
  for (let i = 0; i < 30; i++) {
    const w = (await load()).state;
    if (activeRace(w)?.status === "result") break;
    if (openConsultation(w))
      await page
        .getByRole("button", { name: "この競走への意向を伝える", exact: true })
        .click();
    else
      await page
        .getByRole("button", { name: "1か月進める", exact: true })
        .click();
    await saved(page);
  }
  expect(activeRace((await load()).state)?.status).toBe("result");
  await page.getByRole("button", { name: "スキップして着順を見る" }).click();
  await page.getByRole("button", { name: "結果を精算し、次の相談へ" }).click();
  await saved(page);
  const secondContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  await session(secondContext);
  const second = await secondContext.newPage();
  second.on("requestfailed", (r) => {
    if (r.url().includes("/rpc/"))
      console.log("Live request failure:", r.failure()?.errorText);
  });
  second.on("response", async (r) => {
    if (r.url().includes("/rpc/")) {
      console.log(
        "Live RPC endpoint response:",
        new URL(r.url()).pathname,
        r.status(),
      );
      if (!r.ok()) {
        const body = await r.json().catch(() => ({}));
        console.log("Live RPC error code:", body.code);
      }
    }
  });
  await second.goto("/");
  await saved(second);
  await page
    .getByRole("button", { name: "今回は見送り、待つ", exact: true })
    .click();
  await saved(page);
  const latest = await load();
  const diagnosticStart = Date.now();
  try {
    const response = await fetch(url + "/rest/v1/rpc/commit_owner_save", {
      method: "POST",
      headers,
      body: JSON.stringify({
        p_save_id: latest.state.core.saveId,
        p_command_id: crypto.randomUUID(),
        p_expected_revision: latest.revision - 1,
        p_core: latest.state.core,
        p_upserts: [],
        p_replace: false,
      }),
      signal: AbortSignal.timeout(25000),
    });
    const body = await response.json();
    console.log(
      "Stale direct RPC:",
      response.status,
      body.code,
      "elapsed",
      Date.now() - diagnosticStart,
    );
  } catch {
    console.log("Stale direct RPC timed out", Date.now() - diagnosticStart);
  }

  await second
    .getByRole("button", { name: "今回は見送り、待つ", exact: true })
    .click();
  try {
    await expect(
      second.getByText("別の端末で更新されています", { exact: false }),
    ).toBeVisible({ timeout: 30000 });
  } catch (e) {
    console.log(
      "Live conflict UI:",
      await second.locator(".save-strip").innerText(),
    );
    console.log(
      "Live conflict alert:",
      await second.locator(".notice").allTextContents(),
    );
    throw e;
  }
  expect((await load()).revision).toBe(latest.revision);
  second.on("dialog", (d) => d.accept());
  await second
    .getByRole("button", { name: "クラウドの最新の経歴を使う" })
    .click();
  await saved(second);
  await second.getByRole("button", { name: "記録室", exact: true }).click();
  await second.locator("input[type=file]").setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"format":"bad"}'),
  });
  await expect(second.getByRole("alert")).toContainText(
    "バックアップではありません",
  );
  const restored = structuredClone(latest.state);
  restored.core.owner.goal = "実クラウド復旧確認";
  await second.locator("input[type=file]").setInputFiles({
    name: "restore.json",
    mimeType: "application/json",
    buffer: Buffer.from(backup(restored, latest.revision)),
  });
  await second
    .getByRole("button", { name: "現在の記録を保管して復旧する", exact: true })
    .click();
  await saved(second);
  expect((await load()).state.core.owner.goal).toBe("実クラウド復旧確認");
  const unauth = await fetch(url + "/rest/v1/rpc/load_owner_save", {
    method: "POST",
    headers: {
      apikey: process.env.P2_LIVE_KEY!,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  expect(unauth.ok).toBe(false);
  const others = await fetch(
    url + "/rest/v1/owner_saves?select=id&user_id=neq." + parsed.user.id,
    { headers },
  );
  expect(await others.json()).toEqual([]);
  if (process.env.P3_LIVE_WORLD) {
    const year = JSON.parse(readFileSync(process.env.P3_LIVE_WORLD, "utf8"));
    validateWorld(year);
    const current = await load();
    year.core.saveId = current.state.core.saveId;
    let revision = current.revision;
    const writes: number[] = [];
    for (let i = 0; i < 4; i++) {
      const start = performance.now();
      const response = await fetch(url + "/rest/v1/rpc/commit_owner_save", {
        method: "POST",
        headers,
        body: JSON.stringify({
          p_save_id: year.core.saveId,
          p_command_id: crypto.randomUUID(),
          p_expected_revision: revision,
          p_core: year.core,
          p_upserts: Object.values(year.entities),
          p_replace: true,
        }),
      });
      const result = await response.json();
      console.log(
        "Year restore RPC:",
        i + 1,
        response.status,
        result.code ?? "OK",
        "elapsed",
        performance.now() - start,
      );
      expect(response.ok).toBe(true);
      expect(result.revision).toBe(revision + 1);
      revision = result.revision;
      writes.push(performance.now() - start);
    }
    const start = performance.now();
    const resumed = await load();
    const loadMs = performance.now() - start;
    expect(resumed.state).toEqual(year);
    const pageStart = performance.now();
    await second.reload();
    await saved(second);
    const reloadMs = performance.now() - pageStart;
    await second
      .getByRole("button", { name: "愛馬と予定", exact: true })
      .click();
    await expect(second.locator(".horse-roster button")).toHaveCount(4);
    const proof = {
      kind: "real Supabase test account, one-year P3 world and explicit restores; HTTP latency on this Mac",
      saveBytes: Buffer.byteLength(JSON.stringify(year)),
      restoreWriteMs: writes,
      loadMs,
      browserReloadMs: reloadMs,
      entities: Object.keys(year.entities).length,
    };
    writeFileSync(
      "artifacts/p3-live-year.json",
      JSON.stringify(proof, null, 2),
    );
    console.log(JSON.stringify(proof));
  }
  await context.close();
  await secondContext.close();
});
