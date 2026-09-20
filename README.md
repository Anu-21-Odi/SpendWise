# SpendWise 💸

A private, local-first personal finance tracker. Track cash flow, set category budgets, watch
savings goals fill up, and get insights that are actually computed from your data.

No backend. No build step. No account required. Everything lives in your browser's
`localStorage`.

---

## 🚀 Quick start

There is nothing to install.

```bash
# Option A — just open it
open app.html            # macOS
xdg-open app.html        # Linux
start app.html           # Windows

# Option B — serve the folder (needed if you want the landing page too)
python3 -m http.server 4173
# then visit http://localhost:4173
```

First launch shows an onboarding banner. Click **Load demo data** to generate six months of
realistic activity across every category, budget and goal, or add a transaction by hand.

---

## ✨ Features

**Tracking**
- Income, expense and savings entries with categories, dates and notes
- Search, plus type / category / date-range filters
- Newest-first ordering by real transaction dates
- Undo on every delete

**Budgets**
- A monthly limit per category
- Live progress with a *safe-to-spend-per-day* figure for the rest of the month
- Warns at 75%, flags red when you go over, and counts breaches in the sidebar

**Savings goals**
- Progress rings derived from linked savings transactions — one source of truth, nothing entered twice
- An ETA projected from your actual contribution pace

**Analytics**
- Six-month income vs. expense trend, bucketed by your real transaction dates
- Category distribution and your ten largest expenses
- Insights generated from your ledger: savings rate, month-over-month change, runway in months, budget breaches

**Everything else**
- Eight currencies (USD, EUR, GBP, NGN, INR, KES, CAD, ZAR) with live rates, cached 24h
- Privacy mode that masks amounts across cards, tables *and* charts
- Light and dark themes
- CSV export and full JSON backup / restore
- Keyboard shortcut: press `N` anywhere to add a transaction, `Esc` to close
- Graceful offline behaviour — if the Chart.js CDN is unreachable, every number and table still works

---

## 📂 Project structure

```text
SpendWise/
├── index.html            Landing page
├── login.html            Sign in (local demo profile)
├── signup.html           Sign up (local demo profile)
├── app.html              The application shell
│
├── js/
│   ├── finance.js        Pure domain logic — no DOM, fully unit-tested
│   ├── auth.js           Local-only profile/session helper
│   └── auth-pages.js     Form behaviour for the auth pages
│
├── dashboard.js          DOM + state layer for app.html
├── dashboard.css         App design system (light/dark tokens)
├── style.css             Landing page styles
├── auth.css              Auth page styles
├── script.js             Landing page interactions
│
└── tests/
    ├── finance.test.js           47 unit tests for the money maths
    ├── app.integration.test.js   38 tests that boot app.html in jsdom
    └── auth.test.js              17 tests for auth.js and the auth pages
```

The split matters: **`js/finance.js` contains no DOM access at all.** Every calculation — summaries,
monthly buckets, budget status, goal progress, insight generation, CSV — is a pure function that
takes data and returns data. That is what makes the maths testable in plain Node, and it means the
UI layer can only present numbers, never invent them.

---

## 🧪 Tests

```bash
npm install     # only needed for jsdom (a dev dependency)
npm test        # 102 tests
npm run test:unit   # domain logic only
npm run test:app    # boots app.html in jsdom only
```

Requires Node 18+. There is no build step and no framework — `node --test` is the whole runner.

The integration tests boot the real `app.html` with the real `dashboard.js` inside jsdom and assert
on the rendered DOM: that metric cards show converted totals, that the transactions table renders
rows with no inline `onclick` handlers, that submitting the form validates and persists, that
privacy mode leaves no unmasked amount in the table, that deleting offers a working undo, and that
the app still boots cleanly when Chart.js is unreachable.

---

## 🔒 Privacy

SpendWise makes exactly one network call: live exchange rates from
[open.er-api.com](https://open.er-api.com), cached in `localStorage` for 24 hours. Block it and the
app continues to work at 1:1.

There is no database, no analytics and no tracking. **Sign-in is a local profile, not security** —
passwords are validated for length and then discarded, never stored or transmitted. Only your name
and email are kept, so the app can greet you. Anyone with access to your browser can clear it, which
is exactly why the auth pages say so out loud.

Clear your data from **Settings → Clear all data**, or just clear browser storage.

---

## 💻 Built with

- HTML5 & CSS3 — custom properties, grid, flexbox, no preprocessor
- Vanilla JavaScript (ES2020+) — no framework, no bundler
- [Chart.js](https://www.chartjs.org/) via CDN for the donut and trend charts
- [Node's built-in test runner](https://nodejs.org/api/test.html) + jsdom for tests

---

## 📄 License

MIT.
