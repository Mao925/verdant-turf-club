import { writeFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { applyCommand, backup, cash, createWorld } from "../src/domain/world";
import { activeRace, openConsultation } from "../src/domain/career";
import { routeService, service, signInFixture } from "./fixtures";
async function saved(page: Page) {
  await expect(
    page.getByText("クラウド保存済み", { exact: false }),
  ).toBeVisible();
}
async function start(page: Page, trainer = "佐伯修司") {
  await page.goto("/");
  await page.getByLabel("馬主名", { exact: true }).fill("橋本牧場");
  await page.getByRole("button", { name: "経歴を始める", exact: true }).click();
  await saved(page);
  await expect(
    page.getByRole("heading", { name: "まだ見ぬ、一頭に出会う。" }),
  ).toBeVisible();
  await page.getByLabel("入札上限（万円）").fill("1500");
  await page
    .getByRole("button", { name: "この上限で入札する", exact: true })
    .click();
  await saved(page);
  await page
    .getByRole("button", { name: "支払い、愛馬を迎える", exact: true })
    .click();
  await saved(page);
  await page
    .getByRole("button", { name: trainer + "に預ける", exact: true })
    .click();
  await saved(page);
  await expect(
    page.getByRole("heading", { name: "アオノシルベ", exact: true }),
  ).toBeVisible();
}
async function advance(page: Page) {
  await page.getByRole("button", { name: "1か月進める", exact: true }).click();
  await saved(page);
}
async function firstReport(page: Page, db: ReturnType<typeof service>) {
  for (let i = 0; i < 10 && !openConsultation(db.head!.state); i++)
    await advance(page);
  expect(openConsultation(db.head!.state)).toBeTruthy();
}
async function runRace(page: Page, db: ReturnType<typeof service>) {
  for (let i = 0; i < 30; i++) {
    if (activeRace(db.head!.state)?.status === "result") return;
    if (openConsultation(db.head!.state))
      await page
        .getByRole("button", { name: "この競走への意向を伝える", exact: true })
        .click();
    else await advance(page);
    await saved(page);
  }
  throw new Error("race did not finish");
}
test("Google login uses fixed callback and PKCE", async ({ page, context }) => {
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
test("PC: purchase, trainer, wait, multiple races, 3D/skip, goals, export and restore", async ({
  page,
  context,
}) => {
  test.setTimeout(90000);
  const db = service();
  await signInFixture(context);
  await routeService(context, db);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await start(page);
  await expect(
    page.getByRole("img", { name: "アオノシルベの3D表示" }),
  ).toBeVisible();
  await firstReport(page, db);
  await page.screenshot({ path: "artifacts/p3-desktop.png", fullPage: true });
  await page.getByLabel("今回の判断の理由").fill("まずは待ってみる");
  await page
    .getByRole("button", { name: "今回は見送り、待つ", exact: true })
    .click();
  await saved(page);
  await firstReport(page, db);
  await expect(page.locator("blockquote")).toContainText("まずは待ってみる");
  await runRace(page, db);
  const before = JSON.stringify(activeRace(db.head!.state)!.result);
  const revision = db.head!.revision;
  await expect(page.getByRole("img", { name: /の3D観戦/ })).toBeVisible();
  await page.getByRole("button", { name: "観戦を再生", exact: true }).click();
  await page.getByLabel("再生速度").selectOption("12");
  const rendering = await page.evaluate(async () => {
    const intervals: number[] = [];
    await new Promise<void>((resolve) => {
      let previous = performance.now();
      function frame(now: number) {
        intervals.push(now - previous);
        previous = now;
        if (intervals.length < 90) requestAnimationFrame(frame);
        else resolve();
      }
      requestAnimationFrame(frame);
    });
    intervals.shift();
    intervals.sort((a, b) => a - b);
    return {
      frames: intervals.length,
      p50FrameMs: intervals[Math.floor(intervals.length * 0.5)],
      p95FrameMs: intervals[Math.floor(intervals.length * 0.95)],
      maxFrameMs: intervals.at(-1),
      canvases: document.querySelectorAll("canvas").length,
    };
  });
  writeFileSync(
    "artifacts/p3-browser-performance.json",
    JSON.stringify(
      {
        kind: `Headless Chrome on this Mac, portrait plus ${activeRace(db.head!.state)!.field.length}-horse 3D replay; not a real-device guarantee`,
        ...rendering,
      },
      null,
      2,
    ),
  );

  await page.getByRole("button", { name: "スキップして着順を見る" }).click();
  await expect(page.locator(".race-results li")).toHaveCount(
    activeRace(db.head!.state)!.field.length,
  );
  expect(db.head!.revision).toBe(revision);
  expect(JSON.stringify(activeRace(db.head!.state)!.result)).toBe(before);
  await page.screenshot({ path: "artifacts/p3-race.png", fullPage: true });
  await page.getByRole("button", { name: "結果を精算し、次の相談へ" }).click();
  await saved(page);
  await expect(page.locator(".consultation")).toContainText("着");
  await page
    .getByRole("button", { name: "今回は見送り、待つ", exact: true })
    .click();
  await saved(page);
  await firstReport(page, db);
  await runRace(page, db);
  await page.getByRole("button", { name: "結果を精算し、次の相談へ" }).click();
  await saved(page);
  await page.getByText("目標と、その理由を見直す", { exact: true }).click();
  await page
    .getByLabel("この馬の目標", { exact: true })
    .fill("<img src=x onerror=alert(1)>");
  await page.getByLabel("目標を変える理由").fill("二戦の走りを見て");
  await page.getByRole("button", { name: "目標と理由を記録する" }).click();
  await saved(page);
  expect(await page.locator("img[src=x]").count()).toBe(0);
  await page.getByRole("button", { name: "記録室", exact: true }).click();
  const [file] = await Promise.all([
    page.waitForEvent("download"),
    page
      .getByRole("button", { name: "現在の記録を書き出す", exact: true })
      .click(),
  ]);
  expect(file.suggestedFilename()).toContain(db.head!.state.core.date);
  const rev = db.head!.revision;
  await page.locator("input[type=file]").setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"format":"bad"}'),
  });
  await expect(page.getByRole("alert")).toContainText(
    "バックアップではありません",
  );
  expect(db.head!.revision).toBe(rev);
  const candidate = structuredClone(db.head!.state);
  candidate.core.owner.goal = "復旧した目標";
  await page.locator("input[type=file]").setInputFiles({
    name: "valid.json",
    mimeType: "application/json",
    buffer: Buffer.from(backup(candidate, rev)),
  });
  await page
    .getByRole("button", { name: "現在の記録を保管して復旧する", exact: true })
    .click();
  await saved(page);
  expect(db.head!.state.core.owner.goal).toBe("復旧した目標");
  expect(errors).toEqual([]);
});
test("lost purchase response and offline progression preserve pending data and never double-charge", async ({
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
  await saved(page);
  expect(db.applied).toBe(count);
  expect(db.head!.state.core.date).toBe("2026-05-08");
  db.fail = true;
  await page.getByRole("button", { name: "1週間進める", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "同じ処理を再確認" }),
  ).toBeVisible();
  expect(db.head!.state.core.date).toBe("2026-05-08");
  db.fail = false;
  await page.reload();
  await saved(page);
  expect(db.head!.state.core.date).toBe("2026-05-15");
});
test("mobile: all economic decisions, light replay and second browser conflict", async ({
  browser,
}) => {
  test.setTimeout(90000);
  const db = service();
  const c1 = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
  });
  await signInFixture(c1);
  await routeService(c1, db);
  const page = await c1.newPage();
  await start(page, "三原葵");
  await firstReport(page, db);
  await expect(
    page.getByRole("img", { name: "アオノシルベの軽量表示" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "artifacts/p3-mobile.png", fullPage: true });
  await page.getByLabel("検討する路線").selectOption("dirt-middle");
  await page.getByRole("button", { name: "この路線を相談する" }).click();
  await saved(page);
  await firstReport(page, db);
  await runRace(page, db);
  await expect(page.locator(".race-lanes")).toBeVisible();
  await page.getByRole("button", { name: "スキップして着順を見る" }).click();
  await expect(page.locator(".race-results li")).toHaveCount(
    activeRace(db.head!.state)!.field.length,
  );
  await page.getByRole("button", { name: "結果を精算し、次の相談へ" }).click();
  await saved(page);
  const c2 = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  await signInFixture(c2);
  await routeService(c2, db);
  const second = await c2.newPage();
  await second.goto("/");
  await saved(second);
  await expect(
    second.getByRole("heading", { name: "アオノシルベ", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "今回は見送り、待つ", exact: true })
    .click();
  await saved(page);
  const latest = db.head!.revision;
  await second
    .getByRole("button", { name: "今回は見送り、待つ", exact: true })
    .click();
  await expect(
    second.getByText("別の端末で更新されています", { exact: false }),
  ).toBeVisible();
  expect(db.head!.revision).toBe(latest);
  second.on("dialog", (d) => d.accept());
  await second
    .getByRole("button", { name: "クラウドの最新の経歴を使う" })
    .click();
  await saved(second);
  await second.getByRole("button", { name: "資金と契約", exact: true }).click();
  await expect(
    second.getByRole("heading", { name: "賞金ゼロの12か月予測" }),
  ).toBeVisible();
  await expect(second.getByTestId("balance")).toContainText("円");
  expect(
    await second.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await second.screenshot({
    path: "artifacts/p3-finance-mobile.png",
    fullPage: true,
  });
  await c1.close();
  await c2.close();
});
test("P1 upgrade retains the existing save and resumes on reload", async ({
  page,
  context,
}) => {
  const db = service();
  db.head = {
    revision: 4,
    state: applyCommand(
      createWorld({
        save: crypto.randomUUID(),
        owner: crypto.randomUUID(),
        horse: crypto.randomUUID(),
        contract: crypto.randomUUID(),
      }),
      { type: "advance", days: 21 },
      crypto.randomUUID(),
    ),
  };
  const before = cash(db.head.state),
    saveId = db.head.state.core.saveId;
  await signInFixture(context);
  await routeService(context, db);
  await page.goto("/");
  await page.getByRole("button", { name: "愛馬の生涯へ引き継ぐ" }).click();
  await saved(page);
  expect(cash(db.head!.state)).toBe(before);
  expect(db.head!.state.core.saveId).toBe(saveId);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "アオノシルベ", exact: true }),
  ).toBeVisible();
  expect(db.head!.revision).toBe(5);
});
