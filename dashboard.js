document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const modal = document.getElementById('transactionModal');
  const modalTitle = document.getElementById('modalTitle');
  const submitModalBtn = document.getElementById('submitModalBtn');
  const openModalBtn = document.getElementById('openModalBtn');
  const closeModalBtn = document.getElementById('closeModalBtn');
  const cancelBtn = document.getElementById('cancelBtn');
  const transactionForm = document.getElementById('transactionForm');
  const transactionList = document.getElementById('transactionList');
  const dashboardRecentList = document.getElementById('dashboardRecentList');
  const viewAllTxBtn = document.getElementById('viewAllTxBtn');
  const currencySelect = document.getElementById('currencySelect');
  const categoryFilter = document.getElementById('categoryFilter');
  const searchInput = document.getElementById('searchInput');
  const themeSelect = document.getElementById('themeSelect');

  const totalBalanceEl = document.getElementById('totalBalance');
  const totalIncomeEl = document.getElementById('totalIncome');
  const totalExpensesEl = document.getElementById('totalExpenses');

  const pageTitle = document.getElementById('pageTitle');
  const pageSubtitle = document.getElementById('pageSubtitle');
  const navLinks = document.querySelectorAll('.nav-link');
  const contentSections = document.querySelectorAll('.content-section');

  // Chart Instance variable
  let expenseChartInstance = null;

  // Exchange Rates (Base: USD = 1.0)
  const exchangeRates = {
    '$': 1.0,
    '€': 0.92,
    '£': 0.79,
    '₦': 1500.0,
    '₹': 83.0
  };

  // Header Titles Map
  const headersMap = {
    dashboardSection: {
      title: 'Dashboard',
      subtitle: 'Welcome back! Here is your financial summary.'
    },
    transactionsSection: {
      title: 'Transactions',
      subtitle: 'Manage and search through all your income and expenses.'
    },
    analyticsSection: {
      title: 'Analytics',
      subtitle: 'Analyze your spending behavior over time.'
    },
    settingsSection: {
      title: 'Settings',
      subtitle: 'Manage your app preferences and configurations.'
    }
  };

  // State Variables
  let editingTransactionId = null;
  let searchQuery = '';
  let currentCurrency = currencySelect?.value || '$';
  let selectedCategory = categoryFilter?.value || 'All';

  // Load Theme Preference
  const savedTheme = localStorage.getItem('spendwise_theme') || 'light';
  document.documentElement.setAttribute('data-theme', savedTheme);
  if (themeSelect) themeSelect.value = savedTheme;

  themeSelect?.addEventListener('change', (e) => {
    const newTheme = e.target.value;
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('spendwise_theme', newTheme);
    updateDashboard(); // Re-render chart text colors for dark/light contrast
  });

  // Load Saved LocalStorage Data
  let transactions = [];
  try {
    const savedData = localStorage.getItem('spendwise_transactions');
    transactions = savedData ? JSON.parse(savedData) : [];
    if (!Array.isArray(transactions)) transactions = [];
  } catch (e) {
    console.error('Error reading localStorage:', e);
    transactions = [];
  }

  // Number Formatter
  const formatNumber = (num) => {
    return (Number(num) || 0).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  };

  // LocalStorage Saver
  const saveToStorage = () => {
    try {
      localStorage.setItem('spendwise_transactions', JSON.stringify(transactions));
    } catch (e) {
      console.error('Error saving storage:', e);
    }
  };

  // Sidebar Switcher Handler
  navLinks.forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const targetId = link.getAttribute('data-target');
      if (!targetId) return;

      navLinks.forEach((nav) => nav.classList.remove('active'));
      contentSections.forEach((sec) => sec.classList.remove('active'));

      link.classList.add('active');
      const targetSection = document.getElementById(targetId);
      if (targetSection) targetSection.classList.add('active');

      if (headersMap[targetId]) {
        if (pageTitle) pageTitle.textContent = headersMap[targetId].title;
        if (pageSubtitle) pageSubtitle.textContent = headersMap[targetId].subtitle;
      }
    });
  });

  // Jump from "View All →" on Dashboard to Transactions View
  viewAllTxBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    const txLink = document.querySelector('.nav-link[data-target="transactionsSection"]');
    if (txLink) txLink.click();
  });

  // Filter Event Listeners
  currencySelect?.addEventListener('change', (e) => {
    currentCurrency = e.target.value;
    updateDashboard();
  });

  categoryFilter?.addEventListener('change', (e) => {
    selectedCategory = e.target.value;
    updateDashboard();
  });

  searchInput?.addEventListener('input', (e) => {
    searchQuery = e.target.value.toLowerCase().trim();
    updateDashboard();
  });

  // Modal Controls
  const openModal = () => modal?.classList.add('active');
  const closeModal = () => {
    modal?.classList.remove('active');
    transactionForm?.reset();
    editingTransactionId = null;
    if (modalTitle) modalTitle.textContent = 'Add New Transaction';
    if (submitModalBtn) submitModalBtn.textContent = 'Add Transaction';
  };

  openModalBtn?.addEventListener('click', () => {
    editingTransactionId = null;
    if (modalTitle) modalTitle.textContent = 'Add New Transaction';
    if (submitModalBtn) submitModalBtn.textContent = 'Add Transaction';
    openModal();
  });

  closeModalBtn?.addEventListener('click', closeModal);
  cancelBtn?.addEventListener('click', closeModal);
  window.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  // Open Edit Modal Mode
  const openEditModal = (transaction) => {
    editingTransactionId = transaction.id;
    if (modalTitle) modalTitle.textContent = 'Edit Transaction';
    if (submitModalBtn) submitModalBtn.textContent = 'Save Changes';

    const currentRate = exchangeRates[currentCurrency] || 1.0;
    const displayAmount = transaction.amount * currentRate;

    document.getElementById('txDescription').value = transaction.description;
    document.getElementById('txAmount').value = displayAmount.toFixed(2);
    document.getElementById('txType').value = transaction.type;
    document.getElementById('txCategory').value = transaction.category;
    document.getElementById('txDate').value = transaction.date;

    openModal();
  };

  // Render Chart.js Expense Breakdown Pie Chart
  const renderExpenseChart = (rate) => {
    const ctx = document.getElementById('expenseChart')?.getContext('2d');
    if (!ctx) return;

    // Group only expenses by category
    const categoryTotals = {};
    transactions
      .filter(t => t.type === 'expense')
      .forEach(t => {
        const cat = t.category || 'General';
        const converted = (Number(t.amount) || 0) * rate;
        categoryTotals[cat] = (categoryTotals[cat] || 0) + converted;
      });

    const labels = Object.keys(categoryTotals);
    const data = Object.values(categoryTotals);

    // If no expenses exist, destroy existing chart and exit
    if (labels.length === 0) {
      if (expenseChartInstance) {
        expenseChartInstance.destroy();
        expenseChartInstance = null;
      }
      return;
    }

    const chartColors = [
      '#FF6384',
      '#36A2EB',
      '#FFCE56',
      '#4BC0C0',
      '#9966FF',
      '#FF9F40'
    ];

    const isDarkMode = document.documentElement.getAttribute('data-theme') === 'dark';
    const textColor = isDarkMode ? '#e0e0e0' : '#212529';

    // If chart already exists, update data dynamically
    if (expenseChartInstance) {
      expenseChartInstance.data.labels = labels;
      expenseChartInstance.data.datasets[0].data = data;
      expenseChartInstance.data.datasets[0].backgroundColor = chartColors.slice(0, labels.length);
      expenseChartInstance.options.plugins.legend.labels.color = textColor;
      expenseChartInstance.update();
    } else {
      // Create new Chart instance
      expenseChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: labels,
          datasets: [{
            data: data,
            backgroundColor: chartColors.slice(0, labels.length),
            borderWidth: 1,
            borderColor: isDarkMode ? '#1e1e1e' : '#ffffff'
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'bottom',
              labels: {
                boxWidth: 12,
                font: { size: 11 },
                color: textColor
              }
            },
            tooltip: {
              callbacks: {
                label: function(context) {
                  const val = context.raw || 0;
                  return ` ${context.label}: ${currentCurrency}${formatNumber(val)}`;
                }
              }
            }
          }
        }
      });
    }
  };

  // Update Mini Dashboard Recent Activity Table
  const renderDashboardRecent = (rate) => {
    if (!dashboardRecentList) return;
    dashboardRecentList.innerHTML = '';

    const recentItems = transactions.slice(0, 4);

    if (recentItems.length === 0) {
      dashboardRecentList.innerHTML = `
        <tr>
          <td colspan="3" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">
            No recent activity to show.
          </td>
        </tr>
      `;
      return;
    }

    recentItems.forEach((t) => {
      const isIncome = t.type === 'income';
      const convertedAmount = (Number(t.amount) || 0) * rate;
      const row = document.createElement('tr');

      row.innerHTML = `
        <td>
          <span class="badge ${isIncome ? 'badge-income' : 'badge-expense'}">
            ${isIncome ? '↑' : '↓'}
          </span>
          <span style="margin-left: 0.5rem; font-weight: 500;">${t.description || 'Untitled'}</span>
        </td>
        <td><span class="badge badge-category">${t.category || 'General'}</span></td>
        <td class="${isIncome ? 'text-success' : 'text-danger'} text-right" style="font-weight: 600;">
          ${isIncome ? '+' : '-'}${currentCurrency}${formatNumber(convertedAmount)}
        </td>
      `;
      dashboardRecentList.appendChild(row);
    });
  };

  // Main Render Routine
  const updateDashboard = () => {
    saveToStorage();

    const rate = exchangeRates[currentCurrency] || 1.0;

    // Totals calculations
    const baseIncome = transactions
      .filter(t => t && t.type === 'income')
      .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

    const baseExpenses = transactions
      .filter(t => t && t.type === 'expense')
      .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

    const baseBalance = baseIncome - baseExpenses;

    if (totalBalanceEl) totalBalanceEl.textContent = `${currentCurrency}${formatNumber(baseBalance * rate)}`;
    if (totalIncomeEl) totalIncomeEl.textContent = `+${currentCurrency}${formatNumber(baseIncome * rate)}`;
    if (totalExpensesEl) totalExpensesEl.textContent = `-${currentCurrency}${formatNumber(baseExpenses * rate)}`;

    // Render Dashboard Charts & Tables
    renderExpenseChart(rate);
    renderDashboardRecent(rate);

    if (!transactionList) return;
    transactionList.innerHTML = '';

    // Filter for All Transactions view
    const filteredTransactions = transactions.filter(t => {
      if (!t) return false;
      const matchesCategory = selectedCategory === 'All' || t.category === selectedCategory;
      const matchesSearch = (t.description || '').toLowerCase().includes(searchQuery);
      return matchesCategory && matchesSearch;
    });

    if (filteredTransactions.length === 0) {
      transactionList.innerHTML = `
        <tr>
          <td colspan="5" style="text-align: center; color: var(--text-muted); padding: 2rem;">
            ${transactions.length === 0 
              ? 'No transactions found. Click "+ Add Transaction" to start.' 
              : 'No matching transactions found.'}
          </td>
        </tr>
      `;
      return;
    }

    // Render Full Transactions Table
    filteredTransactions.forEach((t) => {
      const isIncome = t.type === 'income';
      const convertedAmount = (Number(t.amount) || 0) * rate;

      const row = document.createElement('tr');
      row.innerHTML = `
        <td>
          <span class="badge ${isIncome ? 'badge-income' : 'badge-expense'}">
            ${isIncome ? '↑' : '↓'}
          </span>
          <span style="margin-left: 0.5rem; font-weight: 500;">${t.description || 'Untitled'}</span>
        </td>
        <td><span class="badge badge-category">${t.category || 'General'}</span></td>
        <td style="color: var(--text-muted); font-size: 0.875rem;">${t.date || new Date().toISOString().split('T')[0]}</td>
        <td class="${isIncome ? 'text-success' : 'text-danger'}" style="font-weight: 600;">
          ${isIncome ? '+' : '-'}${currentCurrency}${formatNumber(convertedAmount)}
        </td>
        <td class="text-right">
          <button class="btn btn-secondary-outline edit-btn" style="margin-right: 0.25rem;">Edit</button>
          <button class="btn btn-danger-outline delete-btn">Delete</button>
        </td>
      `;

      row.querySelector('.edit-btn')?.addEventListener('click', () => openEditModal(t));

      row.querySelector('.delete-btn')?.addEventListener('click', () => {
        const index = transactions.findIndex(item => item && item.id === t.id);
        if (index !== -1) transactions.splice(index, 1);
        updateDashboard();
      });

      transactionList.appendChild(row);
    });
  };

  // Form Submit Handler
  transactionForm?.addEventListener('submit', (e) => {
    e.preventDefault();

    try {
      const description = document.getElementById('txDescription')?.value || 'Untitled';
      const amountEntered = parseFloat(document.getElementById('txAmount')?.value);
      const type = document.getElementById('txType')?.value || 'expense';
      const category = document.getElementById('txCategory')?.value || 'General';
      const dateInput = document.getElementById('txDate')?.value;

      if (isNaN(amountEntered)) {
        alert('Please enter a valid amount.');
        return;
      }

      const currentRate = exchangeRates[currentCurrency] || 1.0;
      const amountInUSD = amountEntered / currentRate;

      if (editingTransactionId !== null) {
        const index = transactions.findIndex(t => t.id === editingTransactionId);
        if (index !== -1) {
          transactions[index] = {
            id: editingTransactionId,
            description,
            amount: amountInUSD,
            type,
            category,
            date: dateInput || new Date().toISOString().split('T')[0]
          };
        }
      } else {
        transactions.unshift({
          id: Date.now(),
          description,
          amount: amountInUSD,
          type,
          category,
          date: dateInput || new Date().toISOString().split('T')[0]
        });
      }

      updateDashboard();
    } catch (err) {
      console.error('Error submitting form:', err);
    } finally {
      closeModal();
    }
  });

  // Initial Boot
  updateDashboard();
});