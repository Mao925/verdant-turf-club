import { test, expect, type BrowserContext } from "@playwright/test";
import { createWorld, type Envelope } from "../src/domain/world";
const uid = "10000000-0000-4000-8000-000000000001";
const user = {
  id: uid,
  aud: "authenticated",
  role: "authenticated",
  email: "owner@example.test",
  app_metadata: { provider: "google", providers: ["google"] },
  user_metadata: {},
  created_at: "2026-09-08T00:00:00Z",
};
async function signInFixture(context: BrowserContext) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const access =
    [
      { alg: "HS256", typ: "JWT" },
      { sub: uid, exp, aud: "authenticated", role: "authenticated" },
    ]
      .map((o) => Buffer.from(JSON.stringify(o)).toString("base64url"))
      .join(".") + ".test-signature";
  await context.addInitScript(
    ({ access, exp, user }) => {
      localStorage.setItem(
        "sb-127-auth-token",
        JSON.stringify({
          access_token: access,
          refresh_token: "local-test-refresh",
          token_type: "bearer",
          expires_in: 3600,
          expires_at: exp,
          user,
        }),
      );
    },
    { access, exp, user },
  );
}
function service() {
  return {
    head: null as Envelope | null,
    seen: new Set<string>(),
    fail: false,
    lose: false,
    calls: 0,
    applied: 0,
  };
}
async function routeService(
  context: BrowserContext,
  db: ReturnType<typeof service>,
) {
  await context.route("http://127.0.0.1:54321/**", async (route) => {
    const url = route.request().url();
    if (url.includes("/auth/v1/user")) return route.fulfill({ json: user });
    if (url.includes("/auth/v1/logout")) return route.fulfill({ status: 204 });
    if (url.includes("/rest/v1/owner_checkpoints"))
      return route.fulfill({ json: [] });
    if (db.fail) return route.abort("internetdisconnected");
    if (url.includes("/rpc/load_owner_save"))
      return route.fulfill({ json: db.head });
    if (url.includes("/rpc/commit_owner_save")) {
      db.calls++;
      const body = route.request().postDataJSON();
      if (db.seen.has(body.p_command_id))
        return route.fulfill({ json: db.head });
      if ((db.head?.revision ?? 0) !== body.p_expected_revision)
        return route.fulfill({
          status: 409,
          json: { code: "40001", message: "revision conflict" },
        });
      const entities = body.p_replace ? {} : { ...db.head?.state.entities };
      for (const e of body.p_upserts) entities[e.id] = e;
      db.head = {
        revision: body.p_expected_revision + 1,
        state: { core: body.p_core, entities },
      };
      db.seen.add(body.p_command_id);
      db.applied++;
      if (db.lose) {
        db.lose = false;
        return route.abort("connectionreset");
      }
      return route.fulfill({ json: db.head });
    }
    return route.fulfill({
      status: 404,
      json: { message: "unexpected test route" },
    });
  });
}
async function start(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByLabel("馬主名", { exact: true }).fill("橋本牧場");
  await page.getByRole("button", { name: "経歴を始める", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "アオノシルベ", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("クラウド保存済み", { exact: false }),
  ).toBeVisible();
}
test("Google login sends the fixed callback and PKCE request", async ({
  page,
  context,
}) => {
  await context.route("http://127.0.0.1:54321/auth/v1/authorize**", (r) =>
    r.fulfill({ contentType: "text/html", body: "<p>OAuth test boundary</p>" }),
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "Googleでログイン", exact: true })
    .click();
  await expect(page).toHaveURL(/provider=google/);
  const url = new URL(page.url());
  expect(url.searchParams.get("redirect_to")).toBe("http://127.0.0.1:5178/");
  expect(url.searchParams.get("code_challenge_method")).toBe("s256");
});
test("PC: permanent horse, Worker progression, reload, safe text, export and invalid import", async ({
  page,
  context,
}) => {
  const db = service();
  await signInFixture(context);
  await routeService(context, db);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await start(page);
  await expect(
    page.getByRole("img", { name: "アオノシルベの3D表示" }),
  ).toBeVisible();
  await page.screenshot({ path: "artifacts/p1-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "1週間進める", exact: true }).click();
  await expect(
    page.getByText("確定した日付 2026-05-08", { exact: false }),
  ).toBeVisible();
  expect(db.head!.revision).toBe(2);
  await page.reload();
  await expect(
    page.getByText("確定した日付 2026-05-08", { exact: false }),
  ).toBeVisible();
  const name = "<img src=x onerror=alert(1)>";
  await page.getByLabel("愛馬の名前", { exact: true }).fill(name);
  await page
    .getByRole("button", { name: "馬名を記録する", exact: true })
    .click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  expect(await page.locator("img[src=x]").count()).toBe(0);
  await page.getByRole("button", { name: "記録室", exact: true }).click();
  const [file] = await Promise.all([
    page.waitForEvent("download"),
    page
      .getByRole("button", { name: "現在の記録を書き出す", exact: true })
      .click(),
  ]);
  expect(file.suggestedFilename()).toContain("2026-05-08");
  await page.locator("input[type=file]").setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"format":"bad"}'),
  });
  await expect(page.getByRole("alert")).toContainText(
    "バックアップではありません",
  );
  expect(db.head!.revision).toBe(3);
  const candidate = structuredClone(db.head!.state);
  candidate.core.owner.goal = "復旧した目標";
  await page.locator("input[type=file]").setInputFiles({
    name: "valid.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({ format: "verdant-owner-backup-v1", state: candidate }),
    ),
  });
  await expect(page.getByRole("dialog")).toBeVisible();
  await page
    .getByRole("button", { name: "現在の記録を保管して復旧する", exact: true })
    .click();
  await expect(page.getByText("保存 4", { exact: false })).toBeVisible();
  expect(db.head!.state.core.owner.goal).toBe("復旧した目標");
  expect(errors).toEqual([]);
});
test("lost response locks progression, reload retries without double charges", async ({
  page,
  context,
}) => {
  const db = service();
  await signInFixture(context);
  await routeService(context, db);
  await start(page);
  db.lose = true;
  await page.getByRole("button", { name: "1週間進める", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "同じ処理を再確認" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "1か月進める", exact: true }),
  ).toBeDisabled();
  const count = db.applied;
  await page.reload();
  await expect(
    page.getByText("確定した日付 2026-05-08", { exact: false }),
  ).toBeVisible();
  expect(db.applied).toBe(count);
  await expect(
    page.getByRole("button", { name: "1か月進める", exact: true }),
  ).toBeEnabled();
});
test("mobile: second isolated browser resumes same cloud state and uses light view", async ({
  browser,
}) => {
  const db = service();
  const context1 = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  await signInFixture(context1);
  await routeService(context1, db);
  const first = await context1.newPage();
  await first.goto("http://127.0.0.1:5178");
  await first.getByLabel("馬主名", { exact: true }).fill("橋本牧場");
  await first
    .getByRole("button", { name: "経歴を始める", exact: true })
    .click();
  await expect(
    first.getByRole("heading", { name: "アオノシルベ", exact: true }),
  ).toBeVisible();
  await first.getByRole("button", { name: "1週間進める", exact: true }).click();
  await expect(
    first.getByText("確定した日付 2026-05-08", { exact: false }),
  ).toBeVisible();
  const second = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    deviceScaleFactor: 1,
  });
  await signInFixture(second);
  await routeService(second, db);
  const page = await second.newPage();
  await page.goto("http://127.0.0.1:5178");
  await expect(
    page.getByText("確定した日付 2026-05-08", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: "アオノシルベの軽量表示" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "artifacts/p1-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "資金と契約", exact: true }).click();
  await expect(page.getByTestId("balance")).toContainText("円");
  await second.close();
  await context1.close();
});
