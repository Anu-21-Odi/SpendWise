/* ==========================================================================
   SpendWise — app integration smoke tests
   Boots the real app.html + dashboard.js inside jsdom and asserts the UI
   renders real numbers. This exercises the DOM layer, not a stand-in.

   Chart.js is intentionally NOT provided, so these tests also prove the
   offline fallback path does not crash the app.

   Run with: npm test
   ========================================================================== */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const F = require('../js/finance.js');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const FINANCE = read('js/finance.js');
const AUTH = read('js/auth.js');
const DASHBOARD = read('dashboard.js');
const HTML = read('app.html');

const FIXED_NOW = new Date(2026, 8, 20); // 20 Sep 2026

/**
 * Boot the app in a fresh jsdom window.
 * dashboard.js defers init() to DOMContentLoaded, so callers must await this
 * before asserting anything.
 */
async function boot(seed, options) {
  const opts = options || {};
  const errors = [];

  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => {
    // jsdom has no canvas backend and no navigation; both are expected here.
    if (/Not implemented/.test(e.message)) return;
    errors.push(e.message);
  });
  virtualConsole.on('error', () => {});
  virtualConsole.on('warn', () => {});

  const dom = new JSDOM(HTML, {
    url: 'http://localhost/app.html',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole
  });

  const { window } = dom;
  const document = window.document;

  // Optional Chart.js stand-in, installed before dashboard.js reads it.
  if (opts.withCharts) {
    window.__charts = [];
    window.Chart = class {
      constructor(ctx, config) {
        this.data = config.data;
        this.options = config.options;
        this.updates = 0;
        window.__charts.push(this);
      }
      update() { this.updates++; }
    };
  }

  // Keep the expected offline warning out of the TAP stream.
  const realWarn = console.warn;
  const quiet = (msg, ...rest) => {
    if (String(msg).includes('Exchange rates unavailable')) return;
    realWarn(msg, ...rest);
  };
  console.warn = quiet;
  window.console.warn = quiet;

  window.onerror = (msg) => errors.push(String(msg));
  window.addEventListener('error', (e) => errors.push(String(e.message || e)));

  // Simulate a network-less environment: no CDN Chart.js, no rates endpoint.
  window.fetch = () => Promise.reject(new Error('offline'));
  window.URL.createObjectURL = () => 'blob:mock';
  window.URL.revokeObjectURL = () => {};

  if (seed) {
    if (seed.transactions) window.localStorage.setItem('spendwise_transactions', JSON.stringify(seed.transactions));
    if (seed.budgets) window.localStorage.setItem('spendwise_budgets', JSON.stringify(seed.budgets));
    if (seed.goals) window.localStorage.setItem('spendwise_goals', JSON.stringify(seed.goals));
    if (seed.theme) window.localStorage.setItem('spendwise_theme', seed.theme);
    if (seed.privacy) window.localStorage.setItem('spendwise_privacy', 'true');
  }

  // Load the app's scripts in the same order the page does.
  window.eval(FINANCE);
  window.eval(AUTH);
  window.eval(DASHBOARD);

  // Wait for the app's own init to have run.
  await new Promise((resolve) => {
    if (document.readyState !== 'loading') return resolve();
    document.addEventListener('DOMContentLoaded', resolve);
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const $ = (id) => document.getElementById(id);
  const text = (id) => { const el = $(id); return el ? el.textContent : null; };

  return { window, document, errors, $, text };
}

/** A consistent six-month dataset for the "has data" tests. */
const demoFor = (seed) => F.buildDemoData(seed, FIXED_NOW);

/* ------------------------------------------------------------------ */

test('app.html boots without throwing, even with no Chart.js and no network', async () => {
  const { $, errors } = await boot();
  assert.deepEqual(errors, [], `unexpected runtime errors: ${errors.join(' | ')}`);
  assert.equal($('pageTitle').textContent, 'Dashboard');
});

test('an empty ledger shows the onboarding banner and clean zeros', async () => {
  const { $, text } = await boot();
  assert.equal($('onboardingBanner').hidden, false);
  assert.equal(text('totalBalance'), '$0.00');
  assert.equal(text('totalIncome'), '+$0.00');
  assert.equal(text('totalExpenses'), '-$0.00');
  assert.equal(text('totalSavings'), '+$0.00');
  assert.match($('transactionList').textContent, /No transactions yet/);
});

test('the offline chart fallback renders a message instead of a dead canvas', async () => {
  const { document } = await boot(); // no withCharts -> Chart is undefined
  const container = document.querySelectorAll('.chart-container')[0];
  assert.match(container.textContent, /Charts unavailable offline/);
  assert.equal(container.querySelector('canvas'), null, 'canvas should be replaced');
});

test('a seeded ledger renders real totals in the metric cards', async () => {
  const demo = demoFor(1234);
  const { $, text, errors } = await boot({
    transactions: demo.transactions, budgets: demo.budgets, goals: demo.goals
  });

  assert.deepEqual(errors, [], errors.join(' | '));
  assert.equal($('onboardingBanner').hidden, true, 'onboarding should hide once there is data');

  const summary = F.computeSummary(demo.transactions);
  // Counters animate over ~620ms; the settled target is stored on the node.
  assert.equal(Number($('totalBalance').dataset.value), summary.balance);
  assert.equal(Number($('totalIncome').dataset.value), summary.income);
  assert.equal(Number($('totalExpenses').dataset.value), summary.expense, 'expenses card stores the positive magnitude');
  assert.equal(Number($('totalSavings').dataset.value), summary.savings);
  assert.match(text('savingsRateLabel'), /^\d+(\.\d+)?% savings rate/);
  assert.ok(summary.balance !== 0, 'demo data should produce a non-zero balance');
});

test('the transactions table renders rows with data-attribute actions, no inline handlers', async () => {
  const demo = demoFor(99);
  const { document, $ } = await boot({ transactions: demo.transactions });

  const rows = document.querySelectorAll('#transactionList tr');
  assert.ok(rows.length > 10, `expected rows, got ${rows.length}`);
  assert.match($('txResultCount').textContent, /transactions/);

  assert.ok(document.querySelector('#transactionList [data-edit]'), 'edit action missing');
  assert.ok(document.querySelector('#transactionList [data-delete]'), 'delete action missing');
  assert.equal(document.querySelectorAll('#transactionList [onclick]').length, 0, 'inline onclick should be gone');
});

test('budgets render progress bars and the sidebar badge counts breaches', async () => {
  const demo = demoFor(5);
  const evaluated = F.evaluateBudgets(demo.budgets, demo.transactions, FIXED_NOW);
  const overCount = evaluated.filter((b) => b.status === 'over').length;

  const { document, $, text } = await boot({
    transactions: demo.transactions, budgets: demo.budgets, goals: demo.goals
  });

  assert.ok(document.querySelectorAll('#budgetList .budget-row').length >= 3, 'budget rows should render');
  assert.ok(document.querySelectorAll('#budgetList .progress-fill').length >= 3, 'progress bars should render');
  assert.match(text('budgetRollup'), /% used/);
  assert.match(text('budgetPeriodLabel'), /days left/);

  const badge = $('budgetAlertBadge');
  assert.equal(badge.hidden, overCount === 0);
  if (overCount > 0) assert.equal(badge.textContent, String(overCount));
});

test('goals render progress rings derived from linked savings', async () => {
  const demo = demoFor(11);
  const { document } = await boot({
    transactions: demo.transactions, budgets: demo.budgets, goals: demo.goals
  });

  const cards = document.querySelectorAll('#goalGrid .goal-card');
  assert.equal(cards.length, demo.goals.length);
  assert.equal(document.querySelectorAll('#goalGrid circle.ring-fill').length, demo.goals.length);
  assert.match(document.querySelector('#goalGrid').textContent, /saved/);
  assert.match(document.querySelector('#dashboardGoals').textContent, /of/);
});

test('insights are data-driven and the old hard-coded copy is gone', async () => {
  const demo = demoFor(77);
  const { document, $ } = await boot({
    transactions: demo.transactions, budgets: demo.budgets, goals: demo.goals
  });

  const copy = $('dashboardInsights').textContent;
  assert.ok(copy.length > 20, 'insights should be populated');
  assert.ok(document.querySelectorAll('.insight').length >= 2, 'expected multiple insight cards');

  // The legacy build shipped these strings verbatim regardless of the data.
  assert.ok(!document.body.textContent.includes('Food & Dining currently takes up the largest share'));
  assert.ok(!document.body.textContent.includes('+28% Net Savings'));
  assert.ok(!document.body.textContent.includes('Regular contributions to your savings buffer'));
});

test('insights show the empty-state message when there is no data', async () => {
  const { $ } = await boot();
  assert.match($('dashboardInsights').textContent, /Nothing to analyse yet/);
});

test('privacy mode masks amounts everywhere, not just the summary cards', async () => {
  const demo = demoFor(321);
  const { document, $, text } = await boot({
    transactions: demo.transactions, budgets: demo.budgets, goals: demo.goals, privacy: true
  });

  assert.ok(document.body.classList.contains('privacy-on'));
  assert.equal(text('totalBalance'), '$••••••');
  const table = $('transactionList').textContent;
  assert.match(table, /\$••••••/, 'table amounts should be masked');
  assert.ok(!/\$\d{1,3}(,\d{3})+\.\d{2}/.test(table), 'a real amount leaked into the table');
});

test('submitting the form validates, rejects bad input, then saves good input', async () => {
  const { window, $, errors } = await boot();
  const submit = () => $('transactionForm').dispatchEvent(
    new window.Event('submit', { bubbles: true, cancelable: true })
  );

  // Invalid first — must be rejected, not saved.
  $('txDescription').value = '';
  $('txAmount').value = '-50';
  submit();

  assert.match($('err-txDescription').textContent, /name/i);
  assert.match($('err-txAmount').textContent, /greater than zero/i);
  assert.equal($('transactionList').querySelectorAll('[data-edit]').length, 0, 'nothing should have been saved');
  assert.equal(window.localStorage.getItem('spendwise_transactions'), null);

  // Then valid.
  $('txDescription').value = 'Integration test rent';
  $('txAmount').value = '1234.56';
  $('txDate').value = '2026-09-15';
  submit();

  assert.deepEqual(errors, [], errors.join(' | '));
  assert.match($('transactionList').textContent, /Integration test rent/);
  assert.match($('transactionList').textContent, /\$1,234\.56/);
  assert.equal(Number($('totalExpenses').dataset.value), 1234.56);
  assert.equal($('onboardingBanner').hidden, true);

  const saved = JSON.parse(window.localStorage.getItem('spendwise_transactions'));
  assert.equal(saved.length, 1);
  assert.equal(saved[0].description, 'Integration test rent');
  assert.equal(saved[0].type, 'expense');
  assert.equal(saved[0].category, 'Food & Dining', 'first expense category should be the default');
});

test('a future-dated transaction is rejected', async () => {
  const { window, $ } = await boot();
  $('txDescription').value = 'Time travel';
  $('txAmount').value = '10';
  $('txDate').value = '2099-01-01';
  $('transactionForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

  assert.match($('err-txDate').textContent, /future/i);
  assert.equal(window.localStorage.getItem('spendwise_transactions'), null);
});

test('deleting a transaction offers an undo that actually restores it', async () => {
  const { window, document, $ } = await boot();
  $('txDescription').value = 'Undo me';
  $('txAmount').value = '10';
  $('txDate').value = '2026-09-15';
  $('transactionForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  assert.match($('transactionList').textContent, /Undo me/);

  document.querySelector('#transactionList [data-delete]').click();
  assert.ok(!$('transactionList').textContent.includes('Undo me'), 'row should be gone');

  const undo = document.querySelector('#toastStack .toast-action');
  assert.ok(undo, 'an undo action should be offered');
  undo.click();

  assert.match($('transactionList').textContent, /Undo me/);
  assert.equal(JSON.parse(window.localStorage.getItem('spendwise_transactions')).length, 1);
});

test('loading demo data populates transactions, budgets and goals in one click', async () => {
  const { window, document, $, errors } = await boot();
  $('loadDemoBtn').click();

  assert.deepEqual(errors, [], errors.join(' | '));
  const saved = JSON.parse(window.localStorage.getItem('spendwise_transactions'));
  assert.ok(saved.length > 100, `expected a rich demo set, got ${saved.length}`);
  assert.equal($('onboardingBanner').hidden, true);
  assert.ok(document.querySelectorAll('#goalGrid .goal-card').length >= 3);
  assert.ok(document.querySelectorAll('#budgetList .budget-row').length >= 5);
  assert.match($('transactionList').textContent, /Monthly Salary/);
  assert.match($('dashboardInsights').textContent, /.+/);
});

test('the search filter narrows the rendered table', async () => {
  const demo = demoFor(404);
  const { window, document, $ } = await boot({ transactions: demo.transactions });

  const before = document.querySelectorAll('#transactionList tr').length;
  $('searchInput').value = 'Pharmacy';
  $('searchInput').dispatchEvent(new window.Event('input', { bubbles: true }));
  const after = document.querySelectorAll('#transactionList tr').length;

  assert.ok(after < before, `search should narrow results (${before} -> ${after})`);
  assert.ok(after > 0, 'search should still find matches');
  assert.match($('txResultCount').textContent, /of \d+ transactions/);
});

test('the type filter limits rows to that type', async () => {
  const demo = demoFor(808);
  const { window, document, $ } = await boot({ transactions: demo.transactions });

  $('typeFilter').value = 'income';
  $('typeFilter').dispatchEvent(new window.Event('change', { bubbles: true }));

  const categories = [...document.querySelectorAll('#transactionList .badge')].map((b) => b.textContent);
  assert.ok(categories.length > 0);
  assert.ok(
    categories.every((c) => /Salary|Freelance|Investments/.test(c)),
    `unexpected category shown for the income filter: ${categories.join(', ')}`
  );
});

test('an unmatched search shows the empty state, not a blank table', async () => {
  const demo = demoFor(17);
  const { window, $ } = await boot({ transactions: demo.transactions });
  $('searchInput').value = 'zzzz-no-match';
  $('searchInput').dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.match($('transactionList').textContent, /No matches/);
});

test('navigation switches sections and updates the heading and subtitle', async () => {
  const { document, $, text } = await boot();
  document.querySelector('[data-target="analyticsSection"]').click();

  assert.equal($('analyticsSection').classList.contains('active'), true);
  assert.equal($('dashboardSection').classList.contains('active'), false);
  assert.equal(text('pageTitle'), 'Analytics');
  assert.match(text('pageSubtitle'), /Trends/);
  assert.equal(document.querySelector('[data-target="analyticsSection"]').classList.contains('active'), true);
});

test('every nav target resolves to a real section', async () => {
  const { document } = await boot();
  const links = [...document.querySelectorAll('.nav-link')];
  assert.ok(links.length >= 6);
  links.forEach((link) => {
    assert.ok(document.getElementById(link.dataset.target), `nav points at missing #${link.dataset.target}`);
    assert.ok(link.dataset.title, 'nav link needs a data-title for the page heading');
  });
});

test('the currency dropdown is populated and switching currency persists and re-renders', async () => {
  const demo = demoFor(606);
  const { window, $ } = await boot({ transactions: demo.transactions });

  const options = [...$('currencySelect').options].map((o) => o.value);
  ['USD', 'EUR', 'GBP', 'NGN', 'INR'].forEach((c) => assert.ok(options.includes(c), `${c} missing`));

  $('currencySelect').value = 'INR';
  $('currencySelect').dispatchEvent(new window.Event('change', { bubbles: true }));

  assert.equal(window.localStorage.getItem('spendwise_currency'), 'INR');
  // Offline, rates stay 1:1 — the symbol is what must change.
  assert.match($('totalBalance').textContent, /₹/, `expected the rupee symbol, got "${$('totalBalance').textContent}"`);
  assert.equal($('defaultCurrencySelect').value, 'INR', 'both currency controls should stay in sync');
});

test('privacy quick-toggle flips state, persists it, and unmasks again', async () => {
  const { window, document, $, text } = await boot();
  $('privacyQuickBtn').click();
  assert.equal(document.body.classList.contains('privacy-on'), true);
  assert.equal(window.localStorage.getItem('spendwise_privacy'), 'true');
  assert.equal(text('totalBalance'), '$••••••');
  assert.equal($('privacyToggle').checked, true, 'settings toggle should follow the quick toggle');

  $('privacyQuickBtn').click();
  assert.equal(document.body.classList.contains('privacy-on'), false);
  assert.equal(window.localStorage.getItem('spendwise_privacy'), 'false');
  assert.equal(text('totalBalance'), '$0.00');
});

test('theme quick-toggle switches dark mode without throwing', async () => {
  const { window, document, errors, $ } = await boot();
  $('themeQuickBtn').click();

  assert.equal(document.body.classList.contains('dark-theme'), true);
  assert.equal(window.localStorage.getItem('spendwise_theme'), 'dark');
  assert.equal(document.documentElement.getAttribute('data-theme'), 'dark');
  assert.equal($('themeSelect').value, 'dark');
  assert.deepEqual(errors, [], errors.join(' | '));
});

test('clearing data wipes state but offers an undo', async () => {
  const { window, document, $ } = await boot();
  $('loadDemoBtn').click();
  assert.ok(JSON.parse(window.localStorage.getItem('spendwise_transactions')).length > 0);

  $('clearDataBtn').click();
  assert.equal(JSON.parse(window.localStorage.getItem('spendwise_transactions')).length, 0);
  assert.match($('transactionList').textContent, /No transactions yet/);
  assert.equal($('onboardingBanner').hidden, false, 'onboarding should come back');

  const undo = [...document.querySelectorAll('#toastStack .toast-action')].pop();
  assert.ok(undo);
  undo.click();
  assert.ok(JSON.parse(window.localStorage.getItem('spendwise_transactions')).length > 0);
});

test('creating a goal adds a card and makes it selectable on savings entries', async () => {
  const { window, $, errors } = await boot();
  $('openGoalModalBtn').click();
  $('goalName').value = 'Test Goal';
  $('goalTarget').value = '1500';
  $('goalForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

  assert.deepEqual(errors, [], errors.join(' | '));
  assert.match($('goalGrid').textContent, /Test Goal/);
  assert.equal(JSON.parse(window.localStorage.getItem('spendwise_goals')).length, 1);
  assert.ok([...$('txGoal').options].some((o) => o.textContent.includes('Test Goal')));
});

test('a goal with no target is rejected', async () => {
  const { window, $ } = await boot();
  $('openGoalModalBtn').click();
  $('goalName').value = 'Vague';
  $('goalTarget').value = '0';
  $('goalForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

  assert.match($('err-goalTarget').textContent, /above zero/i);
  assert.equal(window.localStorage.getItem('spendwise_goals'), null);
});

test('setting a budget renders it with a progress bar', async () => {
  const { window, document, $ } = await boot();
  $('openBudgetModalBtn').click();
  $('budgetCategory').value = 'Transport';
  $('budgetLimit').value = '250';
  $('budgetForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

  assert.equal(JSON.parse(window.localStorage.getItem('spendwise_budgets')).length, 1);
  assert.match($('budgetList').textContent, /Transport/);
  assert.ok(document.querySelectorAll('#budgetList .progress-fill').length >= 1);
});

test('a negative budget limit is rejected', async () => {
  const { window, $ } = await boot();
  $('openBudgetModalBtn').click();
  $('budgetLimit').value = '-10';
  $('budgetForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  assert.match($('err-budgetLimit').textContent, /zero or more/i);
  assert.equal(window.localStorage.getItem('spendwise_budgets'), null);
});

test('user-defined HTML in a description is escaped, not injected', async () => {
  const { window, $ } = await boot();
  $('txDescription').value = '<img src=x onerror="window.__pwned=1">';
  $('txAmount').value = '5';
  $('txDate').value = '2026-09-15';
  $('transactionForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

  assert.equal(window.__pwned, undefined, 'injected markup executed');
  assert.equal($('transactionList').querySelector('img'), null, 'raw HTML was injected into the table');
  assert.match($('transactionList').textContent, /onerror/);
});

test('the top-spending table lists the largest expenses with their share', async () => {
  const demo = demoFor(5150);
  const { document } = await boot({
    transactions: demo.transactions, budgets: demo.budgets, goals: demo.goals
  });

  const rows = document.querySelectorAll('#topSpendingList tr');
  assert.ok(rows.length > 0 && rows.length <= 10, `expected 1-10 rows, got ${rows.length}`);
  assert.match(rows[0].textContent, /%/, 'share column should be populated');
});

test('the analytics category breakdown lists real categories', async () => {
  const demo = demoFor(31337);
  const { $ } = await boot({ transactions: demo.transactions });
  const text = $('analyticsCategoryList').textContent;
  assert.match(text, /Housing/);
  assert.match(text, /Food & Dining/);
  assert.match(text, /%/);
});

test('exporting CSV produces a downloadable file with a header row', async () => {
  const demo = demoFor(2468);
  const { window, $ } = await boot({ transactions: demo.transactions });

  let captured = null;
  window.Blob = class {
    constructor(parts) { captured = parts.join(''); }
  };
  window.HTMLAnchorElement.prototype.click = function () { this.__clicked = true; };

  $('exportCsvBtn').click();

  assert.ok(captured, 'no CSV content was produced');
  const lines = captured.split('\n');
  assert.equal(lines[0], 'ID,Date,Description,Category,Type,Amount (USD),Goal ID,Notes');
  assert.ok(lines.length > 100, `expected many rows, got ${lines.length}`);
});

test('storage stats report the real counts', async () => {
  const demo = demoFor(1357);
  const { $, text } = await boot({
    transactions: demo.transactions, budgets: demo.budgets, goals: demo.goals
  });
  assert.match(text('storageStats'), new RegExp(`${demo.transactions.length} transactions`));
  assert.match(text('storageStats'), /KB in localStorage/);
});

/** Copy a jsdom-realm array into this realm so deepStrictEqual can compare it. */
const local = (a) => Array.from(a);

/* ------------------------------------------------------------------ *
 * Chart data — this is where the old build fabricated its numbers
 * ------------------------------------------------------------------ */

test('with Chart.js present, both charts are created and updated', async () => {
  const demo = demoFor(9090);
  const { window, errors } = await boot(
    { transactions: demo.transactions, budgets: demo.budgets, goals: demo.goals },
    { withCharts: true }
  );

  assert.deepEqual(errors, [], errors.join(' | '));
  assert.equal(window.__charts.length, 2, 'expected the donut and the trend chart');
  window.__charts.forEach((c) => assert.ok(c.updates > 0, 'chart should have been updated'));
});

test('the trend chart is built from real monthly buckets, not invented multipliers', async () => {
  const demo = demoFor(24680);
  const { window } = await boot({ transactions: demo.transactions }, { withCharts: true });

  const trend = window.__charts.find((c) => c.options.scales);
  assert.ok(trend, 'trend chart not found');

  const expected = F.monthlySeries(demo.transactions, 6, FIXED_NOW);

  // Labels are the real month names derived from transaction dates.
  assert.deepEqual(local(trend.data.labels), expected.labels);
  assert.deepEqual(local(trend.data.labels), ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep']);

  // Offline the rate is 1:1, so display values equal the stored USD values.
  assert.deepEqual(local(trend.data.datasets[0].data), expected.income);
  assert.deepEqual(local(trend.data.datasets[1].data), expected.expense);
  assert.deepEqual(local(trend.data.datasets[2].data), expected.net);

  // The legacy build multiplied all-time totals by 0.5/0.7/0.8/0.6/0.9/1.
  // That produced a strictly rising curve; real data does not.
  const income = local(trend.data.datasets[0].data);
  const isMonotonic = income.every((v, i) => i === 0 || v >= income[i - 1]);
  assert.equal(isMonotonic, false, 'income series looks like the old fabricated ramp');
  assert.notEqual(income[0], 0, 'April should have real income, not a padded zero');
});

test('the donut chart uses real categories with their configured colours', async () => {
  const demo = demoFor(13579);
  const { window } = await boot({ transactions: demo.transactions }, { withCharts: true });

  const donut = window.__charts.find((c) => !c.options.scales);
  assert.ok(donut, 'donut chart not found');

  const expected = F.groupByCategory(demo.transactions, 'expense');
  assert.deepEqual(local(donut.data.labels), expected.map((g) => g.category));
  assert.deepEqual(local(donut.data.datasets[0].backgroundColor), expected.map((g) => g.color));
  assert.deepEqual(local(donut.data.datasets[0].data), expected.map((g) => g.total));

  assert.ok(donut.data.labels.includes('Housing'));
  assert.equal(donut.data.labels[0], expected[0].category, 'largest category should come first');
});

test('an empty ledger gives the donut a neutral placeholder slice', async () => {
  const { window } = await boot({}, { withCharts: true });
  const donut = window.__charts.find((c) => !c.options.scales);
  assert.deepEqual(local(donut.data.labels), ['No expenses yet']);
  assert.deepEqual(local(donut.data.datasets[0].data), [1]);
});

test('switching theme restyles the charts without throwing', async () => {
  const demo = demoFor(8642);
  const { window, document, errors, $ } = await boot(
    { transactions: demo.transactions },
    { withCharts: true }
  );

  const before = window.__charts.map((c) => c.options.plugins.legend.labels.color);
  $('themeQuickBtn').click();

  assert.deepEqual(errors, [], errors.join(' | '));
  const after = window.__charts.map((c) => c.options.plugins.legend.labels.color);
  assert.notDeepEqual(local(before), local(after), 'legend colour should follow the theme');
  after.forEach((c) => assert.equal(c, '#cbd5e1', 'dark theme legend colour'));
  assert.equal(document.body.classList.contains('dark-theme'), true);
});

test('the trend chart shows all-zero series for an empty ledger instead of a fake curve', async () => {
  const { window } = await boot({}, { withCharts: true });
  const trend = window.__charts.find((c) => c.options.scales);
  assert.deepEqual(local(trend.data.datasets[0].data), [0, 0, 0, 0, 0, 0]);
  assert.deepEqual(local(trend.data.datasets[1].data), [0, 0, 0, 0, 0, 0]);
});

/* ------------------------------------------------------------------ *
 * Vanilla-JS guard rails
 *
 * The brief is plain HTML + CSS + JavaScript with the UI built through the
 * DOM API (Chart.js is the one approved external script). These tests fail
 * if a framework, a bundler, or innerHTML templating creeps back in.
 * ------------------------------------------------------------------ */

const APP_JS = ['dashboard.js', 'script.js', 'js/finance.js', 'js/auth.js', 'js/auth-pages.js'];
const APP_HTML = ['index.html', 'login.html', 'signup.html', 'app.html'];

/** The only external <script> the app is allowed to load. */
const ALLOWED_EXTERNAL_SCRIPTS = [/^https:\/\/cdn\.jsdelivr\.net\/npm\/chart\.js@/];

/** Drop comments so documentation may mention an API without tripping the guard. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:"'\\])\/\/[^\n]*/g, '$1');
}

test('no app script builds markup with innerHTML or document.write', () => {
  const forbidden = ['innerHTML', 'insertAdjacentHTML', 'outerHTML', 'document.write'];
  APP_JS.forEach((file) => {
    const source = stripComments(read(file));
    forbidden.forEach((api) => {
      assert.equal(source.includes(api), false, `${file} still builds markup with ${api}`);
    });
  });
});

test('no page wires behaviour with inline event handlers', () => {
  APP_HTML.forEach((file) => {
    const matches = read(file).match(/<[a-z][^>]*?\son[a-z]+\s*=/gi) || [];
    assert.deepEqual(matches, [], `${file} wires behaviour inline: ${matches.join(', ')}`);
  });
});

test('every script tag is a local file or the approved Chart.js CDN', () => {
  APP_HTML.forEach((file) => {
    const srcs = [...read(file).matchAll(/<script[^>]+src=["']([^"']+)["']/g)].map((m) => m[1]);
    assert.ok(srcs.length > 0, `${file} should load at least one script`);
    srcs.forEach((src) => {
      if (!/^[a-z]+:\/\//i.test(src)) {
        assert.match(src, /^[a-z0-9_\-./]+\.js$/i, `${file}: unexpected local src "${src}"`);
        assert.ok(fs.existsSync(path.join(ROOT, src)), `${file} references missing file ${src}`);
        return;
      }
      assert.ok(
        ALLOWED_EXTERNAL_SCRIPTS.some((re) => re.test(src)),
        `${file} loads an unapproved external script: ${src}`
      );
    });
  });
});

test('a rendered description is one text node, never parsed markup', async () => {
  const { window, document, $ } = await boot();
  $('txDescription').value = 'Rent <b>& utilities</b>';
  $('txAmount').value = '1200';
  $('txDate').value = '2026-09-15';
  $('transactionForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

  const name = document.querySelector('#transactionList .tx-name');
  assert.ok(name, 'description cell should be rendered');
  assert.equal(name.childNodes.length, 1, 'description should be a single text node');
  assert.equal(name.childNodes[0].nodeType, 3, 'expected a TEXT_NODE, not an element');
  assert.equal(name.childNodes[0].data, 'Rent <b>& utilities</b>');
  assert.equal(name.querySelector('b'), null, 'the description was parsed as markup');
});

test('goal rings are real SVG nodes in the SVG namespace', async () => {
  const demo = demoFor(4242);
  const { document } = await boot({ transactions: demo.transactions, goals: demo.goals });

  const rings = document.querySelectorAll('#goalGrid circle.ring-fill');
  assert.equal(rings.length, demo.goals.length, 'one ring per goal');
  rings.forEach((ring) => {
    assert.equal(ring.namespaceURI, 'http://www.w3.org/2000/svg',
      'rings must be built with createElementNS, not parsed from a string');
    assert.ok(Number(ring.getAttribute('stroke-dashoffset')) >= 0, 'dash offset should be a number');
  });
});
