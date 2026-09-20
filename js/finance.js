/* ==========================================================================
   SpendWise — finance.js
   Pure domain logic. Zero DOM, zero globals, zero side effects.
   Every function takes its inputs and returns data, so the money math can be
   unit-tested in plain Node (`npm test`) and reused by any UI layer.
   Amounts are stored internally in USD and converted at the presentation edge.
   ========================================================================== */
(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = mod;            // Node / tests
  } else {
    root.SpendWiseFinance = mod;     // Browser
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Reference data
   * ------------------------------------------------------------------ */

  const CURRENCIES = {
    USD: { code: 'USD', symbol: '$', name: 'US Dollar' },
    EUR: { code: 'EUR', symbol: '€', name: 'Euro' },
    GBP: { code: 'GBP', symbol: '£', name: 'British Pound' },
    NGN: { code: 'NGN', symbol: '₦', name: 'Nigerian Naira' },
    INR: { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
    KES: { code: 'KES', symbol: 'KSh', name: 'Kenyan Shilling' },
    CAD: { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar' },
    ZAR: { code: 'ZAR', symbol: 'R', name: 'South African Rand' }
  };

  const CATEGORIES = [
    { name: 'Food & Dining', icon: '🍜', color: '#f59e0b', type: 'expense' },
    { name: 'Transport',     icon: '🚗', color: '#3b82f6', type: 'expense' },
    { name: 'Housing',       icon: '🏠', color: '#8b5cf6', type: 'expense' },
    { name: 'Utilities',     icon: '⚡', color: '#06b6d4', type: 'expense' },
    { name: 'Shopping',      icon: '🛍️', color: '#ec4899', type: 'expense' },
    { name: 'Entertainment', icon: '🎬', color: '#ef4444', type: 'expense' },
    { name: 'Health',        icon: '🩺', color: '#14b8a6', type: 'expense' },
    { name: 'Education',     icon: '📚', color: '#0ea5e9', type: 'expense' },
    { name: 'Salary',        icon: '💼', color: '#10b981', type: 'income' },
    { name: 'Freelance',     icon: '🧑‍💻', color: '#22c55e', type: 'income' },
    { name: 'Investments',   icon: '📈', color: '#6366f1', type: 'income' },
    { name: 'Savings Fund',  icon: '🏦', color: '#a855f7', type: 'savings' },
    { name: 'Other',         icon: '📦', color: '#64748b', type: 'expense' }
  ];

  const CATEGORY_INDEX = CATEGORIES.reduce((acc, c) => {
    acc[c.name] = c;
    return acc;
  }, {});

  const FALLBACK_CATEGORY = { name: 'Other', icon: '📦', color: '#64748b', type: 'expense' };

  const RANGE_OPTIONS = [
    { key: 'this-month', label: 'This month' },
    { key: '30d',        label: 'Last 30 days' },
    { key: '90d',        label: 'Last 90 days' },
    { key: 'ytd',        label: 'Year to date' },
    { key: 'all',        label: 'All time' }
  ];

  /* ------------------------------------------------------------------ *
   * Small utilities
   * ------------------------------------------------------------------ */

  function isFiniteNumber(n) {
    return typeof n === 'number' && Number.isFinite(n);
  }

  function meta(categoryName) {
    return CATEGORY_INDEX[categoryName] || FALLBACK_CATEGORY;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  /** Deterministic PRNG so demo data is stable between reloads and tests. */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  /* ------------------------------------------------------------------ *
   * Dates
   * ------------------------------------------------------------------ */

  /** "2026-09-20" (or any Date) -> "2026-09" */
  function monthKey(dateLike) {
    const d = dateLike instanceof Date ? dateLike : new Date(String(dateLike));
    if (Number.isNaN(d.getTime())) return null;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  function toDateOnly(dateLike) {
    const d = dateLike instanceof Date ? dateLike : new Date(String(dateLike));
    if (Number.isNaN(d.getTime())) return null;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  /** ISO yyyy-mm-dd for a Date, in local time. */
  function isoDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /** The last `count` month keys ending at `now`, oldest first. */
  function lastMonthKeys(count, now) {
    const ref = now instanceof Date ? now : new Date(now);
    const keys = [];
    for (let i = count - 1; i >= 0; i--) {
      const d = new Date(ref.getFullYear(), ref.getMonth() - i, 1);
      keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    return keys;
  }

  /** "2026-09" -> "Sep" (labels for the trend chart). */
  function monthLabel(key) {
    const parts = String(key).split('-');
    const d = new Date(Number(parts[0]), Number(parts[1]) - 1, 1);
    return d.toLocaleString('en-US', { month: 'short' });
  }

  function daysBetween(a, b) {
    const d1 = toDateOnly(a);
    const d2 = toDateOnly(b);
    if (!d1 || !d2) return 0;
    return Math.round((d2 - d1) / 86400000);
  }

  /** Human relative label: "Today", "Yesterday", "12 Mar". */
  function friendlyDate(dateStr, now) {
    const d = toDateOnly(dateStr);
    if (!d) return String(dateStr || '');
    const diff = daysBetween(d, now instanceof Date ? now : new Date(now));
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    if (diff > 1 && diff < 7) return `${diff} days ago`;
    return d.toLocaleString('en-US', { day: 'numeric', month: 'short' });
  }

  /**
   * Keep transactions inside a window. `rangeKey` is one of RANGE_OPTIONS.
   * Unknown keys behave like "all".
   */
  function filterByRange(transactions, rangeKey, now) {
    const list = Array.isArray(transactions) ? transactions : [];
    const ref = toDateOnly(now) || new Date();
    if (rangeKey === 'all' || !rangeKey) return list;

    if (rangeKey === 'this-month') {
      const key = monthKey(ref);
      return list.filter((t) => monthKey(t.date) === key);
    }
    if (rangeKey === 'ytd') {
      return list.filter((t) => {
        const d = toDateOnly(t.date);
        return d && d.getFullYear() === ref.getFullYear() && d <= ref;
      });
    }
    if (rangeKey === '30d' || rangeKey === '90d') {
      const span = rangeKey === '30d' ? 30 : 90;
      return list.filter((t) => {
        const d = toDateOnly(t.date);
        if (!d) return false;
        const diff = daysBetween(d, ref);
        return diff >= 0 && diff < span;
      });
    }
    return list;
  }

  /* ------------------------------------------------------------------ *
   * Money
   * ------------------------------------------------------------------ */

  function rateFor(code, exchangeRates) {
    const rates = exchangeRates || {};
    const rate = rates[code];
    return isFiniteNumber(rate) && rate > 0 ? rate : (code === 'USD' ? 1 : 1);
  }

  /** USD -> display currency. */
  function fromUSD(amountUSD, code, exchangeRates) {
    return (isFiniteNumber(amountUSD) ? amountUSD : 0) * rateFor(code, exchangeRates);
  }

  /** display currency -> USD (used when saving a form entry). */
  function toUSD(amount, code, exchangeRates) {
    const rate = rateFor(code, exchangeRates);
    return (isFiniteNumber(amount) ? amount : 0) / rate;
  }

  /**
   * Render a converted amount: "$1,234.50".
   *
   * Options:
   *   privacy  -> short-circuits to a masked string so nothing leaks to the DOM
   *   signed   -> always show a sign ("+$10.00", "-$5.00", "+$0.00")
   *   sign     -> force an explicit leading "+" or "-" regardless of the value
   *
   * `sign` exists because the expenses card must read "-$0.00" when empty, and
   * `-0 < 0` is false, so a sign inferred from the value alone drops the minus.
   */
  function formatMoney(value, symbol, opts) {
    const o = opts || {};
    const n = isFiniteNumber(value) ? value : 0;

    let sign = '';
    if (o.sign === '+' || o.sign === '-') sign = o.sign;
    else if (o.signed) sign = n < 0 ? '-' : '+';
    else if (n < 0) sign = '-';

    if (o.privacy) return `${sign}${symbol}••••••`;

    const abs = Math.abs(n).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    return `${sign}${symbol}${abs}`;
  }

  /** "$1.2k" / "$3.4M" — for axis ticks and tight cards. */
  function compactMoney(value, symbol) {
    const n = Math.abs(isFiniteNumber(value) ? value : 0);
    const sign = (isFiniteNumber(value) && value < 0) ? '-' : '';
    if (n >= 1e9) return `${sign}${symbol}${(n / 1e9).toFixed(1)}B`;
    if (n >= 1e6) return `${sign}${symbol}${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${sign}${symbol}${(n / 1e3).toFixed(1)}k`;
    return `${sign}${symbol}${n.toFixed(0)}`;
  }

  /** Percentage of `part` over `whole`, rounded to `digits` decimal places. */
  function pct(part, whole, digits) {
    if (!whole || !isFiniteNumber(part)) return 0;
    const d = digits == null ? 0 : digits;
    const scale = Math.pow(10, d);
    return Math.round((part / whole) * 100 * scale) / scale;
  }

  /* ------------------------------------------------------------------ *
   * Transactions
   * ------------------------------------------------------------------ */

  function normalizeTransaction(raw, fallbackId) {
    const t = raw || {};
    const type = ['income', 'expense', 'savings'].includes(t.type) ? t.type : 'expense';
    const amount = Math.abs(isFiniteNumber(Number(t.amount)) ? Number(t.amount) : 0);
    return {
      id: t.id != null ? t.id : fallbackId,
      description: String(t.description || 'Untitled').slice(0, 120),
      amount,
      type,
      category: String(t.category || meta('').name),
      date: isoDate(toDateOnly(t.date) || new Date()),
      notes: t.notes ? String(t.notes).slice(0, 280) : '',
      goalId: t.goalId != null ? t.goalId : null
    };
  }

  /** Newest first, then by id desc so same-day entries stay stable. */
  function sortTransactions(transactions) {
    return [...(transactions || [])].sort((a, b) => {
      const da = toDateOnly(a.date);
      const db = toDateOnly(b.date);
      if (da && db && db - da !== 0) return db - da;
      return (b.id || 0) - (a.id || 0);
    });
  }

  function filterTransactions(transactions, opts) {
    const o = opts || {};
    const term = String(o.search || '').trim().toLowerCase();
    const list = (transactions || []).filter((t) => {
      if (o.category && o.category !== 'All' && t.category !== o.category) return false;
      if (o.type && o.type !== 'All' && t.type !== o.type) return false;
      if (term) {
        const haystack = `${t.description} ${t.category}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
    return sortTransactions(list);
  }

  /* ------------------------------------------------------------------ *
   * Aggregation
   * ------------------------------------------------------------------ */

  /**
   * Core money summary. `balance` is income minus expenses minus money parked
   * in savings, matching the model the original app used.
   */
  function computeSummary(transactions) {
    const list = transactions || [];
    let income = 0, expense = 0, savings = 0;

    list.forEach((t) => {
      const amt = Math.abs(isFiniteNumber(Number(t.amount)) ? Number(t.amount) : 0);
      if (t.type === 'income') income += amt;
      else if (t.type === 'savings') savings += amt;
      else expense += amt;
    });

    income = round2(income);
    expense = round2(expense);
    savings = round2(savings);

    return {
      income,
      expense,
      savings,
      balance: round2(income - expense - savings),
      netCashflow: round2(income - expense),
      savingsRate: income > 0 ? round2(((income - expense) / income) * 100) : 0,
      count: list.length
    };
  }

  /**
   * Totals per category for one transaction type.
   * Returns [{ category, total, share, icon, color }] sorted by total desc.
   */
  function groupByCategory(transactions, type) {
    const totals = {};
    let sum = 0;

    (transactions || []).forEach((t) => {
      if (type && t.type !== type) return;
      const amt = Math.abs(isFiniteNumber(Number(t.amount)) ? Number(t.amount) : 0);
      totals[t.category] = (totals[t.category] || 0) + amt;
      sum += amt;
    });

    return Object.keys(totals)
      .map((category) => {
        const m = meta(category);
        return {
          category,
          total: round2(totals[category]),
          share: pct(totals[category], sum, 1),
          icon: m.icon,
          color: m.color
        };
      })
      .sort((a, b) => b.total - a.total);
  }

  /**
   * Real monthly buckets built from transaction dates — no invented shape.
   * Returns { keys, labels, income[], expense[], savings[], net[] }.
   */
  function monthlySeries(transactions, monthCount, now) {
    const keys = lastMonthKeys(monthCount || 6, now || new Date());
    const buckets = keys.reduce((acc, k) => {
      acc[k] = { income: 0, expense: 0, savings: 0 };
      return acc;
    }, {});

    (transactions || []).forEach((t) => {
      const key = monthKey(t.date);
      if (!key || !buckets[key]) return;
      const amt = Math.abs(isFiniteNumber(Number(t.amount)) ? Number(t.amount) : 0);
      if (t.type === 'income') buckets[key].income += amt;
      else if (t.type === 'savings') buckets[key].savings += amt;
      else buckets[key].expense += amt;
    });

    const pick = (field) => keys.map((k) => round2(buckets[k][field]));
    const income = pick('income');
    const expense = pick('expense');
    const savings = pick('savings');

    return {
      keys,
      labels: keys.map(monthLabel),
      income,
      expense,
      savings,
      net: income.map((v, i) => round2(v - expense[i]))
    };
  }

  /**
   * Percentage change between the last two populated months of a series.
   * Returns null when there is no comparable previous month.
   */
  function monthOverMonthChange(series, field) {
    const arr = (series && series[field]) || [];
    const current = arr[arr.length - 1];
    const previous = arr[arr.length - 2];
    if (!isFiniteNumber(current) || !isFiniteNumber(previous) || previous === 0) return null;
    return round2(((current - previous) / Math.abs(previous)) * 100);
  }

  /** Average monthly expense across months that actually have spending. */
  function averageMonthlyExpense(series) {
    const months = ((series && series.expense) || []).filter((v) => v > 0);
    if (!months.length) return 0;
    return round2(months.reduce((a, b) => a + b, 0) / months.length);
  }

  /* ------------------------------------------------------------------ *
   * Budgets
   * ------------------------------------------------------------------ */

  /**
   * Compare each budget limit against real spend for `periodTx`.
   * status: 'ok' (<75%), 'warn' (75-100%), 'over' (>100%).
   */
  function evaluateBudgets(budgets, periodTransactions, now) {
    const ref = now instanceof Date ? now : new Date(now || Date.now());
    const inThisMonth = (periodTransactions || []).filter(
      (t) => t.type === 'expense' && monthKey(t.date) === monthKey(ref)
    );
    const spentByCategory = {};
    inThisMonth.forEach((t) => {
      spentByCategory[t.category] = round2((spentByCategory[t.category] || 0) + Math.abs(Number(t.amount) || 0));
    });

    const evaluated = (budgets || []).map((b) => {
      const limit = Math.abs(isFiniteNumber(Number(b.limit)) ? Number(b.limit) : 0);
      const spent = round2(spentByCategory[b.category] || 0);
      const remaining = round2(limit - spent);
      const usedPct = limit > 0 ? round2((spent / limit) * 100) : 0;
      let status = 'ok';
      if (limit > 0 && usedPct >= 100) status = 'over';
      else if (limit > 0 && usedPct >= 75) status = 'warn';
      else if (limit <= 0) status = 'unset';

      return {
        id: b.id,
        category: b.category,
        icon: meta(b.category).icon,
        color: meta(b.category).color,
        limit,
        spent,
        remaining,
        usedPct,
        status,
        dailySafe: remaining > 0 ? round2(remaining / Math.max(1, daysRemainingInMonth(ref))) : 0
      };
    });

    return evaluated.sort((a, b) => b.usedPct - a.usedPct);
  }

  function daysRemainingInMonth(ref) {
    const d = ref instanceof Date ? ref : new Date(ref);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    return Math.max(1, last - d.getDate() + 1);
  }

  /** Roll up every budget into one headline number. */
  function budgetRollup(evaluated) {
    const list = evaluated || [];
    const limited = list.filter((b) => b.limit > 0);
    const limit = round2(limited.reduce((a, b) => a + b.limit, 0));
    const spent = round2(limited.reduce((a, b) => a + b.spent, 0));
    return {
      limit,
      spent,
      remaining: round2(limit - spent),
      usedPct: limit > 0 ? round2((spent / limit) * 100) : 0,
      overCount: limited.filter((b) => b.status === 'over').length,
      warnCount: limited.filter((b) => b.status === 'warn').length,
      count: limited.length
    };
  }

  /* ------------------------------------------------------------------ *
   * Savings goals
   * ------------------------------------------------------------------ */

  /**
   * A goal's progress is derived from its linked savings transactions, so there
   * is exactly one source of truth. `now` drives the ETA maths.
   */
  function evaluateGoal(goal, transactions, now) {
    const ref = now instanceof Date ? now : new Date(now || Date.now());
    const target = Math.abs(isFiniteNumber(Number(goal.target)) ? Number(goal.target) : 0);

    const contributions = (transactions || []).filter(
      (t) => t.type === 'savings' && t.goalId != null && String(t.goalId) === String(goal.id)
    );
    const saved = round2(contributions.reduce((a, t) => a + Math.abs(Number(t.amount) || 0), 0));
    const remaining = round2(Math.max(0, target - saved));
    const progressPct = target > 0 ? Math.min(100, round2((saved / target) * 100)) : 0;

    // Pace: average monthly contribution over the last 3 months of activity.
    const recent = contributions
      .map((t) => toDateOnly(t.date))
      .filter(Boolean)
      .sort((a, b) => b - a);
    const spanDays = recent.length ? Math.max(1, daysBetween(recent[recent.length - 1], ref)) : 0;
    const monthlyPace = spanDays > 0 ? round2((saved / spanDays) * 30) : 0;
    const monthsLeft = monthlyPace > 0 && remaining > 0 ? Math.ceil(remaining / monthlyPace) : null;

    return {
      id: goal.id,
      name: goal.name,
      icon: goal.icon || '🎯',
      color: goal.color || '#8b5cf6',
      target,
      saved,
      remaining,
      progressPct,
      monthlyPace,
      monthsLeft,
      contributions: contributions.length,
      complete: target > 0 && saved >= target,
      deadline: goal.deadline || null,
      onTrack: goal.deadline
        ? (monthsLeft != null && monthsLeft <= Math.max(0, Math.ceil(daysBetween(ref, goal.deadline) / 30)))
        : null
    };
  }

  /* ------------------------------------------------------------------ *
   * Insights
   * ------------------------------------------------------------------ */

  /**
   * Generate up to `max` insights from real numbers. Every message is derived
   * from data — nothing here is pre-baked marketing copy.
   */
  function generateInsights(input) {
    const cfg = input || {};
    const transactions = Array.isArray(cfg.transactions) ? cfg.transactions : [];
    const now = cfg.now instanceof Date ? cfg.now : new Date(cfg.now || Date.now());
    // Derive from the supplied ledger unless the caller already computed them,
    // so `generateInsights({ transactions })` is correct on its own.
    const summary = cfg.summary || computeSummary(transactions);
    const series = cfg.series || monthlySeries(transactions, 6, now);
    const budgets = Array.isArray(cfg.budgets) ? cfg.budgets : [];
    const symbol = cfg.symbol || '$';

    const out = [];
    const expenses = transactions.filter((t) => t.type === 'expense');

    if (!transactions.length) {
      return [{
        tone: 'info',
        icon: '✨',
        title: 'Nothing to analyse yet',
        body: 'Add your first transaction — or load the demo dataset — and SpendWise will start building insights from your real numbers.'
      }];
    }

    // 1. Largest expense category, only when it is genuinely dominant.
    const cats = groupByCategory(expenses, 'expense');
    if (cats.length) {
      const top = cats[0];
      const tone = top.share >= 40 ? 'warn' : 'info';
      out.push({
        tone,
        icon: top.icon,
        title: `${top.category} leads your spending`,
        body: top.share >= 40
          ? `${top.category} is ${top.share}% of everything you spent (${symbol}${top.total.toFixed(2)}). That is a big share — trimming it is the fastest lever you have.`
          : `${top.category} takes the largest slice at ${top.share}% (${symbol}${top.total.toFixed(2)}), spread across ${cats.length} categor${cats.length === 1 ? 'y' : 'ies'}.`
      });
    }

    // 2. Savings rate vs the 20% rule of thumb.
    if (summary.income > 0) {
      const rate = summary.savingsRate;
      out.push({
        tone: rate >= 20 ? 'good' : rate >= 10 ? 'info' : 'warn',
        icon: rate >= 20 ? '🌱' : '📉',
        title: `${rate}% savings rate`,
        body: rate >= 20
          ? `You are keeping ${rate}% of income after expenses — above the 20% benchmark. Keep compounding it.`
          : rate >= 10
            ? `You are keeping ${rate}% of income. The common benchmark is 20%, so there is room to grow.`
            : `Only ${rate}% of income survives your expenses. Even a small recurring transfer would move this quickly.`
      });
    }

    // 3. Month-over-month spending direction.
    const expenseDelta = monthOverMonthChange(series, 'expense');
    if (expenseDelta != null) {
      const up = expenseDelta > 0;
      out.push({
        tone: up ? (expenseDelta > 15 ? 'warn' : 'info') : 'good',
        icon: up ? '📈' : '📉',
        title: `Spending ${up ? 'up' : 'down'} ${Math.abs(expenseDelta)}% this month`,
        body: up
          ? `Expenses rose ${expenseDelta}% versus last month. Worth checking whether that is one-off or a new baseline.`
          : `Expenses fell ${Math.abs(expenseDelta)}% versus last month. That reduction is ${symbol}${Math.abs(round2((series.expense[series.expense.length - 2] || 0) - (series.expense[series.expense.length - 1] || 0))).toFixed(2)} back in your pocket.`
      });
    }

    // 4. Runway — how long the balance covers average spend.
    const avgExpense = averageMonthlyExpense(series);
    if (avgExpense > 0 && summary.balance > 0) {
      const months = round2(summary.balance / avgExpense);
      out.push({
        tone: months >= 3 ? 'good' : months >= 1 ? 'info' : 'danger',
        icon: months >= 3 ? '🛡️' : '⚠️',
        title: `${months} month${months === 1 ? '' : 's'} of runway`,
        body: `At your average spend of ${symbol}${avgExpense.toFixed(2)}/month, your ${symbol}${summary.balance.toFixed(2)} balance covers about ${months} month${months === 1 ? '' : 's'}. Three is a comfortable cushion.`
      });
    } else if (summary.balance < 0) {
      out.push({
        tone: 'danger',
        icon: '🚨',
        title: 'Balance is negative',
        body: `You are ${symbol}${Math.abs(summary.balance).toFixed(2)} underwater across all logged activity. Review recurring expenses first.`
      });
    }

    // 5. Budget breaches beat generic praise.
    const overBudgets = budgets.filter((b) => b.status === 'over');
    if (overBudgets.length) {
      const b = overBudgets[0];
      out.push({
        tone: 'danger',
        icon: '🎯',
        title: `${b.category} budget exceeded`,
        body: `You have spent ${symbol}${b.spent.toFixed(2)} of a ${symbol}${b.limit.toFixed(2)} ${b.category} limit — ${symbol}${Math.abs(b.remaining).toFixed(2)} over, with ${daysRemainingInMonth(now)} day${daysRemainingInMonth(now) === 1 ? '' : 's'} left.`
      });
    } else if (budgets.filter((b) => b.status === 'warn').length) {
      const b = budgets.filter((x) => x.status === 'warn')[0];
      out.push({
        tone: 'warn',
        icon: '⏳',
        title: `${b.category} is at ${b.usedPct}% of budget`,
        body: `${symbol}${b.spent.toFixed(2)} of ${symbol}${b.limit.toFixed(2)} used. Stay under ${symbol}${b.dailySafe.toFixed(2)}/day to finish the month inside the limit.`
      });
    }

    // 6. Single largest transaction.
    if (expenses.length) {
      const biggest = [...expenses].sort((a, b) => b.amount - a.amount)[0];
      if (biggest.amount > 0 && summary.expense > 0 && biggest.amount / summary.expense >= 0.2) {
        out.push({
          tone: 'info',
          icon: meta(biggest.category).icon,
          title: `One purchase = ${pct(biggest.amount, summary.expense)}% of spending`,
          body: `"${biggest.description}" (${symbol}${biggest.amount.toFixed(2)}) is your single largest expense and alone accounts for ${pct(biggest.amount, summary.expense)}% of the total.`
        });
      }
    }

    return out.slice(0, cfg.max ? cfg.max : 5);
  }

  /* ------------------------------------------------------------------ *
   * Export
   * ------------------------------------------------------------------ */

  function toCSV(transactions) {
    const headers = ['ID', 'Date', 'Description', 'Category', 'Type', 'Amount (USD)', 'Goal ID', 'Notes'];
    const rows = sortTransactions(transactions).map((t) => [
      t.id,
      t.date,
      `"${String(t.description).replace(/"/g, '""')}"`,
      `"${String(t.category).replace(/"/g, '""')}"`,
      t.type,
      (Math.abs(Number(t.amount) || 0)).toFixed(2),
      t.goalId == null ? '' : t.goalId,
      `"${String(t.notes || '').replace(/"/g, '""')}"`
    ]);
    return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  }

  /* ------------------------------------------------------------------ *
   * Demo dataset
   * ------------------------------------------------------------------ */

  const DEMO_PLAN = [
    { description: 'Monthly Salary', category: 'Salary', type: 'income', min: 4100, max: 4600, day: 1 },
    { description: 'Rent', category: 'Housing', type: 'expense', min: 1250, max: 1250, day: 3 },
    { description: 'Internet & Mobile', category: 'Utilities', type: 'expense', min: 55, max: 70, day: 5 },
    { description: 'Electricity Bill', category: 'Utilities', type: 'expense', min: 60, max: 115, day: 8 },
    { description: 'Grocery Run', category: 'Food & Dining', type: 'expense', min: 85, max: 190, day: 6, repeat: 3 },
    { description: 'Coffee & Lunch', category: 'Food & Dining', type: 'expense', min: 9, max: 34, day: 2, repeat: 6 },
    { description: 'Ride Share', category: 'Transport', type: 'expense', min: 12, max: 45, day: 4, repeat: 3 },
    { description: 'Fuel Top-up', category: 'Transport', type: 'expense', min: 40, max: 80, day: 12, repeat: 2 },
    { description: 'Streaming Bundle', category: 'Entertainment', type: 'expense', min: 15, max: 32, day: 10 },
    { description: 'Cinema Night', category: 'Entertainment', type: 'expense', min: 18, max: 60, day: 20, repeat: 2 },
    { description: 'Online Shopping', category: 'Shopping', type: 'expense', min: 35, max: 240, day: 15, repeat: 2 },
    { description: 'Pharmacy', category: 'Health', type: 'expense', min: 14, max: 85, day: 18 },
    { description: 'Freelance Project', category: 'Freelance', type: 'income', min: 250, max: 900, day: 22, repeat: 2 },
    { description: 'Dividend Payout', category: 'Investments', type: 'income', min: 40, max: 160, day: 25 },
    { description: 'Emergency Fund Transfer', category: 'Savings Fund', type: 'savings', min: 300, max: 550, day: 2 }
  ];

  const DEMO_GOALS = [
    { id: 'goal-1', name: 'Emergency Fund', target: 6000, icon: '🛟', color: '#8b5cf6' },
    { id: 'goal-2', name: 'Japan Trip', target: 3500, icon: '🗾', color: '#06b6d4' },
    { id: 'goal-3', name: 'New Laptop', target: 2200, icon: '💻', color: '#f59e0b' }
  ];

  /**
   * Six months of plausible activity, deterministic per `seed`. Real dates, so
   * the trend chart and month-over-month insights have something true to show.
   */
  function buildDemoData(seed, now) {
    const rand = mulberry32(seed == null ? 20260920 : seed);
    const ref = now instanceof Date ? now : new Date(now || Date.now());
    const transactions = [];
    let id = 1;

    for (let back = 5; back >= 0; back--) {
      const monthDate = new Date(ref.getFullYear(), ref.getMonth() - back, 1);
      const daysInMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();

      DEMO_PLAN.forEach((plan) => {
        const occurrences = plan.repeat || 1;
        for (let occ = 0; occ < occurrences; occ++) {
          let day = plan.day + Math.floor((daysInMonth / (occurrences + 1)) * occ) + Math.floor(rand() * 3) - 1;
          day = Math.min(Math.max(1, day), back === 0 ? ref.getDate() : daysInMonth);
          const amount = round2(plan.min + rand() * (plan.max - plan.min));
          const goalId = plan.type === 'savings'
            ? DEMO_GOALS[Math.floor(rand() * DEMO_GOALS.length)].id
            : null;

          transactions.push(normalizeTransaction({
            id: id++,
            description: plan.description,
            category: plan.category,
            type: plan.type,
            amount,
            date: isoDate(new Date(monthDate.getFullYear(), monthDate.getMonth(), day)),
            goalId
          }, id));
        }
      });
    }

    return {
      transactions: sortTransactions(transactions),
      goals: DEMO_GOALS.map((g) => ({ ...g })),
      budgets: [
        { id: 'b-1', category: 'Food & Dining', limit: 650 },
        { id: 'b-2', category: 'Transport', limit: 280 },
        { id: 'b-3', category: 'Entertainment', limit: 150 },
        { id: 'b-4', category: 'Shopping', limit: 400 },
        { id: 'b-5', category: 'Utilities', limit: 200 }
      ]
    };
  }

  /* ------------------------------------------------------------------ *
   * Validation
   * ------------------------------------------------------------------ */

  function validateTransactionInput(input) {
    const errors = {};
    const description = String(input.description || '').trim();
    const amount = Number(input.amount);

    if (!description) errors.description = 'Give this transaction a name.';
    else if (description.length < 2) errors.description = 'Use at least 2 characters.';

    if (input.amount === '' || input.amount == null || !isFiniteNumber(amount)) errors.amount = 'Enter a number.';
    else if (amount <= 0) errors.amount = 'Amount must be greater than zero.';
    else if (amount > 1e9) errors.amount = 'That amount looks unrealistic.';

    if (!['income', 'expense', 'savings'].includes(input.type)) errors.type = 'Pick a transaction type.';
    if (!input.category) errors.category = 'Pick a category.';

    const d = toDateOnly(input.date || new Date());
    if (!d) errors.date = 'Enter a valid date.';
    else if (d > toDateOnly(new Date())) errors.date = 'Date cannot be in the future.';

    return { valid: Object.keys(errors).length === 0, errors };
  }

  /* ------------------------------------------------------------------ */

  return {
    // data
    CURRENCIES,
    CATEGORIES,
    CATEGORY_INDEX,
    RANGE_OPTIONS,
    // utils
    meta,
    escapeHtml,
    round2,
    pct,
    mulberry32,
    // dates
    monthKey,
    toDateOnly,
    isoDate,
    lastMonthKeys,
    monthLabel,
    daysBetween,
    daysRemainingInMonth,
    friendlyDate,
    filterByRange,
    // money
    rateFor,
    fromUSD,
    toUSD,
    formatMoney,
    compactMoney,
    // transactions
    normalizeTransaction,
    sortTransactions,
    filterTransactions,
    validateTransactionInput,
    // aggregation
    computeSummary,
    groupByCategory,
    monthlySeries,
    monthOverMonthChange,
    averageMonthlyExpense,
    // budgets & goals
    evaluateBudgets,
    budgetRollup,
    evaluateGoal,
    // insight & export
    generateInsights,
    toCSV,
    buildDemoData,
    DEMO_GOALS
  };
});
