import { test, expect } from "@playwright/test";
import { signInFixture, routeService, service } from "./fixtures";
import {
  applyCommand,
  horses,
  backup,
  cash,
  type World,
  type Horse,
} from "../src/domain/world";
import {
  createCareer,
  openConsultation,
  activeRace,
} from "../src/domain/career";
import { createSeason, allPending } from "../src/domain/season";
import { seasonOpportunities } from "../src/domain/program";
const uuid = () => crypto.randomUUID();
const settings = {
  name: "四季の馬主",
  silk: "#e3bd42",
  goal: "いつか有馬へ",
  initialYen: 100000000,
  annualYen: 20000000,
};
const ids = () => ({
  save: uuid(),
  owner: uuid(),
  horse: uuid(),
  contract: uuid(),
});
const act = (w: World, c: Parameters<typeof applyCommand>[1]) =>
  applyCommand(w, c, uuid());
async function saved(page: import("@playwright/test").Page) {
  await expect(
    page.getByText("クラウド保存済み", { exact: false }),
  ).toBeVisible();
}
test("P3: P2 migration, second purchase, individual plans and combined finances on desktop and mobile", async ({
  page,
  context,
}) => {
  test.setTimeout(90000);
  const db = service();
  let w = createCareer(ids(), settings);
  const m = w.entities[
    w.core.career!.marketId
  ] as import("../src/domain/career-types").Market;
  w = act(w, {
    type: "bid",
    horseId: m.lots[0].horseId,
    limitYen: 15000000,
    reason: "以前の取得",
  });
  w = act(w, { type: "receive", name: "ツキノシルベ", reason: "以前の願い" });
  w = act(w, { type: "board", trainerId: "saeki" });
  const before = cash(w);
  db.head = { revision: 4, state: w };
  await signInFixture(context);
  await routeService(context, db);
  await page.goto("/");
  await page
    .getByRole("button", { name: "通年番組へ引き継ぐ", exact: true })
    .click();
  await saved(page);
  expect(cash(db.head.state)).toBe(before);
  expect(db.head.state.core.engineVersion).toBe("owner-p3");
  await page
    .getByRole("button", { name: "もう一頭を探す", exact: true })
    .click();
  await saved(page);
  // User sees the additional maintenance burden as well as the original contract.
  await page.locator(".lot-card").nth(1).click();
  await page.getByLabel("入札上限（万円）").fill("1500");
  await page
    .getByRole("button", { name: "この上限で入札する", exact: true })
    .click();
  await saved(page);
  await page.getByLabel("愛馬の名前").fill("カゼノシルベ");
  await page
    .getByRole("button", { name: "支払い、愛馬を迎える", exact: true })
    .click();
  await saved(page);
  await page
    .getByRole("button", { name: "三原葵に預ける", exact: true })
    .click();
  await saved(page);
  expect(horses(db.head.state)).toHaveLength(2);
  await page.getByRole("button", { name: "1か月進める", exact: true }).click();
  await saved(page);
  expect(allPending(db.head.state)).toHaveLength(2);
  await page
    .getByRole("button", { name: /ツキノシルベ.*相談への返事待ち/ })
    .click();
  await saved(page);
  await page.getByLabel("今回の判断の理由").fill("この馬は長く待つ");
  await page
    .getByRole("button", { name: "今回は見送り、待つ", exact: true })
    .click();
  await saved(page);
  await expect(
    page.getByRole("button", { name: "1か月進める", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: /カゼノシルベ.*相談への返事待ち/ })
    .click();
  await saved(page);
  await page.getByLabel("検討する路線").selectOption("dirt-middle");
  await page
    .getByRole("button", { name: "この路線を相談する", exact: true })
    .click();
  await saved(page);
  const plans = db.head.state.core.career!.portfolio!.plans;
  expect(plans[m.lots[0].horseId].route).toBe("turf-mile");
  expect(plans[m.lots[1].horseId].route).toBe("dirt-middle");
  await page
    .getByText("通年番組を開く · 東京・中山・京都・阪神・中京", { exact: true })
    .click();
  await page.getByLabel("番組の月").fill("2026-12");
  await page.getByLabel("番組のクラス").selectOption("重賞");
  await expect(
    page.getByRole("cell", { name: "有馬記念 GI · 中山", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "有馬記念の条件", exact: true })
    .click();
  await expect(page.getByText(/ファン上位50頭以内/)).toBeVisible();
  await page.screenshot({
    path: "artifacts/p3-portfolio-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("body")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "artifacts/p3-portfolio-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "資金と契約", exact: true }).click();
  await expect(page.getByText(/ツキノシルベ · 佐伯修司/)).toBeVisible();
  await expect(page.getByText(/カゼノシルベ · 三原葵/)).toBeVisible();
  await page.screenshot({
    path: "artifacts/p3-finance-mobile.png",
    fullPage: true,
  });
  await page.reload();
  await saved(page);
  expect(horses(db.head.state)).toHaveLength(2);
});
test("P3: two owned runners replay identically, camera switches horse without saving and settlement is collective", async ({
  page,
  context,
}) => {
  test.setTimeout(60000);
  const db = service();
  let w = createSeason(ids(), settings);
  for (let i = 0; i < 2; i++) {
    if (i) w = act(w, { type: "open-market" });
    const m = w.entities[
      w.core.career!.marketId
    ] as import("../src/domain/career-types").Market;
    w = act(w, {
      type: "bid",
      horseId: m.lots[i].horseId,
      limitYen: 15000000,
      reason: "比較",
    });
    w = act(w, { type: "receive", name: "観戦馬" + i, reason: "願い" });
    w = act(w, { type: "board", trainerId: "saeki" });
  }
  // Controlled small field tests the actual two-owner rendering path without depending on random selection.
  for (const e of Object.values(w.entities))
    if (e.kind === "horse" && e.id.startsWith("npc:"))
      e.details!.registered = false;
  w = act(w, { type: "advance", days: 31 });
  const owned = horses(w);
  w = act(w, { type: "select-horse", horseId: owned[0].id });
  const r = seasonOpportunities(w).find(
    (r) =>
      r.raceClass === "新馬" &&
      r.terms.maxAge === 2 &&
      r.surface === "芝" &&
      r.distance === 1600,
  )!;
  for (const h of owned) {
    w = act(w, { type: "select-horse", horseId: h.id });
    w = act(w, {
      type: "consult",
      choice: "race",
      raceId: r.id,
      reason: "比較",
    });
  }
  for (let i = 0; i < 10 && activeRace(w)?.status !== "result"; i++)
    w = act(w, { type: "advance", days: 31 });
  expect(activeRace(w)?.status).toBe("result");
  db.head = { revision: 20, state: w };
  await signInFixture(context);
  await routeService(context, db);
  await page.goto("/");
  await saved(page);
  const original = JSON.stringify(activeRace(w)!.result);
  await expect(page.getByRole("img", { name: /の3D観戦/ })).toBeVisible();
  await page.getByLabel("追いかける愛馬").selectOption(owned[1].id);
  await page.getByLabel("観戦カメラ").selectOption("overhead");
  await page
    .getByRole("button", { name: "スキップして着順を見る", exact: true })
    .click();
  await expect(page.locator(".race-results li.my-horse")).toHaveCount(2);
  await page.screenshot({
    path: "artifacts/p3-multiple-race.png",
    fullPage: true,
  });
  expect(db.head.revision).toBe(20);
  expect(JSON.stringify(activeRace(db.head.state)!.result)).toBe(original);
  await page
    .getByRole("button", { name: "結果を精算し、次の相談へ", exact: true })
    .click();
  await saved(page);
  expect(
    allPending(db.head.state).filter((e) => e.kind === "consultation"),
  ).toHaveLength(2);
  expect(
    JSON.stringify(
      (
        db.head.state.entities[
          r.id
        ] as import("../src/domain/season-types").SeasonRace
      ).result,
    ),
  ).toBe(original);
});
