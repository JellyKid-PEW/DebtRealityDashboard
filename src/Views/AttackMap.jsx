import React, { useMemo, useState } from "react";
import { normalizeToMonthly } from "../calculations.js";

// ─── TOKENS ───────────────────────────────────────────────────────────────────
const t = {
    bg0: "#080b10", bg1: "#0f172a", bg2: "#111827",
    border: "#1e293b", bright: "#e2e8f0", body: "#cbd5e1",
    muted: "#94a3b8", subtle: "#64748b",
    amber: "#f59e0b", amberD: "#78350f", amberBg: "#1a1200",
    green: "#22c55e", greenD: "#166534", greenBg: "#052e16",
    red: "#ef4444", redD: "#7f1d1d", redBg: "#1c0707",
    blue: "#38bdf8", blueD: "#1e3a5f", blueBg: "#0c1a2e",
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const fmt = n => `$${Math.abs(Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const fmtD = n => `$${Math.abs(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtPct = n => `${(Number(n) || 0).toFixed(1)}%`;

function monthsAway(dateStr) {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    if (isNaN(d)) return null;
    const now = new Date();
    return (d.getFullYear() - now.getFullYear()) * 12 + (d.getMonth() - now.getMonth());
}
function addMonthsLabel(n) {
    const d = new Date();
    d.setMonth(d.getMonth() + n);
    return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}
function ipm(bal, apr) { return (Number(bal) || 0) * ((Number(apr) || 0) / 100) / 12; }
function getEffApr(d) { const p = Number(d.promoApr); return p > 0 ? p : Number(d.apr) || 0; }
function getFutApr(d) { return Number(d.apr) || 0; }
// Returns the APR that applies at monthOffset months from now — switches from promo to regular when promo expires
function aprAt(d, monthOffset) {
    const regular = Number(d.apr) || 0;
    const promo = Number(d.promoApr);
    if (!(promo > 0)) return regular;
    const promoEnd = d.promoEnd ? new Date(d.promoEnd) : null;
    if (!promoEnd || isNaN(promoEnd)) return promo;
    const now = new Date();
    const monthsUntilExpiry = (promoEnd.getFullYear() - now.getFullYear()) * 12 + (promoEnd.getMonth() - now.getMonth());
    return monthOffset < monthsUntilExpiry ? promo : regular;
}

// ─── DEBT NORMALIZATION ───────────────────────────────────────────────────────
function normalizeDebts(cards, loans) {
    const c = (cards ?? []).map(x => ({
        ...x, _type: "card", balance: Number(x.balance) || 0,
        minPayment: Number(x.minPayment) || 0, monthlyPayment: Number(x.monthlyPayment) || Number(x.minPayment) || 0,
        monthlySpend: Number(x.monthlySpend) || 0
    }));
    const l = (loans ?? []).map(x => ({
        ...x, _type: "loan", balance: Number(x.balance) || 0,
        minPayment: Number(x.monthlyPayment) || 0, monthlyPayment: Number(x.monthlyPayment) || 0, monthlySpend: 0
    }));
    return [...c, ...l];
}

// ─── PRIORITY ENGINE ──────────────────────────────────────────────────────────
function scoreDebt(d) {
    const bal = Number(d.balance) || 0;
    if (bal <= 0) return -Infinity;
    const pm = d.promoEnd ? monthsAway(d.promoEnd) : null;
    const soon = pm !== null && pm <= 6 && pm >= 0;
    let score = getEffApr(d) * 1000;
    if (soon) score += getFutApr(d) * 1000 * ((6 - pm) / 6) * 0.8;
    if (getEffApr(d) < 5 && !soon) score = getEffApr(d) * 10;
    score += (1 / (bal + 1)) * 100;
    return score;
}
function prioritizeDebts(cards, loans) {
    return normalizeDebts(cards, loans).filter(d => d.balance > 0).sort((a, b) => scoreDebt(b) - scoreDebt(a));
}

// ─── SURPLUS ──────────────────────────────────────────────────────────────────
function calcSurplus(state) {
    const income = (state.incomes ?? []).reduce((s, i) => s + normalizeToMonthly(i.amount, i.frequency), 0);
    const essential = (state.expenses ?? []).filter(e => e.essential !== false).reduce((s, e) => s + normalizeToMonthly(e.amount, e.frequency), 0);
    const minimums = [...(state.creditCards ?? []).map(c => Number(c.minPayment) || 0), ...(state.loans ?? []).map(l => Number(l.monthlyPayment) || 0)].reduce((a, b) => a + b, 0);
    return { income, essential, minimums, surplus: Math.max(0, income - essential - minimums) };
}

// ─── SAFE TO PAY ─────────────────────────────────────────────────────────────
// Auto-calculates from state. Only savings balance is user-entered.
// Estimates what falls before next paycheck based on income frequency.
function calcSafeToPay(state) {
    const cash = Number(state.savingsBalance) || 0;
    const buffer = Number(state.emergencyTarget) || 2500;

    // Determine paycheck fraction — how much of monthly spending falls before next check
    const incomes = state.incomes ?? [];
    const primaryIncome = incomes.reduce((best, i) =>
        normalizeToMonthly(i.amount, i.frequency) > normalizeToMonthly(best.amount || 0, best.frequency || "monthly") ? i : best
        , incomes[0] || {});
    const freq = primaryIncome?.frequency || "monthly";
    // Fraction of monthly spending that falls before the next paycheck
    const fraction = freq === "weekly" ? 0.25 : freq === "biweekly" ? 0.5 : 1.0;

    // Essential expenses before next paycheck — auto from expenses tab
    const monthlyEssential = (state.expenses ?? [])
        .filter(e => e.essential !== false)
        .reduce((s, e) => s + normalizeToMonthly(e.amount, e.frequency), 0);
    const essentialBeforePaycheck = monthlyEssential * fraction;

    // Minimum payments before next paycheck — auto from debts
    const monthlyMins = [
        ...(state.creditCards ?? []).map(c => Number(c.minPayment) || 0),
        ...(state.loans ?? []).map(l => Number(l.monthlyPayment) || 0),
    ].reduce((a, b) => a + b, 0);
    const minsBeforePaycheck = monthlyMins * fraction;

    const reserveNeeded = buffer + essentialBeforePaycheck + minsBeforePaycheck;
    const safe = Math.max(0, cash - reserveNeeded);
    const keep = cash - safe;

    return {
        safe, keep, cash, buffer,
        essentialBeforePaycheck, minsBeforePaycheck,
        monthlyEssential, monthlyMins,
        fraction, freq,
        reserveNeeded,
    };
}

// ─── PROMO DEADLINES ─────────────────────────────────────────────────────────
function calcPromos(cards) {
    return (cards ?? []).filter(c => {
        const pm = monthsAway(c.promoEnd);
        return Number(c.promoApr) > 0 && pm !== null && pm >= 0;
    }).map(c => {
        const pm = monthsAway(c.promoEnd);
        const bal = Number(c.balance) || 0;
        return {
            ...c, monthsRemaining: pm, required: bal / Math.max(1, pm),
            urgency: pm <= 2 ? "critical" : pm <= 6 ? "urgent" : "watch",
            futureApr: Number(c.apr) || 0, promoApr: Number(c.promoApr) || 0
        };
    }).sort((a, b) => a.monthsRemaining - b.monthsRemaining);
}

// ─── MIN PAYMENT DANGER ───────────────────────────────────────────────────────
function calcDangers(debts) {
    return debts.filter(d => d.balance > 0).map(d => {
        const interest = ipm(d.balance, getEffApr(d));
        const payment = d.monthlyPayment || d.minPayment || 0;
        const share = payment > 0 ? interest / payment : 1;
        const level = payment <= interest ? "critical" : share >= 0.75 ? "danger" : share >= 0.5 ? "warning" : null;
        const msg = payment <= interest ? "This payment doesn't cover interest. Balance is growing." :
            share >= 0.75 ? "Most of this payment is interest. Balance moves very slowly." :
                share >= 0.5 ? "Over half this payment is interest." : null;
        return { ...d, interest, payment, share, level, msg };
    }).filter(d => d.level);
}

// ─── RISK FLAGS ───────────────────────────────────────────────────────────────
function calcRisk(state, surplus, prioritized, promos) {
    const flags = [];
    const cash = Number(state.savingsBalance) || 0;
    const buffer = Number(state.emergencyTarget) || 2500;
    const cards = state.creditCards ?? [];
    const totalDebt = prioritized.reduce((s, d) => s + d.balance, 0);
    const totalLimit = cards.reduce((s, c) => s + Number(c.limit || 0), 0);
    const util = totalLimit > 0 ? totalDebt / totalLimit : 0;
    const income = (state.incomes ?? []).reduce((s, i) => s + normalizeToMonthly(i.amount, i.frequency), 0);
    const mins = prioritized.reduce((s, d) => s + d.minPayment, 0);

    if (cash < buffer) flags.push({ level: "red", text: `Emergency buffer short — have ${fmt(cash)}, need ${fmt(buffer)}` });
    if (surplus <= 0) flags.push({ level: "red", text: "No monthly surplus — nothing to attack debt with" });
    if (util > 0.8) flags.push({ level: "red", text: `Credit utilization at ${fmtPct(util * 100)} — above 80%` });
    if (promos.filter(p => p.urgency === "critical").length) flags.push({ level: "red", text: "Promo rate expiring within 2 months — act now" });
    if (promos.filter(p => p.urgency === "urgent").length) flags.push({ level: "amber", text: "Promo rate expiring within 6 months" });
    const spendCards = cards.filter(c => Number(c.monthlySpend) > 0 && Number(c.balance) > 0);
    if (spendCards.length) flags.push({ level: "amber", text: `New charges on ${spendCards.length} payoff card${spendCards.length > 1 ? "s" : ""} — breaking the plan` });
    if (income > 0 && mins / income > 0.4) flags.push({ level: "amber", text: `Minimums are ${fmtPct(mins / income * 100)} of income` });

    const redCount = flags.filter(f => f.level === "red").length;
    return { flags, overall: redCount >= 2 ? "red" : redCount >= 1 ? "red" : flags.length >= 2 ? "amber" : "green" };
}

// ─── MILESTONES ───────────────────────────────────────────────────────────────
function calcMilestones(state, prioritized) {
    const cards = state.creditCards ?? [];
    const totalDebt = prioritized.reduce((s, d) => s + d.balance, 0);
    const totalLimit = cards.reduce((s, c) => s + Number(c.limit || 0), 0);
    const util = totalLimit > 0 ? totalDebt / totalLimit : 0;
    const highApr = prioritized.filter(d => getEffApr(d) >= 20).reduce((s, d) => s + d.balance, 0);
    const completed = [], upcoming = [];

    if (prioritized.length > 0) upcoming.push({ label: `Pay off ${prioritized[0].name}`, detail: `${fmt(prioritized[0].balance)} remaining`, priority: true });
    if (util >= 0.9) upcoming.push({ label: `Get utilization below 90% — now ${fmtPct(util * 100)}` });
    else if (util >= 0.75) upcoming.push({ label: `Get utilization below 75% — now ${fmtPct(util * 100)}` });
    else if (util >= 0.5) upcoming.push({ label: `Get utilization below 50% — now ${fmtPct(util * 100)}` });
    else completed.push({ label: "Utilization below 50%" });

    if (highApr > 0) upcoming.push({ label: `Eliminate all 20%+ APR debt — ${fmt(highApr)} remaining` });
    else completed.push({ label: "All 20%+ APR debt gone" });

    if (cards.filter(c => Number(c.balance) > 0).length > 0) upcoming.push({ label: "Clear all credit card balances" });
    else completed.push({ label: "All credit cards cleared" });

    return { completed, upcoming: upcoming.slice(0, 4) };
}

// ─── SPENDING LEAKS ───────────────────────────────────────────────────────────
function calcLeaks(state, surplus) {
    const bycat = {};
    (state.expenses ?? []).forEach(e => {
        const cat = e.category || "Other";
        const mo = normalizeToMonthly(e.amount, e.frequency);
        if (!bycat[cat]) bycat[cat] = { total: 0, optional: 0 };
        bycat[cat].total += mo;
        if (e.essential === false) bycat[cat].optional += mo;
    });
    return Object.entries(bycat).filter(([, v]) => v.optional >= 50).map(([cat, v]) => ({
        category: cat, total: v.total, optional: v.optional,
        monthsSaved: Math.round(v.optional / (surplus + v.optional) * 12),
    })).sort((a, b) => b.optional - a.optional).slice(0, 4);
}

// ─── SIMULATION ───────────────────────────────────────────────────────────────
function simulate(prioritized, surplus, lumpSum, maxMonths = 60) {
    if (!prioritized.length || surplus <= 0) return [];
    let debts = prioritized.map(d => ({ ...d, balance: Number(d.balance) || 0 }));
    let pool = surplus;
    const months = [];

    for (let m = 0; m < maxMonths; m++) {
        const active = debts.filter(d => d.balance > 0.01);
        if (!active.length) break;
        const focus = active[0], rest = active.slice(1);
        const lump = m === 0 ? lumpSum : 0;

        // Use time-aware APR — promo rate switches to regular when promo expires
        const focusApr = aprAt(focus, m);
        let bal = Math.max(0, focus.balance - lump);
        const interest = ipm(bal, focusApr);
        bal += interest;
        const pay = Math.min(bal, pool);
        const remaining = Math.max(0, bal - pay);
        const cleared = remaining <= 0.01;
        const leftover = cleared ? Math.max(0, pay - bal) : 0;
        const next = rest[0] || null;
        const overflow = cleared && next ? Math.min(leftover, next.balance) : 0;
        const totalInterest = interest + rest.reduce((s, d) => s + ipm(d.balance, aprAt(d, m)), 0);

        // Flag if promo expires this month on any debt — affects urgency re-ranking
        const promoExpiries = debts.filter(d => {
            const pm = d.promoEnd ? monthsAway(d.promoEnd) : null;
            return pm === m;
        }).map(d => d.name);

        const instructions = [];
        if (lump > 0) instructions.push({ type: "lump", text: `Deploy ${fmt(lump)} lump sum → ${focus.name}`, amt: lump, debt: focus.name });
        // Warn if promo just expired on focus debt
        const focusPromoExpiredThisMonth = aprAt(focus, m) > aprAt(focus, m - 1 || 0) && m > 0;
        instructions.push({
            type: "focus",
            text: `Pay ${fmt(focus.minPayment + pool)}/mo → ${focus.name}${focusPromoExpiredThisMonth ? " ⚠ rate reset this month" : ""}`,
            amt: focus.minPayment + pool, debt: focus.name
        });
        rest.forEach(d => {
            if (d.balance > 0.01) {
                const rateReset = m > 0 && aprAt(d, m) > aprAt(d, m - 1);
                instructions.push({
                    type: rateReset ? "lump" : "minimum",
                    text: rateReset ? `⚠ ${d.name} promo expired — now ${fmtPct(aprAt(d, m))} APR. Min ${fmt(d.minPayment)}/mo` : `Minimum only — ${fmt(d.minPayment)}/mo`,
                    amt: d.minPayment, debt: d.name
                });
            }
        });
        if (overflow > 0 && next) instructions.push({ type: "overflow", text: `Leftover ${fmt(overflow)} → ${next.name}`, amt: overflow, debt: next.name });
        instructions.push({ type: "rule", text: "No new credit card charges. Not one.", debt: null });

        months.push({
            month: m + 1, label: addMonthsLabel(m), focusDebt: focus.name, focusId: focus.id,
            focusBalance: focus.balance, balAfter: remaining, cleared, lump, pool,
            nextTarget: next?.name || null, instructions, totalInterest, promoExpiries
        });

        // Advance balances — all using time-aware APR for next month
        debts = debts.map(d => {
            if (d.id === focus.id) return { ...d, balance: remaining };
            const nextApr = aprAt(d, m + 1);
            if (d.id === next?.id) return { ...d, balance: Math.max(0, d.balance - overflow + ipm(d.balance, nextApr) + d.monthlySpend) };
            return { ...d, balance: Math.max(0, d.balance + ipm(d.balance, nextApr) + d.monthlySpend - d.minPayment) };
        });
        if (cleared) pool += focus.minPayment || 0;
    }
    return months;
}

// ─── UI PRIMITIVES ────────────────────────────────────────────────────────────
function Card({ children, border = t.border, bg = t.bg1, padding = 16 }) {
    return <div style={{ border: `1px solid ${border}`, background: bg, borderRadius: 12, padding }}>{children}</div>;
}
function Label({ text, sub }) {
    return <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: t.muted, marginBottom: sub ? 3 : 0 }}>{text}</div>
        {sub && <div style={{ fontSize: 12, color: t.subtle, lineHeight: 1.5 }}>{sub}</div>}
    </div>;
}
function Grid({ children, cols = 2, gap = 10 }) {
    return <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols},minmax(0,1fr))`, gap }}>{children}</div>;
}
function Stat({ label, value, sub, color = t.bright }) {
    return <div style={{ border: `1px solid ${t.border}`, background: t.bg2, borderRadius: 10, padding: "12px 14px" }}>
        <div style={{ fontSize: 10, color: t.subtle, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 5 }}>{label}</div>
        <div style={{ fontSize: 18, fontWeight: 700, color, lineHeight: 1.1 }}>{value}</div>
        {sub && <div style={{ fontSize: 11, color: t.subtle, marginTop: 3, lineHeight: 1.4 }}>{sub}</div>}
    </div>;
}
function Inp({ label, value, onChange, help }) {
    return <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <span style={{ fontSize: 12, color: t.body }}>{label}</span>
        <input type="number" value={value || ""} onChange={e => onChange(parseFloat(e.target.value) || 0)}
            style={{
                minHeight: 42, borderRadius: 8, border: `1px solid ${t.border}`, background: t.bg2,
                color: t.bright, padding: "8px 12px", fontSize: 14, outline: "none"
            }} />
        {help && <span style={{ fontSize: 11, color: t.subtle, marginTop: 2 }}>{help}</span>}
    </label>;
}
function Pill({ text, color = t.muted, bg = "transparent", border = t.border }) {
    return <span style={{
        fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 4, color,
        background: bg, border: `1px solid ${border}`, letterSpacing: "0.06em", whiteSpace: "nowrap"
    }}>{text}</span>;
}
function ILine({ item }) {
    const cfg = {
        lump: { icon: "💥", color: t.amber, bg: t.amberBg, border: t.amberD },
        focus: { icon: "🎯", color: t.green, bg: t.greenBg, border: t.greenD },
        minimum: { icon: "→", color: t.muted, bg: "transparent", border: t.border },
        overflow: { icon: "↩", color: t.blue, bg: t.blueBg, border: t.blueD },
        rule: { icon: "⚡", color: t.subtle, bg: "transparent", border: t.border }
    };
    const c = cfg[item.type] || cfg.rule;
    return <div style={{
        display: "flex", alignItems: "flex-start", gap: 10, padding: "9px 13px", borderRadius: 9,
        border: `1px solid ${c.border}`, background: c.bg, marginBottom: 5
    }}>
        <span style={{ fontSize: 15, lineHeight: 1, marginTop: 1, flexShrink: 0 }}>{c.icon}</span>
        <div style={{ flex: 1 }}>
            {item.debt && <div style={{ fontSize: 10, color: t.subtle, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 1 }}>{item.debt}</div>}
            <div style={{ fontSize: 13, color: c.color, fontWeight: item.type === "focus" || item.type === "lump" ? 600 : 400, lineHeight: 1.4 }}>{item.text}</div>
        </div>
        {item.amt && <div style={{ fontSize: 14, fontWeight: 700, color: c.color, flexShrink: 0 }}>{fmt(item.amt)}</div>}
    </div>;
}

// ─── SECTIONS ─────────────────────────────────────────────────────────────────

function TodayCard({ month, lumpSum, focus }) {
    if (!focus || !month) return null;
    const pm = focus.promoEnd ? monthsAway(focus.promoEnd) : null;
    const why = (pm !== null && pm <= 6) ? "Promo expires soon — will reset to high APR" :
        getEffApr(focus) >= 20 ? `Costs ${fmtD(ipm(focus.balance, getEffApr(focus)))}/month in interest` :
            "Smallest high-priority balance — fastest win";
    return (
        <Card border={t.amberD} bg={t.amberBg} padding={20}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: t.amber, marginBottom: 12 }}>
                What To Do Today
            </div>
            {[
                { icon: "🛡", label: "Keep in savings", value: fmt(Number(month?.pool || 2500)), color: t.muted },
                { icon: "💥", label: `Pay now → ${focus.name}`, value: fmt(lumpSum || 0), color: t.green, bold: true },
                { icon: "📌", label: "Why this debt first", value: why, color: t.amber, small: true },
                { icon: "⚡", label: "Non-negotiable rule", value: "No new credit card charges. Not one.", color: t.red, small: true },
            ].map((r, i) => (
                <div key={i} style={{
                    display: "flex", alignItems: "flex-start", gap: 12, padding: "10px 14px",
                    borderRadius: 9, background: t.bg1, border: `1px solid ${t.border}`, marginBottom: 6
                }}>
                    <span style={{ fontSize: 18, lineHeight: 1, flexShrink: 0, marginTop: 2 }}>{r.icon}</span>
                    <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 10, color: t.subtle, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 2 }}>{r.label}</div>
                        <div style={{ fontSize: r.small ? 13 : r.bold ? 20 : 16, fontWeight: r.bold ? 700 : r.small ? 400 : 600, color: r.color, lineHeight: 1.3 }}>{r.value}</div>
                    </div>
                </div>
            ))}
        </Card>
    );
}

function SafePay({ safeData, state, onUpdate }) {
    const [showHow, setShowHow] = useState(false);
    const freqLabel = { weekly: "weekly", biweekly: "biweekly", monthly: "monthly" }[safeData.freq] || "monthly";
    const fractionLabel = safeData.freq === "weekly" ? "¼ of monthly" : safeData.freq === "biweekly" ? "½ of monthly" : "full monthly";

    return (
        <Card border={t.border}>
            <Label text="Safe to Pay Today" sub="Calculated from your expenses, debts, and income schedule — only your savings balance needs to be set." />

            {/* The two numbers that matter */}
            <Grid cols={2} gap={10}>
                <div style={{ background: safeData.safe > 0 ? t.greenBg : t.redBg, border: `1px solid ${safeData.safe > 0 ? t.greenD : t.redD}`, borderRadius: 10, padding: "14px 16px" }}>
                    <div style={{ fontSize: 10, color: t.muted, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>Safe to send today</div>
                    <div style={{ fontSize: 26, fontWeight: 700, color: safeData.safe > 0 ? t.green : t.muted }}>{fmt(safeData.safe)}</div>
                    <div style={{ fontSize: 12, color: safeData.safe > 0 ? "#86efac" : "#f87171", marginTop: 4, lineHeight: 1.5 }}>
                        {safeData.safe > 0 ? "Send this to your focus debt now." : "Build your buffer before sending anything."}
                    </div>
                </div>
                <div style={{ background: t.bg2, border: `1px solid ${t.border}`, borderRadius: 10, padding: "14px 16px" }}>
                    <div style={{ fontSize: 10, color: t.muted, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>Keep in account</div>
                    <div style={{ fontSize: 26, fontWeight: 700, color: t.amber }}>{fmt(safeData.keep)}</div>
                    <div style={{ fontSize: 12, color: t.subtle, marginTop: 4, lineHeight: 1.5 }}>
                        Do not send more. You need this to avoid reusing the cards.
                    </div>
                </div>
            </Grid>

            {/* Savings input — the only thing user needs to enter */}
            <div style={{ marginTop: 14, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
                <div style={{ flex: "1 1 180px" }}>
                    <Inp label="Current savings balance ($)"
                        value={state.savingsBalance}
                        onChange={v => onUpdate({ ...state, savingsBalance: v })}
                        help={`Emergency buffer: ${fmt(Number(state.emergencyTarget) || 2500)} · Lump sum available: ${fmt(Math.max(0, (state.savingsBalance || 0) - (state.emergencyTarget || 2500)))}`} />
                </div>
                <div style={{ flex: "1 1 180px" }}>
                    <Inp label="Emergency buffer to keep ($)"
                        value={state.emergencyTarget}
                        onChange={v => onUpdate({ ...state, emergencyTarget: v })} />
                </div>
            </div>

            {/* How it's calculated — collapsible transparency */}
            <div style={{ marginTop: 12 }}>
                <button onClick={() => setShowHow(h => !h)}
                    style={{ fontSize: 12, color: t.subtle, background: "transparent", border: "none", cursor: "pointer", padding: 0, textDecoration: "underline" }}>
                    {showHow ? "▲ hide calculation" : "▼ how is this calculated?"}
                </button>
                {showHow && (
                    <div style={{ marginTop: 10, padding: "12px 14px", borderRadius: 9, background: t.bg2, border: `1px solid ${t.border}` }}>
                        <div style={{ fontSize: 12, color: t.muted, marginBottom: 8 }}>
                            You are paid <strong style={{ color: t.bright }}>{freqLabel}</strong>, so the app reserves <strong style={{ color: t.bright }}>{fractionLabel}</strong> of your monthly obligations as a cushion before your next paycheck.
                        </div>
                        {[
                            { label: "Savings on hand", value: fmt(safeData.cash), color: t.bright },
                            { label: "Emergency buffer", value: `− ${fmt(safeData.buffer)}`, color: t.red },
                            {
                                label: `Essential expenses (${fractionLabel})`, value: `− ${fmt(safeData.essentialBeforePaycheck)}`, color: t.red,
                                sub: `From your ${fmt(safeData.monthlyEssential)}/mo in essential expenses`
                            },
                            {
                                label: `Minimum payments (${fractionLabel})`, value: `− ${fmt(safeData.minsBeforePaycheck)}`, color: t.red,
                                sub: `From your ${fmt(safeData.monthlyMins)}/mo in minimums`
                            },
                        ].map((r, i) => (
                            <div key={i} style={{
                                display: "flex", justifyContent: "space-between", alignItems: "flex-start",
                                padding: "7px 0", borderBottom: i < 3 ? `1px solid ${t.border}` : "none"
                            }}>
                                <div>
                                    <div style={{ fontSize: 13, color: t.body }}>{r.label}</div>
                                    {r.sub && <div style={{ fontSize: 11, color: t.subtle, marginTop: 1 }}>{r.sub}</div>}
                                </div>
                                <span style={{ fontSize: 13, fontWeight: 600, color: r.color, flexShrink: 0, marginLeft: 16 }}>{r.value}</span>
                            </div>
                        ))}
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 8 }}>
                            <span style={{ fontSize: 13, fontWeight: 700, color: t.bright }}>Safe to send today</span>
                            <span style={{ fontSize: 15, fontWeight: 700, color: safeData.safe > 0 ? t.green : t.muted }}>{fmt(safeData.safe)}</span>
                        </div>
                    </div>
                )}
            </div>
        </Card>
    );
}

function PaycheckPlan({ state, onUpdate, prioritized }) {
    const [open, setOpen] = useState(false);
    const amt = Number(state.paycheckAmount) || 0;
    const bills = Number(state.paycheckBills) || 0;
    const mins = Number(state.paycheckMins) || 0;
    const ess = Number(state.paycheckEssentials) || 0;
    const attack = Math.max(0, amt - bills - mins - ess);
    const focus = prioritized[0];
    return (
        <Card border={t.border}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", marginBottom: amt > 0 ? 12 : 0 }} onClick={() => setOpen(o => !o)}>
                <Label text="Next Paycheck Plan" sub="Exact split of your next paycheck" />
                <span style={{ fontSize: 12, color: t.subtle, flexShrink: 0 }}>{open ? "▲ hide" : "▼ set up"}</span>
            </div>
            {amt > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: open ? 16 : 0 }}>
                    {[
                        { label: "Paycheck received", value: fmt(amt), color: t.green },
                        { label: "Hold for bills", value: `− ${fmt(bills)}`, color: t.red },
                        { label: "Hold for minimums", value: `− ${fmt(mins)}`, color: t.red },
                        { label: "Hold for essentials", value: `− ${fmt(ess)}`, color: t.red },
                        { label: `Send to ${focus?.name || "focus debt"}`, value: fmt(attack), color: t.amber, bold: true },
                    ].map((r, i) => (
                        <div key={i} style={{
                            display: "flex", justifyContent: "space-between", alignItems: "center",
                            padding: "9px 14px", borderRadius: 8,
                            background: r.bold ? t.amberBg : "transparent", border: `1px solid ${r.bold ? t.amberD : t.border}`
                        }}>
                            <span style={{ fontSize: 13, color: r.bold ? t.amber : t.body, fontWeight: r.bold ? 700 : 400 }}>{r.label}</span>
                            <span style={{ fontSize: 14, fontWeight: 700, color: r.color }}>{r.value}</span>
                        </div>
                    ))}
                </div>
            )}
            {open && (
                <div style={{ paddingTop: 16, borderTop: `1px solid ${t.border}` }}>
                    <Grid cols={2} gap={12}>
                        <Inp label="Paycheck amount ($)" value={state.paycheckAmount} onChange={v => onUpdate({ ...state, paycheckAmount: v })} />
                        <Inp label="Bills from this paycheck ($)" value={state.paycheckBills} onChange={v => onUpdate({ ...state, paycheckBills: v })} />
                        <Inp label="Minimum payments ($)" value={state.paycheckMins} onChange={v => onUpdate({ ...state, paycheckMins: v })} />
                        <Inp label="Essential spending ($)" value={state.paycheckEssentials} onChange={v => onUpdate({ ...state, paycheckEssentials: v })} />
                    </Grid>
                </div>
            )}
        </Card>
    );
}

function RiskSection({ risk }) {
    const oc = {
        green: { color: t.green, bg: t.greenBg, border: t.greenD, label: "Stable" },
        amber: { color: t.amber, bg: t.amberBg, border: t.amberD, label: "Watch" },
        red: { color: t.red, bg: t.redBg, border: t.redD, label: "Urgent" }
    }[risk.overall];
    return (
        <Card border={oc.border} bg={oc.bg}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: risk.flags.length ? 12 : 0 }}>
                <Label text="Risk Status" />
                <span style={{ fontSize: 12, fontWeight: 700, color: oc.color, background: t.bg1, border: `1px solid ${oc.border}`, borderRadius: 8, padding: "4px 12px" }}>{oc.label}</span>
            </div>
            {risk.flags.map((f, i) => (
                <div key={i} style={{
                    display: "flex", gap: 10, alignItems: "flex-start", padding: "8px 12px",
                    borderRadius: 8, background: t.bg1, border: `1px solid ${t.border}`, marginBottom: 5
                }}>
                    <span style={{ color: f.level === "red" ? t.red : t.amber, fontSize: 13, flexShrink: 0, marginTop: 1 }}>⚠</span>
                    <span style={{ fontSize: 13, color: f.level === "red" ? "#fca5a5" : "#fcd34d", lineHeight: 1.5 }}>{f.text}</span>
                </div>
            ))}
            {!risk.flags.length && <div style={{ fontSize: 13, color: t.green }}>No active risk flags. Keep executing the plan.</div>}
        </Card>
    );
}

function Promos({ promos }) {
    if (!promos.length) return null;
    const uc = { critical: { b: t.redD, bg: t.redBg, pill: t.red }, urgent: { b: t.amberD, bg: t.amberBg, pill: t.amber }, watch: { b: t.border, bg: t.bg1, pill: t.muted } };
    return (
        <Card border={t.border}>
            <Label text="Promo Deadlines" sub="These rates will reset. Time-sensitive." />
            {promos.map((p, i) => {
                const c = uc[p.urgency];
                return (
                    <div key={p.id || i} style={{ border: `1px solid ${c.b}`, background: c.bg, borderRadius: 10, padding: "12px 16px", marginBottom: 6 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6, marginBottom: 5 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ fontSize: 13, fontWeight: 600, color: t.bright }}>{p.name}</span>
                                <Pill text={p.urgency.toUpperCase()} color={c.pill} bg={c.bg} border={c.b} />
                            </div>
                            <span style={{ fontSize: 12, color: t.muted }}>{p.monthsRemaining}mo remaining</span>
                        </div>
                        <div style={{ fontSize: 13, color: t.body, marginBottom: 5 }}>
                            {fmt(p.balance)} at <strong style={{ color: t.green }}>{fmtPct(p.promoApr)}</strong> → resets to <strong style={{ color: t.red }}>{fmtPct(p.futureApr)}</strong>
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: c.pill }}>
                            Pay at least {fmtD(p.required)}/month to clear before reset.
                        </div>
                    </div>
                );
            })}
        </Card>
    );
}

function AttackOrder({ prioritized }) {
    const active = prioritized.filter(d => d.balance > 0);
    return (
        <Card border={t.border}>
            <Label text="Attack Order" sub="Pay in this exact order. Do not skip to another debt." />
            {active.map((d, i) => {
                const isFirst = i === 0;
                const pm = d.promoEnd ? monthsAway(d.promoEnd) : null;
                const soon = pm !== null && pm <= 6 && pm >= 0;
                return (
                    <div key={d.id} style={{
                        display: "flex", alignItems: "center", gap: 12, padding: "11px 14px",
                        borderRadius: 10, border: `1px solid ${isFirst ? t.amberD : t.border}`,
                        background: isFirst ? t.amberBg : t.bg2, marginBottom: 6
                    }}>
                        <div style={{
                            width: 24, height: 24, borderRadius: "50%", background: isFirst ? t.amber : t.border,
                            color: isFirst ? "#111" : t.subtle, fontSize: 12, fontWeight: 700,
                            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0
                        }}>{i + 1}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 2 }}>
                                <span style={{ fontSize: 14, fontWeight: isFirst ? 700 : 500, color: isFirst ? t.amber : t.bright }}>{d.name}</span>
                                {isFirst && <Pill text="FOCUS NOW" color="#111" bg={t.amber} border={t.amber} />}
                                {soon && <Pill text={pm <= 2 ? "CRITICAL" : "PROMO ENDING"} color={pm <= 2 ? t.red : t.amber} bg={pm <= 2 ? t.redBg : t.amberBg} border={pm <= 2 ? t.redD : t.amberD} />}
                            </div>
                            <div style={{ fontSize: 12, color: t.muted }}>
                                {fmt(d.balance)} · {fmtPct(getEffApr(d))} APR{soon && getFutApr(d) > getEffApr(d) && <span style={{ color: t.red }}> → {fmtPct(getFutApr(d))}</span>} · min {fmt(d.minPayment)}/mo
                            </div>
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: t.red }}>{fmtD(ipm(d.balance, getEffApr(d)))}/mo</div>
                            <div style={{ fontSize: 10, color: t.subtle }}>interest</div>
                        </div>
                    </div>
                );
            })}
        </Card>
    );
}

function ThisMonth({ month, lumpSum }) {
    if (!month) return null;
    return (
        <Card border={t.amberD} bg={t.amberBg} padding={20}>
            <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
                <div>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: t.amber, marginBottom: 3 }}>Month 1 — {month.label}</div>
                    <div style={{ fontSize: 19, fontWeight: 700, color: t.bright }}>Payment Instructions</div>
                </div>
                <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 10, color: t.subtle, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>Focus</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: t.amber }}>{month.focusDebt}</div>
                    {month.cleared && <div style={{ fontSize: 12, color: t.green }}>✓ Cleared this month</div>}
                </div>
            </div>
            <div style={{ marginBottom: 14 }}>{month.instructions.map((item, i) => <ILine key={i} item={item} />)}</div>
            <Grid cols={3} gap={8}>
                {[
                    { label: "Balance drop", value: fmt(month.focusBalance - month.balAfter), color: t.green },
                    { label: "Remaining", value: month.cleared ? "CLEARED" : fmt(month.balAfter), color: month.cleared ? t.green : t.bright },
                    { label: "Next target", value: month.nextTarget || "—", color: t.blue },
                ].map((s, i) => (
                    <div key={i} style={{ background: "#110e00", border: `1px solid ${t.amberD}`, borderRadius: 9, padding: "10px 12px" }}>
                        <div style={{ fontSize: 10, color: t.subtle, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 3 }}>{s.label}</div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: s.color, lineHeight: 1.2 }}>{s.value}</div>
                    </div>
                ))}
            </Grid>
        </Card>
    );
}

function MinWarnings({ dangers }) {
    if (!dangers.length) return null;
    const lc = { critical: { c: t.red, bg: t.redBg, b: t.redD }, danger: { c: t.red, bg: t.redBg, b: t.redD }, warning: { c: t.amber, bg: t.amberBg, b: t.amberD } };
    return (
        <Card border={t.border}>
            <Label text="Minimum Payment Warnings" sub="These debts are barely moving. Paying minimums here doesn't work." />
            {dangers.map((d, i) => {
                const lv = lc[d.level];
                return (
                    <div key={d.id || i} style={{ border: `1px solid ${lv.b}`, background: lv.bg, borderRadius: 9, padding: "10px 14px", marginBottom: 6 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                            <span style={{ fontSize: 13, fontWeight: 600, color: t.bright }}>{d.name}</span>
                            <Pill text={d.level.toUpperCase()} color={lv.c} bg={lv.bg} border={lv.b} />
                        </div>
                        <div style={{ fontSize: 13, color: lv.c, marginBottom: 4, fontWeight: 500 }}>{d.msg}</div>
                        <div style={{ fontSize: 12, color: t.muted }}>Payment {fmtD(d.payment)}/mo · Interest {fmtD(d.interest)}/mo · {fmtPct(d.share * 100)} of payment is interest</div>
                    </div>
                );
            })}
        </Card>
    );
}

function Lockout({ state, onUpdate, prioritized }) {
    const cards = (state.creditCards ?? []).filter(c => Number(c.balance) > 0 || Number(c.monthlySpend) > 0);
    if (!cards.length) return null;
    const focusId = prioritized[0]?.id;
    const lockouts = state.cardLockouts || {};
    const fields = [{ key: "noSpend", label: "No spending" }, { key: "autopayOff", label: "Autopay off" }, { key: "frozen", label: "Frozen" }, { key: "stored", label: "Card stored" }];
    function toggle(id, field) {
        const cur = lockouts[id] || {};
        onUpdate({ ...state, cardLockouts: { ...lockouts, [id]: { ...cur, [field]: !cur[field] } } });
    }
    return (
        <Card border={t.border}>
            <Label text="Card Lockout Tracker" sub="Recovery mode. Check off each step for every payoff card." />
            {cards.map(card => {
                const lock = lockouts[card.id] || {};
                const isFocus = card.id === focusId;
                const hasSpend = Number(card.monthlySpend) > 0;
                const done = fields.filter(f => lock[f.key]).length;
                return (
                    <div key={card.id} style={{
                        border: `1px solid ${hasSpend ? t.redD : isFocus ? t.amberD : t.border}`,
                        background: hasSpend ? t.redBg : isFocus ? t.amberBg : t.bg2, borderRadius: 10, padding: "12px 14px", marginBottom: 6
                    }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ fontSize: 13, fontWeight: 600, color: isFocus ? t.amber : t.bright }}>{card.name}</span>
                                {isFocus && <Pill text="FOCUS DEBT" color="#111" bg={t.amber} border={t.amber} />}
                                {hasSpend && <Pill text="⚠ NEW CHARGES" color={t.red} bg={t.redBg} border={t.redD} />}
                            </div>
                            <span style={{ fontSize: 11, color: t.subtle }}>{done}/{fields.length} done</span>
                        </div>
                        {hasSpend && <div style={{ fontSize: 13, color: t.red, marginBottom: 8, fontWeight: 600 }}>New charges detected ({fmt(card.monthlySpend)}/mo). This card is in recovery mode — do not use it.</div>}
                        {isFocus && !hasSpend && <div style={{ fontSize: 13, color: t.amber, marginBottom: 8 }}>This card is in recovery mode. Do not use it for new purchases.</div>}
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {fields.map(f => (
                                <button key={f.key} onClick={() => toggle(card.id, f.key)}
                                    style={{
                                        padding: "6px 11px", borderRadius: 7, fontSize: 12, cursor: "pointer", fontWeight: lock[f.key] ? 700 : 400,
                                        border: `1px solid ${lock[f.key] ? t.greenD : t.border}`,
                                        background: lock[f.key] ? t.greenBg : t.bg1, color: lock[f.key] ? t.green : t.muted
                                    }}>
                                    {lock[f.key] ? "✓ " : ""}{f.label}
                                </button>
                            ))}
                        </div>
                    </div>
                );
            })}
        </Card>
    );
}

function MilestoneSection({ milestones }) {
    return (
        <Card border={t.border}>
            <Label text="Milestones" />
            {milestones.completed.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 10, color: t.subtle, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>Achieved</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {milestones.completed.map((m, i) => (
                            <span key={i} style={{
                                background: t.greenBg, border: `1px solid ${t.greenD}`, borderRadius: 6,
                                padding: "4px 10px", fontSize: 12, color: "#86efac", fontWeight: 500
                            }}>✓ {m.label}</span>
                        ))}
                    </div>
                </div>
            )}
            <div style={{ fontSize: 10, color: t.subtle, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>Next wins</div>
            {milestones.upcoming.map((m, i) => (
                <div key={i} style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 8,
                    background: i === 0 ? t.amberBg : t.bg2, border: `1px solid ${i === 0 ? t.amberD : t.border}`, marginBottom: 5
                }}>
                    <span style={{ color: i === 0 ? t.amber : t.subtle, fontSize: 15 }}>{i === 0 ? "🎯" : "○"}</span>
                    <span style={{ fontSize: 13, color: i === 0 ? t.amber : t.muted }}>{m.label}</span>
                </div>
            ))}
        </Card>
    );
}

function Leaks({ leaks }) {
    if (!leaks.length) return null;
    return (
        <Card border={t.border}>
            <Label text="Spending Leaks" sub="Optional spending that's slowing your payoff date." />
            {leaks.map((l, i) => (
                <div key={i} style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "10px 14px", borderRadius: 8, background: t.bg2, border: `1px solid ${t.border}`, marginBottom: 5
                }}>
                    <div>
                        <div style={{ fontSize: 13, fontWeight: 500, color: t.bright, marginBottom: 2 }}>{l.category}</div>
                        <div style={{ fontSize: 12, color: t.muted }}>{fmt(l.optional)}/mo optional · {fmt(l.total)}/mo total</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: t.amber }}>+{l.monthsSaved}mo sooner</div>
                        <div style={{ fontSize: 11, color: t.subtle }}>if cut</div>
                    </div>
                </div>
            ))}
        </Card>
    );
}

function Roadmap({ months }) {
    const [expanded, setExpanded] = useState(null);
    const clearances = months.filter(m => m.cleared);
    return (
        <Card border={t.border}>
            <Label text="Payoff Roadmap" sub="Roll-forward sequence. Each cleared debt accelerates the next." />
            {clearances.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                    {clearances.map((m, i) => {
                        const isLast = i === clearances.length - 1;
                        return (
                            <div key={m.month} style={{ display: "flex", gap: 0 }}>
                                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 28, flexShrink: 0 }}>
                                    <div style={{ width: 12, height: 12, borderRadius: "50%", background: t.green, border: `2px solid ${t.greenD}`, marginTop: 14, flexShrink: 0 }} />
                                    {!isLast && <div style={{ width: 2, flex: 1, background: t.border, marginTop: 2 }} />}
                                </div>
                                <div style={{ paddingBottom: isLast ? 0 : 16, paddingLeft: 10, paddingTop: 10 }}>
                                    <div style={{ fontSize: 13, fontWeight: 600, color: t.green }}>✓ {m.focusDebt} cleared</div>
                                    <div style={{ fontSize: 12, color: t.muted }}>~{m.label} · Month {m.month}</div>
                                    {m.nextTarget && <div style={{ fontSize: 12, color: t.subtle, marginTop: 2 }}>→ {m.nextTarget} next · attack pool grows</div>}
                                </div>
                            </div>
                        );
                    })}
                    <div style={{ display: "flex", gap: 0, alignItems: "center", marginTop: 4 }}>
                        <div style={{ width: 28, display: "flex", justifyContent: "center", flexShrink: 0 }}>
                            <div style={{ width: 16, height: 16, borderRadius: "50%", background: t.amber }} />
                        </div>
                        <div style={{ paddingLeft: 10 }}>
                            <div style={{ fontSize: 14, fontWeight: 700, color: t.amber }}>Debt-free</div>
                            <div style={{ fontSize: 12, color: t.muted }}>~{clearances[clearances.length - 1]?.label}</div>
                        </div>
                    </div>
                </div>
            )}
            <div style={{ fontSize: 10, color: t.subtle, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>Month detail</div>
            {months.slice(0, 24).map(m => (
                <div key={m.month}>
                    <button onClick={() => setExpanded(expanded === m.month ? null : m.month)}
                        style={{
                            width: "100%", textAlign: "left", display: "flex", justifyContent: "space-between", alignItems: "center",
                            padding: "9px 12px", borderRadius: 8, marginBottom: 4, cursor: "pointer",
                            border: `1px solid ${m.cleared ? t.greenD : t.border}`,
                            background: m.cleared ? t.greenBg : expanded === m.month ? t.bg2 : "transparent"
                        }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <span style={{ fontSize: 11, color: t.subtle, width: 48, flexShrink: 0 }}>Mo {m.month}</span>
                            <span style={{ fontSize: 13, color: m.cleared ? t.green : t.body, fontWeight: m.cleared ? 600 : 400 }}>
                                {m.cleared ? `✓ ${m.focusDebt} cleared` : `→ ${m.focusDebt}`}
                            </span>
                            {m.cleared && m.nextTarget && <span style={{ fontSize: 12, color: t.subtle }}>→ {m.nextTarget}</span>}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                            <span style={{ fontSize: 12, color: t.muted }}>{fmt(m.balAfter)} left</span>
                            <span style={{ fontSize: 11, color: t.subtle }}>{expanded === m.month ? "▲" : "▼"}</span>
                        </div>
                    </button>
                    {expanded === m.month && (
                        <div style={{ padding: "6px 12px 4px", borderLeft: `2px solid ${t.border}`, marginLeft: 6, marginBottom: 4 }}>
                            {m.instructions.map((item, j) => <ILine key={j} item={item} />)}
                            <div style={{ fontSize: 11, color: t.subtle, marginTop: 6, display: "flex", gap: 16, paddingBottom: 4 }}>
                                <span>Interest: {fmtD(m.totalInterest)}</span>
                                <span>Attack pool: {fmt(m.pool)}/mo</span>
                            </div>
                        </div>
                    )}
                </div>
            ))}
        </Card>
    );
}

function Budget({ income, essential, minimums, surplus }) {
    return (
        <Card border={t.border}>
            <Label text="How the Surplus Is Calculated" />
            {[{ l: "Monthly net income", v: fmt(income), c: t.green, s: "+" }, { l: "Essential expenses", v: fmt(essential), c: t.red, s: "−" }, { l: "Minimum payments", v: fmt(minimums), c: t.red, s: "−" }].map((r, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderBottom: `1px solid ${t.border}` }}>
                    <span style={{ fontSize: 13, color: t.body }}>{r.l}</span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: r.c }}>{r.s} {r.v}</span>
                </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0" }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: t.bright }}>Monthly attack surplus</span>
                <span style={{ fontSize: 20, fontWeight: 700, color: surplus > 0 ? t.green : t.red }}>{fmt(surplus)}/mo</span>
            </div>
        </Card>
    );
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
export default function AttackMap({ state, onUpdate }) {
    const model = useMemo(() => {
        const { income, essential, minimums, surplus } = calcSurplus(state);
        const savingsBalance = Number(state.savingsBalance) || 0;
        const emergencyTarget = Number(state.emergencyTarget) || 2500;
        const lumpSum = Math.max(0, savingsBalance - emergencyTarget);
        const prioritized = prioritizeDebts(state.creditCards, state.loans);
        const safeData = calcSafeToPay(state);
        const promos = calcPromos(state.creditCards);
        const allDebts = normalizeDebts(state.creditCards, state.loans);
        const dangers = calcDangers(allDebts);
        const risk = calcRisk(state, surplus, prioritized, promos);
        const milestones = calcMilestones(state, prioritized);
        const leaks = calcLeaks(state, surplus);
        const months = prioritized.length > 0 && surplus > 0 ? simulate(prioritized, surplus, lumpSum) : [];
        const monthlyInterest = prioritized.reduce((s, d) => s + ipm(d.balance, getEffApr(d)), 0);
        return {
            income, essential, minimums, surplus, savingsBalance, emergencyTarget, lumpSum,
            prioritized, safeData, promos, dangers, risk, milestones, leaks, months, monthlyInterest
        };
    }, [state]);

    const hasDebts = model.prioritized.length > 0;
    const hasIncome = model.income > 0;
    const focus = model.prioritized[0] || null;

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 980, margin: "0 auto", padding: "0 0 48px" }}>
            <div>
                <h2 style={{ fontSize: 13, fontWeight: 700, color: t.bright, margin: "0 0 3px", letterSpacing: "0.04em", textTransform: "uppercase" }}>Debt Attack Map</h2>
                <p style={{ fontSize: 13, color: t.muted, margin: 0, lineHeight: 1.7 }}>You don't need to decide what to pay. This tells you what to pay first, how much, and why.</p>
            </div>

            {hasIncome && hasDebts && model.surplus > 0 && <TodayCard month={model.months[0]} lumpSum={model.lumpSum} focus={focus} />}
            <SafePay safeData={model.safeData} state={state} onUpdate={onUpdate} />

            {!hasIncome && <div style={{ border: `1px solid ${t.border}`, background: t.bg1, borderRadius: 12, padding: 20, textAlign: "center" }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: t.bright, marginBottom: 6 }}>Add your income first</div>
                <div style={{ fontSize: 13, color: t.muted }}>Go to the Income tab and enter your take-home pay.</div>
            </div>}

            {hasIncome && !hasDebts && <div style={{ border: `1px solid ${t.border}`, background: t.bg1, borderRadius: 12, padding: 20, textAlign: "center" }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: t.bright, marginBottom: 6 }}>Add your debts</div>
                <div style={{ fontSize: 13, color: t.muted }}>Go to the Debts tab and enter your cards and loans.</div>
            </div>}

            {hasIncome && hasDebts && model.surplus <= 0 && <div style={{ border: `1px solid ${t.redD}`, background: t.redBg, borderRadius: 12, padding: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: t.red, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>⚠ No Attack Surplus</div>
                <div style={{ fontSize: 13, color: "#fca5a5", lineHeight: 1.7 }}>
                    Income ({fmt(model.income)}) minus expenses ({fmt(model.essential)}) minus minimums ({fmt(model.minimums)}) leaves nothing to attack with. Review your expenses or find additional income.
                </div>
            </div>}

            {hasIncome && hasDebts && model.surplus > 0 && (<>
                <PaycheckPlan state={state} onUpdate={onUpdate} prioritized={model.prioritized} />
                <RiskSection risk={model.risk} />
                {model.promos.length > 0 && <Promos promos={model.promos} />}
                <AttackOrder prioritized={model.prioritized} />
                {model.months[0] && <ThisMonth month={model.months[0]} lumpSum={model.lumpSum} />}
                {model.dangers.length > 0 && <MinWarnings dangers={model.dangers} />}
                <Lockout state={state} onUpdate={onUpdate} prioritized={model.prioritized} />
                <MilestoneSection milestones={model.milestones} />
                {model.leaks.length > 0 && <Leaks leaks={model.leaks} />}
                {model.months.length > 1 && <Roadmap months={model.months} />}
                <Budget income={model.income} essential={model.essential} minimums={model.minimums} surplus={model.surplus} />
            </>)}
        </div>
    );
}
