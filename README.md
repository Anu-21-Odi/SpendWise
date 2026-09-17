# SpendWise 💸

SpendWise is a sleek, responsive, and feature-rich personal finance tracker designed to help you effortlessly monitor your cash flow, analyze spending habits, and securely manage your budget. Built with modern web technologies and zero heavy frameworks, it offers a fast and private financial overview right in your browser.

---

## 🌟 Features

* **Multi-Currency Support:** Seamlessly switch between currencies (**USD $, EUR €, GBP £, NGN ₦, INR ₹**) with live exchange rate integration.
* **Comprehensive Cash Flow Tracking:** Log and categorize **Income**, **Expenses**, and dedicated **Savings** contributions.
* **Visual Analytics & Insights:** 
  * Interactive Donut chart for expense distribution.
  * 6-month historical trend line chart.
  * Dynamic category progress bars and smart financial insights.
* **Privacy Mode:** Toggle a secure privacy mask (`••••••`) over your balances with a single click when viewing your dashboard in public spaces.
* **Data Portability & Backup:** Export your transaction history to a spreadsheet-ready **CSV** file or download/restore complete system backups via **JSON**.
* **Appearance Customization:** Fully responsive layout with built-in **Light** and **Dark mode** themes.
* **Local-First Storage:** All data is safely stored locally in your browser (`localStorage`), ensuring complete privacy.

---

## 📂 Project Structure

```text
spendwise-budget-app/
├── app.html         # Main application layout and UI structure
├── dashboard.css    # Styling, layout grids, theme variables, and responsive design
└── dashboard.js     # State management, local storage, chart rendering, and currency conversion

🚀 Getting Started
Since SpendWise is a client-side web application, you don't need any complex backend setup or node modules to run it!

Clone or Download this repository to your local machine.

Ensure all three files (app.html, dashboard.css, and dashboard.js) are in the same directory.

Open app.html in any modern web browser (Google Chrome, Firefox, Edge, Safari) to launch the app.

💻 Built With
HTML5 & CSS3 (Custom variables, Flexbox & CSS Grid)

Vanilla JavaScript (ES6+)

Chart.js (Data visualization via CDN)

Open Exchange Rates API (Live multi-currency conversion)

📄 License
This project is open-source and available for personal use and portfolio enhancement.
