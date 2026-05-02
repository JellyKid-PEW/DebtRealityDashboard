/**
 * calculations.js
 *
 * Pure functions only — no React, no side effects, no I/O.
 * All functions accept plain data arrays matching the app data model.
 *
 * Exports:
 *   normalizeToMonthly      — convert any frequency amount to monthly
 *   calcMonthlyIncome       — sum all income sources
 *   normalizeDebtsForRanking — canonical debt shape used by all views
 *   rankDebtsCanonical      — canonical debt priority order used by all views
 *   calcAll                 — convenience wrapper for the App header display
 */

// ─── FREQUENCY NORMALIZATION ───────────────────────────────────────────────────

/**
 * Convert any income or expense amount to its monthly equivalent.
 *
 * Multipliers:
 *   weekly   × 4.33   (52 weeks / 12 months)
 *   biweekly × 2.17   (26 pays / 12 months)
 *   monthly  × 1
 *   annual   ÷ 12
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
    return (amount ?? 0) * (multipliers[frequency] ?? 1);
}

// ─── INCOME ────────────────────────────────────────────────────────────────────

/**
 * Sum all income sources to a combined monthly figure.
 *
 * @param {Array<{amount: number, frequency: string}>} incomes
 * @returns {number}
 */
export function calcMonthlyIncome(incomes) {
    return (incomes ?? []).reduce(
        (sum, inc) => sum + normalizeToMonthly(inc.amount, inc.frequency),
        0
    );
}

// ─── SHARED DEBT NORMALIZATION & RANKING ───────────────────────────────────────
//
// These two functions are the single source of truth for how debts are shaped
// and ordered throughout the app. Every view — AttackMap, Trajectory,
// Scenarios, SummaryView — imports from here. Never duplicate this logic.

/**
 * Normalize raw state debts (credit cards + loans) into a consistent shape
 * for ranking and simulation.
 *
 * Computed fields:
 *   promoMonthsLeft   — months until promo rate expires (null if no promo)
 *   currentApr        — effective APR right now (promo if active, else regular)
 *   futureApr         — APR after promo expires (same as apr for non-promo debts)
 *   isPromoUrgent     — true if promo expires ≤6 months AND future APR ≥ 20%
 *   netMonthlyChange  — monthlySpend − minPayment (positive = balance growing)
 *
 * Handles all known field name variants for promoEnd
 * (promoEnd, promoEndDate, promoExpiration, promoExpirationDate, promoExpiry).
 *
 * @param {Array} cards  — state.creditCards
 * @param {Array} loans  — state.loans
 * @returns {Array}      — filtered to balance > 0, ready for rankDebtsCanonical
 */
export function normalizeDebtsForRanking(cards, loans) {
    const now = new Date();
    const nowYear = now.getFullYear();
    const nowMonth = now.getMonth();

    const normalizedCards = (cards ?? []).map(c => {
        const regularApr = Number(c.apr) || 0;
        const promoApr = Number(c.promoApr) > 0 ? Number(c.promoApr) : null;

        // Accept any of the known promo end date field names
        let promoEnd = null;
        for (const key of ['promoEnd', 'promoEndDate', 'promoExpiration', 'promoExpirationDate', 'promoExpiry']) {
            if (c[key]) {
                const d = new Date(c[key]);
                if (!isNaN(d)) { promoEnd = d; break; }
            }
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
            netMonthlyChange: monthlySpend - minPayment,
            limit: Number(c.limit) || 0,
        };
    });

    const normalizedLoans = (loans ?? []).map(l => {
        const monthlyPayment = Number(l.monthlyPayment) || 0;
        const extraPayment = Number(l.extraPayment) || 0;
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
            termRemainingMonths: Number(l.termRemainingMonths) || 0,
            extraPayment,
        };
    });

    return [...normalizedCards, ...normalizedLoans].filter(d => d.balance > 0);
}

/**
 * Sort debts into canonical attack priority order.
 *
 * Rules (in priority order):
 *  1. Low-APR loans (<10%) are deprioritized when any card APR ≥ 20% exists
 *  2. Promo-urgent debts (expiring ≤6mo, resetting to ≥20% APR) come first,
 *     sorted by soonest expiry
 *  3. Debts actively growing (spend > minimum) get a boost at APR ≥ 15%
 *  4. Highest current APR (with 1.5% tolerance before falling to tiebreak)
 *  5. Smaller balance as final tiebreak (quick win frees cash)
 *
 * @param {Array} debts — output of normalizeDebtsForRanking
 * @returns {Array}     — sorted copy, original not mutated
 */
export function rankDebtsCanonical(debts) {
    const hasHighAprCard = debts.some(d => d._type === 'card' && d.currentApr >= 20);

    return [...debts].sort((a, b) => {
        // Rule 1: deprioritize low-APR loans when high-APR cards exist
        const aLowLoan = a._type === 'loan' && a.currentApr < 10 && hasHighAprCard;
        const bLowLoan = b._type === 'loan' && b.currentApr < 10 && hasHighAprCard;
        if (aLowLoan && !bLowLoan) return 1;
        if (bLowLoan && !aLowLoan) return -1;

        // Rule 2: promo-urgent first, soonest expiry wins
        if (a.isPromoUrgent && !b.isPromoUrgent) return -1;
        if (b.isPromoUrgent && !a.isPromoUrgent) return 1;
        if (a.isPromoUrgent && b.isPromoUrgent && a.promoMonthsLeft !== b.promoMonthsLeft) {
            return a.promoMonthsLeft - b.promoMonthsLeft;
        }

        // Rule 3: growing debts at meaningful APR get urgency boost
        const aGrowing = a.netMonthlyChange > 0 && a.currentApr >= 15;
        const bGrowing = b.netMonthlyChange > 0 && b.currentApr >= 15;
        if (aGrowing && !bGrowing) return -1;
        if (bGrowing && !aGrowing) return 1;

        // Rule 4: highest effective APR
        const aprDiff = b.currentApr - a.currentApr;
        if (Math.abs(aprDiff) > 1.5) return aprDiff;

        // Rule 5: smaller balance tiebreak
        return a.balance - b.balance;
    });
}

// ─── APP HEADER ────────────────────────────────────────────────────────────────

/**
 * Minimal calculation set used by the App shell header display.
 * Returns totalDebt and monthlyIncome — the two numbers shown at the top.
 *
 * @param {{ incomes: Array, creditCards: Array, loans: Array }} state
 * @returns {{ totalDebt: number, monthlyIncome: number }}
 */
export function calcAll(state) {
    const { incomes = [], creditCards = [], loans = [] } = state;

    const totalDebt = [
        ...creditCards.map(c => Number(c.balance) || 0),
        ...loans.map(l => Number(l.balance) || 0),
    ].reduce((a, b) => a + b, 0);

    return {
        totalDebt,
        monthlyIncome: calcMonthlyIncome(incomes),
    };
}
