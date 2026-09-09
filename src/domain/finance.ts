import {
  cash,
  monthDays,
  nextDate,
  type World,
  type Contract,
} from "./world.ts";
import type { Invoice } from "./career-types.ts";
export function contracts(world: World) {
  return Object.values(world.entities).filter(
    (e): e is Contract => e.kind === "contract" && !e.endDate,
  );
}
export function invoices(world: World) {
  return Object.values(world.entities).filter(
    (e): e is Invoice => e.kind === "invoice" && !e.paid,
  );
}
export function reserve(world: World) {
  return world.core.career?.reserveYen ?? 0;
}
export function debt(world: World) {
  return (
    invoices(world).reduce((s, e) => s + e.amountYen, 0) +
    contracts(world).reduce((s, c) => s + (c.accruedYen ?? 0), 0)
  );
}
export function dailyCharge(monthlyYen: number, date: string) {
  const day = Number(date.slice(8)),
    days = monthDays(date);
  return (
    Math.floor((monthlyYen * day) / days) -
    Math.floor((monthlyYen * (day - 1)) / days)
  );
}
export function payDue(world: World) {
  for (const invoice of invoices(world)
    .filter((i) => i.dueDate <= world.core.date)
    .sort(
      (a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id),
    )) {
    if (cash(world) < invoice.amountYen) return false;
    const id = `paid:${invoice.id}`;
    if (world.entities[id]) throw new Error("請求の支払記録が重複しています。");
    world.entities[id] = {
      kind: "ledger",
      id,
      date: world.core.date,
      amountYen: -invoice.amountYen,
      category: invoice.category,
      horseId: invoice.horseId,
      ...(invoice.contractId ? { contractId: invoice.contractId } : {}),
      description: invoice.description,
    };
    invoice.paid = true;
  }
  return true;
}
export function closeDay(world: World) {
  const date = world.core.date,
    tomorrow = nextDate(date);
  for (const contract of contracts(world)) {
    contract.accruedYen =
      (contract.accruedYen ?? 0) + dailyCharge(contract.monthlyYen, date);
    if (date.slice(0, 7) !== tomorrow.slice(0, 7)) {
      const id = `bill:${contract.id}:${date.slice(0, 7)}`;
      if (world.entities[id]) throw new Error("月の請求が重複しています。");
      world.entities[id] = {
        kind: "invoice",
        id,
        date: tomorrow,
        dueDate: tomorrow.slice(0, 7) + "-07",
        horseId: contract.horseId,
        contractId: contract.id,
        amountYen: contract.accruedYen,
        category: "boarding",
        description: `${date.slice(0, 7)} 預託料（月末締め・翌7日支払）`,
        paid: false,
      };
      contract.accruedYen = 0;
    }
  }
  world.core.date = tomorrow;
  if (tomorrow.slice(5) === "01-01" && !world.entities[`capital:${tomorrow}`]) {
    const id = `capital:${tomorrow}`;
    world.entities[id] = {
      kind: "ledger",
      id,
      date: tomorrow,
      amountYen: world.core.owner.annualYen,
      category: "capital",
      description: "本業からの年間拠出（固定枠）",
    };
  }
  return payDue(world);
}
export function forecast(
  world: World,
  monthlyOverride?: number,
  purchaseYen = 0,
) {
  let balance = cash(world) - purchaseYen;
  const current = contracts(world);
  const monthly =
    monthlyOverride ?? current.reduce((s, c) => s + c.monthlyYen, 0);
  const monthlyRates =
    monthlyOverride === undefined
      ? current.map((c) => c.monthlyYen)
      : !world.core.career?.portfolio
        ? [monthlyOverride]
        : [
            ...current.map((c) => c.monthlyYen),
            monthlyOverride - current.reduce((s, c) => s + c.monthlyYen, 0),
          ].filter((n) => n > 0);
  let accrued = current.reduce((s, c) => s + (c.accruedYen ?? 0), 0);
  const due = invoices(world).map((i) => ({
    date: i.dueDate,
    amount: i.amountYen,
  }));
  if (world.core.career?.portfolio)
    for (const e of Object.values(world.entities)) {
      if (e.kind !== "race" || !["registered", "selected"].includes(e.status))
        continue;
      const race = e as import("./season-types.ts").SeasonRace;
      const count = e.terms
        ? race.ownedIds.filter(
            (id) =>
              !race.excludedIds.includes(id) && !race.cancelledIds.includes(id),
          ).length
        : 1;
      if (count) due.push({ date: e.date, amount: 150000 * count });
    }
  const rows: { date: string; balanceYen: number; freeYen: number }[] = [];
  let firstShortage: string | null = null;
  let date = world.core.date;
  for (let i = 0; rows.length < 12 && i < 400; i++) {
    for (const b of due.filter((b) => b.date === date)) balance -= b.amount;
    // Existing due/overdue invoices are charged on the first projected day.
    if (i === 0)
      for (const b of due.filter((b) => b.date < date)) balance -= b.amount;
    if (balance < 0 && !firstShortage) firstShortage = date;
    accrued += monthlyRates.reduce((s, n) => s + dailyCharge(n, date), 0);
    const tomorrow = nextDate(date);
    if (date.slice(0, 7) !== tomorrow.slice(0, 7)) {
      due.push({ date: tomorrow.slice(0, 7) + "-07", amount: accrued });
      const unpaid = due
        .filter((b) => b.date > date)
        .reduce((s, b) => s + b.amount, 0);
      rows.push({
        date,
        balanceYen: balance,
        freeYen: balance - unpaid - reserve(world),
      });
      accrued = 0;
    }
    if (tomorrow.slice(5) === "01-01") balance += world.core.owner.annualYen;
    date = tomorrow;
  }
  return { rows, firstShortage, monthlyYen: monthly };
}
