import React, { useMemo } from "react";
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    Tooltip,
    ReferenceLine,
    ResponsiveContainer,
} from "recharts";

const t = {
    bg1: "#0f172a",
    bg2: "#111827",
    border: "#334155",
    bright: "#e2e8f0",
    body: "#cbd5e1",
    muted: "#94a3b8",
    subtle: "#64748b",
    amber: "#f59e0b",
    green: "#22c55e",
    red: "#ef4444",
    blue: "#38bdf8",
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function fmtMoney(n) {
    return `$${(Number(n) || 0).toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    })}`;
}

function fmtPct(n) {
    return `${(Number(n) || 0).toFixed(1)}%`;
}

function sum(arr, fn) {
    return arr.reduce((acc, item) => acc + fn(item), 0);
}

function startOfMonth(d) {
    return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(date, months) {
    return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function parseDateLike(value) {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
}

function getPromoEndDate(card) {
    return (
        parseDateLike(card?.promoEnd) ||
        parseDateLike(card?.promoEndDate) ||
        parseDateLike(card?.promoExpiration) ||
        parseDateLike(card?.promoExpirationDate) ||
        parseDateLike(card?.promoExpiry) ||
        null
    );
}

function currentRegularApr(debt) {
    return Number(debt.apr) || 0;
}

function currentPromoApr(debt) {
    return Number(debt.promoApr) > 0 ? Number(debt.promoApr) : null;
}

function effectiveAprAtMonth(debt, monthOffset, nowMonth) {
    const regularApr = currentRegularApr(debt);
    const promoApr = currentPromoApr(debt);
    const promoEndDate = debt.promoEndDate || null;

    if (!promoApr) return regularApr;
    if (!promoEndDate) return promoApr;

    const phaseMonthDate = addMonths(nowMonth, monthOffset);
    const promoEndMonth = startOfMonth(promoEndDate);
    return phaseMonthDate <= promoEndMonth ? promoApr : regularApr;
}

function estimateInterestThisMonth(balance, apr) {
    return (Number(balance) || 0) * ((Number(apr) || 0) / 100) / 12;
}

// ─── DEBT BUILDING ────────────────────────────────────────────────────────────

function buildDebts(state) {
    const cards = (state.creditCards ?? []).map((c) => ({
        id: c.id,
        type: "card",
        name: c.name || "Card",
        balance: Number(c.balance) || 0,
        apr: Number(c.apr) || 0,
        promoApr: Number(c.promoApr) > 0 ? Number(c.promoApr) : null,
        promoEndDate: getPromoEndDate(c),
        minPayment: Number(c.minPayment) || 0,
        monthlyPayment: Number(c.monthlyPayment) || Number(c.minPayment) || 0,
        monthlySpend: Number(c.monthlySpend) || 0,
    }));

    const loans = (state.loans ?? []).map((l) => ({
        id: l.id,
        type: "loan",
        name: l.name || "Loan",
        balance: Number(l.balance) || 0,
        apr: Number(l.apr) || 0,
        promoApr: null,
        promoEndDate: null,
        minPayment: Number(l.monthlyPayment) || 0,
        monthlyPayment: Number(l.monthlyPayment) || 0,
        monthlySpend: 0,
    }));

    return [...cards, ...loans].filter((d) => d.balance > 0);
}

// Debts that exist in state but have been paid to $0
function buildCompletedDebts(state) {
    const cards = (state.creditCards ?? [])
        .filter((c) => (Number(c.balance) || 0) === 0 && c.name)
        .map((c) => ({ id: c.id, name: c.name, type: "card" }));
    const loans = (state.loans ?? [])
        .filter((l) => (Number(l.balance) || 0) === 0 && l.name)
        .map((l) => ({ id: l.id, name: l.name, type: "loan" }));
    return [...cards, ...loans];
}

function estimateExtraPool(debts) {
    return Math.max(
        0,
        sum(debts, (d) => Math.max(0, (d.monthlyPayment || 0) - (d.minPayment || 0)))
    );
}

// ─── STRATEGY ─────────────────────────────────────────────────────────────────

function chooseStrategy(debts, nowMonth) {
    const highestAprDebt = [...debts].sort(
        (a, b) => effectiveAprAtMonth(b, 0, nowMonth) - effectiveAprAtMonth(a, 0, nowMonth)
    )[0];
    const smallestBalance = [...debts].sort((a, b) => a.balance - b.balance)[0];

    if (!highestAprDebt || !smallestBalance) return "avalanche";

    const highestApr = effectiveAprAtMonth(highestAprDebt, 0, nowMonth);
    const totalVeryHighInterest = sum(
        debts.filter((d) => effectiveAprAtMonth(d, 0, nowMonth) >= 20),
        (d) => estimateInterestThisMonth(d.balance, effectiveAprAtMonth(d, 0, nowMonth))
    );

    if (highestApr - smallestBalance.apr >= 6) return "avalanche";
    if (smallestBalance.balance <= 2500) return "snowball";
    if (totalVeryHighInterest >= 300) return "avalanche";

    return "avalanche";
}

function sortDebtsForStrategy(debts, strategy, monthOffset, nowMonth) {
    const ordered = [...debts];

    if (strategy === "snowball") {
        ordered.sort((a, b) => {
            if (a.balance !== b.balance) return a.balance - b.balance;
            return effectiveAprAtMonth(b, monthOffset, nowMonth) - effectiveAprAtMonth(a, monthOffset, nowMonth);
        });
        return ordered;
    }

    ordered.sort((a, b) => {
        const aprDiff =
            effectiveAprAtMonth(b, monthOffset, nowMonth) -
            effectiveAprAtMonth(a, monthOffset, nowMonth);
        if (aprDiff !== 0) return aprDiff;
        return b.balance - a.balance;
    });

    return ordered;
}

function makePhaseTitle(index, strategy) {
    if (index === 0) {
        return strategy === "avalanche"
            ? "Phase 1 — Stop the Highest APR Bleeding"
            : "Phase 1 — Get a Quick Win";
    }
    if (index === 1) return "Phase 2 — Build Momentum";
    return `Phase ${index + 1} — Continue the Paydown`;
}

function groupPhaseTargets(ordered, strategy, monthOffset, nowMonth) {
    const first = ordered[0];
    const second = ordered[1];
    if (!first) return [];

    if (
        strategy === "avalanche" &&
        second &&
        first.type === "card" &&
        second.type === "card"
    ) {
        const firstApr = effectiveAprAtMonth(first, monthOffset, nowMonth);
        const secondApr = effectiveAprAtMonth(second, monthOffset, nowMonth);
        if (Math.abs(firstApr - secondApr) <= 1.5) return [first, second];
    }

    return [first];
}

function cloneDebt(debt) {
    return { ...debt, balance: Number(debt.balance) || 0 };
}

function simulatePhase(targetGroup, remainingDebts, rollingPool, monthOffsetStart, nowMonth) {
    const targets = targetGroup.map(cloneDebt);
    const targetIds = new Set(targets.map((d) => d.id));

    const targetBasePayments = sum(targets, (d) => d.monthlyPayment || 0);
    const monthlyToGroup = rollingPool + targetBasePayments;

    let monthOffset = monthOffsetStart;
    let roughMonths = 0;
    const interestRemovedAtStart = sum(
        targets,
        (d) => estimateInterestThisMonth(d.balance, effectiveAprAtMonth(d, monthOffsetStart, nowMonth))
    );

    while (sum(targets, (d) => d.balance) > 0.01 && roughMonths < 240) {
        roughMonths += 1;

        for (const debt of targets) {
            if (debt.balance <= 0) continue;
            const apr = effectiveAprAtMonth(debt, monthOffset, nowMonth);
            debt.balance += estimateInterestThisMonth(debt.balance, apr);
        }

        let paymentPool = monthlyToGroup;
        const orderedTargets = [...targets].sort((a, b) => {
            const aprDiff =
                effectiveAprAtMonth(b, monthOffset, nowMonth) -
                effectiveAprAtMonth(a, monthOffset, nowMonth);
            if (aprDiff !== 0) return aprDiff;
            return b.balance - a.balance;
        });

        for (const debt of orderedTargets) {
            if (paymentPool <= 0) break;
            if (debt.balance <= 0) continue;
            const applied = Math.min(debt.balance, paymentPool);
            debt.balance -= applied;
            paymentPool -= applied;
        }

        monthOffset += 1;
    }

    return {
        roughMonths,
        monthlyToGroup,
        interestRemovedAtStart,
        freedPayments: targetBasePayments,
        remaining: remainingDebts.filter((d) => !targetIds.has(d.id)),
    };
}

function buildPhasesWithRollForward(allDebts, strategy, rollingPoolStart, nowMonth) {
    let remaining = [...allDebts];
    let rollingPool = rollingPoolStart;
    let monthOffset = 0;
    const phases = [];
    let phaseIndex = 0;

    while (remaining.length > 0 && phaseIndex < 12) {
        const ordered = sortDebtsForStrategy(remaining, strategy, monthOffset, nowMonth);
        const targets = groupPhaseTargets(ordered, strategy, monthOffset, nowMonth);
        if (!targets.length) break;

        const targetNames = targets.map((d) => d.name);
        const paymentAllocation = sum(targets, (d) => d.monthlyPayment || 0) + rollingPool;
        const simulated = simulatePhase(targets, remaining, rollingPool, monthOffset, nowMonth);

        phases.push({
            title: makePhaseTitle(phaseIndex, strategy),
            targets,
            focusText: targetNames.join(", "),
            paymentAllocation,
            roughMonths: simulated.roughMonths,
            interestRelief: simulated.interestRemovedAtStart,
            resultText:
                targets.length === 1
                    ? `${targets[0].name} likely cleared.`
                    : `${targetNames.join(" and ")} likely cleared.`,
        });

        rollingPool += simulated.freedPayments;
        monthOffset += simulated.roughMonths;
        remaining = simulated.remaining;
        phaseIndex += 1;
    }

    return phases;
}

// ─── TRAJECTORY SIMULATION ────────────────────────────────────────────────────

function monthLabel(offset, nowMonth) {
    const d = addMonths(nowMonth, offset);
    return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

function buildTrajectory(allDebts, strategy, rollingPoolStart, nowMonth, monthsToProject) {
    if (!allDebts.length) return [];

    let debts = allDebts.map(cloneDebt);
    let rollingPool = rollingPoolStart;

    const data = [
        {
            month: 0,
            label: "Now",
            total: Math.round(sum(debts, (d) => d.balance)),
        },
    ];

    for (let m = 1; m <= monthsToProject; m++) {
        if (!debts.length) {
            data.push({ month: m, label: monthLabel(m, nowMonth), total: 0 });
            break;
        }

        // Accrue interest
        for (const d of debts) {
            const apr = effectiveAprAtMonth(d, m - 1, nowMonth);
            d.balance += estimateInterestThisMonth(d.balance, apr);
        }

        // All minimums + rolling extra
        const totalMinimums = sum(debts, (d) => d.minPayment || 0);
        let pool = totalMinimums + rollingPool;

        // Pay in strategy order, focus debt gets extra first
        const ordered = sortDebtsForStrategy(debts, strategy, m - 1, nowMonth);
        for (const d of ordered) {
            if (pool <= 0) break;
            const pay = Math.min(d.balance, pool);
            d.balance = Math.max(0, d.balance - pay);
            pool -= pay;
        }

        // Cleared debts roll their minimums forward
        const cleared = debts.filter((d) => d.balance <= 0.01);
        rollingPool += sum(cleared, (d) => d.minPayment || 0);
        debts = debts.filter((d) => d.balance > 0.01);

        const total = Math.max(0, Math.round(sum(debts, (d) => d.balance)));
        data.push({ month: m, label: monthLabel(m, nowMonth), total });

        if (total === 0) break;
    }

    return data;
}

// ─── CHART ────────────────────────────────────────────────────────────────────

function DebtTrajectoryChart({ trajectory, totalDebt }) {
    if (!trajectory.length) return null;

    const maxDebt = trajectory[0]?.total || totalDebt;
    const payoffPoint = trajectory.find((p) => p.total === 0);
    const finalPoint = trajectory[trajectory.length - 1];

    // Space x-axis ticks sensibly
    const len = trajectory.length;
    const step = len > 48 ? 12 : len > 24 ? 6 : len > 12 ? 3 : 1;
    const ticks = trajectory.filter((p) => p.month === 0 || p.month % step === 0).map((p) => p.month);

    return (
        <div
            style={{
                border: `1px solid ${t.border}`,
                background: t.bg1,
                borderRadius: 12,
                padding: 16,
            }}
        >
            <div
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    marginBottom: 12,
                    flexWrap: "wrap",
                    gap: 8,
                }}
            >
                <div>
                    <div
                        style={{
                            fontSize: 13,
                            fontWeight: 700,
                            color: t.bright,
                            letterSpacing: "0.06em",
                            textTransform: "uppercase",
                            marginBottom: 2,
                        }}
                    >
                        Debt Trajectory
                    </div>
                    <div style={{ fontSize: 12, color: t.muted }}>
                        Projected total debt at current payments — updates on every import
                    </div>
                </div>

                {payoffPoint ? (
                    <div
                        style={{
                            background: "#052e16",
                            border: "1px solid #166534",
                            borderRadius: 8,
                            padding: "6px 12px",
                            fontSize: 13,
                            color: t.green,
                            fontWeight: 700,
                        }}
                    >
                        Debt-free in ~{payoffPoint.month} month{payoffPoint.month === 1 ? "" : "s"}
                    </div>
                ) : (
                    <div
                        style={{
                            background: "#1c1917",
                            border: `1px solid ${t.border}`,
                            borderRadius: 8,
                            padding: "6px 12px",
                            fontSize: 12,
                            color: t.muted,
                        }}
                    >
                        {fmtMoney(finalPoint?.total)} remaining after {trajectory.length - 1} months
                    </div>
                )}
            </div>

            <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={trajectory} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
                    <defs>
                        <linearGradient id="debtGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#ef4444" stopOpacity={0.03} />
                        </linearGradient>
                    </defs>

                    <XAxis
                        dataKey="month"
                        ticks={ticks}
                        tickFormatter={(m) => trajectory.find((p) => p.month === m)?.label ?? ""}
                        tick={{ fill: t.muted, fontSize: 10 }}
                        axisLine={{ stroke: t.border }}
                        tickLine={false}
                    />
                    <YAxis
                        tickFormatter={(v) =>
                            v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`
                        }
                        tick={{ fill: t.muted, fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                        domain={[0, maxDebt * 1.06]}
                        width={52}
                    />
                    <Tooltip
                        contentStyle={{
                            background: "#0f172a",
                            border: `1px solid ${t.border}`,
                            borderRadius: 8,
                            fontSize: 12,
                            color: t.bright,
                        }}
                        formatter={(value) => [fmtMoney(value), "Total Debt"]}
                        labelFormatter={(m) =>
                            trajectory.find((p) => p.month === m)?.label ?? `Month ${m}`
                        }
                    />
                    <ReferenceLine
                        x={0}
                        stroke={t.amber}
                        strokeDasharray="4 3"
                        label={{
                            value: "Today",
                            fill: t.amber,
                            fontSize: 10,
                            position: "insideTopRight",
                        }}
                    />
                    <Area
                        type="monotone"
                        dataKey="total"
                        stroke="#ef4444"
                        strokeWidth={2.5}
                        fill="url(#debtGrad)"
                        dot={false}
                        activeDot={{ r: 5, fill: "#ef4444", strokeWidth: 0 }}
                    />
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
}

// ─── UI COMPONENTS ────────────────────────────────────────────────────────────

function SectionTitle({ title, subtitle }) {
    return (
        <div style={{ marginBottom: 10 }}>
            <div
                style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: t.bright,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    marginBottom: 4,
                }}
            >
                {title}
            </div>
            {subtitle && (
                <div style={{ fontSize: 13, color: t.muted, lineHeight: 1.6 }}>
                    {subtitle}
                </div>
            )}
        </div>
    );
}

function StatCard({ title, value, sub, color = t.bright }) {
    return (
        <div
            style={{
                border: `1px solid ${t.border}`,
                background: t.bg1,
                borderRadius: 12,
                padding: 14,
            }}
        >
            <div
                style={{
                    fontSize: 12,
                    color: t.muted,
                    marginBottom: 6,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                }}
            >
                {title}
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
            {sub && (
                <div style={{ fontSize: 12, color: t.subtle, marginTop: 4, lineHeight: 1.5 }}>
                    {sub}
                </div>
            )}
        </div>
    );
}

function PromoNote({ debt }) {
    if (!debt.promoApr || !debt.promoEndDate) return null;
    return (
        <div style={{ color: t.subtle, fontSize: 12, marginTop: 4 }}>
            Promo APR {fmtPct(debt.promoApr)} until {debt.promoEndDate.toLocaleDateString()}.
        </div>
    );
}

function PlanBlock({ phase, strategy, index }) {
    const isFirst = index === 0;

    return (
        <div
            style={{
                border: `1px solid ${isFirst ? t.amber + "88" : t.border}`,
                background: isFirst ? "#1a1200" : t.bg1,
                borderRadius: 12,
                padding: 16,
                position: "relative",
            }}
        >
            {isFirst && (
                <div
                    style={{
                        position: "absolute",
                        top: 14,
                        right: 14,
                        background: "#78350f",
                        color: t.amber,
                        fontSize: 10,
                        fontWeight: 700,
                        padding: "3px 8px",
                        borderRadius: 4,
                        letterSpacing: "0.1em",
                        textTransform: "uppercase",
                    }}
                >
                    Active Now
                </div>
            )}

            <SectionTitle
                title={phase.title}
                subtitle={
                    strategy === "avalanche"
                        ? "Prioritizes the balances costing the most interest first."
                        : "Prioritizes the balances that can be closed fastest first."
                }
            />

            <div style={{ display: "grid", gap: 8, color: t.body, fontSize: 14, lineHeight: 1.8 }}>
                <div>
                    <strong style={{ color: t.bright }}>Focus:</strong>{" "}
                    {phase.targets.map((d) => `${d.name} (${fmtMoney(d.balance)} @ ${fmtPct(d.apr)})`).join(", ")}
                    <div style={{ marginTop: 4 }}>
                        {phase.targets.map((d) => (
                            <PromoNote key={d.id} debt={d} />
                        ))}
                    </div>
                </div>
                <div>
                    <strong style={{ color: t.bright }}>Payment Allocation:</strong>{" "}
                    about <strong style={{ color: t.amber }}>{fmtMoney(phase.paymentAllocation)}/month</strong>{" "}
                    toward this phase.
                </div>
                <div>
                    <strong style={{ color: t.bright }}>Result:</strong>{" "}
                    {phase.resultText} Rough duration is about{" "}
                    <strong style={{ color: t.green }}>
                        {phase.roughMonths} month{phase.roughMonths === 1 ? "" : "s"}
                    </strong>
                    .
                </div>
                <div>
                    <strong style={{ color: t.bright }}>Interest Impact:</strong>{" "}
                    finishing this phase removes about{" "}
                    <strong style={{ color: t.green }}>{fmtMoney(phase.interestRelief)}/month</strong>{" "}
                    of interest drag permanently.
                </div>
            </div>
        </div>
    );
}

function CompletedDebtsSection({ completed }) {
    if (!completed.length) return null;

    return (
        <div
            style={{
                border: "1px solid #166534",
                background: "#052e16",
                borderRadius: 12,
                padding: 16,
            }}
        >
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    marginBottom: 10,
                }}
            >
                <span style={{ fontSize: 20 }}>✓</span>
                <div
                    style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: t.green,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                    }}
                >
                    {completed.length} debt{completed.length === 1 ? "" : "s"} cleared
                </div>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                {completed.map((d) => (
                    <span
                        key={d.id}
                        style={{
                            background: "#14532d",
                            border: "1px solid #166534",
                            borderRadius: 6,
                            padding: "4px 12px",
                            fontSize: 13,
                            color: "#86efac",
                            fontWeight: 500,
                        }}
                    >
                        ✓ {d.name}
                    </span>
                ))}
            </div>
            <div style={{ fontSize: 12, color: "#4ade80", lineHeight: 1.6 }}>
                Their former payments are now rolling forward into the active phase.
            </div>
        </div>
    );
}

// ─── MAIN EXPORT ──────────────────────────────────────────────────────────────

export default function Plan({ state }) {
    const isMobile = window.innerWidth <= 768;
    const nowMonth = useMemo(() => startOfMonth(new Date()), []);

    const model = useMemo(() => {
        const debts = buildDebts(state);
        const completed = buildCompletedDebts(state);
        const strategy = chooseStrategy(debts, nowMonth);
        const extraPool = estimateExtraPool(debts);
        const phases = buildPhasesWithRollForward(debts, strategy, extraPool, nowMonth);

        const totalDebt = sum(debts, (d) => d.balance);
        const monthlyInterest = sum(
            debts,
            (d) => estimateInterestThisMonth(d.balance, effectiveAprAtMonth(d, 0, nowMonth))
        );

        const firstPhase = phases[0];
        const firstTarget = firstPhase?.targets?.[0];
        const targetInterest = firstTarget
            ? estimateInterestThisMonth(firstTarget.balance, effectiveAprAtMonth(firstTarget, 0, nowMonth))
            : 0;

        const trajectory = buildTrajectory(debts, strategy, extraPool, nowMonth, 72);

        const oneYearPhases = [];
        let monthAccumulator = 0;
        for (const phase of phases) {
            if (monthAccumulator >= 12) break;
            oneYearPhases.push(phase);
            monthAccumulator += phase.roughMonths;
        }
        const oneYearNames = oneYearPhases.flatMap((p) => p.targets.map((d) => d.name));
        const oneYearInterestRelief = sum(oneYearPhases, (p) => p.interestRelief);

        return {
            debts,
            completed,
            strategy,
            extraPool,
            phases,
            totalDebt,
            monthlyInterest,
            firstTarget,
            targetInterest,
            trajectory,
            oneYearPhases,
            oneYearNames,
            oneYearInterestRelief,
            oneYearMonthsCovered: monthAccumulator,
        };
    }, [state]);

    // No debts at all
    if (!model.debts.length) {
        return (
            <div
                style={{
                    border: `1px solid ${t.border}`,
                    background: t.bg1,
                    borderRadius: 12,
                    padding: 20,
                }}
            >
                <SectionTitle
                    title="Payoff Plan"
                    subtitle="Add debts first, then this page will build a recommended payoff plan."
                />
                {model.completed.length > 0 ? (
                    <>
                        <div style={{ color: t.body, fontSize: 14, marginBottom: 12 }}>
                            No active debts remaining.
                        </div>
                        <CompletedDebtsSection completed={model.completed} />
                    </>
                ) : (
                    <div style={{ color: t.body, fontSize: 14 }}>No debts available yet.</div>
                )}
            </div>
        );
    }

    return (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                gap: 16,
                maxWidth: 980,
                margin: "0 auto",
                padding: "0 0 48px",
            }}
        >
            {/* Header */}
            <div>
                <h2
                    style={{
                        fontSize: 14,
                        fontWeight: 700,
                        color: t.bright,
                        margin: "0 0 4px",
                        letterSpacing: "0.04em",
                        textTransform: "uppercase",
                    }}
                >
                    Payoff Plan
                </h2>
                <p style={{ fontSize: 13, color: t.muted, margin: 0, lineHeight: 1.7 }}>
                    Updates live with each import. Phases drop off as balances clear.
                </p>
            </div>

            {/* Completed debts — show wins at the top */}
            {model.completed.length > 0 && (
                <CompletedDebtsSection completed={model.completed} />
            )}

            {/* Stat cards */}
            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, minmax(0, 1fr))",
                    gap: 12,
                }}
            >
                <StatCard
                    title="Strategy"
                    value={model.strategy === "avalanche" ? "Avalanche" : "Snowball"}
                    sub={model.strategy === "avalanche" ? "Highest APR first." : "Smallest balance first."}
                    color={t.amber}
                />
                <StatCard
                    title="Total Debt"
                    value={fmtMoney(model.totalDebt)}
                    sub="All active cards and loans."
                    color={t.bright}
                />
                <StatCard
                    title="Monthly Interest"
                    value={fmtMoney(model.monthlyInterest)}
                    sub="Approximate cost of carrying this debt right now."
                    color={t.red}
                />
                <StatCard
                    title="Extra Pool"
                    value={fmtMoney(model.extraPool)}
                    sub="Amount above minimums directed to focus debt."
                    color={t.green}
                />
            </div>

            {/* Trajectory chart — the main motivating visual */}
            <DebtTrajectoryChart
                trajectory={model.trajectory}
                totalDebt={model.totalDebt}
            />

            {/* Quick read */}
            <div
                style={{
                    border: `1px solid ${t.border}`,
                    background: t.bg1,
                    borderRadius: 12,
                    padding: 14,
                }}
            >
                <SectionTitle
                    title="Quick Read"
                    subtitle="The shortest explanation of what the current plan is saying."
                />
                <div style={{ display: "grid", gap: 8, color: t.body, fontSize: 14, lineHeight: 1.8 }}>
                    <div>
                        Recommended first target:{" "}
                        <strong style={{ color: t.amber }}>{model.firstTarget?.name || ""}</strong>
                        {model.firstTarget && (
                            <>
                                {" "}at{" "}
                                <strong style={{ color: t.bright }}>
                                    {fmtPct(effectiveAprAtMonth(model.firstTarget, 0, nowMonth))}
                                </strong>{" "}
                                with a balance of{" "}
                                <strong style={{ color: t.bright }}>
                                    {fmtMoney(model.firstTarget.balance)}
                                </strong>
                                .
                            </>
                        )}
                    </div>
                    <div>
                        Your debt is costing about{" "}
                        <strong style={{ color: t.red }}>{fmtMoney(model.monthlyInterest)}/month</strong>{" "}
                        in interest across all cards and loans.
                    </div>
                    {model.firstTarget && (
                        <div>
                            {model.firstTarget.name} alone costs about{" "}
                            <strong style={{ color: t.red }}>{fmtMoney(model.targetInterest)}/month</strong>{" "}
                            in interest.
                        </div>
                    )}
                    {model.phases[0] && (
                        <div>
                            Finishing Phase 1 removes about{" "}
                            <strong style={{ color: t.green }}>{fmtMoney(model.phases[0].interestRelief)}/month</strong>{" "}
                            of interest drag permanently.
                        </div>
                    )}
                    {model.firstTarget && (
                        <div>
                            Best next move:{" "}
                            <strong style={{ color: t.bright }}>
                                keep minimums on everything else, direct the extra pool to {model.firstTarget.name}.
                            </strong>
                        </div>
                    )}
                </div>
            </div>

            {/* Phase blocks — drop off automatically as debts clear */}
            {model.phases.slice(0, 3).map((phase, i) => (
                <PlanBlock key={phase.title} phase={phase} strategy={model.strategy} index={i} />
            ))}

            {/* 12-month outlook */}
            <div
                style={{
                    border: `1px solid ${t.border}`,
                    background: t.bg1,
                    borderRadius: 12,
                    padding: 14,
                }}
            >
                <SectionTitle
                    title="Estimated Result After 12 Months"
                    subtitle="Rough first-year picture based on rolling payment capacity."
                />
                <div style={{ display: "grid", gap: 8, color: t.body, fontSize: 14, lineHeight: 1.8 }}>
                    <div>
                        <strong style={{ color: t.bright }}>Likely focus this year:</strong>{" "}
                        {model.oneYearNames.join(", ")}
                    </div>
                    <div>
                        <strong style={{ color: t.bright }}>Timeline covered:</strong>{" "}
                        about{" "}
                        <strong style={{ color: t.green }}>
                            {model.oneYearMonthsCovered} month{model.oneYearMonthsCovered === 1 ? "" : "s"}
                        </strong>{" "}
                        of targeted payoff effort.
                    </div>
                    <div>
                        <strong style={{ color: t.bright }}>Potential interest relief:</strong>{" "}
                        if these phases complete,{" "}
                        <strong style={{ color: t.green }}>{fmtMoney(model.oneYearInterestRelief)}/month</strong>{" "}
                        of interest drag removed.
                    </div>
                    <div>
                        <strong style={{ color: t.bright }}>Why it speeds up:</strong>{" "}
                        as balances clear, their former payments roll into the next target — later phases move faster.
                    </div>
                </div>
            </div>
        </div>
    );
}
