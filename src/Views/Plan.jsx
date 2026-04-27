import React, { useMemo, useState } from "react";
import {
    AreaChart, Area, XAxis, YAxis, Tooltip,
    ReferenceLine, ResponsiveContainer,
} from "recharts";
import { normalizeToMonthly } from "../calculations.js";

// ─── TOKENS ───────────────────────────────────────────────────────────────────

const t = {
    bg0: "#080b10",
    bg1: "#0f172a",
    bg2: "#111827",
    border: "#334155",
    bright: "#e2e8f0",
    body: "#cbd5e1",
    muted: "#94a3b8",
    subtle: "#64748b",
    amber: "#f59e0b",
    amberDim: "#1a1200",
    green: "#22c55e",
    greenDim: "#052e16",
    red: "#ef4444",
    redDim: "#1c0707",
    blue: "#38bdf8",
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function fmt(n) {
    return `$${(Number(n) || 0).toLocaleString(undefined, {
        minimumFractionDigits: 0, maximumFractionDigits: 0,
    })}`;
}

function fmtExact(n) {
    return `$${(Number(n) || 0).toLocaleString(undefined, {
        minimumFractionDigits: 2, maximumFractionDigits: 2,
    })}`;
}

function fmtPct(n) { return `${(Number(n) || 0).toFixed(1)}%`; }

function sumArr(arr, fn) { return (arr || []).reduce((a, x) => a + fn(x), 0); }

function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }

function addMonths(d, n) { return new Date(d.getFullYear(), d.getMonth() + n, 1); }

function parseDateLike(v) {
    if (!v) return null;
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
}

function getPromoEnd(card) {
    return parseDateLike(card?.promoEnd) || parseDateLike(card?.promoEndDate) ||
        parseDateLike(card?.promoExpiration) || parseDateLike(card?.promoExpirationDate) ||
        parseDateLike(card?.promoExpiry) || null;
}

function effectiveApr(debt, monthOffset, nowMonth) {
    const regular = Number(debt.apr) || 0;
    const promo = Number(debt.promoApr) > 0 ? Number(debt.promoApr) : null;
    const promoEnd = debt.promoEndDate || null;
    if (!promo) return regular;
    if (!promoEnd) return promo;
    return addMonths(nowMonth, monthOffset) <= startOfMonth(promoEnd) ? promo : regular;
}

function monthInterest(balance, apr) {
    return (Number(balance) || 0) * ((Number(apr) || 0) / 100) / 12;
}

function monthLabel(offset, now) {
    return addMonths(now, offset).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

// ─── DEBT MODEL ───────────────────────────────────────────────────────────────

function buildDebts(state) {
    const now = startOfMonth(new Date());

    const cards = (state.creditCards ?? []).map(c => {
        const promoEnd = getPromoEnd(c);
        const promoApr = Number(c.promoApr) > 0 ? Number(c.promoApr) : null;
        const regularApr = Number(c.apr) || 0;

        // Months until promo expires
        let promoMonthsLeft = null;
        if (promoApr !== null && promoEnd) {
            const diff = (promoEnd.getFullYear() - now.getFullYear()) * 12
                + (promoEnd.getMonth() - now.getMonth());
            promoMonthsLeft = Math.max(0, diff);
        }

        // Urgency score for sorting: promo expiring soon is most urgent
        // then highest effective APR, then smallest balance as tiebreak
        const currentApr = promoApr !== null ? promoApr : regularApr;
        const futureApr = promoApr !== null ? regularApr : regularApr;
        const isPromoUrgent = promoMonthsLeft !== null && promoMonthsLeft <= 6 && futureApr >= 20;

        return {
            id: c.id,
            type: "card",
            name: c.name || "Card",
            balance: Number(c.balance) || 0,
            apr: regularApr,
            promoApr,
            promoEnd,
            promoEndDate: promoEnd,
            promoMonthsLeft,
            futureApr,
            currentApr,
            isPromoUrgent,
            minPayment: Number(c.minPayment) || 0,
            monthlyPayment: Number(c.monthlyPayment) || Number(c.minPayment) || 0,
            monthlySpend: Number(c.monthlySpend) || 0,
        };
    });

    const loans = (state.loans ?? []).map(l => ({
        id: l.id,
        type: "loan",
        name: l.name || "Loan",
        balance: Number(l.balance) || 0,
        apr: Number(l.apr) || 0,
        promoApr: null,
        promoEnd: null,
        promoEndDate: null,
        promoMonthsLeft: null,
        futureApr: Number(l.apr) || 0,
        currentApr: Number(l.apr) || 0,
        isPromoUrgent: false,
        minPayment: Number(l.monthlyPayment) || 0,
        monthlyPayment: Number(l.monthlyPayment) || 0,
        monthlySpend: 0,
    }));

    return [...cards, ...loans].filter(d => d.balance > 0);
}

function buildCompleted(state) {
    return [
        ...(state.creditCards ?? []).filter(c => (Number(c.balance) || 0) === 0 && c.name)
            .map(c => ({ id: c.id, name: c.name, type: "card" })),
        ...(state.loans ?? []).filter(l => (Number(l.balance) || 0) === 0 && l.name)
            .map(l => ({ id: l.id, name: l.name, type: "loan" })),
    ];
}

// ─── FOCUS DEBT RANKING ───────────────────────────────────────────────────────
// Priority:
//  1. Promo balances expiring ≤6mo that will reset to ≥20% APR
//  2. Highest effective APR
//  3. Smallest balance as tiebreak
//  Never focus on loans <10% APR while high-APR card debt exists

function rankDebts(debts) {
    const hasHighAprCards = debts.some(
        d => d.type === "card" && d.currentApr >= 20
    );

    return [...debts].sort((a, b) => {
        // Deprioritize low-APR loans when high-APR cards exist
        const aLowLoan = a.type === "loan" && a.currentApr < 10 && hasHighAprCards;
        const bLowLoan = b.type === "loan" && b.currentApr < 10 && hasHighAprCards;
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

        // Highest effective APR
        const aprDiff = b.currentApr - a.currentApr;
        if (Math.abs(aprDiff) > 1.5) return aprDiff;

        // Close APR: smaller balance first (quick win)
        return a.balance - b.balance;
    });
}

// ─── CASH FLOW ────────────────────────────────────────────────────────────────

function calcCashFlow(state) {
    const income = sumArr(state.incomes ?? [], i =>
        normalizeToMonthly(i.amount, i.frequency)
    );
    const essentialExpenses = sumArr(
        (state.expenses ?? []).filter(e => e.essential),
        e => normalizeToMonthly(e.amount, e.frequency)
    );
    const allExpenses = sumArr(state.expenses ?? [], e =>
        normalizeToMonthly(e.amount, e.frequency)
    );
    const allMinimums = sumArr(state.creditCards ?? [], c => Number(c.minPayment) || 0)
        + sumArr(state.loans ?? [], l => Number(l.monthlyPayment) || 0);

    // Attack capacity = income - ALL expenses - all minimums
    // (we use all expenses, not just essential, because that's reality)
    const attackCapacity = income - allExpenses - allMinimums;

    return { income, essentialExpenses, allExpenses, allMinimums, attackCapacity };
}

// ─── SAVINGS / EMERGENCY FUND ─────────────────────────────────────────────────

const EMERGENCY_BUFFER_DEFAULT = 2500;

function calcSavingsSetup(state) {
    const totalSavings = Number(state.savingsBalance) || 0;
    const emergencyTarget = Number(state.emergencyTarget) || EMERGENCY_BUFFER_DEFAULT;
    const lumpSumAvailable = Math.max(0, totalSavings - emergencyTarget);
    return { totalSavings, emergencyTarget, lumpSumAvailable };
}

// ─── MONTH-BY-MONTH ATTACK PLAN ───────────────────────────────────────────────

function buildAttackPlan(debts, attackCapacity, lumpSum, nowMonth) {
    if (!debts.length) return { months: [], payoffMonth: null };

    let working = debts.map(d => ({ ...d, balance: Number(d.balance) || 0 }));
    let rollingPool = attackCapacity; // extra above minimums
    let lumpRemaining = lumpSum;
    const months = [];

    for (let m = 0; m < 120; m++) {
        if (!working.length) break;

        // Re-rank every month so promo expirations shift priority correctly
        working = rankDebts(working);
        const focus = working[0];
        const others = working.slice(1);
        const monthName = monthLabel(m, nowMonth);
        const actions = [];
        let lumpThisMonth = 0;

        // Apply lump sum in month 0 only
        if (m === 0 && lumpRemaining > 0) {
            lumpThisMonth = Math.min(lumpRemaining, focus.balance);
            focus.balance -= lumpThisMonth;
            lumpRemaining -= lumpThisMonth;
            if (lumpThisMonth > 0) {
                actions.push({
                    type: "lump",
                    debt: focus.name,
                    amount: lumpThisMonth,
                    note: "Lump sum from savings above emergency buffer",
                });
            }
        }

        // New charges + interest on all debts
        for (const d of working) {
            d.balance += Number(d.monthlySpend) || 0;
            d.balance += monthInterest(d.balance, effectiveApr(d, m, nowMonth));
            d.balance = Math.max(0, d.balance);
        }

        // Pay minimums on non-focus debts
        for (const d of others) {
            const pay = Math.min(d.balance, d.minPayment || 0);
            d.balance = Math.max(0, d.balance - pay);
            if (pay > 0) actions.push({ type: "minimum", debt: d.name, amount: pay });
        }

        // Direct attack pool + focus debt minimum to focus debt
        const focusMin = focus.minPayment || 0;
        const focusAttack = Math.min(focus.balance, focusMin + rollingPool);
        focus.balance = Math.max(0, focus.balance - focusAttack);
        if (focusAttack > 0) {
            actions.push({
                type: "focus",
                debt: focus.name,
                amount: focusAttack,
                breakdown: { minimum: focusMin, extra: Math.max(0, focusAttack - focusMin) },
            });
        }

        months.push({
            month: m,
            label: monthName,
            focus: focus.name,
            focusBalance: Math.round(focus.balance),
            lumpSum: lumpThisMonth,
            attackPool: rollingPool,
            actions,
            totalDebt: Math.round(sumArr(working, d => d.balance)),
        });

        // Clear paid debts, roll their minimums forward
        const cleared = working.filter(d => d.balance <= 0.01);
        cleared.forEach(d => {
            rollingPool += d.minPayment || 0;
        });
        working = working.filter(d => d.balance > 0.01);

        if (!working.length) break;
    }

    const payoffMonth = months.find(m => m.totalDebt === 0)?.month ?? null;
    return { months, payoffMonth };
}

// ─── TRAJECTORY (for chart) ───────────────────────────────────────────────────

function buildTrajectory(debts, attackCapacity, lumpSum, nowMonth, maxMonths = 84) {
    if (!debts.length) return { data: [{ month: 0, label: "Now", total: 0 }], events: [] };

    let working = debts.map(d => ({ ...d, balance: Number(d.balance) || 0 }));
    let pool = attackCapacity;
    let lumpRemaining = lumpSum;

    const data = [{ month: 0, label: "Now", total: Math.round(sumArr(working, d => d.balance)) }];
    const events = [];

    for (let m = 1; m <= maxMonths; m++) {
        // Re-rank each month as promo rates may change
        if (working.length > 1) working = rankDebts(working);
        if (!working.length) { data.push({ month: m, label: monthLabel(m, nowMonth), total: 0 }); break; }

        // Lump sum in month 1
        if (m === 1 && lumpRemaining > 0) {
            working[0].balance = Math.max(0, working[0].balance - lumpRemaining);
            lumpRemaining = 0;
        }

        // Charges + interest
        for (const d of working) {
            d.balance += Number(d.monthlySpend) || 0;
            d.balance += monthInterest(d.balance, effectiveApr(d, m - 1, nowMonth));
            d.balance = Math.max(0, d.balance);
        }

        // Minimums on all + attack pool on focus
        const totalMin = sumArr(working, d => d.minPayment || 0);
        let payPool = totalMin + pool;
        const focus = working[0];
        const others = working.slice(1);

        for (const d of others) {
            const pay = Math.min(d.balance, d.minPayment || 0);
            d.balance = Math.max(0, d.balance - pay);
            payPool -= pay;
        }
        const focusPay = Math.min(focus.balance, payPool);
        focus.balance = Math.max(0, focus.balance - focusPay);

        // Clearance events
        const cleared = working.filter(d => d.balance <= 0.01);
        if (cleared.length) {
            events.push({ month: m, label: monthLabel(m, nowMonth), names: cleared.map(d => d.name) });
            pool += sumArr(cleared, d => d.minPayment || 0);
        }
        working = working.filter(d => d.balance > 0.01);

        const total = Math.max(0, Math.round(sumArr(working, d => d.balance)));
        data.push({ month: m, label: monthLabel(m, nowMonth), total });
        if (total === 0) break;
    }

    return { data, events };
}

// ─── CHART ────────────────────────────────────────────────────────────────────

function TrajectoryChart({ data, events, totalDebt }) {
    if (!data.length) return null;

    const payoffPt = data.find(p => p.total === 0);
    const finalPt = data[data.length - 1];
    const maxY = (data[0]?.total || totalDebt) * 1.06;
    const len = data.length;
    const step = len > 48 ? 12 : len > 24 ? 6 : len > 12 ? 3 : 1;
    const ticks = data.filter(p => p.month === 0 || p.month % step === 0).map(p => p.month);
    const labelPos = ["insideTopLeft", "insideTopRight"];

    return (
        <div style={{ border: `1px solid ${t.border}`, background: t.bg1, borderRadius: 12, padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: t.bright, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>
                        Debt Trajectory
                    </div>
                    <div style={{ fontSize: 12, color: t.muted }}>
                        Each cleared debt accelerates the next — the snowball effect
                    </div>
                </div>
                {payoffPt
                    ? <div style={{ background: t.greenDim, border: "1px solid #166534", borderRadius: 8, padding: "6px 14px", fontSize: 13, color: t.green, fontWeight: 700 }}>
                        Debt-free ~{payoffPt.label}
                    </div>
                    : <div style={{ background: t.bg2, border: `1px solid ${t.border}`, borderRadius: 8, padding: "6px 14px", fontSize: 12, color: t.muted }}>
                        {fmt(finalPt?.total)} remaining after {data.length - 1}mo
                    </div>
                }
            </div>

            <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={data} margin={{ top: 24, right: 8, left: 4, bottom: 0 }}>
                    <defs>
                        <linearGradient id="dg" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#ef4444" stopOpacity={0.03} />
                        </linearGradient>
                    </defs>
                    <XAxis dataKey="month" ticks={ticks}
                        tickFormatter={m => data.find(p => p.month === m)?.label ?? ""}
                        tick={{ fill: t.muted, fontSize: 10 }} axisLine={{ stroke: t.border }} tickLine={false} />
                    <YAxis tickFormatter={v => v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`}
                        tick={{ fill: t.muted, fontSize: 10 }} axisLine={false} tickLine={false}
                        domain={[0, maxY]} width={52} />
                    <Tooltip
                        contentStyle={{ background: t.bg1, border: `1px solid ${t.border}`, borderRadius: 8, fontSize: 12, color: t.bright }}
                        formatter={v => [fmt(v), "Total Debt"]}
                        labelFormatter={m => {
                            const pt = data.find(p => p.month === m);
                            const ev = events.find(e => e.month === m);
                            return ev ? `${pt?.label} — ${ev.names.join(" + ")} cleared` : pt?.label ?? `Month ${m}`;
                        }}
                    />
                    <ReferenceLine x={0} stroke={t.amber} strokeDasharray="4 3"
                        label={{ value: "Today", fill: t.amber, fontSize: 10, position: "insideTopRight" }} />
                    {events.map((ev, i) => (
                        <ReferenceLine key={ev.month} x={ev.month} stroke={t.green}
                            strokeDasharray="3 3" strokeOpacity={0.7}
                            label={{ value: ev.names.join(" + ") + " ✓", fill: t.green, fontSize: 9, position: labelPos[i % 2] }} />
                    ))}
                    <Area type="monotone" dataKey="total" stroke="#ef4444" strokeWidth={2.5}
                        fill="url(#dg)" dot={false} activeDot={{ r: 5, fill: "#ef4444", strokeWidth: 0 }} />
                </AreaChart>
            </ResponsiveContainer>

            {events.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${t.border}` }}>
                    {events.map(ev => (
                        <div key={ev.month} style={{ display: "flex", gap: 5, fontSize: 12, color: t.muted }}>
                            <span style={{ color: t.green, fontWeight: 700 }}>✓</span>
                            <span style={{ color: t.green }}>{ev.names.join(" + ")}</span>
                            <span style={{ color: t.subtle }}>~{ev.label}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// ─── COMPLETED DEBTS ──────────────────────────────────────────────────────────

function CompletedDebts({ completed }) {
    if (!completed.length) return null;
    return (
        <div style={{ border: "1px solid #166534", background: t.greenDim, borderRadius: 12, padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: t.green, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
                ✓ {completed.length} Debt{completed.length !== 1 ? "s" : ""} Cleared
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
                {completed.map(d => (
                    <span key={d.id} style={{ background: "#14532d", border: "1px solid #166534", borderRadius: 6, padding: "4px 12px", fontSize: 13, color: "#86efac", fontWeight: 500 }}>
                        ✓ {d.name}
                    </span>
                ))}
            </div>
            <div style={{ fontSize: 12, color: "#4ade80" }}>
                Their payments are rolling forward into your active attack pool.
            </div>
        </div>
    );
}

// ─── SAVINGS SETUP ROW ────────────────────────────────────────────────────────

function SavingsSetupCard({ state, onUpdate }) {
    const savings = Number(state.savingsBalance) || 0;
    const target = Number(state.emergencyTarget) || EMERGENCY_BUFFER_DEFAULT;

    return (
        <div style={{ border: `1px solid ${t.border}`, background: t.bg1, borderRadius: 12, padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: t.bright, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
                Savings & Emergency Buffer
            </div>
            <div style={{ fontSize: 13, color: t.muted, marginBottom: 14, lineHeight: 1.6 }}>
                The plan keeps your emergency buffer safe and uses the rest as a lump-sum attack on Month 1.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <span style={{ fontSize: 12, color: t.muted, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                        Current Savings ($)
                    </span>
                    <input
                        type="number"
                        value={savings || ""}
                        placeholder="0"
                        onChange={e => onUpdate({ ...state, savingsBalance: parseFloat(e.target.value) || 0 })}
                        style={{ height: 44, borderRadius: 8, border: `1px solid ${t.border}`, background: t.bg2, color: t.bright, padding: "0 12px", fontSize: 15, outline: "none" }}
                    />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <span style={{ fontSize: 12, color: t.muted, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                        Emergency Buffer Target ($)
                    </span>
                    <input
                        type="number"
                        value={target || ""}
                        placeholder="2500"
                        onChange={e => onUpdate({ ...state, emergencyTarget: parseFloat(e.target.value) || 0 })}
                        style={{ height: 44, borderRadius: 8, border: `1px solid ${t.border}`, background: t.bg2, color: t.bright, padding: "0 12px", fontSize: 15, outline: "none" }}
                    />
                </label>
            </div>
            <div style={{ display: "flex", gap: 20, marginTop: 12, fontSize: 13 }}>
                <span style={{ color: t.muted }}>Keep: <strong style={{ color: t.bright }}>{fmt(Math.min(savings, target))}</strong></span>
                <span style={{ color: t.muted }}>Available lump sum: <strong style={{ color: savings > target ? t.amber : t.subtle }}>{fmt(Math.max(0, savings - target))}</strong></span>
            </div>
        </div>
    );
}

// ─── MONTH 1 ATTACK CARD ──────────────────────────────────────────────────────

function MonthOneCard({ plan, ranked, cashFlow, lumpSum }) {
    if (!plan.months.length) return null;

    const m0 = plan.months[0];
    const focus = ranked[0];
    const next = ranked[1];

    // After lump sum, how much more to clear focus debt this month?
    const balanceAfterLump = Math.max(0, (focus?.balance || 0) - lumpSum);
    const attackPool = cashFlow.attackCapacity;
    const canClearThisMonth = attackPool >= balanceAfterLump;
    const leftoverAfterFocus = canClearThisMonth ? attackPool - balanceAfterLump : 0;

    const rows = [
        { label: "Emergency fund kept", value: fmt(Number(focus ? cashFlow.income - cashFlow.allExpenses - cashFlow.allMinimums + attackPool : 0)), isValue: false, note: "" },
    ];

    return (
        <div style={{ border: `2px solid ${t.amber}`, background: t.amberDim, borderRadius: 12, padding: 20 }}>
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
                <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: t.amber, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>
                        Month 1 — Attack Plan
                    </div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: t.bright }}>
                        {focus?.name ?? "No focus debt"}
                    </div>
                    <div style={{ fontSize: 13, color: t.muted, marginTop: 2 }}>
                        {focus?.isPromoUrgent
                            ? `Promo rate expires in ${focus.promoMonthsLeft}mo → resets to ${fmtPct(focus.futureApr)}`
                            : focus ? `${fmtPct(focus.currentApr)} APR · ${fmt(focus.balance)} balance` : ""}
                    </div>
                </div>
                {plan.payoffMonth !== null && (
                    <div style={{ background: t.greenDim, border: "1px solid #166534", borderRadius: 8, padding: "8px 14px", textAlign: "center" }}>
                        <div style={{ fontSize: 11, color: "#4ade80", marginBottom: 2 }}>Debt-free by</div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: t.green }}>
                            {monthLabel(plan.payoffMonth, startOfMonth(new Date()))}
                        </div>
                    </div>
                )}
            </div>

            {/* Action steps */}
            <div style={{ display: "grid", gap: 2, marginBottom: 20 }}>
                {/* Emergency fund */}
                <ActionRow
                    num="1"
                    label="Keep in savings"
                    value={fmt(Number(state?.emergencyTarget) || EMERGENCY_BUFFER_DEFAULT)}
                    note="Emergency buffer — do not touch"
                    color={t.muted}
                />
                {/* Lump sum */}
                {lumpSum > 0 && (
                    <ActionRow
                        num="2"
                        label={`Lump sum → ${focus?.name}`}
                        value={fmt(lumpSum)}
                        note={`Balance drops to ${fmt(balanceAfterLump)}`}
                        color={t.amber}
                    />
                )}
                {/* Monthly attack */}
                <ActionRow
                    num={lumpSum > 0 ? "3" : "2"}
                    label={`Monthly attack → ${focus?.name}`}
                    value={`${fmt(focus?.minPayment || 0)} min + ${fmt(Math.max(0, attackPool - (focus?.minPayment || 0)))} extra`}
                    note={canClearThisMonth
                        ? `Goal: clear ${focus?.name} this month`
                        : `Pays down ${fmt(attackPool)} this month · ${fmt(balanceAfterLump - attackPool)} remaining`}
                    color={t.green}
                />
                {/* Overflow */}
                {canClearThisMonth && leftoverAfterFocus > 0 && next && (
                    <ActionRow
                        num={lumpSum > 0 ? "4" : "3"}
                        label={`Overflow → ${next.name}`}
                        value={fmt(leftoverAfterFocus)}
                        note="Leftover after clearing focus debt"
                        color={t.blue}
                    />
                )}
                {/* Minimums on everything else */}
                <ActionRow
                    num={lumpSum > 0 ? (canClearThisMonth && leftoverAfterFocus > 0 ? "5" : "4") : (canClearThisMonth && leftoverAfterFocus > 0 ? "4" : "3")}
                    label="Minimums on all other debts"
                    value={fmt(cashFlow.allMinimums - (focus?.minPayment || 0))}
                    note="Keep every other account current"
                    color={t.subtle}
                />
                {/* Rule */}
                <div style={{ display: "flex", gap: 12, padding: "10px 14px", background: "#0c0a00", borderRadius: 8, marginTop: 4, alignItems: "flex-start" }}>
                    <span style={{ fontSize: 13, color: t.amber, fontWeight: 700, flexShrink: 0 }}>Rule</span>
                    <span style={{ fontSize: 13, color: t.body, lineHeight: 1.6 }}>
                        No new credit card charges. Every dollar of available cash goes toward {focus?.name} first.
                    </span>
                </div>
            </div>

            {/* Next target */}
            {next && (
                <div style={{ borderTop: `1px solid ${t.border}`, paddingTop: 14 }}>
                    <span style={{ fontSize: 12, color: t.subtle, textTransform: "uppercase", letterSpacing: "0.08em" }}>Next target after {focus?.name}: </span>
                    <strong style={{ fontSize: 13, color: t.bright }}>{next.name}</strong>
                    <span style={{ fontSize: 12, color: t.muted }}> · {fmt(next.balance)} · {fmtPct(next.currentApr)}</span>
                    {next.isPromoUrgent && (
                        <span style={{ fontSize: 11, color: t.red, marginLeft: 8 }}>⚠ promo expires in {next.promoMonthsLeft}mo</span>
                    )}
                </div>
            )}
        </div>
    );
}

function ActionRow({ num, label, value, note, color }) {
    return (
        <div style={{ display: "flex", gap: 12, padding: "10px 14px", background: "rgba(255,255,255,0.03)", borderRadius: 8, alignItems: "flex-start" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: t.subtle, width: 16, flexShrink: 0, paddingTop: 2 }}>{num}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: t.body }}>{label}</div>
                {note && <div style={{ fontSize: 12, color: t.subtle, marginTop: 2 }}>{note}</div>}
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color, flexShrink: 0 }}>{value}</div>
        </div>
    );
}

// ─── CASH FLOW BREAKDOWN ──────────────────────────────────────────────────────

function CashFlowCard({ cashFlow, lumpSum }) {
    const rows = [
        { label: "Net monthly income", value: fmt(cashFlow.income), color: t.green },
        { label: "Living expenses", value: `−${fmt(cashFlow.allExpenses)}`, color: t.muted },
        { label: "Debt minimums", value: `−${fmt(cashFlow.allMinimums)}`, color: t.muted },
        { label: "Monthly attack capacity", value: fmt(Math.max(0, cashFlow.attackCapacity)), color: cashFlow.attackCapacity > 0 ? t.amber : t.red, bold: true },
    ];
    if (lumpSum > 0) {
        rows.push({ label: "Lump sum available (Month 1)", value: fmt(lumpSum), color: t.blue, bold: false });
    }

    return (
        <div style={{ border: `1px solid ${t.border}`, background: t.bg1, borderRadius: 12, padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: t.bright, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 14 }}>
                Monthly Attack Capacity
            </div>
            <div style={{ display: "grid", gap: 1 }}>
                {rows.map((r, i) => (
                    <div key={i} style={{
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                        padding: "9px 0",
                        borderTop: i === rows.length - (lumpSum > 0 ? 2 : 1) ? `1px solid ${t.border}` : "none",
                        marginTop: i === rows.length - (lumpSum > 0 ? 2 : 1) ? 4 : 0,
                    }}>
                        <span style={{ fontSize: 13, color: t.body }}>{r.label}</span>
                        <span style={{ fontSize: r.bold ? 16 : 13, fontWeight: r.bold ? 700 : 400, color: r.color }}>{r.value}</span>
                    </div>
                ))}
            </div>
            {cashFlow.attackCapacity <= 0 && (
                <div style={{ marginTop: 12, padding: "10px 12px", background: t.redDim, borderRadius: 8, fontSize: 13, color: "#fca5a5", lineHeight: 1.6 }}>
                    ⚠ No attack capacity available. Expenses + minimums exceed income. The plan needs breathing room — review discretionary expenses.
                </div>
            )}
        </div>
    );
}

// ─── DEBT PRIORITY TABLE ──────────────────────────────────────────────────────

function DebtPriorityTable({ ranked }) {
    if (!ranked.length) return null;

    return (
        <div style={{ border: `1px solid ${t.border}`, background: t.bg1, borderRadius: 12, padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: t.bright, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
                Attack Order
            </div>
            <div style={{ fontSize: 12, color: t.muted, marginBottom: 14 }}>
                Ranked by urgency — promo expirations, then highest APR, then smallest balance.
            </div>
            <div style={{ display: "grid", gap: 6 }}>
                {ranked.map((d, i) => (
                    <div key={d.id} style={{
                        display: "flex", alignItems: "center", gap: 12, padding: "10px 12px",
                        background: i === 0 ? t.amberDim : t.bg2,
                        border: `1px solid ${i === 0 ? t.amber + "66" : t.border}`,
                        borderRadius: 8,
                    }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: i === 0 ? t.amber : t.subtle, width: 20, flexShrink: 0 }}>
                            {i === 0 ? "▶" : `${i + 1}`}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, color: i === 0 ? t.bright : t.body, fontWeight: i === 0 ? 600 : 400 }}>
                                {d.name}
                            </div>
                            <div style={{ fontSize: 11, color: t.subtle, marginTop: 2 }}>
                                {d.isPromoUrgent
                                    ? `⚠ promo expires in ${d.promoMonthsLeft}mo → ${fmtPct(d.futureApr)} · ${fmt(d.balance)}`
                                    : d.promoApr !== null
                                        ? `${fmtPct(d.promoApr)} promo now → ${fmtPct(d.futureApr)} later · ${fmt(d.balance)}`
                                        : `${fmtPct(d.currentApr)} APR · ${fmt(d.balance)}`}
                            </div>
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                            <div style={{ fontSize: 12, color: t.muted }}>min {fmt(d.minPayment)}/mo</div>
                        </div>
                        {i === 0 && (
                            <div style={{ background: "#78350f", color: t.amber, fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 4, letterSpacing: "0.1em", textTransform: "uppercase", flexShrink: 0 }}>
                                Focus
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}

// ─── SPEND WARNINGS ───────────────────────────────────────────────────────────

function SpendWarnings({ debts }) {
    const problems = debts.filter(d => d.type === "card" && (d.monthlySpend || 0) >= (d.monthlyPayment || 0));
    if (!problems.length) return null;

    return (
        <div style={{ border: "1px solid #7f1d1d", background: t.redDim, borderRadius: 12, padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: t.red, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                ⚠ Spending Exceeds Payment — {problems.length} Card{problems.length !== 1 ? "s" : ""}
            </div>
            <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
                {problems.map(d => (
                    <div key={d.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#fca5a5", padding: "6px 10px", background: "#2d0a0a", borderRadius: 7 }}>
                        <span>{d.name}</span>
                        <span>spending {fmt(d.monthlySpend)}/mo · paying {fmt(d.monthlyPayment || d.minPayment)}/mo</span>
                    </div>
                ))}
            </div>
            <div style={{ fontSize: 13, color: "#f87171", lineHeight: 1.7 }}>
                These balances are growing faster than they're being paid. The plan cannot reduce them until spending drops below the payment. Reduce spend or increase payment.
            </div>
        </div>
    );
}

// ─── MAIN EXPORT ──────────────────────────────────────────────────────────────

export default function Plan({ state, onUpdate }) {
    const isMobile = window.innerWidth <= 768;
    const nowMonth = useMemo(() => startOfMonth(new Date()), []);

    const model = useMemo(() => {
        const debts = buildDebts(state);
        const completed = buildCompleted(state);
        const ranked = rankDebts(debts);
        const cashFlow = calcCashFlow(state);
        const { totalSavings, emergencyTarget, lumpSumAvailable } = calcSavingsSetup(state);

        const attackCapacity = Math.max(0, cashFlow.attackCapacity);
        const plan = buildAttackPlan(ranked, attackCapacity, lumpSumAvailable, nowMonth);
        const { data: trajData, events: trajEvents } = buildTrajectory(
            ranked, attackCapacity, lumpSumAvailable, nowMonth
        );

        const totalDebt = sumArr(debts, d => d.balance);
        const monthlyInterest = sumArr(debts, d => monthInterest(d.balance, effectiveApr(d, 0, nowMonth)));

        return {
            debts, completed, ranked, cashFlow,
            totalSavings, emergencyTarget, lumpSumAvailable,
            attackCapacity, plan,
            trajData, trajEvents,
            totalDebt, monthlyInterest,
        };
    }, [state]);

    if (!model.debts.length) {
        return (
            <div style={{ border: `1px solid ${t.border}`, background: t.bg1, borderRadius: 12, padding: 24 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: t.bright, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                    Debt Attack Map
                </div>
                <div style={{ fontSize: 14, color: t.muted }}>
                    {model.completed.length > 0
                        ? "All debts cleared."
                        : "Add debts in the Debts tab — the plan will build itself from your numbers."}
                </div>
                {model.completed.length > 0 && <CompletedDebts completed={model.completed} />}
            </div>
        );
    }

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 980, margin: "0 auto", padding: "0 0 48px" }}>

            {/* Header */}
            <div>
                <h2 style={{ fontSize: 14, fontWeight: 700, color: t.bright, margin: "0 0 4px", letterSpacing: "0.04em", textTransform: "uppercase" }}>
                    Debt Attack Map
                </h2>
                <p style={{ fontSize: 13, color: t.muted, margin: 0, lineHeight: 1.7 }}>
                    Tells you exactly what to pay this month, to whom, and how much. Updates on every import.
                </p>
            </div>

            {/* Wins */}
            {model.completed.length > 0 && <CompletedDebts completed={model.completed} />}

            {/* Spend warnings — surface immediately if blocking the plan */}
            <SpendWarnings debts={model.debts} />

            {/* Savings setup — needed for Month 1 lump sum */}
            <SavingsSetupCard state={state} onUpdate={onUpdate} />

            {/* Month 1 Attack Card — the hero element */}
            <MonthOneCard
                plan={model.plan}
                ranked={model.ranked}
                cashFlow={model.cashFlow}
                lumpSum={model.lumpSumAvailable}
                state={state}
            />

            {/* Cash flow breakdown */}
            <CashFlowCard cashFlow={model.cashFlow} lumpSum={model.lumpSumAvailable} />

            {/* Attack order */}
            <DebtPriorityTable ranked={model.ranked} />

            {/* Trajectory chart */}
            <TrajectoryChart
                data={model.trajData}
                events={model.trajEvents}
                totalDebt={model.totalDebt}
            />

            {/* Quick stats */}
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(3, 1fr)", gap: 12 }}>
                {[
                    { label: "Total Debt", value: fmt(model.totalDebt), color: t.bright },
                    { label: "Monthly Interest", value: fmt(model.monthlyInterest), color: t.red, sub: "Cost of carrying this debt" },
                    { label: "Projected Payoff", value: model.plan.payoffMonth ? monthLabel(model.plan.payoffMonth, nowMonth) : "60mo+", color: t.green },
                ].map(s => (
                    <div key={s.label} style={{ border: `1px solid ${t.border}`, background: t.bg1, borderRadius: 12, padding: 14 }}>
                        <div style={{ fontSize: 12, color: t.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>{s.label}</div>
                        <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
                        {s.sub && <div style={{ fontSize: 12, color: t.subtle, marginTop: 4 }}>{s.sub}</div>}
                    </div>
                ))}
            </div>
        </div>
    );
}
