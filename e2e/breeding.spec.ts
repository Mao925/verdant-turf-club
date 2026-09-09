import { test, expect, type Page } from "@playwright/test";
import { signInFixture, routeService, service } from "./fixtures";
import { prepared, covered, normal, at } from "../tests/breeding-fixtures";
import { horses, type Horse, createWorld } from "../src/domain/world";
import { cycles } from "../src/domain/breeding-support";
import { contracts } from "../src/domain/finance";
import { nextDate } from "../src/domain/world";
async function saved(p: Page) {
  await expect(p.getByText("クラウド保存済み", { exact: false })).toBeVisible();
}
test("P5: compare breeding terms, reserve a mating and reload the same outcome on desktop/mobile", async ({
  page,
  context,
}) => {
  test.setTimeout(60000);
  const db = service();
  db.head = { revision: 5, state: prepared() };
  await signInFixture(context);
  await routeService(context, db);
  await page.goto("/");
  await saved(page);
  await expect(
    page.getByRole("heading", { name: "順調に進んだ場合、仔のデビューまで" }),
  ).toBeVisible();
  await page.getByLabel("種付料の支払条件").selectOption("live-foal");
  await page
    .getByLabel("繁殖・育成と親子を考える理由")
    .fill("母を知る牧場へ次の世代も託したい");
  await page.screenshot({
    path: "artifacts/p5-breeding-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "この配合の受入条件を照会する" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "artifacts/p5-breeding-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "この配合の受入条件を照会する" })
    .click();
  await saved(page);
  expect(cycles(db.head.state)[0].status).toBe("applied");
  await page.getByRole("button", { name: "1週間進める", exact: true }).click();
  await saved(page);
  await page
    .getByRole("button", { name: "この条件で種付けを予約する" })
    .click();
  await saved(page);
  expect(cycles(db.head.state)[0].status).toBe("reserved");
  await page.getByRole("button", { name: "1週間進める", exact: true }).click();
  await saved(page);
  const outcome = structuredClone(cycles(db.head.state)[0].outcome);
  expect(outcome).toBeTruthy();
  await page.reload();
  await saved(page);
  expect(cycles(db.head.state)[0].outcome).toEqual(outcome);
  await expect(
    page.getByRole("button", { name: "母仔の報告を受け取る" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "母仔の報告を受け取る" }).click();
  await saved(page);
  expect(cycles(db.head.state)[0].report).toBe(false);
});
test("P5: yearling market acquisition requires rearing instead of immediate racing", async ({
  page,
  context,
}) => {
  const db = service();
  await signInFixture(context);
  await routeService(context, db);
  await page.goto("/");
  await page.getByLabel("馬主名", { exact: true }).fill("育成から見守る馬主");
  await page.getByRole("button", { name: "経歴を始める", exact: true }).click();
  await saved(page);
  await page.getByRole("button", { name: "1歳育成市場", exact: true }).click();
  await saved(page);
  await page.getByLabel("入札上限（万円）").fill("1500");
  await page
    .getByRole("button", { name: "この上限で入札する", exact: true })
    .click();
  await saved(page);
  await page
    .getByRole("button", { name: "支払い、愛馬を迎える", exact: true })
    .click();
  await saved(page);
  await expect(
    page.getByRole("heading", { name: "成長を、牧場へ託す。" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "佐伯修司に預ける" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "白樺牧場へ育成預託する" }).click();
  await saved(page);
  await page.reload();
  await saved(page);
  expect(contracts(db.head.state)[0].purpose).toBe("rearing");
  expect(horses(db.head.state)[0].details!.registered).toBe(false);
  await expect(
    page.getByRole("button", { name: "段階的な育成を始める（月35万円）" }),
  ).toBeDisabled();
});
test("P5: a foal retains its deceased mother and can choose a different goal", async ({
  page,
  context,
}) => {
  const db = service(),
    w = covered("live-foal"),
    b = normal(w);
  b.outcome!.motherDies = true;
  at(w, nextDate(b.matingDate!, 17));
  at(w, b.dueDate!);
  db.head = { revision: 20, state: w };
  await signInFixture(context);
  await routeService(context, db);
  await page.goto("/");
  await saved(page);
  const f = w.entities[b.foalId!] as Horse;
  await page
    .locator(".horse-roster button")
    .filter({ hasText: f.name })
    .click();
  await saved(page);
  await page.getByText(/人物と愛馬の記憶をたどる/).click();
  await expect(
    page.getByText(/離乳までは乳母・哺育支援に月10万円/),
  ).toBeVisible();
  await page
    .getByText("仔を名付け、母の目標を継ぐか考える", { exact: true })
    .click();
  await page.getByLabel("仔の名前", { exact: true }).fill("アシタノミチ");
  await page.getByLabel("目標の継ぎ方").selectOption("new");
  await page.getByLabel("仔と目指す目標").fill("この仔に合う芝のマイルへ");
  await page.getByLabel("仔の路線").selectOption("turf-mile");
  await page.getByRole("button", { name: "名前と目標を記録する" }).click();
  await saved(page);
  await page.reload();
  await saved(page);
  expect((db.head.state.entities[f.id] as Horse).family!.damId).toBe(b.horseId);
  expect(db.head.state.core.career!.horseGoal).toBe("この仔に合う芝のマイルへ");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "artifacts/p5-foal-memory.png",
    fullPage: true,
  });
});
