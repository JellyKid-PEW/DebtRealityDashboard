/**
 * Plan.jsx — Trajectory tab (the chart view).
 *
 * Shows the snowball debt payoff curve, clearance event markers,
 * projected debt-free date, and attack order list.
 *
 * This is a read-only view — no state changes happen here.
 * For payment instructions, the user should use the Attack Map tab.
 */
import React, { useMemo } from "react";
import {
    LineChart, Line, XAxis, YAxis, Tooltip,
    ReferenceLine, ResponsiveContainer,
} from "recharts";
import { normalizeToMonthly, normalizeDebtsForRanking, rankDebtsCanonical } from "../calculations.js";

// ─── COMPLETED DEBTS ───────────────────────────────────────────────────────────

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

// ─── COMPLETED DEBTS ───────────────────────────────────────────────────────────

function fmt(n) {
    return `$${(Number(n) || 0).toLocaleString(undefined, {
        minimumFractionDigits: 0, maximumFractionDigits: 0,
    })}`;
}

function fmtPct(n) { return `${(Number(n) || 0).toFixed(1)}%`; }

function sumArr(arr, fn) { return (arr || []).reduce((a, x) => a + fn(x), 0); }

function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }

function addMonths(d, n) { return new Date(d.getFullYear(), d.getMonth() + n, 1); }

function effectiveApr(debt, monthOffset, nowMonth) {
    const regular = Number(debt.apr) || 0;
    const promo = Number(debt.promoApr) > 0 ? Number(debt.promoApr) : null;
    // normalizeDebtsForRanking stores the date in promoEnd (as a Date object)
    const promoEnd = debt.promoEnd || null;
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

// ─── DATA BUILDERS ─────────────────────────────────────────────────────────

function buildDebts(state) {
    // Use shared canonical normalization so Plan and AttackMap always work from same data
    return normalizeDebtsForRanking(state.creditCards, state.loans);
}

function buildCompleted(state) {
    return [
        ...(state.creditCards ?? []).filter(c => (Number(c.balance) || 0) === 0 && c.name)
            .map(c => ({ id: c.id, name: c.name, type: "card" })),
        ...(state.loans ?? []).filter(l => (Number(l.balance) || 0) === 0 && l.name)
            .map(l => ({ id: l.id, name: l.name, type: "loan" })),
    ];
}

// ─── CASH FLOW ──────────────────────────────────────────────────────────────

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

// ─── TRAJECTORY (for chart) ────────────────────────────────────────────────

// Color palette for individual debt lines
const DEBT_COLORS = [
    "#ef4444", // red
    "#f59e0b", // amber
    "#38bdf8", // blue
    "#a78bfa", // purple
    "#34d399", // emerald
    "#fb923c", // orange
    "#e879f9", // fuchsia
    "#4ade80", // green
    "#f472b6", // pink
    "#67e8f9", // cyan
];

function buildTrajectory(debts, attackCapacity, lumpSum, nowMonth, maxMonths = 84) {
    if (!debts.length) return { data: [{ month: 0, label: "Now", total: 0 }], events: [], debtKeys: [] };

    // Assign a stable color to each debt by its original index
    const debtColors = {};
    debts.forEach((d, i) => { debtColors[d.id] = DEBT_COLORS[i % DEBT_COLORS.length]; });
    const debtKeys = debts.map(d => ({ id: d.id, name: d.name, color: debtColors[d.id] }));

    let working = debts.map(d => ({ ...d, balance: Number(d.balance) || 0 }));
    let pool = attackCapacity;
    let lumpRemaining = lumpSum;

    // Build initial data point with per-debt balances
    const makePoint = (month, label, ws) => {
        const pt = { month, label, total: Math.max(0, Math.round(sumArr(ws, d => d.balance))) };
        debts.forEach(d => { pt[d.id] = Math.round(ws.find(w => w.id === d.id)?.balance ?? 0); });
        return pt;
    };

    const data = [makePoint(0, "Now", working)];
    const events = [];

    for (let m = 1; m <= maxMonths; m++) {
        if (working.length > 1) working = rankDebtsCanonical(working);
        if (!working.length) {
            // Pad all debt balances to 0 at clearance
            const zeroPt = { month: m, label: monthLabel(m, nowMonth), total: 0 };
            debts.forEach(d => { zeroPt[d.id] = 0; });
            data.push(zeroPt);
            break;
        }

        if (m === 1 && lumpRemaining > 0) {
            working[0].balance = Math.max(0, working[0].balance - lumpRemaining);
            lumpRemaining = 0;
        }

        for (const d of working) {
            d.balance += Number(d.monthlySpend) || 0;
            d.balance += monthInterest(d.balance, effectiveApr(d, m - 1, nowMonth));
            d.balance = Math.max(0, d.balance);
        }

        const totalMin = sumArr(working, d => d.minPayment || 0);
        let payPool = totalMin + pool;
        const focus = working[0];
        const others = working.slice(1);

        for (const d of others) {
            const pay = Math.min(d.balance, d.minPayment || 0);
            d.balance = Math.max(0, d.balance - pay);
            payPool -= pay;
        }
        focus.balance = Math.max(0, focus.balance - Math.min(focus.balance, payPool));

        const cleared = working.filter(d => d.balance <= 0.01);
        if (cleared.length) {
            events.push({ month: m, label: monthLabel(m, nowMonth), names: cleared.map(d => d.name) });
            pool += sumArr(cleared, d => d.minPayment || 0);
        }
        working = working.filter(d => d.balance > 0.01);

        // Build data point — cleared debts get 0, others get current balance
        const pt = { month: m, label: monthLabel(m, nowMonth), total: Math.max(0, Math.round(sumArr(working, d => d.balance))) };
        debts.forEach(d => { pt[d.id] = Math.round(working.find(w => w.id === d.id)?.balance ?? 0); });
        data.push(pt);
        if (pt.total === 0) break;
    }

    return { data, events, debtKeys };
}

// ─── CHART COMPONENT ───────────────────────────────────────────────────────────

function TrajectoryChart({ data, events, totalDebt, debtKeys }) {
    if (!data.length) return null;

    const payoffPt = data.find(p => p.total === 0);
    const finalPt = data[data.length - 1];
    const maxY = (data[0]?.total || totalDebt) * 1.06;
    const len = data.length;
    const step = len > 48 ? 12 : len > 24 ? 6 : len > 12 ? 3 : 1;
    const ticks = data.filter(p => p.month === 0 || p.month % step === 0).map(p => p.month);
    // debtKeys: [{ id, name, color }] — used for per-debt lines and legend

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

            {/* Per-debt color legend */}
            {debtKeys && debtKeys.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                    {debtKeys.map(dk => (
                        <div key={dk.id} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11 }}>
                            <span style={{ display: "inline-block", width: 20, height: 3, borderRadius: 2, background: dk.color, flexShrink: 0 }} />
                            <span style={{ color: t.body }}>{dk.name}</span>
                        </div>
                    ))}
                </div>
            )}

            <ResponsiveContainer width="100%" height={260}>
                <LineChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
                    <XAxis dataKey="month" ticks={ticks}
                        tickFormatter={m => data.find(p => p.month === m)?.label ?? ""}
                        tick={{ fill: t.muted, fontSize: 10 }} axisLine={{ stroke: t.border }} tickLine={false} />
                    <YAxis tickFormatter={v => v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`}
                        tick={{ fill: t.muted, fontSize: 10 }} axisLine={false} tickLine={false}
                        domain={[0, maxY]} width={52} />
                    <Tooltip
                        contentStyle={{ background: t.bg1, border: `1px solid ${t.border}`, borderRadius: 8, fontSize: 12, color: t.bright }}
                        labelFormatter={m => {
                            const pt = data.find(p => p.month === m);
                            const ev = events.find(e => e.month === m);
                            return ev ? `${pt?.label} — ${ev.names.join(" + ")} cleared` : pt?.label ?? `Month ${m}`;
                        }}
                        formatter={(v, key) => {
                            if (!debtKeys) return [`$${(v||0).toLocaleString()}`, key];
                            const dk = debtKeys.find(d => d.id === key);
                            return [`$${(v||0).toLocaleString()}`, dk?.name ?? key];
                        }}
                    />
                    {/* Today marker */}
                    <ReferenceLine x={0} stroke={t.amber} strokeDasharray="4 3"
                        label={{ value: "Today", fill: t.amber, fontSize: 10, position: "insideTopRight" }} />
                    {/* Clearance markers — vertical lines only, no labels (names are in legend) */}
                    {events.map(ev => (
                        <ReferenceLine key={ev.month} x={ev.month} stroke={t.green}
                            strokeDasharray="3 3" strokeOpacity={0.5} />
                    ))}
                    {/* One colored line per debt */}
                    {debtKeys.map(dk => (
                        <Line key={dk.id} type="monotone" dataKey={dk.id}
                            stroke={dk.color} strokeWidth={2} dot={false}
                            activeDot={{ r: 4, fill: dk.color, strokeWidth: 0 }} />
                    ))}
                </LineChart>
            </ResponsiveContainer>

            {/* Clearance events below chart */}
            {events.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${t.border}` }}>
                    {events.map(ev => (
                        <div key={ev.month} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12 }}>
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

// ─── COMPLETED DEBTS ───────────────────────────────────────────────────────────

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

// ─── CHART COMPONENT ───────────────────────────────────────────────────────────

export default function Plan({ state }) {
    const isMobile = window.innerWidth <= 768;
    const nowMonth = useMemo(() => startOfMonth(new Date()), []);

    const model = useMemo(() => {
        const debts = buildDebts(state);
        const completed = buildCompleted(state);
        const ranked = rankDebtsCanonical(debts);
        const cashFlow = calcCashFlow(state);

        const attackCapacity = Math.max(0, cashFlow.attackCapacity);
        const lumpSumAvailable = Math.max(0,
            (Number(state.savingsBalance) || 0) - (Number(state.emergencyTarget) || 2500)
        );

        const { data: trajData, events: trajEvents, debtKeys } = buildTrajectory(
            ranked, attackCapacity, lumpSumAvailable, nowMonth
        );

        const totalDebt = sumArr(debts, d => d.balance);
        const monthlyInterest = sumArr(debts, d => monthInterest(d.balance, effectiveApr(d, 0, nowMonth)));
        const payoffMonth = trajData.find(p => p.total === 0)?.month ?? null;

        return {
            debts, completed, ranked, cashFlow,
            attackCapacity, lumpSumAvailable,
            trajData, trajEvents, debtKeys,
            totalDebt, monthlyInterest, payoffMonth,
        };
    }, [state]);

    if (!model.debts.length) {
        return (
            <div style={{ border: `1px solid ${t.border}`, background: t.bg1, borderRadius: 12, padding: 24 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: t.bright, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                    Trajectory
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
                    Trajectory
                </h2>
                <p style={{ fontSize: 13, color: t.muted, margin: 0, lineHeight: 1.7 }}>
                    The big-picture view — snowball curve, phase breakdown, and projected payoff date. For payment instructions, use Attack Map.
                </p>
            </div>

            {/* Wins — cleared debts shown as motivation */}
            {model.completed.length > 0 && <CompletedDebts completed={model.completed} />}

            {/* Key stats */}
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(3, 1fr)", gap: 12 }}>
                {[
                    { label: "Total Debt", value: fmt(model.totalDebt), color: t.bright },
                    { label: "Monthly Interest", value: fmt(model.monthlyInterest), color: t.red, sub: "Cost of carrying this debt" },
                    { label: "Projected Payoff", value: model.payoffMonth ? monthLabel(model.payoffMonth, nowMonth) : "60mo+", color: t.green },
                ].map(s => (
                    <div key={s.label} style={{ border: `1px solid ${t.border}`, background: t.bg1, borderRadius: 12, padding: 14 }}>
                        <div style={{ fontSize: 12, color: t.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>{s.label}</div>
                        <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
                        {s.sub && <div style={{ fontSize: 12, color: t.subtle, marginTop: 4 }}>{s.sub}</div>}
                    </div>
                ))}
            </div>

            {/* Trajectory chart — the main view */}
            <TrajectoryChart
                data={model.trajData}
                events={model.trajEvents}
                totalDebt={model.totalDebt}
                debtKeys={model.debtKeys}
            />

            {/* Attack order — context for the chart, not instructions */}
            <div style={{ border: `1px solid ${t.border}`, background: t.bg1, borderRadius: 12, padding: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: t.muted, marginBottom: 12 }}>
                    Attack Order — for payment instructions, use the Attack Map tab
                </div>
                {model.ranked.map((d, i) => (
                    <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0",
                        borderBottom: i < model.ranked.length - 1 ? `1px solid ${t.border}` : "none" }}>
                        <div style={{ width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
                            background: i === 0 ? t.amber : t.border,
                            color: i === 0 ? "#111" : t.subtle,
                            fontSize: 11, fontWeight: 700,
                            display: "flex", alignItems: "center", justifyContent: "center" }}>
                            {i + 1}
                        </div>
                        <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 13, fontWeight: i === 0 ? 600 : 400, color: i === 0 ? t.amber : t.bright }}>
                                {d.name}
                                {i === 0 && <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, background: "#78350f", color: t.amber, padding: "2px 6px", borderRadius: 3 }}>FOCUS</span>}
                            </div>
                            <div style={{ fontSize: 11, color: t.muted, marginTop: 2 }}>
                                {d.isPromoUrgent
                                    ? `⚠ promo expires in ${d.promoMonthsLeft}mo → ${fmtPct(d.futureApr)} · ${fmt(d.balance)}`
                                    : d.promoApr !== null
                                        ? `${fmtPct(d.promoApr)} promo → ${fmtPct(d.futureApr)} later · ${fmt(d.balance)}`
                                        : `${fmtPct(d.currentApr)} APR · ${fmt(d.balance)}`}
                            </div>
                        </div>
                        <div style={{ fontSize: 12, color: t.muted, flexShrink: 0 }}>min {fmt(d.minPayment)}/mo</div>
                    </div>
                ))}
            </div>
        </div>
    );
}
