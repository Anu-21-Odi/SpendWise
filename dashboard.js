/* ==========================================================================
   SpendWise — dashboard.js
   DOM + state layer. All money maths lives in js/finance.js (unit-tested).
   ========================================================================== */
(function () {
  'use strict';

  const F = window.SpendWiseFinance;
  const Auth = window.SpendWiseAuth;

  if (!F) {
    clearEl(document.body);
    document.body.appendChild(el('p', {
      style: 'padding:2rem;font-family:system-ui',
      text: 'SpendWise could not load its core module (js/finance.js).'
    }));
    return;
  }

  /* ====================================================================== *
   * Constants & state
   * ==================================================================== */

  const KEY = {
    tx: 'spendwise_transactions',
    budgets: 'spendwise_budgets',
    goals: 'spendwise_goals',
    theme: 'spendwise_theme',
    privacy: 'spendwise_privacy',
    currency: 'spendwise_currency',
    rates: 'spendwise_rates'
  };

  const state = {
    transactions: [],
    budgets: [],
    goals: [],
    currency: 'USD',
    rates: { USD: 1 },
    privacy: false,
    range: 'all',
    filters: { search: '', category: 'All', type: 'All' },
    editingId: null,
    editingBudgetId: null
  };

  const charts = { expense: null, trend: null };
  const HAS_CHARTS = typeof window.Chart !== 'undefined';

  /* ====================================================================== *
   * Tiny helpers
   * ==================================================================== */

  const $ = (id) => document.getElementById(id);

  /* ------------------------------------------------------------------ *
   * DOM construction
   *
   * Every node in the UI is built with createElement / createElementNS and
   * filled with textContent. This file never assigns innerHTML, so no value
   * read back from the ledger can ever be parsed as markup.
   * ------------------------------------------------------------------ */

  const SVG_NS = 'http://www.w3.org/2000/svg';

  /** Remove every child node (the DOM equivalent of `el.innerHTML = ''`). */
  function clearEl(target) {
    while (target && target.firstChild) target.removeChild(target.firstChild);
  }

  function appendAll(parent, children) {
    (Array.isArray(children) ? children : [children]).forEach((child) => {
      if (child === null || child === undefined || child === false) return;
      parent.appendChild(
        typeof child === 'object' ? child : document.createTextNode(String(child))
      );
    });
  }

  /**
   * Create an element from a plain descriptor.
   *   class / text / style / dataset are handled specially, every other key
   *   becomes a literal attribute (so 'aria-label', 'colspan', 'title' work).
   */
  function el(tag, props, children) {
    const created = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach((key) => {
        const value = props[key];
        if (value === null || value === undefined || value === false) return;
        if (key === 'class') created.className = value;
        else if (key === 'text') created.textContent = value;
        else if (key === 'style') created.setAttribute('style', value);
        else if (key === 'dataset') Object.assign(created.dataset, value);
        else created.setAttribute(key, value === true ? '' : String(value));
      });
    }
    if (children) appendAll(created, children);
    return created;
  }

  /** Create an SVG element — needed because SVG nodes require their own namespace. */
  function svgEl(tag, attrs, children) {
    const created = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach((key) => {
      const value = attrs[key];
      if (value !== null && value !== undefined) created.setAttribute(key, String(value));
    });
    if (children) appendAll(created, children);
    return created;
  }

  /** Icon + heading + copy, used wherever a panel has nothing to show. */
  function emptyState(icon, title, body, extraStyle) {
    return el('div', { class: 'empty-state', style: extraStyle || null }, [
      el('div', { class: 'empty-icon', text: icon }),
      el('h3', { text: title }),
      el('p', { text: body })
    ]);
  }

  /** A progress bar; `fill` is a 0-100 percentage, `color` an optional CSS colour. */
  function progressBar(fill, color, extraStyle, fillClass) {
    const pctValue = Math.min(100, Math.max(0, Number(fill) || 0));
    return el('div', { class: 'progress', style: extraStyle || null }, [
      el('div', {
        class: `progress-fill${fillClass ? ` ${fillClass}` : ''}`,
        style: `width:${pctValue}%;${color ? ` --fill-color:${color};` : ''}`
      })
    ]);
  }

  const prefersReducedMotion = () =>
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return parsed == null ? fallback : parsed;
    } catch (e) {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      toast('Could not save — browser storage may be full.', { tone: 'danger' });
    }
  }

  function uid(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  }

  const symbol = () => (F.CURRENCIES[state.currency] || F.CURRENCIES.USD).symbol;

  /** USD stored value -> formatted display string in the active currency. */
  function money(usd, opts) {
    const value = F.fromUSD(usd, state.currency, state.rates);
    return F.formatMoney(value, symbol(), Object.assign({ privacy: state.privacy }, opts || {}));
  }

  function compact(usd) {
    return state.privacy
      ? `${symbol()}•••`
      : F.compactMoney(F.fromUSD(usd, state.currency, state.rates), symbol());
  }

  /* ====================================================================== *
   * Toasts (replace alert/confirm)
   * ==================================================================== */

  const TOAST_ICONS = { success: '✅', danger: '⚠️', info: 'ℹ️' };

  function toast(message, opts) {
    const o = opts || {};
    const stack = $('toastStack');
    if (!stack) return;

    const el = document.createElement('div');
    el.className = `toast tone-${o.tone || 'info'}`;

    const icon = document.createElement('span');
    icon.className = 'toast-icon';
    icon.textContent = TOAST_ICONS[o.tone || 'info'] || 'ℹ️';

    const msg = document.createElement('span');
    msg.className = 'toast-msg';
    msg.textContent = message;

    el.append(icon, msg);

    const dismiss = () => {
      if (!el.isConnected) return;
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 240);
    };

    if (typeof o.action === 'function') {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'toast-action';
      btn.textContent = o.actionLabel || 'Undo';
      btn.addEventListener('click', () => { o.action(); dismiss(); });
      el.appendChild(btn);
    }

    stack.appendChild(el);
    setTimeout(dismiss, o.duration || (o.action ? 6000 : 3600));

    // Keep at most three on screen.
    while (stack.children.length > 3) stack.firstElementChild.remove();
  }

  /* ====================================================================== *
   * Persistence
   * ==================================================================== */

  function persist() {
    writeJSON(KEY.tx, state.transactions);
    writeJSON(KEY.budgets, state.budgets);
    writeJSON(KEY.goals, state.goals);
  }

  function loadState() {
    const rawTx = readJSON(KEY.tx, []);
    state.transactions = (Array.isArray(rawTx) ? rawTx : [])
      .map((t, i) => F.normalizeTransaction(t, t.id != null ? t.id : i + 1));
    state.transactions = F.sortTransactions(state.transactions);

    const rawBudgets = readJSON(KEY.budgets, []);
    state.budgets = Array.isArray(rawBudgets)
      ? rawBudgets.filter((b) => b && b.category).map((b) => ({
          id: b.id || uid('b'),
          category: b.category,
          limit: Math.abs(Number(b.limit) || 0)
        }))
      : [];

    const rawGoals = readJSON(KEY.goals, []);
    state.goals = Array.isArray(rawGoals)
      ? rawGoals.filter((g) => g && g.name).map((g) => ({
          id: g.id || uid('goal'),
          name: String(g.name),
          target: Math.abs(Number(g.target) || 0),
          icon: g.icon || '🎯',
          color: g.color || '#8b5cf6',
          deadline: g.deadline || null
        }))
      : [];
  }

  function loadSettings() {
    const theme = localStorage.getItem(KEY.theme) || 'light';
    applyTheme(theme, false);
    if ($('themeSelect')) $('themeSelect').value = theme;

    state.privacy = localStorage.getItem(KEY.privacy) === 'true';
    if ($('privacyToggle')) $('privacyToggle').checked = state.privacy;

    const savedCurrency = localStorage.getItem(KEY.currency);
    if (savedCurrency && F.CURRENCIES[savedCurrency]) state.currency = savedCurrency;

    const cached = readJSON(KEY.rates, null);
    if (cached && cached.rates && cached.at && Date.now() - cached.at < 24 * 3600 * 1000) {
      state.rates = cached.rates;
    }
  }

  function syncPrivacyControls() {
    document.body.classList.toggle('privacy-on', state.privacy);
    if ($('privacyToggle')) $('privacyToggle').checked = state.privacy;
    const btn = $('privacyQuickBtn');
    if (btn) btn.classList.toggle('active-toggle', state.privacy);
  }

  function applyTheme(theme, redraw) {
    const dark = theme === 'dark';
    document.body.classList.toggle('dark-theme', dark);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    const meta = document.querySelector('meta[name="color-scheme"]');
    if (meta) meta.setAttribute('content', dark ? 'dark light' : 'light dark');
    const quick = $('themeQuickBtn');
    if (quick) quick.textContent = dark ? '☀️' : '🌙';
    if (redraw !== false) restyleCharts();
  }

  async function fetchExchangeRates() {
    try {
      const res = await fetch('https://open.er-api.com/v6/latest/USD');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data && data.rates && typeof data.rates === 'object') {
        state.rates = data.rates;
        writeJSON(KEY.rates, { at: Date.now(), rates: data.rates });
        renderAll();
      }
    } catch (err) {
      console.warn('Exchange rates unavailable, falling back to 1:1.', err);
    }
  }

  /* ====================================================================== *
   * Derived data
   * ==================================================================== */

  const now = () => new Date();

  function summaryAll() {
    return F.computeSummary(state.transactions);
  }

  function series() {
    return F.monthlySeries(state.transactions, 6, now());
  }

  function budgetsEvaluated() {
    return F.evaluateBudgets(state.budgets, state.transactions, now());
  }

  function goalsEvaluated() {
    return state.goals.map((g) => F.evaluateGoal(g, state.transactions, now()));
  }

  function scopedTransactions() {
    return F.filterByRange(state.transactions, state.range, now());
  }

  function visibleTransactions() {
    return F.filterTransactions(scopedTransactions(), state.filters);
  }

  /* ====================================================================== *
   * Animated numbers
   * ==================================================================== */

  function setAmount(el, usd, opts) {
    if (!el) return;
    if (state.privacy || prefersReducedMotion()) {
      el.textContent = money(usd, opts);
      el.dataset.value = String(usd);
      return;
    }

    const from = Number(el.dataset.value || 0);
    el.dataset.value = String(usd);
    if (from === usd) { el.textContent = money(usd, opts); return; }

    const duration = 620;
    const start = performance.now();

    function step(ts) {
      const p = Math.min(1, (ts - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = money(from + (usd - from) * eased, opts);
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function setDelta(el, value, goodWhenNegative) {
    if (!el) return;
    if (value == null || !isFinite(value)) {
      el.textContent = 'no prior month';
      el.className = 'delta delta-flat';
      return;
    }
    const flat = value === 0;
    el.textContent = `${value > 0 ? '▲' : flat ? '▬' : '▼'} ${Math.abs(value)}%`;
    const good = flat ? null : ((value > 0) !== goodWhenNegative);
    el.className = `delta ${flat ? 'delta-flat' : good ? 'delta-up' : 'delta-down'}`;
  }

  /* ====================================================================== *
   * Select population
   * ==================================================================== */

  function fillSelect(select, options, selected) {
    if (!select) return;
    clearEl(select);
    options.forEach((o) => {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      if (o.value === selected) opt.selected = true;
      select.appendChild(opt);
    });
  }

  function populateStaticSelects() {
    const currencyOptions = Object.keys(F.CURRENCIES).map((code) => ({
      value: code,
      label: `${F.CURRENCIES[code].symbol}  ${code}`
    }));
    fillSelect($('currencySelect'), currencyOptions, state.currency);
    fillSelect($('defaultCurrencySelect'), currencyOptions, state.currency);

    fillSelect($('categoryFilter'),
      [{ value: 'All', label: 'All categories' }].concat(
        F.CATEGORIES.map((c) => ({ value: c.name, label: `${c.icon}  ${c.name}` }))
      ), 'All');

    fillSelect($('rangeFilter'),
      F.RANGE_OPTIONS.map((r) => ({ value: r.key, label: r.label })), state.range);

    fillSelect($('budgetCategory'),
      F.CATEGORIES.filter((c) => c.type === 'expense').map((c) => ({ value: c.name, label: `${c.icon}  ${c.name}` })));

    refreshTypeScopedSelects();
    refreshGoalSelect();
  }

  /** Category options depend on the chosen transaction type. */
  function refreshTypeScopedSelects() {
    const typeEl = document.querySelector('input[name="txType"]:checked');
    const type = typeEl ? typeEl.value : 'expense';
    const wanted = F.CATEGORIES.filter((c) => c.type === type);
    const current = $('txCategory') ? $('txCategory').value : null;
    fillSelect($('txCategory'),
      wanted.map((c) => ({ value: c.name, label: `${c.icon}  ${c.name}` })),
      wanted.some((c) => c.name === current) ? current : wanted[0].name);

    const goalSelect = $('txGoal');
    if (goalSelect) goalSelect.disabled = type !== 'savings';
  }

  function refreshGoalSelect(selected) {
    fillSelect($('txGoal'),
      [{ value: '', label: 'No goal' }].concat(
        state.goals.map((g) => ({ value: g.id, label: `${g.icon}  ${g.name}` }))
      ), selected || '');
  }

  /* ====================================================================== *
   * Render: metrics
   * ==================================================================== */

  function renderMetrics() {
    const s = summaryAll();
    const ser = series();

    setAmount($('totalBalance'), s.balance);
    setAmount($('totalIncome'), s.income, { signed: true });
    // Expenses are stored positive; the minus is a presentational prefix.
    setAmount($('totalExpenses'), s.expense, { sign: '-' });
    setAmount($('totalSavings'), s.savings, { signed: true });

    const incCount = state.transactions.filter((t) => t.type === 'income').length;
    const expCount = state.transactions.filter((t) => t.type === 'expense').length;
    if ($('incomeCount')) $('incomeCount').textContent = `${incCount} income ${incCount === 1 ? 'entry' : 'entries'}`;
    if ($('savingsRateLabel')) {
      $('savingsRateLabel').textContent = s.income > 0
        ? `${s.savingsRate}% savings rate · ${expCount} expenses`
        : `${expCount} expenses logged`;
    }

    setDelta($('balanceDelta'), s.income > 0 ? F.pct(s.netCashflow, s.income, 1) : null, false);
    setDelta($('expenseDelta'), F.monthOverMonthChange(ser, 'expense'), true);

    if ($('donutCenter')) $('donutCenter').textContent = compact(s.expense);

    if ($('onboardingBanner')) $('onboardingBanner').hidden = state.transactions.length > 0;
  }

  /* ====================================================================== *
   * Render: transactions
   * ==================================================================== */

  /** Signed, coloured amount for a table cell. */
  function amountNode(t) {
    const sign = t.type === 'expense' ? '-' : '+';
    const tone = t.type === 'income' ? 'text-success' : t.type === 'expense' ? 'text-danger' : '';
    return el('span', {
      class: tone || null,
      style: t.type === 'savings' ? 'color: var(--accent);' : null,
      text: `${sign}${money(t.amount)}`
    });
  }

  function badgeNode(text, tone) {
    return el('span', { class: `badge${tone ? ` badge-${tone}` : ''}`, text });
  }

  /**
   * First column of every transaction row: category icon, name, and an optional
   * sub-line (notes, or a friendly date).
   */
  function descriptionCell(t, subText, wrapped) {
    const m = F.meta(t.category);
    const label = wrapped
      ? el('span', { style: 'min-width:0;' }, [
          el('span', { class: 'tx-name', title: t.description, text: t.description }),
          subText ? el('div', { class: 'tx-sub', text: subText }) : null
        ])
      : el('span', { class: 'tx-name', text: t.description });

    return el('td', null, [
      el('div', { class: 'tx-desc' }, [
        el('span', { class: 'tx-icon', text: m.icon }),
        label
      ])
    ]);
  }

  /** An icon button, wired up through the delegated row-action handler. */
  function actionButton(icon, actionKey, id, title, label, danger) {
    return el('button', {
      type: 'button',
      class: `icon-action${danger ? ' danger' : ''}`,
      title,
      text: icon,
      'aria-label': label,
      dataset: { [actionKey]: String(id) }
    });
  }

  function renderTransactions() {
    const list = $('transactionList');
    if (!list) return;

    const rows = visibleTransactions();
    clearEl(list);

    if (!rows.length) {
      list.appendChild(el('tr', null, [
        el('td', { colspan: 5 }, [
          emptyState(
            '🔍',
            state.transactions.length ? 'No matches' : 'No transactions yet',
            state.transactions.length
              ? 'Try a different search term, category or date range.'
              : 'Add your first transaction or load the demo dataset from the dashboard.'
          )
        ])
      ]));
    } else {
      rows.forEach((t) => {
        list.appendChild(el('tr', null, [
          descriptionCell(t, t.notes || null, true),
          el('td', null, [badgeNode(t.category, t.type)]),
          el('td', { class: 'text-muted', style: 'white-space:nowrap;', text: F.friendlyDate(t.date, now()) }),
          el('td', { class: 'text-right tx-amount' }, [amountNode(t)]),
          el('td', null, [
            el('div', { class: 'row-actions' }, [
              actionButton('✏️', 'edit', t.id, 'Edit', `Edit ${t.description}`),
              actionButton('🗑️', 'delete', t.id, 'Delete', `Delete ${t.description}`, true)
            ])
          ])
        ]));
      });
    }

    if ($('txResultCount')) {
      const total = scopedTransactions().length;
      $('txResultCount').textContent = rows.length === total
        ? `${total} transaction${total === 1 ? '' : 's'}`
        : `${rows.length} of ${total} transactions`;
    }
  }

  function renderRecent() {
    const body = $('dashboardRecentList');
    if (!body) return;

    const recent = F.sortTransactions(state.transactions).slice(0, 5);
    clearEl(body);

    if (!recent.length) {
      body.appendChild(el('tr', null, [
        el('td', { colspan: 3 }, [
          emptyState('💳', 'Nothing here yet',
            'Your latest transactions will show up in this list.', 'padding:1.5rem;')
        ])
      ]));
      return;
    }

    recent.forEach((t) => {
      body.appendChild(el('tr', null, [
        descriptionCell(t, F.friendlyDate(t.date, now()), true),
        el('td', null, [badgeNode(t.category)]),
        el('td', { class: 'text-right tx-amount' }, [amountNode(t)])
      ]));
    });
  }

  function renderTopSpending() {
    const body = $('topSpendingList');
    if (!body) return;

    const scoped = scopedTransactions();
    const expenses = F.sortTransactions(scoped.filter((t) => t.type === 'expense'))
      .slice()
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 10);
    const totalExpense = F.computeSummary(scoped).expense;

    clearEl(body);

    if (!expenses.length) {
      body.appendChild(el('tr', null, [
        el('td', { colspan: 5 }, [
          emptyState('📊', 'No expenses in this range',
            'Widen the date range or log an expense to populate this table.', 'padding:1.5rem;')
        ])
      ]));
      return;
    }

    expenses.forEach((t) => {
      const share = F.pct(t.amount, totalExpense, 1);
      body.appendChild(el('tr', null, [
        descriptionCell(t, null, false),
        el('td', null, [badgeNode(t.category)]),
        el('td', { class: 'text-muted', style: 'white-space:nowrap;', text: F.friendlyDate(t.date, now()) }),
        el('td', { class: 'text-right tx-amount text-danger', text: `-${money(t.amount)}` }),
        el('td', { class: 'text-right', style: 'white-space:nowrap;' }, [
          el('span', {
            class: 'text-muted',
            style: 'font-variant-numeric:tabular-nums;',
            text: state.privacy ? '••%' : `${share}%`
          })
        ])
      ]));
    });
  }

  /* ====================================================================== *
   * Render: budgets
   * ==================================================================== */

  /** One budget line: header, progress bar and (optionally) edit/remove actions. */
  function budgetRowNode(b, withActions) {
    const fillClass = b.status === 'over' ? 'over' : b.status === 'warn' ? 'warn' : '';

    const status = b.status === 'over'
      ? el('span', { class: 'text-danger', style: 'font-weight:700;', text: ` · ${money(Math.abs(b.remaining))} over` })
      : b.status === 'warn'
        ? el('span', { class: 'text-warning', style: 'font-weight:700;', text: ` · ${b.usedPct}% used` })
        : ` · ${money(b.remaining)} left`;

    const children = [
      el('div', { class: 'budget-row-head' }, [
        el('span', { class: 'budget-title' }, [
          el('span', { text: b.icon }),
          ` ${b.category}`
        ]),
        el('span', { class: 'budget-nums' }, [
          el('strong', { text: money(b.spent) }),
          ` / ${money(b.limit)}`,
          status
        ])
      ]),
      progressBar(b.usedPct, b.color, null, fillClass)
    ];

    if (withActions) {
      children.push(el('div', {
        style: 'display:flex;justify-content:space-between;align-items:center;margin-top:.55rem;gap:.5rem;flex-wrap:wrap;'
      }, [
        el('span', {
          class: 'text-muted',
          style: 'font-size:.75rem;',
          text: b.status === 'over'
            ? 'Limit reached for this month.'
            : `Safe to spend ${money(b.dailySafe)}/day for the rest of the month.`
        }),
        el('div', { class: 'row-actions' }, [
          actionButton('✏️', 'editBudget', b.id, 'Edit', `Edit ${b.category} budget`),
          actionButton('🗑️', 'deleteBudget', b.id, 'Remove', `Remove ${b.category} budget`, true)
        ])
      ]));
    }

    return el('div', { class: `budget-row${b.status === 'over' ? ' is-over' : ''}` }, children);
  }

  /** The "spent of X across N budgets" summary on the Budgets page. */
  function renderBudgetRollup(host, rollup) {
    clearEl(host);

    if (!rollup.count) {
      host.appendChild(emptyState('🎯', 'No budgets yet',
        'Create your first monthly limit to see progress here.'));
      return;
    }

    const fillClass = rollup.overCount ? 'over' : rollup.usedPct >= 75 ? 'warn' : '';
    const notes = [
      el('span', { text: `${rollup.usedPct}% used` }),
      el('span', { text: '·' }),
      el('span', { text: `${money(rollup.remaining)} remaining` })
    ];
    if (rollup.overCount) {
      notes.push(el('span', { class: 'text-danger', style: 'font-weight:700;', text: `· ${rollup.overCount} over limit` }));
    }
    if (rollup.warnCount) {
      notes.push(el('span', { class: 'text-warning', style: 'font-weight:600;', text: `· ${rollup.warnCount} close to limit` }));
    }

    appendAll(host, [
      el('div', { style: 'display:flex;justify-content:space-between;align-items:baseline;gap:1rem;flex-wrap:wrap;' }, [
        el('span', { style: 'font-size:1.5rem;font-weight:750;font-variant-numeric:tabular-nums;', text: money(rollup.spent) }),
        el('span', {
          class: 'text-muted',
          style: 'font-size:.85rem;',
          text: `of ${money(rollup.limit)} across ${rollup.count} budget${rollup.count === 1 ? '' : 's'}`
        })
      ]),
      progressBar(rollup.usedPct, null, 'height:10px;', fillClass),
      el('div', { style: 'display:flex;gap:1rem;flex-wrap:wrap;font-size:.8rem;color:var(--text-muted);' }, notes)
    ]);
  }

  function renderBudgets() {
    const evaluated = budgetsEvaluated();
    const rollup = F.budgetRollup(evaluated);

    // Sidebar alert badge
    const badge = $('budgetAlertBadge');
    if (badge) {
      badge.hidden = rollup.overCount === 0;
      badge.textContent = String(rollup.overCount);
    }

    // Dashboard pulse: the three tightest budgets
    const pulse = $('dashboardBudgets');
    if (pulse) {
      clearEl(pulse);
      if (!evaluated.length) {
        pulse.appendChild(emptyState('🎯', 'No budgets set',
          'Set a monthly limit per category to start tracking.'));
      } else {
        evaluated.slice(0, 3).forEach((b) => pulse.appendChild(budgetRowNode(b, false)));
      }
    }

    const rollupEl = $('budgetRollup');
    if (rollupEl) renderBudgetRollup(rollupEl, rollup);

    const listEl = $('budgetList');
    if (listEl) {
      clearEl(listEl);
      if (!evaluated.length) {
        listEl.appendChild(emptyState('🎯', 'No budgets yet',
          'Pick a category and a monthly limit to get started.'));
      } else {
        evaluated.forEach((b) => listEl.appendChild(budgetRowNode(b, true)));
      }
    }

    if ($('budgetPeriodLabel')) {
      $('budgetPeriodLabel').textContent = new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' })
        + ` · ${F.daysRemainingInMonth(now())} days left`;
    }
  }

  /* ====================================================================== *
   * Render: goals
   * ==================================================================== */

  /** Circular progress indicator for a goal, built from real SVG nodes. */
  function ringNode(g) {
    const r = 26;
    const circumference = 2 * Math.PI * r;
    const offset = circumference * (1 - Math.min(1, g.progressPct / 100));

    const ring = svgEl('svg', { width: 62, height: 62, viewBox: '0 0 62 62', 'aria-hidden': 'true' }, [
      svgEl('circle', { class: 'ring-track', cx: 31, cy: 31, r }),
      svgEl('circle', {
        class: 'ring-fill',
        cx: 31,
        cy: 31,
        r,
        stroke: g.color,
        'stroke-dasharray': circumference.toFixed(2),
        'stroke-dashoffset': offset.toFixed(2)
      })
    ]);

    return el('div', { class: 'goal-ring' }, [
      ring,
      el('span', { class: 'goal-ring-pct', text: state.privacy ? '••%' : `${Math.round(g.progressPct)}%` })
    ]);
  }

  function goalEtaText(g) {
    if (g.monthsLeft == null) return 'Add savings to project an ETA';
    if (g.monthsLeft === 0) return 'On pace to finish this month';
    return `≈ ${g.monthsLeft} month${g.monthsLeft === 1 ? '' : 's'} left at ${money(g.monthlyPace)}/mo`;
  }

  /** Compact goal row used by the dashboard card. */
  function goalMiniNode(g) {
    return el('div', { style: 'display:flex;align-items:center;gap:.85rem;' }, [
      ringNode(g),
      el('div', { style: 'min-width:0;flex:1;' }, [
        el('div', { class: 'goal-name', style: 'font-size:.9rem;', text: `${g.icon} ${g.name}` }),
        el('div', { class: 'goal-sub', text: `${money(g.saved)} of ${money(g.target)}` }),
        progressBar(g.progressPct, g.color, 'height:6px;margin-top:.35rem;')
      ])
    ]);
  }

  /** Full goal card for the Goals page. */
  function goalCardNode(g) {
    return el('div', { class: `goal-card${g.complete ? ' is-complete' : ''}` }, [
      el('div', { class: 'goal-top' }, [
        ringNode(g),
        el('div', { style: 'min-width:0;flex:1;' }, [
          el('div', { class: 'goal-name', text: `${g.icon} ${g.name}` }),
          el('div', { class: 'goal-sub', text: g.complete ? '🎉 Goal reached' : goalEtaText(g) })
        ])
      ]),
      el('div', { class: 'goal-meta' }, [
        el('span', null, [el('strong', { text: money(g.saved) }), ' saved']),
        el('span', { text: `of ${money(g.target)}` })
      ]),
      progressBar(g.progressPct, g.color),
      el('div', { class: 'row-actions', style: 'justify-content:space-between;margin-top:.25rem;' }, [
        el('button', {
          type: 'button',
          class: 'btn btn-secondary btn-sm',
          text: '＋ Add money',
          dataset: { contribute: String(g.id) }
        }),
        el('span', { class: 'row-actions' }, [
          actionButton('✏️', 'editGoal', g.id, 'Edit', `Edit ${g.name}`),
          actionButton('🗑️', 'deleteGoal', g.id, 'Delete', `Delete ${g.name}`, true)
        ])
      ])
    ]);
  }

  function renderGoals() {
    const evaluated = goalsEvaluated().sort((a, b) => b.progressPct - a.progressPct);

    const mini = $('dashboardGoals');
    if (mini) {
      clearEl(mini);
      if (!evaluated.length) {
        mini.appendChild(emptyState('🏦', 'No goals yet',
          'Create a savings goal to track progress automatically.'));
      } else {
        evaluated.slice(0, 3).forEach((g) => mini.appendChild(goalMiniNode(g)));
      }
    }

    const grid = $('goalGrid');
    if (grid) {
      clearEl(grid);
      if (!evaluated.length) {
        grid.appendChild(el('div', { class: 'card', style: 'grid-column:1 / -1;' }, [
          emptyState('🏦', 'No savings goals yet',
            'Create a goal, then link savings transactions to it — progress updates itself.')
        ]));
      } else {
        evaluated.forEach((g) => grid.appendChild(goalCardNode(g)));
      }
    }
  }

  /* ====================================================================== *
   * Render: categories + insights
   * ==================================================================== */

  function renderCategoryBreakdown() {
    const container = $('analyticsCategoryList');
    if (!container) return;

    const groups = F.groupByCategory(scopedTransactions(), 'expense');
    clearEl(container);

    if (!groups.length) {
      container.appendChild(emptyState('📊', 'No expense data',
        'Log an expense in this range to see the breakdown.'));
      return;
    }

    groups.forEach((g) => {
      container.appendChild(el('div', null, [
        el('div', { style: 'display:flex;justify-content:space-between;gap:1rem;font-size:.85rem;margin-bottom:.35rem;' }, [
          el('span', { style: 'font-weight:600;', text: `${g.icon} ${g.category}` }),
          el('span', {
            class: 'text-muted',
            style: 'font-variant-numeric:tabular-nums;',
            text: `${money(g.total)} · ${state.privacy ? '••%' : `${g.share}%`}`
          })
        ]),
        progressBar(g.share, g.color, 'height:7px;')
      ]));
    });
  }

  function insightNode(i) {
    return el('div', { class: `insight tone-${i.tone}` }, [
      el('span', { class: 'insight-icon', text: i.icon }),
      el('div', null, [
        el('h4', { text: i.title }),
        el('p', { text: i.body })
      ])
    ]);
  }

  function renderInsights() {
    const scoped = scopedTransactions();
    const list = F.generateInsights({
      transactions: scoped,
      budgets: budgetsEvaluated(),
      symbol: symbol(),
      now: now()
    });

    ['dashboardInsights', 'analyticsInsights'].forEach((id) => {
      const host = $(id);
      if (!host) return;
      clearEl(host);
      list.forEach((insight) => host.appendChild(insightNode(insight)));
    });

    const badge = $('trendBadge');
    if (badge) {
      const s = F.computeSummary(scoped);
      badge.textContent = scoped.length ? `${s.savingsRate}% of income kept` : 'No data yet';
      badge.className = `badge ${s.savingsRate >= 20 ? 'badge-income' : 'badge-expense'}`;
    }
  }

  /* ====================================================================== *
   * Charts
   * ==================================================================== */

  function chartTextColor() {
    return document.body.classList.contains('dark-theme') ? '#cbd5e1' : '#64748b';
  }

  function chartGridColor() {
    return document.body.classList.contains('dark-theme') ? 'rgba(148,163,184,.14)' : 'rgba(100,116,139,.12)';
  }

  function initCharts() {
    if (!HAS_CHARTS) {
      ['expenseChart', 'trendChart'].forEach((id) => {
        const c = $(id);
        if (c && c.parentElement) {
          const host = c.parentElement;
          clearEl(host);
          host.appendChild(emptyState('📉', 'Charts unavailable offline',
            'Chart.js could not be loaded from the CDN. Every number and table still works.',
            'height:100%;'));
        }
      });
      return;
    }

    const donut = $('expenseChart');
    if (donut) {
      charts.expense = new Chart(donut.getContext('2d'), {
        type: 'doughnut',
        data: { labels: [], datasets: [{ data: [], borderWidth: 0, hoverOffset: 8 }] },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '68%',
          plugins: {
            legend: {
              position: 'bottom',
              labels: { color: chartTextColor(), usePointStyle: true, pointStyleWidth: 9, padding: 14, font: { size: 11 } }
            },
            tooltip: {
              callbacks: {
                label: (ctx) => {
                  const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                  const share = total ? F.pct(ctx.parsed, total, 1) : 0;
                  return ` ${money(ctx.parsed)} (${share}%)`;
                }
              }
            }
          }
        }
      });
    }

    const trend = $('trendChart');
    if (trend) {
      const ctx = trend.getContext('2d');
      charts.trend = new Chart(ctx, {
        type: 'line',
        data: {
          labels: [],
          datasets: [
            { label: 'Income', data: [], borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,.14)', fill: true, tension: 0.35, borderWidth: 2.5, pointRadius: 3, pointHoverRadius: 5 },
            { label: 'Expenses', data: [], borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,.14)', fill: true, tension: 0.35, borderWidth: 2.5, pointRadius: 3, pointHoverRadius: 5 },
            { label: 'Net', data: [], borderColor: '#8b5cf6', borderDash: [5, 4], fill: false, tension: 0.35, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4 }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { position: 'bottom', labels: { color: chartTextColor(), usePointStyle: true, pointStyleWidth: 9, padding: 16, font: { size: 11 } } },
            tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${money(ctx.parsed.y)}` } }
          },
          scales: {
            x: { grid: { display: false }, ticks: { color: chartTextColor() } },
            y: {
              grid: { color: chartGridColor() },
              border: { display: false },
              ticks: { color: chartTextColor(), callback: (v) => compact(v) }
            }
          }
        }
      });
    }
  }

  function renderCharts() {
    if (charts.expense) {
      const groups = F.groupByCategory(state.transactions, 'expense');
      if (!groups.length) {
        charts.expense.data.labels = ['No expenses yet'];
        charts.expense.data.datasets[0].data = [1];
        charts.expense.data.datasets[0].backgroundColor = [document.body.classList.contains('dark-theme') ? '#232c42' : '#e6e8f0'];
      } else {
        charts.expense.data.labels = groups.map((g) => g.category);
        charts.expense.data.datasets[0].data = groups.map((g) => F.fromUSD(g.total, state.currency, state.rates));
        charts.expense.data.datasets[0].backgroundColor = groups.map((g) => g.color);
      }
      charts.expense.update();
    }

    if (charts.trend) {
      const ser = series();
      charts.trend.data.labels = ser.labels;
      charts.trend.data.datasets[0].data = ser.income.map((v) => F.fromUSD(v, state.currency, state.rates));
      charts.trend.data.datasets[1].data = ser.expense.map((v) => F.fromUSD(v, state.currency, state.rates));
      charts.trend.data.datasets[2].data = ser.net.map((v) => F.fromUSD(v, state.currency, state.rates));
      charts.trend.update();
    }
  }

  function restyleCharts() {
    [charts.expense, charts.trend].forEach((chart) => {
      if (!chart) return;
      if (chart.options.plugins.legend) chart.options.plugins.legend.labels.color = chartTextColor();
      if (chart.options.scales) {
        if (chart.options.scales.x) chart.options.scales.x.ticks.color = chartTextColor();
        if (chart.options.scales.y) {
          chart.options.scales.y.ticks.color = chartTextColor();
          if (chart.options.scales.y.grid) chart.options.scales.y.grid.color = chartGridColor();
        }
      }
      chart.update();
    });
  }

  /* ====================================================================== *
   * Render: settings + shell
   * ==================================================================== */

  function renderStorageStats() {
    const el = $('storageStats');
    if (!el) return;
    let bytes = 0;
    [KEY.tx, KEY.budgets, KEY.goals, KEY.rates].forEach((k) => {
      bytes += (localStorage.getItem(k) || '').length;
    });
    const kb = (bytes / 1024).toFixed(1);
    el.textContent = `${state.transactions.length} transactions · ${state.budgets.length} budgets · `
      + `${state.goals.length} goals · ${kb} KB in localStorage`;
  }

  function renderUser() {
    const user = Auth ? Auth.currentUser() : null;
    const name = $('userName');
    const avatar = $('userAvatar');
    const meta = $('userMeta');
    if (name) name.textContent = user ? user.name : 'Guest';
    if (avatar) avatar.textContent = user ? user.initials : '?';
    if (meta) meta.textContent = user ? user.email : 'Local session';

    const first = Auth ? Auth.firstName() : null;
    const sub = $('pageSubtitle');
    if (sub && sub.dataset.section === 'dashboard') {
      sub.textContent = first
        ? `Welcome back, ${first}. Here is where your money stands.`
        : 'Welcome back! Here is your financial summary.';
    }
  }

  function renderAll() {
    syncPrivacyControls();
    renderMetrics();
    renderTransactions();
    renderRecent();
    renderTopSpending();
    renderBudgets();
    renderGoals();
    renderCategoryBreakdown();
    renderInsights();
    renderCharts();
    renderStorageStats();
    refreshGoalSelect();
  }

  /* ====================================================================== *
   * Modals
   * ==================================================================== */

  function openModal(id) {
    const modal = $(id);
    if (!modal) return;
    modal.classList.add('active');
    const focusable = modal.querySelector('input:not([type="radio"]), select, textarea');
    if (focusable) setTimeout(() => focusable.focus(), 60);
  }

  function closeModals() {
    document.querySelectorAll('.modal-overlay.active').forEach((m) => m.classList.remove('active'));
    resetTransactionForm();
  }

  function clearFieldErrors() {
    document.querySelectorAll('.field-error').forEach((e) => { e.classList.remove('visible'); e.textContent = ''; });
    document.querySelectorAll('.form-control.invalid').forEach((e) => e.classList.remove('invalid'));
  }

  function showFieldError(fieldId, message) {
    const err = $(`err-${fieldId}`);
    const input = $(fieldId);
    if (err) { err.textContent = message; err.classList.add('visible'); }
    if (input) input.classList.add('invalid');
  }

  function resetTransactionForm() {
    state.editingId = null;
    const form = $('transactionForm');
    if (form) form.reset();
    const def = $('typeExpense');
    if (def) def.checked = true;
    refreshTypeScopedSelects();
    const dateEl = $('txDate');
    if (dateEl) dateEl.value = F.isoDate(new Date());
    const title = $('modalTitle');
    if (title) title.textContent = 'Add Transaction';
    const submit = $('submitModalBtn');
    if (submit) submit.textContent = 'Add transaction';
    clearFieldErrors();
  }

  function openEditModal(id) {
    const t = state.transactions.find((x) => String(x.id) === String(id));
    if (!t) return;

    state.editingId = t.id;
    $('modalTitle').textContent = 'Edit Transaction';
    $('submitModalBtn').textContent = 'Save changes';

    const radio = document.querySelector(`input[name="txType"][value="${t.type}"]`);
    if (radio) radio.checked = true;
    refreshTypeScopedSelects();

    $('txDescription').value = t.description;
    $('txAmount').value = F.fromUSD(t.amount, state.currency, state.rates).toFixed(2);
    $('txDate').value = t.date;
    $('txCategory').value = t.category;
    $('txNotes').value = t.notes || '';
    refreshGoalSelect(t.goalId || '');

    openModal('transactionModal');
  }

  /* ====================================================================== *
   * Mutations
   * ==================================================================== */

  function submitTransaction(e) {
    e.preventDefault();
    clearFieldErrors();

    const typeEl = document.querySelector('input[name="txType"]:checked');
    const input = {
      description: $('txDescription').value,
      amount: $('txAmount').value,
      type: typeEl ? typeEl.value : 'expense',
      category: $('txCategory').value,
      date: $('txDate').value
    };

    const check = F.validateTransactionInput(input);
    if (!check.valid) {
      Object.entries(check.errors).forEach(([field, msg]) => showFieldError(`tx${field[0].toUpperCase()}${field.slice(1)}`, msg));
      const firstBad = Object.keys(check.errors)[0];
      const el = $(`tx${firstBad[0].toUpperCase()}${firstBad.slice(1)}`);
      if (el) el.focus();
      return;
    }

    const amountUSD = F.toUSD(Math.abs(Number(input.amount)), state.currency, state.rates);
    const goalId = input.type === 'savings' ? ($('txGoal').value || null) : null;

    if (state.editingId !== null) {
      const idx = state.transactions.findIndex((t) => String(t.id) === String(state.editingId));
      if (idx !== -1) {
        state.transactions[idx] = F.normalizeTransaction({
          ...state.transactions[idx],
          description: input.description.trim(),
          amount: amountUSD,
          type: input.type,
          category: input.category,
          date: input.date,
          notes: $('txNotes').value.trim(),
          goalId
        }, state.transactions[idx].id);
      }
      toast('Transaction updated.', { tone: 'success' });
    } else {
      const record = F.normalizeTransaction({
        id: uid('tx'),
        description: input.description.trim(),
        amount: amountUSD,
        type: input.type,
        category: input.category,
        date: input.date,
        notes: $('txNotes').value.trim(),
        goalId
      }, uid('tx'));
      state.transactions.push(record);
      toast('Transaction added.', { tone: 'success' });
    }

    state.transactions = F.sortTransactions(state.transactions);
    persist();
    renderAll();
    closeModals();
  }

  function deleteTransaction(id) {
    const idx = state.transactions.findIndex((t) => String(t.id) === String(id));
    if (idx === -1) return;
    const [removed] = state.transactions.splice(idx, 1);
    persist();
    renderAll();
    toast(`Deleted “${removed.description}”.`, {
      tone: 'danger',
      actionLabel: 'Undo',
      action: () => {
        state.transactions.push(removed);
        state.transactions = F.sortTransactions(state.transactions);
        persist();
        renderAll();
        toast('Restored.', { tone: 'success' });
      }
    });
  }

  function submitBudget(e) {
    e.preventDefault();
    clearFieldErrors();

    const category = $('budgetCategory').value;
    const limit = Number($('budgetLimit').value);
    if (!isFinite(limit) || limit < 0) {
      showFieldError('budgetLimit', 'Enter a limit of zero or more.');
      return;
    }

    const limitUSD = F.toUSD(limit, state.currency, state.rates);
    const existing = state.budgets.find((b) => b.category === category && String(b.id) !== String(state.editingBudgetId));

    if (existing) {
      existing.limit = limitUSD;
      toast(`${category} budget updated.`, { tone: 'success' });
    } else {
      state.budgets.push({ id: uid('b'), category, limit: limitUSD });
      toast(`${category} budget set.`, { tone: 'success' });
    }

    state.editingBudgetId = null;
    persist();
    renderAll();
    closeModals();
  }

  function deleteBudget(id) {
    const b = state.budgets.find((x) => String(x.id) === String(id));
    if (!b) return;
    state.budgets = state.budgets.filter((x) => String(x.id) !== String(id));
    persist();
    renderAll();
    toast(`${b.category} budget removed.`, {
      tone: 'danger',
      actionLabel: 'Undo',
      action: () => { state.budgets.push(b); persist(); renderAll(); }
    });
  }

  function submitGoal(e) {
    e.preventDefault();
    clearFieldErrors();

    const name = $('goalName').value.trim();
    const target = Number($('goalTarget').value);

    let bad = false;
    if (!name) { showFieldError('goalName', 'Give the goal a name.'); bad = true; }
    if (!isFinite(target) || target <= 0) { showFieldError('goalTarget', 'Enter a target above zero.'); bad = true; }
    if (bad) return;

    state.goals.push({
      id: uid('goal'),
      name,
      target: F.toUSD(target, state.currency, state.rates),
      icon: $('goalIcon').value,
      color: '#8b5cf6',
      deadline: $('goalDeadline').value || null
    });

    persist();
    refreshGoalSelect();
    renderAll();
    closeModals();
    toast(`Goal “${name}” created.`, { tone: 'success' });
  }

  function deleteGoal(id) {
    const g = state.goals.find((x) => String(x.id) === String(id));
    if (!g) return;
    state.goals = state.goals.filter((x) => String(x.id) !== String(id));
    // Unlink rather than delete the money already saved.
    state.transactions.forEach((t) => { if (String(t.goalId) === String(id)) t.goalId = null; });
    persist();
    renderAll();
    toast(`Goal “${g.name}” deleted. Savings kept.`, {
      tone: 'danger',
      actionLabel: 'Undo',
      action: () => { state.goals.push(g); persist(); renderAll(); }
    });
  }

  function contributeToGoal(id) {
    resetTransactionForm();
    const savings = document.querySelector('input[name="txType"][value="savings"]');
    if (savings) savings.checked = true;
    refreshTypeScopedSelects();
    refreshGoalSelect(id);
    $('txDate').value = F.isoDate(new Date());
    const goal = state.goals.find((g) => String(g.id) === String(id));
    if (goal) $('txDescription').value = `${goal.name} contribution`;
    openModal('transactionModal');
  }

  /* ====================================================================== *
   * Demo data
   * ==================================================================== */

  function loadDemoData() {
    const demo = F.buildDemoData(Math.floor(Math.random() * 1e6), new Date());
    state.transactions = demo.transactions.map((t) => ({ ...t, id: uid('tx') }));

    // Re-link savings to the fresh goal ids, since we minted new transaction ids.
    const goals = demo.goals.map((g) => ({ ...g, id: uid('goal') }));
    const byName = {};
    demo.goals.forEach((g, i) => { byName[g.id] = goals[i].id; });
    state.transactions.forEach((t) => {
      if (t.goalId && byName[t.goalId]) t.goalId = byName[t.goalId];
    });

    state.goals = goals;
    state.budgets = demo.budgets.map((b) => ({ ...b, id: uid('b') }));

    persist();
    renderAll();
    toast(`Loaded ${state.transactions.length} demo transactions across 6 months.`, { tone: 'success', duration: 4500 });
  }

  /* ====================================================================== *
   * Export / import
   * ==================================================================== */

  function download(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const stamp = () => new Date().toISOString().split('T')[0];

  function exportCSV() {
    if (!state.transactions.length) return toast('No transactions to export.', { tone: 'info' });
    download(`spendwise_export_${stamp()}.csv`, F.toCSV(state.transactions), 'text/csv;charset=utf-8');
    toast('CSV exported.', { tone: 'success' });
  }

  function exportJSON() {
    const payload = {
      app: 'SpendWise',
      version: 2,
      exportedAt: new Date().toISOString(),
      currency: state.currency,
      transactions: state.transactions,
      budgets: state.budgets,
      goals: state.goals
    };
    download(`spendwise_backup_${stamp()}.json`, JSON.stringify(payload, null, 2), 'application/json');
    toast('Backup saved.', { tone: 'success' });
  }

  function importJSON(file) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        // Accept both the new wrapper and a bare array from older exports.
        const tx = Array.isArray(data) ? data : data.transactions;
        if (!Array.isArray(tx)) throw new Error('no transactions array');

        state.transactions = F.sortTransactions(tx.map((t, i) => F.normalizeTransaction(t, t.id != null ? t.id : i + 1)));
        if (data && !Array.isArray(data)) {
          if (Array.isArray(data.budgets)) {
            state.budgets = data.budgets.map((b) => ({ id: b.id || uid('b'), category: b.category, limit: Math.abs(Number(b.limit) || 0) }));
          }
          if (Array.isArray(data.goals)) {
            state.goals = data.goals.map((g) => ({
              id: g.id || uid('goal'), name: String(g.name), target: Math.abs(Number(g.target) || 0),
              icon: g.icon || '🎯', color: g.color || '#8b5cf6', deadline: g.deadline || null
            }));
          }
        }
        persist();
        renderAll();
        toast(`Restored ${state.transactions.length} transactions.`, { tone: 'success' });
      } catch (err) {
        toast('That file is not a valid SpendWise backup.', { tone: 'danger' });
      }
    };
    reader.readAsText(file);
  }

  function clearAll() {
    if (!state.transactions.length && !state.budgets.length && !state.goals.length) {
      return toast('Nothing to clear.', { tone: 'info' });
    }
    const snapshot = {
      transactions: state.transactions,
      budgets: state.budgets,
      goals: state.goals
    };
    state.transactions = [];
    state.budgets = [];
    state.goals = [];
    persist();
    renderAll();
    toast('All data cleared.', {
      tone: 'danger',
      duration: 8000,
      actionLabel: 'Undo',
      action: () => {
        state.transactions = snapshot.transactions;
        state.budgets = snapshot.budgets;
        state.goals = snapshot.goals;
        persist();
        renderAll();
        toast('Data restored.', { tone: 'success' });
      }
    });
  }

  /* ====================================================================== *
   * Navigation
   * ==================================================================== */

  const SECTION_COPY = {
    dashboardSection: 'Your financial summary at a glance.',
    transactionsSection: 'Search, filter and manage every entry.',
    budgetsSection: 'Monthly limits versus real spending.',
    goalsSection: 'Track what you are saving towards.',
    analyticsSection: 'Trends, distribution and automated feedback.',
    settingsSection: 'Preferences, data and privacy.'
  };

  function showSection(targetId, title) {
    document.querySelectorAll('.nav-link').forEach((l) => {
      l.classList.toggle('active', l.dataset.target === targetId);
    });
    document.querySelectorAll('.content-section').forEach((s) => {
      s.classList.toggle('active', s.id === targetId);
    });

    $('pageTitle').textContent = title;
    const sub = $('pageSubtitle');
    sub.textContent = SECTION_COPY[targetId] || '';
    sub.dataset.section = targetId;
    if (targetId === 'dashboardSection') renderUser();

    closeMobileSidebar();
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }

  function openMobileSidebar() {
    $('sidebar').classList.add('open');
    $('sidebarBackdrop').classList.add('active');
  }

  function closeMobileSidebar() {
    $('sidebar').classList.remove('open');
    $('sidebarBackdrop').classList.remove('active');
  }

  /* ====================================================================== *
   * Event wiring
   * ==================================================================== */

  function wireEvents() {
    // Navigation
    document.querySelectorAll('.nav-link').forEach((link) => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        showSection(link.dataset.target, link.dataset.title || link.textContent.trim());
      });
    });

    $('menuToggleBtn').addEventListener('click', openMobileSidebar);
    $('closeSidebarBtn').addEventListener('click', closeMobileSidebar);
    $('sidebarBackdrop').addEventListener('click', closeMobileSidebar);

    $('viewAllTxBtn').addEventListener('click', (e) => {
      e.preventDefault();
      showSection('transactionsSection', 'Transactions');
    });

    // Currency
    const onCurrency = (e) => {
      state.currency = e.target.value;
      localStorage.setItem(KEY.currency, state.currency);
      [$('currencySelect'), $('defaultCurrencySelect')].forEach((s) => { if (s) s.value = state.currency; });
      renderAll();
    };
    $('currencySelect').addEventListener('change', onCurrency);
    $('defaultCurrencySelect').addEventListener('change', onCurrency);

    // Theme
    $('themeSelect').addEventListener('change', (e) => {
      applyTheme(e.target.value);
      localStorage.setItem(KEY.theme, e.target.value);
    });
    $('themeQuickBtn').addEventListener('click', () => {
      const next = document.body.classList.contains('dark-theme') ? 'light' : 'dark';
      applyTheme(next);
      localStorage.setItem(KEY.theme, next);
      if ($('themeSelect')) $('themeSelect').value = next;
    });

    // Privacy
    const togglePrivacy = (value) => {
      state.privacy = typeof value === 'boolean' ? value : !state.privacy;
      localStorage.setItem(KEY.privacy, String(state.privacy));
      renderAll();
      toast(state.privacy ? 'Privacy mode on — amounts are hidden.' : 'Privacy mode off.', { tone: 'info', duration: 2200 });
    };
    $('privacyToggle').addEventListener('change', (e) => togglePrivacy(e.target.checked));
    $('privacyQuickBtn').addEventListener('click', () => togglePrivacy());

    // Transaction filters
    $('searchInput').addEventListener('input', (e) => { state.filters.search = e.target.value; renderTransactions(); });
    $('categoryFilter').addEventListener('change', (e) => { state.filters.category = e.target.value; renderTransactions(); });
    $('typeFilter').addEventListener('change', (e) => { state.filters.type = e.target.value; renderTransactions(); });
    $('rangeFilter').addEventListener('change', (e) => {
      state.range = e.target.value;
      renderAll();
    });

    // Modal: transaction
    $('openModalBtn').addEventListener('click', () => { resetTransactionForm(); openModal('transactionModal'); });
    $('onboardingAddBtn').addEventListener('click', () => { resetTransactionForm(); openModal('transactionModal'); });
    $('closeModalBtn').addEventListener('click', closeModals);
    $('cancelBtn').addEventListener('click', closeModals);
    $('transactionForm').addEventListener('submit', submitTransaction);

    document.querySelectorAll('input[name="txType"]').forEach((r) => {
      r.addEventListener('change', refreshTypeScopedSelects);
    });

    // Modal: budget
    $('openBudgetModalBtn').addEventListener('click', () => {
      state.editingBudgetId = null;
      $('budgetModalTitle').textContent = 'Set a budget';
      $('budgetForm').reset();
      clearFieldErrors();
      openModal('budgetModal');
    });
    $('budgetForm').addEventListener('submit', submitBudget);

    // Modal: goal
    $('openGoalModalBtn').addEventListener('click', () => {
      $('goalModalTitle').textContent = 'New savings goal';
      $('goalForm').reset();
      clearFieldErrors();
      openModal('goalModal');
    });
    $('goalForm').addEventListener('submit', submitGoal);

    // Generic modal close buttons + backdrop + Escape
    document.querySelectorAll('[data-close-modal]').forEach((btn) => {
      btn.addEventListener('click', closeModals);
    });
    document.querySelectorAll('.modal-overlay').forEach((overlay) => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModals();
      });
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { closeModals(); closeMobileSidebar(); return; }
      const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName);
      const modalOpen = document.querySelector('.modal-overlay.active');
      if (!typing && !modalOpen && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault();
        resetTransactionForm();
        openModal('transactionModal');
      }
    });

    // Delegated row actions
    document.addEventListener('click', (e) => {
      const edit = e.target.closest('[data-edit]');
      if (edit) return openEditModal(edit.dataset.edit);

      const del = e.target.closest('[data-delete]');
      if (del) return deleteTransaction(del.dataset.delete);

      const editBudget = e.target.closest('[data-edit-budget]');
      if (editBudget) {
        const b = state.budgets.find((x) => String(x.id) === String(editBudget.dataset.editBudget));
        if (!b) return;
        state.editingBudgetId = b.id;
        $('budgetModalTitle').textContent = `Edit ${b.category} budget`;
        $('budgetCategory').value = b.category;
        $('budgetLimit').value = Math.round(F.fromUSD(b.limit, state.currency, state.rates));
        openModal('budgetModal');
        return;
      }

      const delBudget = e.target.closest('[data-delete-budget]');
      if (delBudget) return deleteBudget(delBudget.dataset.deleteBudget);

      const contribute = e.target.closest('[data-contribute]');
      if (contribute) return contributeToGoal(contribute.dataset.contribute);

      const delGoal = e.target.closest('[data-delete-goal]');
      if (delGoal) return deleteGoal(delGoal.dataset.deleteGoal);

      const editGoal = e.target.closest('[data-edit-goal]');
      if (editGoal) {
        const g = state.goals.find((x) => String(x.id) === String(editGoal.dataset.editGoal));
        if (!g) return;
        // Re-targeting a goal: edit in place through the same form.
        state.goals = state.goals.filter((x) => String(x.id) !== String(g.id));
        $('goalModalTitle').textContent = `Edit ${g.name}`;
        $('goalName').value = g.name;
        $('goalTarget').value = Math.round(F.fromUSD(g.target, state.currency, state.rates));
        $('goalIcon').value = g.icon;
        $('goalDeadline').value = g.deadline || '';
        // Keep the same id so linked contributions survive.
        const submitOnce = (ev) => {
          ev.preventDefault();
          clearFieldErrors();
          const name = $('goalName').value.trim();
          const target = Number($('goalTarget').value);
          if (!name || !isFinite(target) || target <= 0) {
            if (!name) showFieldError('goalName', 'Give the goal a name.');
            if (!isFinite(target) || target <= 0) showFieldError('goalTarget', 'Enter a target above zero.');
            return;
          }
          state.goals.push({
            id: g.id, name,
            target: F.toUSD(target, state.currency, state.rates),
            icon: $('goalIcon').value,
            color: g.color,
            deadline: $('goalDeadline').value || null
          });
          persist();
          refreshGoalSelect();
          renderAll();
          closeModals();
          $('goalForm').removeEventListener('submit', submitOnce);
          toast('Goal updated.', { tone: 'success' });
        };
        $('goalForm').addEventListener('submit', submitOnce);
        openModal('goalModal');
        return;
      }
    });

    // Demo data
    $('loadDemoBtn').addEventListener('click', loadDemoData);
    $('loadDemoSettingsBtn').addEventListener('click', loadDemoData);

    // Data management
    $('exportCsvBtn').addEventListener('click', exportCSV);
    $('exportJsonBtn').addEventListener('click', exportJSON);
    $('importJsonBtn').addEventListener('click', () => $('importJsonInput').click());
    $('importJsonInput').addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) importJSON(e.target.files[0]);
      e.target.value = '';
    });
    $('clearDataBtn').addEventListener('click', clearAll);

    // User chip
    $('userChip').addEventListener('click', () => {
      const user = Auth ? Auth.currentUser() : null;
      if (!user) {
        window.location.href = 'login.html';
        return;
      }
      toast(`Signed in as ${user.email}`, {
        tone: 'info',
        duration: 7000,
        actionLabel: 'Sign out',
        action: () => {
          Auth.signOut();
          window.location.href = 'index.html';
        }
      });
    });
  }

  /* ====================================================================== *
   * Boot
   * ==================================================================== */

  function init() {
    loadSettings();
    loadState();
    populateStaticSelects();

    const dateEl = $('txDate');
    if (dateEl) dateEl.value = F.isoDate(new Date());

    initCharts();
    wireEvents();
    renderAll();
    renderUser();

    // Currency select should reflect any cached/selected currency.
    if ($('currencySelect')) $('currencySelect').value = state.currency;
    if ($('defaultCurrencySelect')) $('defaultCurrencySelect').value = state.currency;

    fetchExchangeRates();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
