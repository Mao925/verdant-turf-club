import { test, expect, type Page } from "@playwright/test";
import { signInFixture, routeService, service } from "./fixtures";
import {
  applyCommand,
  horses,
  nextDate,
  validateWorld,
  type World,
  type Horse,
} from "../src/domain/world";
import { createLife } from "../src/domain/life";
import { beginEpisode, healthDay, raceCause } from "../src/domain/health";
import { contracts } from "../src/domain/finance";
import { hash, random } from "../src/domain/catalog";
import { program } from "../src/domain/program";
import type { SeasonRace } from "../src/domain/season-types";
const uuid = () => crypto.randomUUID();
const act = (w: World, c: Parameters<typeof applyCommand>[1]) =>
  applyCommand(w, c, uuid());
function fresh() {
  let w = createLife(
    {
      save: "40000000-0000-4000-8000-000000000004",
      owner: uuid(),
      horse: uuid(),
      contract: uuid(),
    },
    {
      name: "長い季節の馬主",
      silk: "#e3bd42",
      goal: "ずっと一緒に",
      initialYen: 100000000,
      annualYen: 20000000,
    },
  );
  const m = w.entities[w.core.career!.marketId];
  if (m.kind !== "market") throw Error();
  const l = m.lots[0];
  w = act(w, {
    type: "bid",
    horseId: l.horseId,
    limitYen: l.rivalYen + 100000,
    reason: "継続所有",
  });
  w = act(w, { type: "receive", name: "カゼノキオク", reason: "願いを託す" });
  return act(w, { type: "board", trainerId: "saeki" });
}
async function saved(page: Page) {
  await expect(
    page.getByText("クラウド保存済み", { exact: false }),
  ).toBeVisible();
}
test("P4: diagnosis, rehabilitation, capacity terms, memories and reload on mobile", async ({
  page,
  context,
}) => {
  test.setTimeout(60000);
  const db = service(),
    w = fresh(),
    h = horses(w)[0];
  const e = beginEpisode(w, h, "tendon", "training");
  e.outcome = "recover";
  w.core.date = e.dueDate!;
  healthDay(w);
  validateWorld(w);
  db.head = { revision: 5, state: w };
  await signInFixture(context);
  await routeService(context, db);
  page.on("dialog", (d) => d.accept());
  await page.goto("/");
  await saved(page);
  await expect(
    page.getByRole("heading", { name: "診療方針の返事待ち" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "1か月進める", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("診療・進退を考える理由")
    .fill("焦らず、この馬の回復を待ちたい");
  await page
    .getByRole("button", { name: "白樺牧場で療養を始める", exact: true })
    .click();
  await saved(page);
  expect(contracts(db.head.state)[0].monthlyYen).toBe(350000);
  await page.getByRole("button", { name: "1週間進める", exact: true }).click();
  await saved(page);
  await expect(
    page.getByRole("heading", { name: "療養と再評価", exact: true }),
  ).toBeVisible();
  await page.getByText(/人物と愛馬の記憶をたどる/).click();
  await page
    .getByLabel("この場面に残す言葉（任意）")
    .first()
    .fill("この牧場で過ごす時間も大切にしたい");
  await page
    .getByRole("button", { name: "言葉を記録する", exact: true })
    .first()
    .click();
  await saved(page);
  await page.screenshot({
    path: "artifacts/p4-care-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "artifacts/p4-care-mobile.png",
    fullPage: true,
  });
  await page.reload();
  await saved(page);
  await page.getByText(/人物と愛馬の記憶をたどる/).click();
  await expect(
    page.getByLabel("この場面に残す言葉（任意）").first(),
  ).toHaveValue("この牧場で過ごす時間も大切にしたい");
  await page.getByRole("button", { name: "資金と契約", exact: true }).click();
  await expect(page.getByText(/白樺牧場・森谷澄：月額/)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "支払日を相談する" }),
  ).toBeVisible();
});
test("P4: DNF replay freezes and settlement preserves clinical record without prize", async ({
  page,
  context,
}) => {
  test.setTimeout(60000);
  let w = fresh();
  const h = horses(w)[0],
    spec = program(2026).find(
      (r) => r.raceClass === "新馬" && r.date >= "2026-06-01",
    )!;
  w.core.date = nextDate(spec.date, -1);
  const rival = Object.values(w.entities).find(
    (e): e is Horse => e.kind === "horse" && e.id.startsWith("npc:"),
  )!;
  const r: SeasonRace = {
    ...spec,
    kind: "race",
    seed: 5,
    status: "selected",
    horseId: h.id,
    entries: [h.id, rival.id],
    field: [h.id, rival.id],
    ownedIds: [h.id],
    excludedIds: [],
    cancelledIds: [],
    selectionNotes: { [h.id]: "選出済み" },
    applicantCount: 2,
  };
  w.entities[r.id] = r;
  for (let seed = 0; seed < 100000; seed++) {
    if (
      raceCause(random(hash(`${r.id}:${h.id}:race-health`, seed))()) ===
      "fracture"
    ) {
      w.core.worldSeed = seed;
      break;
    }
  }
  w = act(w, { type: "advance", days: 1 });
  const race = w.entities[r.id] as SeasonRace;
  expect(race.dnf?.some((d) => d.horseId === h.id)).toBe(true);
  const db = service();
  db.head = { revision: 12, state: w };
  await signInFixture(context);
  await routeService(context, db);
  await page.goto("/");
  await saved(page);
  await expect(page.getByRole("img", { name: /の3D観戦/ })).toBeVisible();
  await page
    .getByRole("button", { name: "スキップして着順を見る", exact: true })
    .click();
  await expect(page.locator(".race-results li.my-horse")).toContainText(
    "競走中止",
  );
  await expect(page.locator(".race-results li.my-horse")).not.toContainText(
    "秒",
  );
  await page.getByRole("button", { name: "軽量観戦へ", exact: true }).click();
  const width = await page
    .locator(".race-lane.my-horse .race-rail i")
    .evaluate((e) => e.getAttribute("style"));
  expect(width).not.toContain("width: 100%");
  await page.screenshot({ path: "artifacts/p4-dnf.png", fullPage: true });
  expect(db.head.revision).toBe(12);
  await page
    .getByRole("button", { name: "結果を精算し、次の相談へ", exact: true })
    .click();
  await saved(page);
  expect(
    (db.head.state.entities[r.id] as SeasonRace).awards![h.id].cashYen,
  ).toBe(0);
  await page.reload();
  await saved(page);
  await expect(
    page.getByRole("heading", { name: "診断の報告待ち" }),
  ).toBeVisible();
});
test("P4: death report, memorial and closure keep an explicit historical record", async ({
  page,
  context,
}) => {
  const db = service(),
    w = fresh();
  const h = horses(w)[0];
  beginEpisode(w, h, "catastrophic", "training");
  validateWorld(w);
  db.head = { revision: 5, state: w };
  await signInFixture(context);
  await routeService(context, db);
  await page.goto("/");
  await saved(page);
  await expect(page.locator(".memorial")).toContainText(h.name);
  await expect(
    page.getByRole("button", { name: "1か月進める", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "報告を受け取り、記録に残す", exact: true })
    .click();
  await saved(page);
  await page.getByText(/人物と愛馬の記憶をたどる/).click();
  await expect(
    page.locator(".memory-card").filter({ hasText: "亡くなりました" }),
  ).toBeVisible();
  await page.screenshot({ path: "artifacts/p4-memorial.png", fullPage: true });
  await page.getByRole("button", { name: "資金と契約", exact: true }).click();
  await page.getByText("資金不足で続けられないとき", { exact: true }).click();
  await page.getByLabel("活動を終える理由").fill("ここまでの経歴を大切に残す");
  page.on("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "活動終了を記録する", exact: true })
    .click();
  await saved(page);
  await expect(
    page.getByRole("heading", { name: "活動終了時点の記録" }),
  ).toBeVisible();
  expect(db.head.state.core.career!.life!.closure?.unplacedIds).toEqual([]);
});
