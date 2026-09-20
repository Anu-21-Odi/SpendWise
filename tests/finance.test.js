/* ==========================================================================
   SpendWise — domain logic tests
   Run with: npm test   (node --test)
   These exercise js/finance.js directly — the same module the app loads.
   ========================================================================== */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../js/finance.js');

/* ------------------------------------------------------------------ *
 * Fixture: a fixed reference date so nothing depends on "today"
 * ------------------------------------------------------------------ */
const NOW = new Date(2026, 8, 20); // 20 Sep 2026 (month index is 0-based)

const TX = [
  { id: 1, description: 'Salary',        category: 'Salary',        type: 'income',  amount: 5000, date: '2026-09-01' },
  { id: 2, description: 'Rent',          category: 'Housing',       type: 'expense', amount: 1200, date: '2026-09-03' },
  { id: 3, description: 'Groceries',     category: 'Food & Dining', type: 'expense', amount: 300,  date: '2026-09-06' },
  { id: 4, description: 'Coffee',        category: 'Food & Dining', type: 'expense', amount: 20,   date: '2026-09-08' },
  { id: 5, description: 'Emergency fund',category: 'Savings Fund',  type: 'savings', amount: 400,  date: '2026-09-02', goalId: 'goal-1' },
  { id: 6, description: 'August Salary', category: 'Salary',        type: 'income',  amount: 5000, date: '2026-08-01' },
  { id: 7, description: 'August Rent',   category: 'Housing',       type: 'expense', amount: 1200, date: '2026-08-03' },
  { id: 8, description: 'August Food',   category: 'Food & Dining', type: 'expense', amount: 500,  date: '2026-08-12' }
];

/* ------------------------------------------------------------------ *
 * Money & currency
 * ------------------------------------------------------------------ */
test('formatMoney renders sign, symbol and thousands separators', () => {
  assert.equal(F.formatMoney(1234.5, '$'), '$1,234.50');
  assert.equal(F.formatMoney(-88, '$'), '-$88.00');
  assert.equal(F.formatMoney(1234.5, '$', { signed: true }), '+$1,234.50');
  assert.equal(F.formatMoney(0, '€'), '€0.00');
});

test('formatMoney masks everything when privacy is on', () => {
  assert.equal(F.formatMoney(999999, '$', { privacy: true }), '$••••••');
});

test('signed mode keeps the + at zero, matching the income card markup', () => {
  assert.equal(F.formatMoney(0, '$', { signed: true }), '+$0.00');
  assert.equal(F.formatMoney(0, '$'), '$0.00');
  assert.equal(F.formatMoney(-250, '$', { signed: true }), '-$250.00');
});

test('an explicit sign survives zero, which -0 comparisons cannot', () => {
  assert.equal(F.formatMoney(0, '$', { sign: '-' }), '-$0.00');
  assert.equal(F.formatMoney(-0, '$'), '$0.00', 'a bare -0 must not render as -$0.00');
  assert.equal(F.formatMoney(42, '$', { sign: '-' }), '-$42.00');
  assert.equal(F.formatMoney(0, '$', { sign: '-', privacy: true }), '-$••••••');
});

test('currency conversion round-trips', () => {
  const rates = { USD: 1, NGN: 1500 };
  assert.equal(F.fromUSD(10, 'NGN', rates), 15000);
  assert.equal(F.round2(F.toUSD(15000, 'NGN', rates)), 10);
});

test('an unknown or broken rate falls back to 1 instead of NaN', () => {
  assert.equal(F.fromUSD(50, 'ZZZ', { USD: 1 }), 50);
  assert.equal(F.fromUSD(50, 'NGN', { NGN: 0 }), 50);
  assert.equal(F.fromUSD(50, 'NGN', { NGN: NaN }), 50);
});

test('compactMoney abbreviates large values', () => {
  assert.equal(F.compactMoney(1500, '$'), '$1.5k');
  assert.equal(F.compactMoney(2500000, '$'), '$2.5M');
  assert.equal(F.compactMoney(-3200, '$'), '-$3.2k');
  assert.equal(F.compactMoney(42, '$'), '$42');
});

/* ------------------------------------------------------------------ *
 * Dates & ranges
 * ------------------------------------------------------------------ */
test('monthKey and monthLabel agree', () => {
  assert.equal(F.monthKey('2026-09-20'), '2026-09');
  assert.equal(F.monthLabel('2026-09'), 'Sep');
  assert.equal(F.monthKey('not-a-date'), null);
});

test('lastMonthKeys returns exactly N keys ending on the current month', () => {
  const keys = F.lastMonthKeys(6, NOW);
  assert.equal(keys.length, 6);
  assert.equal(keys[5], '2026-09');
  assert.equal(keys[0], '2026-04');
});

test('filterByRange honours each window', () => {
  assert.equal(F.filterByRange(TX, 'this-month', NOW).length, 5);
  assert.equal(F.filterByRange(TX, 'all', NOW).length, 8);
  assert.equal(F.filterByRange(TX, 'ytd', NOW).length, 8);
  // 30d window from 20 Sep excludes 20 Aug and earlier
  assert.equal(F.filterByRange(TX, '30d', NOW).length, 5);
  assert.equal(F.filterByRange(TX, '90d', NOW).length, 8);
});

test('friendlyDate gives relative labels', () => {
  assert.equal(F.friendlyDate('2026-09-20', NOW), 'Today');
  assert.equal(F.friendlyDate('2026-09-19', NOW), 'Yesterday');
  assert.equal(F.friendlyDate('2026-09-17', NOW), '3 days ago');
});

/* ------------------------------------------------------------------ *
 * Sorting & filtering
 * ------------------------------------------------------------------ */
test('sortTransactions orders newest first regardless of insertion order', () => {
  const shuffled = [TX[0], TX[7], TX[3], TX[6], TX[1]];
  const sorted = F.sortTransactions(shuffled);
  assert.equal(sorted[0].date, '2026-09-08');
  assert.equal(sorted[sorted.length - 1].date, '2026-08-03');
});

test('filterTransactions combines search, category and type', () => {
  assert.equal(F.filterTransactions(TX, { search: 'coffee' }).length, 1);
  assert.equal(F.filterTransactions(TX, { category: 'Food & Dining' }).length, 3);
  assert.equal(F.filterTransactions(TX, { type: 'income' }).length, 2);
  assert.equal(F.filterTransactions(TX, { type: 'All', category: 'All' }).length, 8);
  assert.equal(F.filterTransactions(TX, { search: 'zzzz' }).length, 0);
});

/* ------------------------------------------------------------------ *
 * Summary maths — the core of the app
 * ------------------------------------------------------------------ */
test('computeSummary adds up income, expense, savings and balance', () => {
  const s = F.computeSummary(TX);
  assert.equal(s.income, 10000);
  assert.equal(s.expense, 3220);
  assert.equal(s.savings, 400);
  assert.equal(s.balance, 10000 - 3220 - 400); // 6380
  assert.equal(s.netCashflow, 6780);
  assert.equal(s.count, 8);
});

test('savings rate is net cashflow over income', () => {
  const s = F.computeSummary(TX);
  assert.equal(s.savingsRate, 67.8);
});

test('an empty ledger produces clean zeros, not NaN', () => {
  const s = F.computeSummary([]);
  assert.deepEqual(
    { i: s.income, e: s.expense, s: s.savings, b: s.balance, r: s.savingsRate },
    { i: 0, e: 0, s: 0, b: 0, r: 0 }
  );
});

test('negative amounts are treated as magnitudes, not signed flips', () => {
  const s = F.computeSummary([
    { id: 1, type: 'expense', amount: -50, category: 'Other', date: '2026-09-01' }
  ]);
  assert.equal(s.expense, 50);
  assert.equal(s.balance, -50);
});

/* ------------------------------------------------------------------ *
 * Category grouping
 * ------------------------------------------------------------------ */
test('groupByCategory sorts descending and computes share', () => {
  const groups = F.groupByCategory(TX, 'expense');
  assert.equal(groups[0].category, 'Housing');
  assert.equal(groups[0].total, 2400);
  assert.equal(groups[1].category, 'Food & Dining');
  assert.equal(groups[1].total, 820);
  assert.equal(groups[0].share + groups[1].share, 100);
  assert.equal(groups[0].icon, '🏠');
});

test('groupByCategory returns an empty array when the type is absent', () => {
  assert.deepEqual(F.groupByCategory([{ type: 'income', amount: 5, category: 'Salary', date: '2026-09-01' }], 'expense'), []);
});

/* ------------------------------------------------------------------ *
 * Monthly series — this replaced hard-coded fake multipliers
 * ------------------------------------------------------------------ */
test('monthlySeries buckets by the real transaction dates', () => {
  const series = F.monthlySeries(TX, 6, NOW);
  assert.equal(series.labels.length, 6);
  assert.deepEqual(series.income, [0, 0, 0, 0, 5000, 5000]);
  assert.deepEqual(series.expense, [0, 0, 0, 0, 1700, 1520]);
  assert.deepEqual(series.savings, [0, 0, 0, 0, 0, 400]);
});

test('monthlySeries net is income minus expense per month', () => {
  const series = F.monthlySeries(TX, 6, NOW);
  assert.equal(series.net[4], 3300);
  assert.equal(series.net[5], 3480);
});

test('monthlySeries on an empty ledger is all zeros, not a fabricated curve', () => {
  const series = F.monthlySeries([], 6, NOW);
  assert.deepEqual(series.income, [0, 0, 0, 0, 0, 0]);
  assert.deepEqual(series.expense, [0, 0, 0, 0, 0, 0]);
});

test('monthOverMonthChange compares the two newest months', () => {
  const series = F.monthlySeries(TX, 6, NOW);
  // expenses went 1700 -> 1520 = -10.59%
  assert.equal(F.monthOverMonthChange(series, 'expense'), -10.59);
  // income was flat 5000 -> 5000 = 0%
  assert.equal(F.monthOverMonthChange(series, 'income'), 0);
});

test('monthOverMonthChange is null when there is no previous month', () => {
  const series = F.monthlySeries([{ type: 'expense', amount: 10, category: 'Other', date: '2026-09-01' }], 6, NOW);
  assert.equal(F.monthOverMonthChange(series, 'expense'), null);
});

test('averageMonthlyExpense ignores months with no spending', () => {
  const series = F.monthlySeries(TX, 6, NOW);
  assert.equal(F.averageMonthlyExpense(series), 1610); // (1700 + 1520) / 2
});

/* ------------------------------------------------------------------ *
 * Budgets
 * ------------------------------------------------------------------ */
test('evaluateBudgets classifies ok / warn / over from real spend', () => {
  const budgets = [
    { id: 1, category: 'Food & Dining', limit: 300 },  // 320 in TX + 20 more = 340 -> over
    { id: 2, category: 'Housing', limit: 1300 },       // spent 1200 -> warn (92%)
    { id: 3, category: 'Transport', limit: 500 },      // spent 0 -> ok
    { id: 4, category: 'Shopping', limit: 0 }          // unset
  ];
  const withOverspend = [...TX, { id: 99, type: 'expense', category: 'Food & Dining', amount: 20, date: '2026-09-10' }];
  const result = F.evaluateBudgets(budgets, withOverspend, NOW);

  const byCat = (c) => result.find((b) => b.category === c);
  assert.equal(byCat('Food & Dining').spent, 340);
  assert.equal(byCat('Food & Dining').status, 'over');
  assert.equal(byCat('Food & Dining').remaining, -40);
  assert.equal(byCat('Housing').status, 'warn');
  assert.equal(byCat('Housing').usedPct, 92.31);
  assert.equal(byCat('Transport').status, 'ok');
  assert.equal(byCat('Shopping').status, 'unset');
  // sorted worst-first so the UI shows the problem at the top
  assert.equal(result[0].category, 'Food & Dining');
});

test('evaluateBudgets only counts the current month', () => {
  const result = F.evaluateBudgets([{ id: 1, category: 'Housing', limit: 1300 }], TX, NOW);
  assert.equal(result[0].spent, 1200); // August rent must not leak in
});

test('budgetRollup aggregates and counts breaches', () => {
  const result = F.evaluateBudgets(
    [
      { id: 1, category: 'Food & Dining', limit: 300 },
      { id: 2, category: 'Housing', limit: 1300 },
      { id: 3, category: 'Transport', limit: 500 }
    ],
    TX,
    NOW
  );
  const rollup = F.budgetRollup(result);
  assert.equal(rollup.limit, 2100);
  assert.equal(rollup.spent, 1520);
  assert.equal(rollup.remaining, 580);
  assert.equal(rollup.overCount, 1);
  assert.equal(rollup.warnCount, 1);
  assert.equal(rollup.count, 3);
});

/* ------------------------------------------------------------------ *
 * Savings goals
 * ------------------------------------------------------------------ */
test('evaluateGoal derives progress from linked savings transactions only', () => {
  const goal = { id: 'goal-1', name: 'Emergency Fund', target: 6000, icon: '🛟' };
  const tx = [
    { id: 1, type: 'savings', amount: 400, category: 'Savings Fund', date: '2026-09-02', goalId: 'goal-1' },
    { id: 2, type: 'savings', amount: 600, category: 'Savings Fund', date: '2026-08-02', goalId: 'goal-1' },
    { id: 3, type: 'savings', amount: 999, category: 'Savings Fund', date: '2026-08-05', goalId: 'goal-2' }
  ];
  const g = F.evaluateGoal(goal, tx, NOW);
  assert.equal(g.saved, 1000);
  assert.equal(g.remaining, 5000);
  assert.equal(g.progressPct, 16.67);
  assert.equal(g.contributions, 2);
  assert.equal(g.complete, false);
});

test('evaluateGoal caps progress at 100% and flags completion', () => {
  const goal = { id: 'g', name: 'Laptop', target: 500 };
  const tx = [{ id: 1, type: 'savings', amount: 750, category: 'Savings Fund', date: '2026-09-01', goalId: 'g' }];
  const g = F.evaluateGoal(goal, tx, NOW);
  assert.equal(g.saved, 750);
  assert.equal(g.progressPct, 100);
  assert.equal(g.remaining, 0);
  assert.equal(g.complete, true);
});

test('evaluateGoal handles a goal with no contributions', () => {
  const g = F.evaluateGoal({ id: 'x', name: 'Empty', target: 1000 }, [], NOW);
  assert.equal(g.saved, 0);
  assert.equal(g.progressPct, 0);
  assert.equal(g.monthsLeft, null);
});

/* ------------------------------------------------------------------ *
 * Insights — must be data-driven, never pre-baked copy
 * ------------------------------------------------------------------ */
test('insights are empty-safe', () => {
  const out = F.generateInsights({ transactions: [] });
  assert.equal(out.length, 1);
  assert.match(out[0].title, /Nothing to analyse yet/);
});

test('insights name the actual largest category', () => {
  const summary = F.computeSummary(TX);
  const series = F.monthlySeries(TX, 6, NOW);
  const out = F.generateInsights({ transactions: TX, summary, series, now: NOW });
  const top = out.find((i) => i.title.includes('leads your spending'));
  assert.ok(top, 'expected a top-category insight');
  assert.match(top.title, /Housing/);
});

test('insights change tone with the savings rate', () => {
  const rich = [
    { id: 1, type: 'income', amount: 1000, category: 'Salary', date: '2026-09-01' },
    { id: 2, type: 'expense', amount: 100, category: 'Other', date: '2026-09-02' }
  ];
  const poor = [
    { id: 1, type: 'income', amount: 1000, category: 'Salary', date: '2026-09-01' },
    { id: 2, type: 'expense', amount: 950, category: 'Other', date: '2026-09-02' }
  ];
  const richRate = F.generateInsights({ transactions: rich, now: NOW }).find((i) => /savings rate/.test(i.title));
  const poorRate = F.generateInsights({ transactions: poor, now: NOW }).find((i) => /savings rate/.test(i.title));
  assert.equal(richRate.tone, 'good');
  assert.equal(poorRate.tone, 'warn');
  assert.equal(richRate.title, '90% savings rate');
  assert.equal(poorRate.title, '5% savings rate');
});

test('an over-budget category surfaces as a danger insight', () => {
  const budgets = F.evaluateBudgets([{ id: 1, category: 'Food & Dining', limit: 300 }], TX, NOW);
  const out = F.generateInsights({
    transactions: TX,
    summary: F.computeSummary(TX),
    series: F.monthlySeries(TX, 6, NOW),
    budgets,
    now: NOW
  });
  const breach = out.find((i) => i.tone === 'danger' && /budget exceeded/i.test(i.title));
  assert.ok(breach, 'expected an over-budget insight');
  assert.match(breach.body, /Food & Dining/);
});

test('a negative balance raises a warning', () => {
  const tx = [
    { id: 1, type: 'income', amount: 100, category: 'Salary', date: '2026-09-01' },
    { id: 2, type: 'expense', amount: 400, category: 'Other', date: '2026-09-02' }
  ];
  const out = F.generateInsights({ transactions: tx, summary: F.computeSummary(tx), now: NOW });
  assert.ok(out.some((i) => /negative/i.test(i.title)));
});

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */
test('validateTransactionInput rejects the obvious bad input', () => {
  assert.equal(F.validateTransactionInput({ description: '', amount: 10, type: 'expense', category: 'Other', date: '2026-09-01' }).valid, false);
  assert.equal(F.validateTransactionInput({ description: 'X', amount: 0, type: 'expense', category: 'Other', date: '2026-09-01' }).valid, false);
  assert.equal(F.validateTransactionInput({ description: 'X', amount: -5, type: 'expense', category: 'Other', date: '2026-09-01' }).valid, false);
  assert.equal(F.validateTransactionInput({ description: 'X', amount: 'abc', type: 'expense', category: 'Other', date: '2026-09-01' }).valid, false);
  assert.equal(F.validateTransactionInput({ description: 'Rent', amount: 50, type: 'expense', category: 'Other', date: '2099-01-01' }).valid, false);
});

test('validateTransactionInput accepts good input and reports which field failed', () => {
  const ok = F.validateTransactionInput({ description: 'Rent', amount: 1200, type: 'expense', category: 'Housing', date: '2026-09-01' });
  assert.equal(ok.valid, true);
  assert.deepEqual(ok.errors, {});

  const bad = F.validateTransactionInput({ description: '', amount: 0, type: 'expense', category: 'Housing', date: '2026-09-01' });
  assert.deepEqual(Object.keys(bad.errors).sort(), ['amount', 'description']);
});

/* ------------------------------------------------------------------ *
 * CSV export
 * ------------------------------------------------------------------ */
test('toCSV escapes quotes and emits a header row', () => {
  const csv = F.toCSV([{ id: 1, description: 'Say "hi"', category: 'Other', type: 'expense', amount: 12.5, date: '2026-09-01', notes: '' }]);
  const lines = csv.split('\n');
  assert.equal(lines[0], 'ID,Date,Description,Category,Type,Amount (USD),Goal ID,Notes');
  assert.match(lines[1], /"Say ""hi"""/);
  assert.match(lines[1], /12\.50/);
});

/* ------------------------------------------------------------------ *
 * Demo data — must be deterministic and internally consistent
 * ------------------------------------------------------------------ */
test('buildDemoData is deterministic for a given seed', () => {
  const a = F.buildDemoData(42, NOW);
  const b = F.buildDemoData(42, NOW);
  assert.deepEqual(a.transactions, b.transactions);
});

test('buildDemoData produces six months of real, sorted history', () => {
  const demo = F.buildDemoData(7, NOW);
  assert.ok(demo.transactions.length > 50, `expected a rich dataset, got ${demo.transactions.length}`);

  const keys = new Set(demo.transactions.map((t) => F.monthKey(t.date)));
  assert.equal(keys.size, 6, 'demo data should span exactly 6 months');

  const sorted = F.sortTransactions(demo.transactions);
  assert.deepEqual(demo.transactions.map((t) => t.id), sorted.map((t) => t.id), 'demo data ships pre-sorted');

  const series = F.monthlySeries(demo.transactions, 6, NOW);
  assert.ok(series.income.every((v) => v > 0), 'every demo month should have income');
  assert.ok(series.expense.every((v) => v > 0), 'every demo month should have expenses');
});

test('demo data has no future-dated transactions', () => {
  const demo = F.buildDemoData(7, NOW);
  const future = demo.transactions.filter((t) => F.toDateOnly(t.date) > F.toDateOnly(NOW));
  assert.deepEqual(future, []);
});

test('demo savings transactions are linked to real goals', () => {
  const demo = F.buildDemoData(7, NOW);
  const goalIds = new Set(demo.goals.map((g) => g.id));
  const savings = demo.transactions.filter((t) => t.type === 'savings');
  assert.ok(savings.length > 0);
  savings.forEach((t) => assert.ok(goalIds.has(String(t.goalId)) || goalIds.has(t.goalId), `orphan goalId ${t.goalId}`));
});

test('demo goals make measurable progress', () => {
  const demo = F.buildDemoData(7, NOW);
  const progress = demo.goals.map((g) => F.evaluateGoal(g, demo.transactions, NOW));
  assert.ok(progress.every((g) => g.saved > 0), 'every demo goal should have contributions');
  assert.ok(progress.every((g) => g.progressPct > 0 && g.progressPct <= 100));
});

/* ------------------------------------------------------------------ *
 * Robustness
 * ------------------------------------------------------------------ */
test('normalizeTransaction repairs malformed records', () => {
  const t = F.normalizeTransaction({ description: '', amount: '-40', type: 'nonsense', category: '', date: 'garbage' }, 999);
  assert.equal(t.description, 'Untitled');
  assert.equal(t.amount, 40);
  assert.equal(t.type, 'expense');
  assert.match(t.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(t.id, 999);
});

test('aggregate helpers never throw on null or undefined', () => {
  assert.equal(F.computeSummary(undefined).balance, 0);
  assert.deepEqual(F.groupByCategory(undefined, 'expense'), []);
  assert.deepEqual(F.evaluateBudgets(undefined, undefined, NOW), []);
  assert.equal(F.toCSV(undefined).split('\n').length, 1);
  assert.equal(F.sortTransactions(undefined).length, 0);
});

test('escapeHtml neutralises markup from user input', () => {
  assert.equal(F.escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(F.escapeHtml(null), '');
});
