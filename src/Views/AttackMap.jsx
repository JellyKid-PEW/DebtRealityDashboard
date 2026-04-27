import React, { useMemo, useState } from "react";
import { normalizeToMonthly } from "../calculations.js";

// ─── TOKENS ───────────────────────────────────────────────────────────────────

const t = {
    bg0:    "#080b10",
    bg1:    "#0f172a",
    bg2:    "#111827",
    border: "#1e293b",
    bright: "#e2e8f0",
    body:   "#cbd5e1",
    muted:  "#94a3b8",
    subtle: "#64748b",
    amber:  "#f59e0b",
    amberD: "#78350f",
    amberBg:"#1a1200",
    green:  "#22c55e",
    greenD: "#166534",
    greenBg:"#052e16",
    red:    "#ef4444",
    redD:   "#7f1d1d",
    redBg:  "#1c0707",
    blue:   "#38bdf8",
    blueBg: "#0c1a2e",
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function fmt(n) {
    const v = Math.abs(Number(n) || 0);
    return `$${v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function fmtExact(n) {
    return `$${Math.abs(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(n) {
    return `${(Number(n) || 0).toFixed(1)}%`;
}

function monthsAway(dateStr) {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    if (isNaN(d)) return null;
    const now = new Date();
    return (d.getFullYear() - now.getFullYear()) * 12 + (d.getMonth() - now.getMonth());
}

function addMonths(n) {
    const d = new Date();
    d.setMonth(d.getMonth() + n);
    return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function interestPerMonth(balance, apr) {
    return (Number(balance) || 0) * ((Number(apr) || 0) / 100) / 12;
}

// ─── DEBT PRIORITY ENGINE ─────────────────────────────────────────────────────
// Scores every active debt and returns them sorted by urgency.
// Priority logic:
//   1. Promo balances expiring within 6 months — highest urgency
//   2. Highest effective APR
//   3. Tie-break: smaller balance (quick win)
//   4. Low/no APR debts (mortgage, student loan, 0% cards) — deprioritized

function scoreDept(debt, nowMonth) {
    const effectiveApr = getEffectiveApr(debt);
    const balance = Number(debt.balance) || 0;
    if (balance <= 0) return -Infinity;

    // Promo expiry urgency: treated as "current APR will spike"
    const promoMonths = debt.promoEnd ? monthsAway(debt.promoEnd) : null;
    const isPromoExpiringSoon = promoMonths !== null && promoMonths <= 6 && promoMonths >= 0;
    const futureApr = Number(debt.apr) || 0;

    // Base score = effective APR × 1000 (so basis points matter)
    let score = effectiveApr * 1000;

    // Promo urgency boost: weight by how soon it expires and what the reset APR is
    if (isPromoExpiringSoon) {
        const urgencyMultiplier = (6 - promoMonths) / 6; // 0–1, higher = more urgent
        score += futureApr * 1000 * urgencyMultiplier * 0.8;
    }

    // Penalize very low APR debts (mortgage, student loans, 0% cards not expiring)
    if (effectiveApr < 5 && !isPromoExpiringSoon) score = effectiveApr * 10;

    // Tie-break: smaller balance scores slightly higher
    score += (1 / (balance + 1)) * 100;

    return score;
}

function getEffectiveApr(debt) {
    const promoApr = Number(debt.promoApr);
    if (promoApr > 0) return promoApr;
    return Number(debt.apr) || 0;
}

function prioritizeDebts(cards, loans) {
    const all = [
        ...(cards ?? []).map(c => ({
            ...c,
            _type: "card",
            balance: Number(c.balance) || 0,
            minPayment: Number(c.minPayment) || 0,
            monthlyPayment: Number(c.monthlyPayment) || Number(c.minPayment) || 0,
            monthlySpend: Number(c.monthlySpend) || 0,
        })),
        ...(loans ?? []).map(l => ({
            ...l,
            _type: "loan",
            balance: Number(l.balance) || 0,
            minPayment: Number(l.monthlyPayment) || 0,
            monthlyPayment: Number(l.monthlyPayment) || 0,
            monthlySpend: 0,
        })),
    ].filter(d => d.balance > 0);

    return [...all].sort((a, b) => scoreDept(b) - scoreDept(a));
}

// ─── SURPLUS CALCULATION ──────────────────────────────────────────────────────
// Real attack capacity = income - essential expenses - all minimums
// This is money the household can throw at debt beyond minimums.

function calcSurplus(state) {
    const income = (state.incomes ?? []).reduce(
        (sum, i) => sum + normalizeToMonthly(i.amount, i.frequency), 0
    );

    const essentialExpenses = (state.expenses ?? [])
        .filter(e => e.essential !== false)
        .reduce((sum, e) => sum + normalizeToMonthly(e.amount, e.frequency), 0);

    const allMinimums = [
        ...(state.creditCards ?? []).map(c => Number(c.minPayment) || 0),
        ...(state.loans ?? []).map(l => Number(l.monthlyPayment) || 0),
    ].reduce((a, b) => a + b, 0);

    const surplus = income - essentialExpenses - allMinimums;
    return { income, essentialExpenses, allMinimums, surplus: Math.max(0, surplus) };
}

// ─── EMERGENCY BUFFER RECOMMENDATION ─────────────────────────────────────────
// Recommended buffer = 1 month of essential expenses + minimums
// (reduced from the standard 3-6 months because stable income + strong position)
// Floor at $1,000, cap at $5,000 for aggressive paydown context.

function calcEmergencyBuffer(essentialExpenses, allMinimums) {
    const oneMonth = essentialExpenses + allMinimums;
    return Math.min(5000, Math.max(1000, Math.round(oneMonth * 0.5 / 100) * 100));
}

// ─── MONTH-BY-MONTH SIMULATION ────────────────────────────────────────────────
// Simulates the attack sequence month by month.
// Returns an array of month objects with exact instructions.

function simulateAttackMap(prioritized, surplus, lumpSum, maxMonths = 60) {
    if (!prioritized.length || surplus <= 0) return [];

    // Deep clone with working balances
    let debts = prioritized.map(d => ({ ...d, balance: Number(d.balance) || 0 }));
    let attackPool = surplus; // grows as debts clear
    const months = [];

    for (let m = 0; m < maxMonths; m++) {
        const activeDebts = debts.filter(d => d.balance > 0.01);
        if (!activeDebts.length) break;

        const focus = activeDebts[0];
        const rest = activeDebts.slice(1);

        // Month 1: apply lump sum first
        let lumpThisMonth = m === 0 ? lumpSum : 0;
        let balanceAfterLump = Math.max(0, focus.balance - lumpThisMonth);

        // Interest on focus debt (on remaining balance after lump)
        const focusInterest = interestPerMonth(balanceAfterLump, getEffectiveApr(focus));
        balanceAfterLump += focusInterest;

        // How much attack pool can go to focus
        let remainingPool = attackPool;
        const focusMinimum = focus.minPayment || 0;
        // Pool already covers focus minimum (it's included in minimums subtracted from income)
        // Extra pool = surplus above all minimums — goes entirely to focus
        const focusExtraPayment = Math.min(balanceAfterLump, remainingPool);
        const balanceAfterAttack = Math.max(0, balanceAfterLump - focusExtraPayment);
        const focusCleared = balanceAfterAttack <= 0.01;

        // Leftover pool if focus is cleared mid-month
        let leftover = focusCleared ? Math.max(0, focusExtraPayment - (balanceAfterLump)) : 0;

        // Next target gets leftover
        const nextTarget = rest[0] || null;
        let nextTargetPayment = 0;
        if (focusCleared && nextTarget && leftover > 0) {
            nextTargetPayment = Math.min(leftover, nextTarget.balance);
        }

        // Build month instructions
        const instructions = [];

        if (m === 0 && lumpThisMonth > 0) {
            instructions.push({
                type: "lump",
                text: `Deploy ${fmt(lumpThisMonth)} lump sum → ${focus.name}`,
                amount: lumpThisMonth,
                debt: focus.name,
            });
        }

        instructions.push({
            type: "focus",
            text: `Pay ${fmt(focusMinimum + focusExtraPayment + (m === 0 ? 0 : 0))}/mo → ${focus.name} (focus debt)`,
            amount: focusMinimum + (attackPool - (nextTarget && focusCleared ? leftover : 0)),
            debt: focus.name,
        });

        // Minimums on everything else
        for (const d of rest) {
            if (d.balance > 0.01) {
                instructions.push({
                    type: "minimum",
                    text: `Pay minimum ${fmt(d.minPayment)}/mo → ${d.name}`,
                    amount: d.minPayment,
                    debt: d.name,
                });
            }
        }

        if (focusCleared && nextTarget && nextTargetPayment > 0) {
            instructions.push({
                type: "overflow",
                text: `Send leftover ${fmt(nextTargetPayment)} → ${nextTarget.name}`,
                amount: nextTargetPayment,
                debt: nextTarget.name,
            });
        }

        instructions.push({
            type: "rule",
            text: "No new credit card charges this month",
        });

        months.push({
            month: m + 1,
            label: addMonths(m),
            focusDebt: focus.name,
            focusBalance: focus.balance,
            focusApr: getEffectiveApr(focus),
            balanceAfterMonth: balanceAfterAttack,
            focusCleared,
            lumpSum: lumpThisMonth,
            attackPool,
            nextTarget: nextTarget?.name || null,
            instructions,
            interestCost: focusInterest + rest.reduce((s, d) => s + interestPerMonth(d.balance, getEffectiveApr(d)), 0),
        });

        // Advance balances for next month
        debts = debts.map(d => {
            if (d.id === focus.id) return { ...d, balance: balanceAfterAttack };
            if (d.id === nextTarget?.id) return { ...d, balance: Math.max(0, d.balance - nextTargetPayment + interestPerMonth(d.balance, getEffectiveApr(d)) + d.monthlySpend) };
            const newBal = Math.max(0, d.balance + interestPerMonth(d.balance, getEffectiveApr(d)) + d.monthlySpend - d.minPayment);
            return { ...d, balance: newBal };
        });

        // Roll freed minimum into attack pool when focus clears
        if (focusCleared) {
            attackPool += focus.minPayment || 0;
        }
    }

    return months;
}

// ─── UI COMPONENTS ────────────────────────────────────────────────────────────

function SectionHeader({ label, sub }) {
    return (
        <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: t.muted, marginBottom: 3 }}>
                {label}
            </div>
            {sub && <div style={{ fontSize: 13, color: t.subtle, lineHeight: 1.5 }}>{sub}</div>}
        </div>
    );
}

function BigStat({ label, value, sub, color = t.bright, size = 28 }) {
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <div style={{ fontSize: 11, color: t.subtle, letterSpacing: "0.08em", textTransform: "uppercase" }}>{label}</div>
            <div style={{ fontSize: size, fontWeight: 700, color, lineHeight: 1.1 }}>{value}</div>
            {sub && <div style={{ fontSize: 12, color: t.subtle, lineHeight: 1.4 }}>{sub}</div>}
        </div>
    );
}

function Card({ children, border = t.border, bg = t.bg1, padding = 18 }) {
    return (
        <div style={{ border: `1px solid ${border}`, background: bg, borderRadius: 12, padding }}>
            {children}
        </div>
    );
}

function Row({ children, gap = 12 }) {
    return <div style={{ display: "flex", gap, flexWrap: "wrap", alignItems: "flex-start" }}>{children}</div>;
}

function Grid({ children, cols = 2, gap = 12 }) {
    return (
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap }}>
            {children}
        </div>
    );
}

function StatBox({ label, value, color = t.bright, sub }) {
    return (
        <div style={{ border: `1px solid ${t.border}`, background: t.bg2, borderRadius: 10, padding: "12px 14px" }}>
            <div style={{ fontSize: 11, color: t.subtle, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 5 }}>{label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color }}>{value}</div>
            {sub && <div style={{ fontSize: 11, color: t.subtle, marginTop: 3, lineHeight: 1.4 }}>{sub}</div>}
        </div>
    );
}

function InstructionLine({ item, index }) {
    const icons = { lump: "💥", focus: "🎯", minimum: "→", overflow: "↩", rule: "⚡" };
    const colors = { lump: t.amber, focus: t.green, minimum: t.muted, overflow: t.blue, rule: t.subtle };
    const bgs = { lump: t.amberBg, focus: t.greenBg, minimum: "transparent", overflow: t.blueBg, rule: "transparent" };
    const borders = { lump: t.amberD, focus: t.greenD, minimum: t.border, overflow: "#1e3a5f", rule: t.border };

    return (
        <div style={{
            display: "flex", alignItems: "flex-start", gap: 10,
            padding: "10px 14px", borderRadius: 9,
            border: `1px solid ${borders[item.type]}`,
            background: bgs[item.type],
            marginBottom: 6,
        }}>
            <span style={{ fontSize: 16, lineHeight: 1, marginTop: 1, flexShrink: 0 }}>{icons[item.type]}</span>
            <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, color: colors[item.type], fontWeight: item.type === "focus" || item.type === "lump" ? 600 : 400, lineHeight: 1.5 }}>
                    {item.text}
                </div>
            </div>
            {item.amount && (
                <div style={{ fontSize: 14, fontWeight: 700, color: colors[item.type], flexShrink: 0 }}>
                    {fmt(item.amount)}
                </div>
            )}
        </div>
    );
}

function PromoWarningBadge({ debt }) {
    const months = monthsAway(debt.promoEnd);
    if (months === null || months > 6 || months < 0) return null;
    return (
        <span style={{
            background: t.redBg, border: `1px solid ${t.redD}`,
            borderRadius: 5, padding: "2px 7px",
            fontSize: 11, color: t.red, fontWeight: 600,
            marginLeft: 8,
        }}>
            ⚠ promo ends {months === 0 ? "this month" : `in ${months}mo`}
        </span>
    );
}

// ─── POSITION SECTION ─────────────────────────────────────────────────────────

function PositionSection({ surplus, savingsBalance, emergencyTarget, lumpSum, monthlyInterest, isMobile }) {
    const dailyCost = monthlyInterest / 30;

    return (
        <Card border={t.border}>
            <SectionHeader
                label="Your Position"
                sub="The numbers that determine how fast you can attack."
            />

            {/* The cost of inaction — most viscerally important number */}
            <div style={{
                background: t.redBg, border: `1px solid ${t.redD}`,
                borderRadius: 10, padding: "14px 18px", marginBottom: 16,
                display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8,
            }}>
                <div>
                    <div style={{ fontSize: 12, color: "#f87171", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 2 }}>
                        Cost of doing nothing
                    </div>
                    <div style={{ fontSize: 13, color: "#fca5a5", lineHeight: 1.6 }}>
                        Your debt costs approximately{" "}
                        <strong style={{ color: t.red }}>{fmtExact(monthlyInterest)}/month</strong>{" "}
                        in interest — that's{" "}
                        <strong style={{ color: t.red }}>{fmtExact(dailyCost)}/day</strong>{" "}
                        just to stand still.
                    </div>
                </div>
            </div>

            <Grid cols={isMobile ? 2 : 4} gap={10}>
                <StatBox
                    label="Monthly Surplus"
                    value={fmt(surplus)}
                    color={surplus > 0 ? t.green : t.red}
                    sub="Income minus expenses minus minimums"
                />
                <StatBox
                    label="Savings on Hand"
                    value={fmt(savingsBalance)}
                    color={t.bright}
                    sub="Current balance"
                />
                <StatBox
                    label="Keep as Buffer"
                    value={fmt(emergencyTarget)}
                    color={t.amber}
                    sub="Recommended emergency reserve"
                />
                <StatBox
                    label="Deployable Now"
                    value={fmt(lumpSum)}
                    color={lumpSum > 0 ? t.green : t.muted}
                    sub="Lump sum ready to deploy"
                />
            </Grid>
        </Card>
    );
}

// ─── PRIORITY STACK SECTION ───────────────────────────────────────────────────

function PriorityStack({ prioritized, isMobile }) {
    const active = prioritized.filter(d => d.balance > 0);

    return (
        <Card border={t.border}>
            <SectionHeader
                label="Attack Order"
                sub="Debts ranked by urgency. Promo expirations and high APR first."
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {active.map((d, i) => {
                    const isFirst = i === 0;
                    const effectiveApr = getEffectiveApr(d);
                    const futureApr = Number(d.apr) || 0;
                    const promoMonths = d.promoEnd ? monthsAway(d.promoEnd) : null;
                    const isPromo = promoMonths !== null && promoMonths >= 0;
                    const monthly = interestPerMonth(d.balance, effectiveApr);

                    return (
                        <div key={d.id} style={{
                            display: "flex", alignItems: "center", gap: 12,
                            padding: "12px 14px", borderRadius: 10,
                            border: `1px solid ${isFirst ? t.amberD : t.border}`,
                            background: isFirst ? t.amberBg : t.bg2,
                        }}>
                            {/* Rank */}
                            <div style={{
                                width: 26, height: 26, borderRadius: "50%",
                                background: isFirst ? t.amber : t.border,
                                color: isFirst ? "#111" : t.subtle,
                                fontSize: 12, fontWeight: 700,
                                display: "flex", alignItems: "center", justifyContent: "center",
                                flexShrink: 0,
                            }}>
                                {i + 1}
                            </div>

                            {/* Name + badges */}
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 4, marginBottom: 3 }}>
                                    <span style={{ fontSize: 14, fontWeight: isFirst ? 700 : 500, color: isFirst ? t.amber : t.bright }}>
                                        {d.name}
                                    </span>
                                    {isFirst && (
                                        <span style={{ background: t.amber, color: "#111", fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4, letterSpacing: "0.08em" }}>
                                            FOCUS
                                        </span>
                                    )}
                                    {isPromo && <PromoWarningBadge debt={d} />}
                                </div>
                                <div style={{ fontSize: 12, color: t.muted, lineHeight: 1.5 }}>
                                    {fmt(d.balance)} balance · {fmtPct(effectiveApr)} APR
                                    {isPromo && futureApr > effectiveApr && (
                                        <span style={{ color: t.red }}> → resets to {fmtPct(futureApr)}</span>
                                    )}
                                    {" · "}min {fmt(d.minPayment)}/mo
                                </div>
                            </div>

                            {/* Monthly interest cost */}
                            <div style={{ textAlign: "right", flexShrink: 0 }}>
                                <div style={{ fontSize: 13, fontWeight: 600, color: t.red }}>{fmtExact(monthly)}/mo</div>
                                <div style={{ fontSize: 11, color: t.subtle }}>in interest</div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </Card>
    );
}

// ─── THIS MONTH CARD ──────────────────────────────────────────────────────────

function ThisMonthCard({ month, surplus, lumpSum }) {
    if (!month) return null;

    const balanceDrop = month.focusBalance - month.balanceAfterMonth - lumpSum;

    return (
        <Card border={t.amberD} bg={t.amberBg} padding={20}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
                <div>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: t.amber, marginBottom: 3 }}>
                        Month 1 — {month.label}
                    </div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: t.bright, lineHeight: 1.2 }}>
                        Your Attack Plan
                    </div>
                    <div style={{ fontSize: 13, color: t.muted, marginTop: 4 }}>
                        Exact instructions. Follow these and the plan works.
                    </div>
                </div>
                <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 11, color: t.subtle, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>Focus debt</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: t.amber }}>{month.focusDebt}</div>
                    {month.focusCleared && (
                        <div style={{ fontSize: 12, color: t.green, marginTop: 2 }}>✓ Cleared this month</div>
                    )}
                </div>
            </div>

            {/* Instructions */}
            <div style={{ marginBottom: 16 }}>
                {month.instructions.map((item, i) => (
                    <InstructionLine key={i} item={item} index={i} />
                ))}
            </div>

            {/* Month summary stats */}
            <Grid cols={3} gap={8}>
                <div style={{ border: `1px solid ${t.amberD}`, background: "#110e00", borderRadius: 9, padding: "10px 12px" }}>
                    <div style={{ fontSize: 11, color: t.subtle, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>Balance drop</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: t.green }}>
                        {fmt(month.focusBalance - month.balanceAfterMonth)}
                    </div>
                    <div style={{ fontSize: 11, color: t.subtle }}>off {month.focusDebt}</div>
                </div>
                <div style={{ border: `1px solid ${t.amberD}`, background: "#110e00", borderRadius: 9, padding: "10px 12px" }}>
                    <div style={{ fontSize: 11, color: t.subtle, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>Remaining</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: month.focusCleared ? t.green : t.bright }}>
                        {month.focusCleared ? "CLEARED" : fmt(month.balanceAfterMonth)}
                    </div>
                    <div style={{ fontSize: 11, color: t.subtle }}>on {month.focusDebt}</div>
                </div>
                <div style={{ border: `1px solid ${t.amberD}`, background: "#110e00", borderRadius: 9, padding: "10px 12px" }}>
                    <div style={{ fontSize: 11, color: t.subtle, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>Next target</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: t.blue, lineHeight: 1.2 }}>
                        {month.nextTarget || "—"}
                    </div>
                    <div style={{ fontSize: 11, color: t.subtle }}>after this</div>
                </div>
            </Grid>
        </Card>
    );
}

// ─── ROADMAP SECTION ──────────────────────────────────────────────────────────

function RoadmapSection({ months }) {
    const [expanded, setExpanded] = useState(null);
    const clearanceMonths = months.filter(m => m.focusCleared);

    return (
        <Card border={t.border}>
            <SectionHeader
                label="What Happens Next"
                sub="The roll-forward sequence. Each cleared debt makes the next one faster."
            />

            {/* Clearance milestones */}
            {clearanceMonths.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 12, color: t.subtle, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>
                        Projected milestones
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                        {clearanceMonths.map((m, i) => {
                            const isLast = i === clearanceMonths.length - 1;
                            return (
                                <div key={m.month} style={{ display: "flex", gap: 0, alignItems: "stretch" }}>
                                    {/* Timeline line */}
                                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 28, flexShrink: 0 }}>
                                        <div style={{
                                            width: 12, height: 12, borderRadius: "50%",
                                            background: t.green, border: `2px solid ${t.greenD}`,
                                            marginTop: 14, flexShrink: 0,
                                        }} />
                                        {!isLast && <div style={{ width: 2, flex: 1, background: t.border, marginTop: 2 }} />}
                                    </div>
                                    {/* Content */}
                                    <div style={{ paddingBottom: isLast ? 0 : 16, paddingLeft: 10, paddingTop: 10 }}>
                                        <div style={{ fontSize: 13, fontWeight: 600, color: t.green }}>
                                            ✓ {m.focusDebt} cleared
                                        </div>
                                        <div style={{ fontSize: 12, color: t.muted }}>
                                            ~{m.label} · Month {m.month}
                                        </div>
                                        {m.nextTarget && (
                                            <div style={{ fontSize: 12, color: t.subtle, marginTop: 2 }}>
                                                Attack pool grows · next target: {m.nextTarget}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                        {/* Debt free */}
                        {clearanceMonths.length > 0 && (
                            <div style={{ display: "flex", gap: 0, alignItems: "center" }}>
                                <div style={{ width: 28, display: "flex", justifyContent: "center", flexShrink: 0 }}>
                                    <div style={{ width: 16, height: 16, borderRadius: "50%", background: t.amber }} />
                                </div>
                                <div style={{ paddingLeft: 10 }}>
                                    <div style={{ fontSize: 14, fontWeight: 700, color: t.amber }}>Debt-free</div>
                                    <div style={{ fontSize: 12, color: t.muted }}>~{clearanceMonths[clearanceMonths.length - 1]?.label}</div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Month-by-month expandable list */}
            <div style={{ fontSize: 12, color: t.subtle, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>
                Month-by-month detail
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {months.slice(0, 24).map((m, i) => (
                    <div key={m.month}>
                        <button
                            onClick={() => setExpanded(expanded === m.month ? null : m.month)}
                            style={{
                                width: "100%", textAlign: "left",
                                display: "flex", justifyContent: "space-between", alignItems: "center",
                                padding: "10px 12px", borderRadius: 8,
                                border: `1px solid ${m.focusCleared ? t.greenD : t.border}`,
                                background: m.focusCleared ? t.greenBg : expanded === m.month ? t.bg2 : "transparent",
                                cursor: "pointer", gap: 8,
                            }}
                        >
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                <span style={{ fontSize: 11, color: t.subtle, width: 52, flexShrink: 0 }}>
                                    Mo {m.month}
                                </span>
                                <span style={{ fontSize: 13, color: m.focusCleared ? t.green : t.body, fontWeight: m.focusCleared ? 600 : 400 }}>
                                    {m.focusCleared ? `✓ ${m.focusDebt} cleared` : `→ ${m.focusDebt}`}
                                </span>
                                {m.focusCleared && m.nextTarget && (
                                    <span style={{ fontSize: 12, color: t.subtle }}>→ {m.nextTarget} next</span>
                                )}
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
                                <span style={{ fontSize: 12, color: t.muted }}>{fmt(m.balanceAfterMonth)} left</span>
                                <span style={{ fontSize: 12, color: t.subtle }}>{expanded === m.month ? "▲" : "▼"}</span>
                            </div>
                        </button>

                        {expanded === m.month && (
                            <div style={{ padding: "10px 12px 4px", borderLeft: `2px solid ${t.border}`, marginLeft: 6, marginBottom: 4 }}>
                                {m.instructions.map((item, j) => (
                                    <InstructionLine key={j} item={item} index={j} />
                                ))}
                                <div style={{ display: "flex", gap: 16, marginTop: 8, marginBottom: 4, fontSize: 12, color: t.subtle }}>
                                    <span>Interest this month: {fmtExact(m.interestCost)}</span>
                                    <span>Attack pool: {fmt(m.attackPool)}/mo</span>
                                </div>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </Card>
    );
}

// ─── SAVINGS CONFIG ───────────────────────────────────────────────────────────

function SavingsConfig({ state, onUpdate }) {
    const savingsBalance = Number(state.savingsBalance) || 0;
    const emergencyTarget = Number(state.emergencyTarget) || 2500;

    return (
        <Card border={t.border}>
            <SectionHeader
                label="Savings & Buffer"
                sub="Set your current savings and how much to keep as an emergency buffer. The rest becomes your lump sum."
            />
            <Grid cols={2} gap={12}>
                <div>
                    <div style={{ fontSize: 13, color: t.body, marginBottom: 6 }}>Current savings balance ($)</div>
                    <input
                        type="number"
                        value={savingsBalance || ""}
                        onChange={e => onUpdate({ ...state, savingsBalance: parseFloat(e.target.value) || 0 })}
                        style={{
                            width: "100%", minHeight: 44, borderRadius: 9,
                            border: `1px solid ${t.border}`, background: t.bg2,
                            color: t.bright, padding: "10px 12px", fontSize: 15,
                            outline: "none", boxSizing: "border-box",
                        }}
                    />
                </div>
                <div>
                    <div style={{ fontSize: 13, color: t.body, marginBottom: 6 }}>Emergency buffer to keep ($)</div>
                    <input
                        type="number"
                        value={emergencyTarget || ""}
                        onChange={e => onUpdate({ ...state, emergencyTarget: parseFloat(e.target.value) || 0 })}
                        style={{
                            width: "100%", minHeight: 44, borderRadius: 9,
                            border: `1px solid ${t.border}`, background: t.bg2,
                            color: t.bright, padding: "10px 12px", fontSize: 15,
                            outline: "none", boxSizing: "border-box",
                        }}
                    />
                    <div style={{ fontSize: 12, color: t.subtle, marginTop: 5 }}>
                        Lump sum available: <strong style={{ color: t.green }}>{fmt(Math.max(0, savingsBalance - emergencyTarget))}</strong>
                    </div>
                </div>
            </Grid>
        </Card>
    );
}

// ─── EMPTY STATE ──────────────────────────────────────────────────────────────

function EmptyState({ reason }) {
    return (
        <Card border={t.border}>
            <div style={{ padding: "20px 0", textAlign: "center" }}>
                <div style={{ fontSize: 28, marginBottom: 12 }}>🗺️</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: t.bright, marginBottom: 6 }}>Attack Map needs more data</div>
                <div style={{ fontSize: 13, color: t.muted, lineHeight: 1.7 }}>{reason}</div>
            </div>
        </Card>
    );
}

// ─── MAIN EXPORT ──────────────────────────────────────────────────────────────

export default function AttackMap({ state, onUpdate }) {
    const isMobile = window.innerWidth <= 768;

    const model = useMemo(() => {
        const { income, essentialExpenses, allMinimums, surplus } = calcSurplus(state);
        const savingsBalance = Number(state.savingsBalance) || 0;
        const emergencyTarget = Number(state.emergencyTarget) ||
            calcEmergencyBuffer(essentialExpenses, allMinimums);
        const lumpSum = Math.max(0, savingsBalance - emergencyTarget);

        const prioritized = prioritizeDebts(state.creditCards, state.loans);

        // Monthly interest across all debts
        const monthlyInterest = prioritized.reduce(
            (s, d) => s + interestPerMonth(d.balance, getEffectiveApr(d)), 0
        );

        const months = prioritized.length > 0 && surplus > 0
            ? simulateAttackMap(prioritized, surplus, lumpSum)
            : [];

        return {
            income,
            essentialExpenses,
            allMinimums,
            surplus,
            savingsBalance,
            emergencyTarget,
            lumpSum,
            prioritized,
            monthlyInterest,
            months,
        };
    }, [state]);

    const hasDebts = model.prioritized.length > 0;
    const hasIncome = model.income > 0;
    const hasExpenses = model.essentialExpenses > 0 || model.allMinimums > 0;

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 980, margin: "0 auto", padding: "0 0 48px" }}>

            {/* Header */}
            <div>
                <h2 style={{ fontSize: 14, fontWeight: 700, color: t.bright, margin: "0 0 4px", letterSpacing: "0.04em", textTransform: "uppercase" }}>
                    Debt Attack Map
                </h2>
                <p style={{ fontSize: 13, color: t.muted, margin: 0, lineHeight: 1.7 }}>
                    You don't need to decide what to pay. This tells you exactly what to pay first, how much, and why.
                </p>
            </div>

            {/* Savings config — always show so user can fill in */}
            <SavingsConfig state={state} onUpdate={onUpdate} />

            {/* Validation */}
            {!hasIncome && (
                <EmptyState reason="Add your income sources in the Income tab. The attack map needs to know what you bring home each month." />
            )}
            {hasIncome && !hasDebts && (
                <EmptyState reason="Add your debts in the Debts tab. Once you have active debts, the attack map will build your plan." />
            )}
            {hasIncome && hasDebts && model.surplus <= 0 && (
                <Card border={t.redD} bg={t.redBg}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: t.red, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                        ⚠ No Attack Surplus
                    </div>
                    <div style={{ fontSize: 13, color: "#fca5a5", lineHeight: 1.7 }}>
                        Your income ({fmt(model.income)}) minus essential expenses ({fmt(model.essentialExpenses)}) minus minimum debt payments ({fmt(model.allMinimums)}) leaves{" "}
                        <strong>{fmt(model.surplus)}</strong> — nothing extra to attack with.
                        Review your expenses or look for income to unlock the plan.
                    </div>
                </Card>
            )}

            {hasIncome && hasDebts && model.surplus > 0 && (
                <>
                    {/* Position */}
                    <PositionSection
                        surplus={model.surplus}
                        savingsBalance={model.savingsBalance}
                        emergencyTarget={model.emergencyTarget}
                        lumpSum={model.lumpSum}
                        monthlyInterest={model.monthlyInterest}
                        isMobile={isMobile}
                    />

                    {/* Attack order */}
                    <PriorityStack prioritized={model.prioritized} isMobile={isMobile} />

                    {/* This month's instructions */}
                    <ThisMonthCard
                        month={model.months[0]}
                        surplus={model.surplus}
                        lumpSum={model.lumpSum}
                    />

                    {/* Roadmap */}
                    {model.months.length > 1 && (
                        <RoadmapSection months={model.months} />
                    )}

                    {/* Budget breakdown — transparency */}
                    <Card border={t.border}>
                        <SectionHeader label="How the Numbers Work" sub="Where the surplus comes from." />
                        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                            {[
                                { label: "Monthly net income", value: fmt(model.income), color: t.green, sign: "+" },
                                { label: "Essential expenses", value: fmt(model.essentialExpenses), color: t.red, sign: "−" },
                                { label: "Minimum debt payments", value: fmt(model.allMinimums), color: t.red, sign: "−" },
                            ].map((row, i) => (
                                <div key={i} style={{
                                    display: "flex", justifyContent: "space-between", alignItems: "center",
                                    padding: "9px 0", borderBottom: `1px solid ${t.border}`,
                                }}>
                                    <span style={{ fontSize: 13, color: t.body }}>{row.label}</span>
                                    <span style={{ fontSize: 14, fontWeight: 600, color: row.color }}>
                                        {row.sign} {row.value}
                                    </span>
                                </div>
                            ))}
                            <div style={{
                                display: "flex", justifyContent: "space-between", alignItems: "center",
                                padding: "12px 0", marginTop: 2,
                            }}>
                                <span style={{ fontSize: 14, fontWeight: 700, color: t.bright }}>Monthly attack surplus</span>
                                <span style={{ fontSize: 20, fontWeight: 700, color: model.surplus > 0 ? t.green : t.red }}>
                                    {fmt(model.surplus)}/mo
                                </span>
                            </div>
                        </div>
                    </Card>
                </>
            )}
        </div>
    );
}
