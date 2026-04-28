// calculations.js
// Pure functions only â no React, no side effects, no I/O.
// All functions take plain data arrays matching the app's data models.

// âââ FREQUENCY NORMALIZATION ââââââââââââââââââââââââââââââââââââââââââââââââââ

/**
 * Convert any income/expense amount to a monthly equivalent.
 * Multipliers: weekly Ã 4.33, biweekly Ã 2.17, monthly Ã 1, annual Ã· 12
 *
 * @param {number} amount
 * @param {"weekly"|"biweekly"|"monthly"|"annual"} frequency
 * @returns {number}
 */
export function normalizeToMonthly(amount, frequency) {
    const multipliers = {
        weekly: 4.33,
        biweekly: 2.17,
        monthly: 1,
        annual: 1 / 12,
    };
    const multiplier = multipliers[frequency] ?? 1;
    return (amount ?? 0) * multiplier;
}

// âââ INCOME âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

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

// âââ DEBT TOTALS ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

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

// âââ MONTHLY PAYMENTS âââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

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
 * Use this for DTI and cash-flow calculations â represents the floor
 * of what must leave the account each month.
 *
 * @param {Array<{minPayment: number}>} cards
 * @param {Array<{monthlyPayment: number}>} loans
 * @returns {number}
 */
export function calcTotalDebtObligation(cards, loans) {
    return calcTotalMinCardPayments(cards) + calcTotalLoanPayments(loans);
}

// âââ CARD FLOW ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

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

// âââ INTEREST âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

/**
 * Total monthly interest accruing across all credit cards.
 * Uses promoApr when present and non-zero, otherwise falls back to apr.
 * Formula: balance Ã effectiveApr / 100 / 12
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

// âââ EXPENSES âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

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

// âââ CASH FLOW ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

/**
 * Net monthly cash flow after expenses and minimum debt obligations.
 * Formula: monthlyIncome â monthlyExpenses â totalDebtObligation
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

// âââ DEBT DIRECTION âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

/**
 * Net change in card debt per month, factoring in both spend/payment
 * flow AND interest accrual.
 *
 * direction:
 *   "increasing"  â net change > +$10  (debt is growing)
 *   "flat"        â within Â±$10 of zero
 *   "decreasing"  â net change < -$10  (debt is shrinking)
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

// âââ RATIOS âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

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

// âââ ALERTS âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

/**
 * Generate an array of active alerts based on the full app state.
 * Each alert has a stable id (for React keying), a human-readable label,
 * and a severity level.
 *
 * Thresholds:
 *   - netDebtChange > 0           â "Increasing Debt"       (warning)
 *   - DTI > 0.4                   â "High Debt Load"        (danger)
 *   - utilization > 0.7           â "High Utilization"      (warning)
 *   - totalCardSpend > totalCardPayments â "Spending More Than Paying" (warning)
 *   - cashFlow < 0                â "Limited Margin"        (danger)
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

// âââ COMBINED ENTRY POINT âââââââââââââââââââââââââââââââââââââââââââââââââââââ

/**
 * Run all calculations against the full app state in one call.
 * Ideal for use in a React useMemo or selector â call once, destructure
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
// ─── SHARED DEBT NORMALIZATION & RANKING ─────────────────────────────────────
// Single canonical implementation used by both AttackMap and Plan views.
// This ensures both views always show the same attack order.

/**
 * Normalize raw state debts into a consistent shape for ranking and simulation.
 * Computes promoMonthsLeft, currentApr, futureApr, isPromoUrgent, netMonthlyChange.
 */
export function normalizeDebtsForRanking(cards, loans) {
    const now = new Date();
    const nowYear = now.getFullYear();
    const nowMonth = now.getMonth();

    const normalized = [
        ...(cards ?? []).map(c => {
            const regularApr = Number(c.apr) || 0;
            const promoApr = Number(c.promoApr) > 0 ? Number(c.promoApr) : null;

            // Parse promo end date from any field name variant
            let promoEnd = null;
            for (const key of ['promoEnd', 'promoEndDate', 'promoExpiration', 'promoExpirationDate', 'promoExpiry']) {
                if (c[key]) { const d = new Date(c[key]); if (!isNaN(d)) { promoEnd = d; break; } }
            }

            let promoMonthsLeft = null;
            if (promoApr !== null && promoEnd) {
                promoMonthsLeft = Math.max(0,
                    (promoEnd.getFullYear() - nowYear) * 12 + (promoEnd.getMonth() - nowMonth)
                );
            }

            const currentApr = promoApr !== null ? promoApr : regularApr;
            const futureApr = regularApr;
            const isPromoUrgent = promoMonthsLeft !== null && promoMonthsLeft <= 6 && futureApr >= 20;

            const minPayment = Number(c.minPayment) || 0;
            const monthlySpend = Number(c.monthlySpend) || 0;
            const netMonthlyChange = monthlySpend - minPayment; // positive = balance growing

            return {
                id: c.id,
                _type: 'card',
                name: c.name || 'Card',
                balance: Number(c.balance) || 0,
                apr: regularApr,
                promoApr,
                promoEnd,
                promoMonthsLeft,
                currentApr,
                futureApr,
                isPromoUrgent,
                minPayment,
                monthlyPayment: Number(c.monthlyPayment) || minPayment,
                monthlySpend,
                netMonthlyChange,
                limit: Number(c.limit) || 0,
            };
        }),
        ...(loans ?? []).map(l => {
            const monthlyPayment = Number(l.monthlyPayment) || 0;
            const extraPayment = Number(l.extraPayment) || 0;
            const termRemaining = Number(l.termRemainingMonths) || 0;
            // Effective monthly payment = base + extra
            const effectivePayment = monthlyPayment + extraPayment;
            return {
                id: l.id,
                _type: 'loan',
                name: l.name || 'Loan',
                balance: Number(l.balance) || 0,
                apr: Number(l.apr) || 0,
                promoApr: null,
                promoEnd: null,
                promoMonthsLeft: null,
                currentApr: Number(l.apr) || 0,
                futureApr: Number(l.apr) || 0,
                isPromoUrgent: false,
                minPayment: monthlyPayment,
                monthlyPayment: effectivePayment,
                monthlySpend: 0,
                netMonthlyChange: -effectivePayment,
                limit: 0,
                termRemainingMonths: termRemaining,
                extraPayment,
            };
        }),
    ].filter(d => d.balance > 0);

    return normalized;
}

/**
 * Canonical debt ranking — same rules applied everywhere.
 * Priority order:
 *  1. Promo balances expiring ≤6mo resetting to ≥20% APR (soonest first)
 *  2. Highest effective APR
 *  3. Debts actively growing (spend > minimum) get a boost
 *  4. Smaller balance as final tiebreak (quick win)
 *  Never prioritize loans <10% APR while any card APR ≥20% exists.
 */
export function rankDebtsCanonical(debts) {
    const hasHighAprCard = debts.some(d => d._type === 'card' && d.currentApr >= 20);

    return [...debts].sort((a, b) => {
        // Deprioritize low-APR loans when high-APR cards exist
        const aLowLoan = a._type === 'loan' && a.currentApr < 10 && hasHighAprCard;
        const bLowLoan = b._type === 'loan' && b.currentApr < 10 && hasHighAprCard;
        if (aLowLoan && !bLowLoan) return 1;
        if (bLowLoan && !aLowLoan) return -1;

        // Urgent promo debts first
        if (a.isPromoUrgent && !b.isPromoUrgent) return -1;
        if (b.isPromoUrgent && !a.isPromoUrgent) return 1;

        // Both urgent: soonest expiry first
        if (a.isPromoUrgent && b.isPromoUrgent) {
            if (a.promoMonthsLeft !== b.promoMonthsLeft)
                return a.promoMonthsLeft - b.promoMonthsLeft;
        }

        // Growing debt urgency: if one debt is growing and other isn't, growing goes first
        const aGrowing = a.netMonthlyChange > 0;
        const bGrowing = b.netMonthlyChange > 0;
        if (aGrowing && !bGrowing && a.currentApr >= 15) return -1;
        if (bGrowing && !aGrowing && b.currentApr >= 15) return 1;

        // Highest effective APR (allow 1.5% tolerance before tiebreaking by balance)
        const aprDiff = b.currentApr - a.currentApr;
        if (Math.abs(aprDiff) > 1.5) return aprDiff;

        // Close APR: smaller balance first (quick win)
        return a.balance - b.balance;
    });
}

export function calcAll(state) {
    const { incomes = [], creditCards = [], loans = [], expenses = [] } = state;

    return {
        // Income
        monthlyIncome: calcMonthlyIncome(incomes),

        // Debt totals
        totalCreditCardDebt: calcTotalCreditCardDebt(creditCards),
        totalLoanDebt: calcTotalLoanDebt(loans),
        totalDebt: calcTotalDebt(creditCards, loans),

        // Monthly payments
        totalMinCardPayments: calcTotalMinCardPayments(creditCards),
        totalLoanPayments: calcTotalLoanPayments(loans),
        totalDebtObligation: calcTotalDebtObligation(creditCards, loans),

        // Card flow
        totalCardSpend: calcTotalCardSpend(creditCards),
        totalCardPayments: calcTotalCardPayments(creditCards),
        netCardChange: calcNetCardChange(creditCards),

        // Interest
        cardInterest: calcCardInterest(creditCards),

        // Expenses
        monthlyExpenses: calcMonthlyExpenses(expenses),

        // Cash flow
        cashFlow: calcCashFlow(incomes, expenses, creditCards, loans),

        // Debt direction
        netDebtChange: calcNetDebtChange(creditCards),

        // Ratios
        dti: calcDTI(creditCards, loans, incomes),
        utilization: calcUtilization(creditCards),

        // Alerts
        alerts: calcAlerts(state),
    };
}
