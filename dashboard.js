// --- STATE MANAGEMENT ---
let transactions = [];
let currentCurrency = '$';
let currentCurrencyCode = 'USD';
let exchangeRates = { USD: 1 };
let expenseChart = null;
let trendChart = null;
let editingTransactionId = null;
let isPrivacyMode = false;

// Currency symbol mapping
const currencyMap = {
  '$': 'USD',
  '€': 'EUR',
  '£': 'GBP',
  '₦': 'NGN',
  '₹': 'INR'
};

// --- DOM ELEMENTS ---
const openModalBtn = document.getElementById('openModalBtn');
const closeModalBtn = document.getElementById('closeModalBtn');
const cancelBtn = document.getElementById('cancelBtn');
const transactionModal = document.getElementById('transactionModal');
const transactionForm = document.getElementById('transactionForm');
const modalTitle = document.getElementById('modalTitle');
const submitModalBtn = document.getElementById('submitModalBtn');

const totalBalanceEl = document.getElementById('totalBalance');
const totalIncomeEl = document.getElementById('totalIncome');
const totalExpensesEl = document.getElementById('totalExpenses');
const totalSavingsEl = document.getElementById('totalSavings');

const transactionList = document.getElementById('transactionList');
const dashboardRecentList = document.getElementById('dashboardRecentList');
const currencySelect = document.getElementById('currencySelect');
const categoryFilter = document.getElementById('categoryFilter');
const searchInput = document.getElementById('searchInput');

// Settings Controls
const clearDataBtn = document.getElementById('clearDataBtn');
const themeSelect = document.getElementById('themeSelect');
const privacyToggle = document.getElementById('privacyToggle');
const exportCsvBtn = document.getElementById('exportCsvBtn');
const exportJsonBtn = document.getElementById('exportJsonBtn');
const importJsonInput = document.getElementById('importJsonInput');

// Navigation Elements
const navLinks = document.querySelectorAll('.nav-link');
const contentSections = document.querySelectorAll('.content-section');
const viewAllTxBtn = document.getElementById('viewAllTxBtn');
const pageTitle = document.getElementById('pageTitle');
const pageSubtitle = document.getElementById('pageSubtitle');
const menuToggleBtn = document.getElementById('menuToggleBtn');
const closeSidebarBtn = document.getElementById('closeSidebarBtn');
const sidebar = document.getElementById('sidebar');
const sidebarBackdrop = document.getElementById('sidebarBackdrop');

// --- FORMATTING HELPERS ---
function formatCurrency(amount) {
  return amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function convertAmount(amountInUSD) {
  const rate = exchangeRates[currentCurrencyCode] || 1;
  return amountInUSD * rate;
}

// Fetch live rates from free API
async function fetchExchangeRates() {
  try {
    const response = await fetch('https://open.er-api.com/v6/latest/USD');
    const data = await response.json();
    if (data && data.rates) {
      exchangeRates = data.rates;
    }
  } catch (error) {
    console.error('Failed to fetch exchange rates, using default:', error);
  }
}

// --- STORAGE MANAGEMENT ---
function saveTransactionsToStorage() {
  localStorage.setItem('spendwise_transactions', JSON.stringify(transactions));
}

function loadTransactionsFromStorage() {
  const savedData = localStorage.getItem('spendwise_transactions');
  if (savedData) {
    try {
      transactions = JSON.parse(savedData);
    } catch (e) {
      console.error('Failed to parse transactions:', e);
      transactions = [];
    }
  }
}

// --- THEME & PRIVACY ---
function applyTheme(theme) {
  if (theme === 'dark') {
    document.body.classList.add('dark-theme');
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.body.classList.remove('dark-theme');
    document.documentElement.setAttribute('data-theme', 'light');
  }
  updateChart();
  updateTrendChart();
}

function loadSettingsFromStorage() {
  // Theme
  const savedTheme = localStorage.getItem('spendwise_theme') || 'light';
  applyTheme(savedTheme);
  if (themeSelect) themeSelect.value = savedTheme;

  // Privacy
  isPrivacyMode = localStorage.getItem('spendwise_privacy') === 'true';
  if (privacyToggle) privacyToggle.checked = isPrivacyMode;
}

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
  loadTransactionsFromStorage();
  loadSettingsFromStorage();
  initChart();
  initTrendChart();
  await fetchExchangeRates();
  updateUI();
});

// --- UI REFRESH ROUTINE ---
function updateUI() {
  calculateMetrics();
  renderTransactions();
  renderRecentActivity();
  updateChart();
  updateTrendChart();
  renderAnalyticsCategories();
}

// --- CALCULATE METRICS ---
function calculateMetrics() {
  if (isPrivacyMode) {
    totalBalanceEl.textContent = `${currentCurrency}••••••`;
    totalIncomeEl.textContent = `+${currentCurrency}••••••`;
    totalExpensesEl.textContent = `-${currentCurrency}••••••`;
    if (totalSavingsEl) totalSavingsEl.textContent = `+${currentCurrency}••••••`;
    return;
  }

  const incomeUSD = transactions.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
  const expensesUSD = transactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);
  const savingsUSD = transactions.filter(t => t.type === 'savings').reduce((sum, t) => sum + t.amount, 0);
  
  // Balance accounts for income minus expenses and money moved to savings out of daily funds
  const balanceUSD = incomeUSD - expensesUSD - savingsUSD;

  const convertedBalance = convertAmount(balanceUSD);
  const convertedIncome = convertAmount(incomeUSD);
  const convertedExpenses = convertAmount(expensesUSD);
  const convertedSavings = convertAmount(savingsUSD);

  totalBalanceEl.textContent = `${currentCurrency}${formatCurrency(convertedBalance)}`;
  totalIncomeEl.textContent = `+${currentCurrency}${formatCurrency(convertedIncome)}`;
  totalExpensesEl.textContent = `-${currentCurrency}${formatCurrency(convertedExpenses)}`;
  if (totalSavingsEl) totalSavingsEl.textContent = `+${currentCurrency}${formatCurrency(convertedSavings)}`;
}

// --- RENDER TABLES ---
function renderTransactions() {
  const filterValue = categoryFilter ? categoryFilter.value : 'All';
  const searchTerm = searchInput ? searchInput.value.toLowerCase() : '';

  const filtered = transactions.filter(t => {
    const matchesCategory = filterValue === 'All' || t.category === filterValue;
    const matchesSearch = t.description.toLowerCase().includes(searchTerm);
    return matchesCategory && matchesSearch;
  });

  transactionList.innerHTML = '';

  if (filtered.length === 0) {
    transactionList.innerHTML = `<tr><td colspan="5" style="text-align:center; color: var(--text-muted); padding: 1.5rem;">No transactions found.</td></tr>`;
    return;
  }

  filtered.forEach(t => {
    const tr = document.createElement('tr');
    const isIncome = t.type === 'income';
    const isSavings = t.type === 'savings';
    
    let amountSign = '-';
    let amountClass = 'text-danger';
    
    if (isIncome) {
      amountSign = '+';
      amountClass = 'text-success';
    } else if (isSavings) {
      amountSign = '+';
      amountClass = ''; // styled distinct or neutral
    }

    const convertedValue = convertAmount(t.amount);
    const savingsColorStyle = isSavings ? 'color: #8b5cf6; font-weight: 600;' : '';

    tr.innerHTML = `
      <td><strong>${t.description}</strong></td>
      <td><span class="badge">${t.category}</span></td>
      <td>${t.date}</td>
      <td class="${amountClass}" style="${savingsColorStyle}">${amountSign}${currentCurrency}${formatCurrency(convertedValue)}</td>
      <td class="text-right">
        <button onclick="openEditModal(${t.id})" class="btn" style="padding: 0.25rem 0.5rem; background: transparent; color: var(--primary);" title="Edit">✏️</button>
        <button onclick="deleteTransaction(${t.id})" class="btn" style="padding: 0.25rem 0.5rem; background: transparent; color: var(--danger-color);" title="Delete">🗑️</button>
      </td>
    `;
    transactionList.appendChild(tr);
  });
}

function renderRecentActivity() {
  dashboardRecentList.innerHTML = '';
  const recent = [...transactions].slice(-4).reverse();

  if (recent.length === 0) {
    dashboardRecentList.innerHTML = `<tr><td colspan="3" style="text-align:center; color: var(--text-muted); padding: 1rem;">No recent transactions.</td></tr>`;
    return;
  }

  recent.forEach(t => {
    const tr = document.createElement('tr');
    const isIncome = t.type === 'income';
    const isSavings = t.type === 'savings';
    
    let amountSign = '-';
    let amountClass = 'text-danger';
    
    if (isIncome) {
      amountSign = '+';
      amountClass = 'text-success';
    } else if (isSavings) {
      amountSign = '+';
      amountClass = '';
    }

    const convertedValue = convertAmount(t.amount);
    const savingsColorStyle = isSavings ? 'color: #8b5cf6; font-weight: 600;' : '';

    tr.innerHTML = `
      <td>${t.description}</td>
      <td><span class="badge">${t.category}</span></td>
      <td class="text-right ${amountClass}" style="${savingsColorStyle}">${amountSign}${currentCurrency}${formatCurrency(convertedValue)}</td>
    `;
    dashboardRecentList.appendChild(tr);
  });
}

// --- ANALYTICS CATEGORY BREAKDOWN PROGRESS LIST ---
function renderAnalyticsCategories() {
  const container = document.getElementById('analyticsCategoryList');
  if (!container) return;

  container.innerHTML = '';
  // Expenses only for breakdown chart accuracy
  const expenses = transactions.filter(t => t.type === 'expense');
  
  if (expenses.length === 0) {
    container.innerHTML = `<p style="color: var(--text-muted); font-size: 0.875rem;">No expense data available for breakdown.</p>`;
    return;
  }

  const categoryTotals = {};
  let totalExpenseSum = 0;

  expenses.forEach(t => {
    const val = convertAmount(t.amount);
    categoryTotals[t.category] = (categoryTotals[t.category] || 0) + val;
    totalExpenseSum += val;
  });

  Object.keys(categoryTotals).forEach(cat => {
    const catSum = categoryTotals[cat];
    const percentage = totalExpenseSum > 0 ? Math.round((catSum / totalExpenseSum) * 100) : 0;

    const itemWrapper = document.createElement('div');
    itemWrapper.innerHTML = `
      <div style="display: flex; justify-content: space-between; font-size: 0.875rem; margin-bottom: 0.3rem;">
        <span style="font-weight: 500; color: var(--text-dark, #111827);">${cat}</span>
        <span style="color: var(--text-muted, #6b7280);">${currentCurrency}${formatCurrency(catSum)} (${percentage}%)</span>
      </div>
      <div style="width: 100%; background: var(--border-color, #e5e7eb); height: 8px; border-radius: 4px; overflow: hidden;">
        <div style="width: ${percentage}%; background: var(--primary, #4f46e5); height: 100%; border-radius: 4px;"></div>
      </div>
    `;
    container.appendChild(itemWrapper);
  });
}

// --- ADD / EDIT / DELETE ---
transactionForm.addEventListener('submit', (e) => {
  e.preventDefault();

  const description = document.getElementById('txDescription').value;
  const inputAmount = parseFloat(document.getElementById('txAmount').value);
  const type = document.getElementById('txType').value;
  const category = document.getElementById('txCategory').value;
  const date = document.getElementById('txDate').value || new Date().toISOString().split('T')[0];

  const rate = exchangeRates[currentCurrencyCode] || 1;
  const amountInUSD = inputAmount / rate;

  if (editingTransactionId !== null) {
    const index = transactions.findIndex(t => t.id === editingTransactionId);
    if (index !== -1) {
      transactions[index] = { id: editingTransactionId, description, amount: amountInUSD, type, category, date };
    }
  } else {
    transactions.push({ id: Date.now(), description, amount: amountInUSD, type, category, date });
  }

  saveTransactionsToStorage();
  updateUI();
  closeModal();
});

window.openEditModal = function(id) {
  const transaction = transactions.find(t => t.id === id);
  if (!transaction) return;

  editingTransactionId = id;
  modalTitle.textContent = 'Edit Transaction';
  submitModalBtn.textContent = 'Save Changes';

  const convertedValue = convertAmount(transaction.amount);

  document.getElementById('txDescription').value = transaction.description;
  document.getElementById('txAmount').value = convertedValue.toFixed(2);
  document.getElementById('txType').value = transaction.type;
  document.getElementById('txCategory').value = transaction.category;
  document.getElementById('txDate').value = transaction.date;

  transactionModal.classList.add('active');
};

window.deleteTransaction = function(id) {
  transactions = transactions.filter(t => t.id !== id);
  saveTransactionsToStorage();
  updateUI();
};

// --- DATA EXPORT & IMPORT ---
if (exportCsvBtn) {
  exportCsvBtn.addEventListener('click', () => {
    if (transactions.length === 0) return alert("No transactions available to export.");

    const headers = ["ID", "Description", "Category", "Type", "Amount (USD)", "Date"];
    const rows = transactions.map(t => [
      t.id,
      `"${t.description.replace(/"/g, '""')}"`,
      `"${t.category}"`,
      t.type,
      t.amount.toFixed(2),
      t.date
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
    const link = document.createElement("a");
    link.setAttribute("href", encodeURI(csvContent));
    link.setAttribute("download", `spendwise_export_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
  });
}

if (exportJsonBtn) {
  exportJsonBtn.addEventListener('click', () => {
    if (transactions.length === 0) return alert("No transaction data to back up.");
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(transactions, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `spendwise_backup_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  });
}

if (importJsonInput) {
  importJsonInput.addEventListener('change', (e) => {
    const fileReader = new FileReader();
    fileReader.onload = (event) => {
      try {
        const importedData = JSON.parse(event.target.result);
        if (Array.isArray(importedData)) {
          transactions = importedData;
          saveTransactionsToStorage();
          updateUI();
          alert("Backup restored successfully!");
        } else {
          alert("Invalid backup file structure.");
        }
      } catch (err) {
        alert("Error reading JSON file.");
      }
    };
    if (e.target.files[0]) fileReader.readAsText(e.target.files[0]);
  });
}

// --- SETTINGS CONTROLS ---
if (privacyToggle) {
  privacyToggle.addEventListener('change', (e) => {
    isPrivacyMode = e.target.checked;
    localStorage.setItem('spendwise_privacy', isPrivacyMode ? 'true' : 'false');
    calculateMetrics();
  });
}

if (themeSelect) {
  themeSelect.addEventListener('change', (e) => {
    const theme = e.target.value;
    applyTheme(theme);
    localStorage.setItem('spendwise_theme', theme);
  });
}

if (clearDataBtn) {
  clearDataBtn.addEventListener('click', () => {
    if (confirm("Are you sure you want to clear all data? This cannot be undone.")) {
      localStorage.removeItem('spendwise_transactions');
      transactions = [];
      updateUI();
      alert("All data cleared.");
    }
  });
}

// --- CHART.JS (EXPENSE DONUT CHART) ---
function initChart() {
  const canvas = document.getElementById('expenseChart');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  expenseChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: [],
      datasets: [{
        data: [],
        backgroundColor: ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899']
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { color: '#1e293b' } }
      }
    }
  });
}

function updateChart() {
  if (!expenseChart) return;

  const expenses = transactions.filter(t => t.type === 'expense');
  const categories = {};

  expenses.forEach(t => {
    const convertedVal = convertAmount(t.amount);
    categories[t.category] = (categories[t.category] || 0) + convertedVal;
  });

  const labels = Object.keys(categories);
  const data = Object.values(categories);

  if (labels.length === 0) {
    expenseChart.data.labels = ['No Expenses'];
    expenseChart.data.datasets[0].data = [1];
    expenseChart.data.datasets[0].backgroundColor = ['#e2e8f0'];
  } else {
    expenseChart.data.labels = labels;
    expenseChart.data.datasets[0].data = data;
    expenseChart.data.datasets[0].backgroundColor = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
  }

  const isDark = document.body.classList.contains('dark-theme');
  if (expenseChart.options.plugins.legend) {
    expenseChart.options.plugins.legend.labels.color = isDark ? '#f8fafc' : '#1e293b';
  }

  expenseChart.update();
}

// --- CHART.JS (ANALYTICS TREND LINE CHART) ---
function initTrendChart() {
  const canvas = document.getElementById('trendChart');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  trendChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: ['Month -5', 'Month -4', 'Month -3', 'Month -2', 'Last Month', 'This Month'],
      datasets: [
        {
          label: 'Income',
          data: [0, 0, 0, 0, 0, 0],
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          fill: true,
          tension: 0.3
        },
        {
          label: 'Expenses',
          data: [0, 0, 0, 0, 0, 0],
          borderColor: '#ef4444',
          backgroundColor: 'rgba(239, 68, 68, 0.1)',
          fill: true,
          tension: 0.3
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { color: '#1e293b' } }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#6b7280' } },
        y: { ticks: { color: '#6b7280' } }
      }
    }
  });
}

function updateTrendChart() {
  if (!trendChart) return;

  let totalInc = 0;
  let totalExp = 0;

  transactions.forEach(t => {
    const val = convertAmount(t.amount);
    if (t.type === 'income') totalInc += val;
    else if (t.type === 'expense') totalExp += val;
  });

  trendChart.data.datasets[0].data = [
    Math.round(totalInc * 0.5), 
    Math.round(totalInc * 0.7), 
    Math.round(totalInc * 0.8), 
    Math.round(totalInc * 0.6), 
    Math.round(totalInc * 0.9), 
    Math.round(totalInc)
  ];

  trendChart.data.datasets[1].data = [
    Math.round(totalExp * 0.4), 
    Math.round(totalExp * 0.6), 
    Math.round(totalExp * 0.5), 
    Math.round(totalExp * 0.8), 
    Math.round(totalExp * 0.7), 
    Math.round(totalExp)
  ];

  const isDark = document.body.classList.contains('dark-theme');
  if (trendChart.options.plugins.legend) {
    trendChart.options.plugins.legend.labels.color = isDark ? '#f8fafc' : '#1e293b';
  }

  trendChart.update();
}

// --- EVENT LISTENERS & NAVIGATION ---
currencySelect.addEventListener('change', (e) => {
  currentCurrency = e.target.value;
  currentCurrencyCode = currencyMap[currentCurrency] || 'USD';
  updateUI();
});

if (categoryFilter) categoryFilter.addEventListener('change', renderTransactions);
if (searchInput) searchInput.addEventListener('input', renderTransactions);

openModalBtn.addEventListener('click', () => {
  editingTransactionId = null;
  modalTitle.textContent = 'Add New Transaction';
  submitModalBtn.textContent = 'Add Transaction';
  transactionForm.reset();
  transactionModal.classList.add('active');
});

closeModalBtn.addEventListener('click', closeModal);
cancelBtn.addEventListener('click', closeModal);

function closeModal() {
  transactionModal.classList.remove('active');
  editingTransactionId = null;
  transactionForm.reset();
}

// Tab Switching
navLinks.forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const targetId = link.getAttribute('data-target');

    navLinks.forEach(l => l.classList.remove('active'));
    contentSections.forEach(s => s.classList.remove('active'));

    link.classList.add('active');
    document.getElementById(targetId).classList.add('active');

    const titleText = link.textContent.trim();
    pageTitle.textContent = titleText;
    pageSubtitle.textContent = `Manage your ${titleText.toLowerCase()} options.`;

    closeMobileSidebar();
  });
});

if (viewAllTxBtn) {
  viewAllTxBtn.addEventListener('click', (e) => {
    e.preventDefault();
    document.querySelector('[data-target="transactionsSection"]').click();
  });
}

// Mobile Sidebar
menuToggleBtn.addEventListener('click', () => {
  sidebar.classList.add('open');
  sidebarBackdrop.classList.add('active');
});

closeSidebarBtn.addEventListener('click', closeMobileSidebar);
sidebarBackdrop.addEventListener('click', closeMobileSidebar);

function closeMobileSidebar() {
  sidebar.classList.remove('open');
  sidebarBackdrop.classList.remove('active');
}