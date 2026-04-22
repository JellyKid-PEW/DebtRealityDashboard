// calculations.js
// Pure functions only — no React, no side effects, no I/O.
// All functions take plain data arrays matching the app's data models.

// ─── FREQUENCY NORMALIZATION ──────────────────────────────────────────────────

/**
 * Convert any income/expense amount to a monthly equivalent.
 * Multipliers: weekly × 4.33, biweekly × 2.17, monthly × 1, annual ÷ 12
 *
 * @param {number} amount
 * @param {"weekly"|"biweekly"|"monthly"|"annual"} frequency
 * @returns {number}
 */
export function normalizeToMonthly(amount, frequency) {
  const multipliers = {
    weekly:   4.33,
    biweekly: 2.17,
    monthly:  1,
    annual:   1 / 12,
  };
  const multiplier = multipliers[frequency] ?? 1;
  return (amount ?? 0) * multiplier;
}

// ─── INCOME ───────────────────────────────────────────────────────────────────

/**
 * Total monthly income across all income sources.
 *
 * @param {Array<{amount: number, frequency: string}>} incomes
 * @returns {number}
 */
export function calcMonthlyIncome(incomes) {
  return (incomes ?? []).reduce(
    (sum, income) => sum + normalizeToMonthly(income.amount, income.frequency),
    0
  );
}

// ─── DEBT TOTALS ──────────────────────────────────────────────────────────────

/**
 * Sum of all credit card balances.
 *
 * @param {Array<{balance: number}>} cards
 * @returns {number}
 */
export function calcTotalCreditCardDebt(cards) {
  return (cards ?? []).reduce((sum, card) => sum + (card.balance ?? 0), 0);
}

/**
 * Sum of all loan balances.
 *
 * @param {Array<{balance: number}>} loans
 * @returns {number}
 */
export function calcTotalLoanDebt(loans) {
  return (loans ?? []).reduce((sum, loan) => sum + (loan.balance ?? 0), 0);
}

/**
 * Combined credit card + loan balances.
 *
 * @param {Array<{balance: number}>} cards
 * @param {Array<{balance: number}>} loans
 * @returns {number}
 */
export function calcTotalDebt(cards, loans) {
  return calcTotalCreditCardDebt(cards) + calcTotalLoanDebt(loans);
}

// ─── MONTHLY PAYMENTS ─────────────────────────────────────────────────────────

/**
 * Sum of minimum required card payments.
 *
 * @param {Array<{minPayment: number}>} cards
 * @returns {number}
 */
export function calcTotalMinCardPayments(cards) {
  return (cards ?? []).reduce((sum, card) => sum + (card.minPayment ?? 0), 0);
}

/**
 * Sum of all loan monthly payments.
 *
 * @param {Array<{monthlyPayment: number}>} loans
 * @returns {number}
 */
export function calcTotalLoanPayments(loans) {
  return (loans ?? []).reduce((sum, loan) => sum + (loan.monthlyPayment ?? 0), 0);
}

/**
 * Total monthly debt obligation: min card payments + loan payments.
 * Use this for DTI and cash-flow calculations — represents the floor
 * of what must leave the account each month.
 *
 * @param {Array<{minPayment: number}>} cards
 * @param {Array<{monthlyPayment: number}>} loans
 * @returns {number}
 */
export function calcTotalDebtObligation(cards, loans) {
  return calcTotalMinCardPayments(cards) + calcTotalLoanPayments(loans);
}

// ─── CARD FLOW ────────────────────────────────────────────────────────────────

/**
 * Total new charges being put on cards each month.
 *
 * @param {Array<{monthlySpend: number}>} cards
 * @returns {number}
 */
export function calcTotalCardSpend(cards) {
  return (cards ?? []).reduce((sum, card) => sum + (card.monthlySpend ?? 0), 0);
}

/**
 * Total amount actually being paid toward cards each month
 * (may exceed minPayment if the user is paying more).
 *
 * @param {Array<{monthlyPayment: number}>} cards
 * @returns {number}
 */
export function calcTotalCardPayments(cards) {
  return (cards ?? []).reduce((sum, card) => sum + (card.monthlyPayment ?? 0), 0);
}

/**
 * Net monthly change in card balances from spend vs payments alone
 * (before interest accrual).
 * Positive = balances growing from usage, negative = shrinking.
 *
 * @param {Array<{monthlySpend: number, monthlyPayment: number}>} cards
 * @returns {number}
 */
export function calcNetCardChange(cards) {
  return calcTotalCardSpend(cards) - calcTotalCardPayments(cards);
}

// ─── INTEREST ─────────────────────────────────────────────────────────────────

/**
 * Total monthly interest accruing across all credit cards.
 * Uses promoApr when present and non-zero, otherwise falls back to apr.
 * Formula: balance × effectiveApr / 100 / 12
 *
 * @param {Array<{balance: number, apr: number, promoApr?: number}>} cards
 * @returns {number}
 */
export function calcCardInterest(cards) {
  return (cards ?? []).reduce((sum, card) => {
    const effectiveApr = (card.promoApr != null && card.promoApr !== "" && Number(card.promoApr) > 0)
      ? Number(card.promoApr)
      : (card.apr ?? 0);
    return sum + ((card.balance ?? 0) * effectiveApr / 100 / 12);
  }, 0);
}

// ─── EXPENSES ─────────────────────────────────────────────────────────────────

/**
 * Total monthly living expenses (normalized from any frequency).
 *
 * @param {Array<{amount: number, frequency: string}>} expenses
 * @returns {number}
 */
export function calcMonthlyExpenses(expenses) {
  return (expenses ?? []).reduce(
    (sum, expense) => sum + normalizeToMonthly(expense.amount, expense.frequency),
    0
  );
}

// ─── CASH FLOW ────────────────────────────────────────────────────────────────

/**
 * Net monthly cash flow after expenses and minimum debt obligations.
 * Formula: monthlyIncome − monthlyExpenses − totalDebtObligation
 * Negative = household is spending more than it earns.
 *
 * @param {Array} incomes
 * @param {Array} expenses
 * @param {Array} cards
 * @param {Array} loans
 * @returns {number}
 */
export function calcCashFlow(incomes, expenses, cards, loans) {
  return (
    calcMonthlyIncome(incomes) -
    calcMonthlyExpenses(expenses) -
    calcTotalDebtObligation(cards, loans)
  );
}

// ─── DEBT DIRECTION ───────────────────────────────────────────────────────────

/**
 * Net change in card debt per month, factoring in both spend/payment
 * flow AND interest accrual.
 *
 * direction:
 *   "increasing"  → net change > +$10  (debt is growing)
 *   "flat"        → within ±$10 of zero
 *   "decreasing"  → net change < -$10  (debt is shrinking)
 *
 * @param {Array} cards
 * @returns {{ amount: number, direction: "increasing"|"flat"|"decreasing" }}
 */
export function calcNetDebtChange(cards) {
  const amount = calcNetCardChange(cards) + calcCardInterest(cards);

  let direction;
  if (amount > 10) {
    direction = "increasing";
  } else if (amount < -10) {
    direction = "decreasing";
  } else {
    direction = "flat";
  }

  return { amount, direction };
}

// ─── RATIOS ───────────────────────────────────────────────────────────────────

/**
 * Debt-to-income ratio: totalDebtObligation / monthlyIncome.
 * Returns 0 when income is zero to avoid division-by-zero.
 * Expressed as a decimal (0.43 = 43%).
 *
 * @param {Array} cards
 * @param {Array} loans
 * @param {Array} incomes
 * @returns {number}
 */
export function calcDTI(cards, loans, incomes) {
  const monthlyIncome = calcMonthlyIncome(incomes);
  if (monthlyIncome === 0) return 0;
  return calcTotalDebtObligation(cards, loans) / monthlyIncome;
}

/**
 * Credit utilization ratio: sum(balance) / sum(limit).
 * Cards with no limit (0 or missing) are excluded from the limit total
 * to avoid artificially deflating utilization.
 * Returns 0 when total limit is zero.
 * Expressed as a decimal (0.30 = 30%).
 *
 * @param {Array<{balance: number, limit: number}>} cards
 * @returns {number}
 */
export function calcUtilization(cards) {
  const safeCards = cards ?? [];
  const totalBalance = safeCards.reduce((sum, card) => sum + (card.balance ?? 0), 0);
  const totalLimit = safeCards.reduce((sum, card) => sum + (card.limit ?? 0), 0);
  if (totalLimit === 0) return 0;
  return totalBalance / totalLimit;
}

// ─── ALERTS ───────────────────────────────────────────────────────────────────

/**
 * Generate an array of active alerts based on the full app state.
 * Each alert has a stable id (for React keying), a human-readable label,
 * and a severity level.
 *
 * Thresholds:
 *   - netDebtChange > 0           → "Increasing Debt"       (warning)
 *   - DTI > 0.4                   → "High Debt Load"        (danger)
 *   - utilization > 0.7           → "High Utilization"      (warning)
 *   - totalCardSpend > totalCardPayments → "Spending More Than Paying" (warning)
 *   - cashFlow < 0                → "Limited Margin"        (danger)
 *
 * @param {{ incomes: Array, creditCards: Array, loans: Array, expenses: Array }} state
 * @returns {Array<{ id: string, label: string, severity: "warning"|"danger" }>}
 */
export function calcAlerts(state) {
  const { incomes = [], creditCards = [], loans = [], expenses = [] } = state;
  const alerts = [];

  const { direction } = calcNetDebtChange(creditCards);
  if (direction === "increasing") {
    alerts.push({
      id: "increasing-debt",
      label: "Increasing Debt",
      severity: "warning",
    });
  }

  if (calcDTI(creditCards, loans, incomes) > 0.4) {
    alerts.push({
      id: "high-dti",
      label: "High Debt Load",
      severity: "danger",
    });
  }

  if (calcUtilization(creditCards) > 0.7) {
    alerts.push({
      id: "high-utilization",
      label: "High Utilization",
      severity: "warning",
    });
  }

  if (calcTotalCardSpend(creditCards) > calcTotalCardPayments(creditCards)) {
    alerts.push({
      id: "spend-exceeds-payment",
      label: "Spending More Than Paying",
      severity: "warning",
    });
  }

  if (calcCashFlow(incomes, expenses, creditCards, loans) < 0) {
    alerts.push({
      id: "limited-margin",
      label: "Limited Margin",
      severity: "danger",
    });
  }

  return alerts;
}

// ─── COMBINED ENTRY POINT ─────────────────────────────────────────────────────

/**
 * Run all calculations against the full app state in one call.
 * Ideal for use in a React useMemo or selector — call once, destructure
 * what you need. All values are recomputed from scratch with no caching.
 *
 * @param {{ incomes: Array, creditCards: Array, loans: Array, expenses: Array, assets: Array }} state
 * @returns {{
 *   monthlyIncome: number,
 *   totalCreditCardDebt: number,
 *   totalLoanDebt: number,
 *   totalDebt: number,
 *   totalMinCardPayments: number,
 *   totalLoanPayments: number,
 *   totalDebtObligation: number,
 *   totalCardSpend: number,
 *   totalCardPayments: number,
 *   netCardChange: number,
 *   cardInterest: number,
 *   monthlyExpenses: number,
 *   cashFlow: number,
 *   netDebtChange: { amount: number, direction: "increasing"|"flat"|"decreasing" },
 *   dti: number,
 *   utilization: number,
 *   alerts: Array<{ id: string, label: string, severity: "warning"|"danger" }>
 * }}
 */
export function calcAll(state) {
  const { incomes = [], creditCards = [], loans = [], expenses = [] } = state;

  return {
    // Income
    monthlyIncome:        calcMonthlyIncome(incomes),

    // Debt totals
    totalCreditCardDebt:  calcTotalCreditCardDebt(creditCards),
    totalLoanDebt:        calcTotalLoanDebt(loans),
    totalDebt:            calcTotalDebt(creditCards, loans),

    // Monthly payments
    totalMinCardPayments: calcTotalMinCardPayments(creditCards),
    totalLoanPayments:    calcTotalLoanPayments(loans),
    totalDebtObligation:  calcTotalDebtObligation(creditCards, loans),

    // Card flow
    totalCardSpend:       calcTotalCardSpend(creditCards),
    totalCardPayments:    calcTotalCardPayments(creditCards),
    netCardChange:        calcNetCardChange(creditCards),

    // Interest
    cardInterest:         calcCardInterest(creditCards),

    // Expenses
    monthlyExpenses:      calcMonthlyExpenses(expenses),

    // Cash flow
    cashFlow:             calcCashFlow(incomes, expenses, creditCards, loans),

    // Debt direction
    netDebtChange:        calcNetDebtChange(creditCards),

    // Ratios
    dti:                  calcDTI(creditCards, loans, incomes),
    utilization:          calcUtilization(creditCards),

    // Alerts
    alerts:               calcAlerts(state),
  };
}
