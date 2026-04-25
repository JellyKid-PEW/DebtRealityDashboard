import React, { useMemo, useState } from "react";
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    Tooltip,
    Legend,
    ResponsiveContainer,
} from "recharts";

// ─── STYLE TOKENS ─────────────────────────────────────────────────────────────

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
    green: "#22c55e",
    red: "#ef4444",
    blue: "#38bdf8",
};

const inputStyle = {
    width: "100%",
    minHeight: 44,
    borderRadius: 9,
    border: `1px solid ${t.border}`,
    background: t.bg2,
    color: t.bright,
    padding: "10px 12px",
    fontSize: 15,
    outline: "none",
    boxSizing: "border-box",
};

const selectStyle = { ...inputStyle };

// ─── SHARED HELPERS ───────────────────────────────────────────────────────────

function fmtMoney(n) {
    const v = Number(n) || 0;
    return `$${Math.abs(v).toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    })}`;
}

function fmtMoneyExact(n) {
    return `$${(Number(n) || 0).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`;
}

function fmtPct(n) {
    return `${(Number(n) || 0).toFixed(1)}%`;
}

function sumArr(arr, fn) {
    return (arr || []).reduce((acc, x) => acc + fn(x), 0);
}

function startOfMonth(d) {
    return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(date, n) {
    return new Date(date.getFullYear(), date.getMonth() + n, 1);
}

function parseDateLike(v) {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
}

function monthLabel(offset, nowMonth) {
    return addMonths(nowMonth, offset).toLocaleDateString("en-US", {
        month: "short",
        year: "2-digit",
    });
}

// ─── DEBT BUILDING ────────────────────────────────────────────────────────────

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

function effectiveApr(debt, monthOffset, nowMonth) {
    const regular = Number(debt.apr) || 0;
    const promo = Number(debt.promoApr) > 0 ? Number(debt.promoApr) : null;
    const promoEnd = debt.promoEndDate || null;
    if (!promo) return regular;
    if (!promoEnd) return promo;
    const phaseDate = addMonths(nowMonth, monthOffset);
    const endMonth = startOfMonth(promoEnd);
    return phaseDate <= endMonth ? promo : regular;
}

function interestThisMonth(balance, apr) {
    return (Number(balance) || 0) * ((Number(apr) || 0) / 100) / 12;
}

function buildBaseDebts(state) {
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
    }));
    return [...cards, ...loans].filter((d) => d.balance > 0);
}

function cloneDebts(debts) {
    return debts.map((d) => ({ ...d, balance: Number(d.balance) || 0 }));
}

function extraPoolFromDebts(debts) {
    return Math.max(
        0,
        sumArr(debts, (d) => Math.max(0, (d.monthlyPayment || 0) - (d.minPayment || 0)))
    );
}

function chooseStrategy(debts, nowMonth) {
    const byApr = [...debts].sort(
        (a, b) => effectiveApr(b, 0, nowMonth) - effectiveApr(a, 0, nowMonth)
    );
    const byBal = [...debts].sort((a, b) => a.balance - b.balance);
    if (!byApr[0] || !byBal[0]) return "avalanche";
    const highApr = effectiveApr(byApr[0], 0, nowMonth);
    const veryHighInterest = sumArr(
        debts.filter((d) => effectiveApr(d, 0, nowMonth) >= 20),
        (d) => interestThisMonth(d.balance, effectiveApr(d, 0, nowMonth))
    );
    if (highApr - byBal[0].apr >= 6) return "avalanche";
    if (byBal[0].balance <= 2500) return "snowball";
    if (veryHighInterest >= 300) return "avalanche";
    return "avalanche";
}

function sortedForStrategy(debts, strategy, mOffset, nowMonth) {
    const ordered = [...debts];
    if (strategy === "snowball") {
        ordered.sort((a, b) =>
            a.balance !== b.balance
                ? a.balance - b.balance
                : effectiveApr(b, mOffset, nowMonth) - effectiveApr(a, mOffset, nowMonth)
        );
    } else {
        ordered.sort((a, b) => {
            const diff = effectiveApr(b, mOffset, nowMonth) - effectiveApr(a, mOffset, nowMonth);
            return diff !== 0 ? diff : b.balance - a.balance;
        });
    }
    return ordered;
}

// ─── TRAJECTORY ENGINE ────────────────────────────────────────────────────────
// Used by every scenario. Returns month-by-month [{month, label, total}]

function buildTrajectory(debts, extraPool, strategy, nowMonth, maxMonths = 72) {
    if (!debts.length) return [{ month: 0, label: "Now", total: 0 }];

    let working = cloneDebts(debts);
    let pool = extraPool;

    const data = [
        { month: 0, label: "Now", total: Math.round(sumArr(working, (d) => d.balance)) },
    ];

    for (let m = 1; m <= maxMonths; m++) {
        if (!working.length) {
            data.push({ month: m, label: monthLabel(m, nowMonth), total: 0 });
            break;
        }

        // New charges + interest
        for (const d of working) {
            d.balance += Number(d.monthlySpend) || 0;
            d.balance += interestThisMonth(d.balance, effectiveApr(d, m - 1, nowMonth));
        }

        // Pay: minimums + extra to focus debt
        const totalMin = sumArr(working, (d) => d.minPayment || 0);
        let payPool = totalMin + pool;
        const ordered = sortedForStrategy(working, strategy, m - 1, nowMonth);
        for (const d of ordered) {
            if (payPool <= 0) break;
            const pay = Math.min(d.balance, payPool);
            d.balance = Math.max(0, d.balance - pay);
            payPool -= pay;
        }

        // Roll freed minimums into pool
        const cleared = working.filter((d) => d.balance <= 0.01);
        pool += sumArr(cleared, (d) => d.minPayment || 0);
        working = working.filter((d) => d.balance > 0.01);

        const total = Math.max(0, Math.round(sumArr(working, (d) => d.balance)));
        data.push({ month: m, label: monthLabel(m, nowMonth), total });
        if (total === 0) break;
    }

    return data;
}

// ─── COMPARISON CHART ─────────────────────────────────────────────────────────

function ComparisonChart({ baseline, scenario, scenarioLabel }) {
    if (!baseline.length) return null;

    // Merge into single data array keyed by month
    const maxMonth = Math.max(
        baseline[baseline.length - 1]?.month || 0,
        scenario[scenario.length - 1]?.month || 0
    );

    const baseMap = Object.fromEntries(baseline.map((p) => [p.month, p.total]));
    const scenMap = Object.fromEntries(scenario.map((p) => [p.month, p.total]));

    const data = [];
    for (let m = 0; m <= maxMonth; m++) {
        const baseVal = baseMap[m] ?? 0;
        const scenVal = scenMap[m] ?? 0;
        data.push({
            month: m,
            label: baseline.find((p) => p.month === m)?.label || monthLabel(m, startOfMonth(new Date())),
            baseline: baseVal,
            scenario: scenVal,
        });
    }

    // X tick spacing
    const len = data.length;
    const step = len > 48 ? 12 : len > 24 ? 6 : len > 12 ? 3 : 1;
    const ticks = data.filter((p) => p.month === 0 || p.month % step === 0).map((p) => p.month);

    const basePayoff = baseline.find((p) => p.total === 0)?.month;
    const scenPayoff = scenario.find((p) => p.total === 0)?.month;

    const saved = scenPayoff && basePayoff ? basePayoff - scenPayoff : null;

    return (
        <div style={{ border: `1px solid ${t.border}`, background: t.bg1, borderRadius: 12, padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: t.bright, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 2 }}>
                        Trajectory Comparison
                    </div>
                    <div style={{ fontSize: 12, color: t.muted }}>
                        Red = current plan · Blue = {scenarioLabel}
                    </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {basePayoff && (
                        <div style={{ background: "#1c1917", border: `1px solid ${t.border}`, borderRadius: 8, padding: "6px 12px", fontSize: 12, color: t.muted }}>
                            Current: debt-free ~{basePayoff}mo
                        </div>
                    )}
                    {scenPayoff && (
                        <div style={{ background: "#052e16", border: "1px solid #166534", borderRadius: 8, padding: "6px 12px", fontSize: 13, color: t.green, fontWeight: 700 }}>
                            Scenario: debt-free ~{scenPayoff}mo
                            {saved !== null && saved > 0 && ` (${saved}mo sooner)`}
                        </div>
                    )}
                </div>
            </div>

            <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
                    <defs>
                        <linearGradient id="baseGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#ef4444" stopOpacity={0.2} />
                            <stop offset="95%" stopColor="#ef4444" stopOpacity={0.02} />
                        </linearGradient>
                        <linearGradient id="scenGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.25} />
                            <stop offset="95%" stopColor="#38bdf8" stopOpacity={0.02} />
                        </linearGradient>
                    </defs>
                    <XAxis
                        dataKey="month"
                        ticks={ticks}
                        tickFormatter={(m) => data.find((p) => p.month === m)?.label ?? ""}
                        tick={{ fill: t.muted, fontSize: 10 }}
                        axisLine={{ stroke: t.border }}
                        tickLine={false}
                    />
                    <YAxis
                        tickFormatter={(v) => v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`}
                        tick={{ fill: t.muted, fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                        width={52}
                    />
                    <Tooltip
                        contentStyle={{ background: t.bg1, border: `1px solid ${t.border}`, borderRadius: 8, fontSize: 12, color: t.bright }}
                        formatter={(value, name) => [fmtMoney(value), name === "baseline" ? "Current Plan" : scenarioLabel]}
                        labelFormatter={(m) => data.find((p) => p.month === m)?.label ?? `Month ${m}`}
                    />
                    <Area type="monotone" dataKey="baseline" stroke="#ef4444" strokeWidth={2} fill="url(#baseGrad)" dot={false} activeDot={{ r: 4, fill: "#ef4444", strokeWidth: 0 }} />
                    <Area type="monotone" dataKey="scenario" stroke="#38bdf8" strokeWidth={2} fill="url(#scenGrad)" dot={false} activeDot={{ r: 4, fill: "#38bdf8", strokeWidth: 0 }} />
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
}

// ─── SHARED UI ────────────────────────────────────────────────────────────────

function StatCard({ title, value, sub, color = t.bright }) {
    return (
        <div style={{ border: `1px solid ${t.border}`, background: t.bg1, borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: 12, color: t.muted, marginBottom: 6, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                {title}
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
            {sub && <div style={{ fontSize: 12, color: t.subtle, marginTop: 4, lineHeight: 1.5 }}>{sub}</div>}
        </div>
    );
}

function Field({ label, children, help }) {
    return (
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 13, color: t.body }}>{label}</span>
            {children}
            {help && <span style={{ fontSize: 12, color: t.subtle, lineHeight: 1.5 }}>{help}</span>}
        </label>
    );
}

function SectionLabel({ text }) {
    return (
        <div style={{ fontSize: 13, fontWeight: 700, color: t.bright, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 10 }}>
            {text}
        </div>
    );
}

function Note({ text }) {
    return (
        <div style={{ fontSize: 13, color: t.muted, lineHeight: 1.7, borderLeft: `3px solid ${t.border}`, paddingLeft: 12 }}>
            {text}
        </div>
    );
}

// ─── SCENARIO: EXTRA PAYMENT ──────────────────────────────────────────────────

function ScenarioExtraPayment({ debts, baseTrajectory, extraPool, strategy, nowMonth }) {
    const [extra, setExtra] = useState(200);

    const scenTrajectory = useMemo(() => {
        return buildTrajectory(debts, extraPool + (Number(extra) || 0), strategy, nowMonth);
    }, [debts, extraPool, extra, strategy, nowMonth]);

    const basePayoff = baseTrajectory.find((p) => p.total === 0)?.month;
    const scenPayoff = scenTrajectory.find((p) => p.total === 0)?.month;
    const monthsSaved = basePayoff && scenPayoff ? basePayoff - scenPayoff : null;

    // Rough interest saved: compare total extra payments to balance reduction difference
    const extraMonths = scenPayoff || (scenTrajectory.length - 1);
    const interestSaved = monthsSaved
        ? monthsSaved * (sumArr(debts, (d) => d.minPayment || 0) + extraPool)
        : null;

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Note text="Add a fixed extra amount per month above your current payments. The extra goes to the focus debt first, then rolls forward. This never changes your real data." />

            <div style={{ border: `1px solid ${t.border}`, background: t.bg1, borderRadius: 12, padding: 16 }}>
                <SectionLabel text="Extra Monthly Payment" />
                <div style={{ maxWidth: 280 }}>
                    <Field label="Extra per month ($)" help="Added on top of what you're already paying above minimums.">
                        <input
                            type="number"
                            value={extra}
                            min={0}
                            onChange={(e) => setExtra(Math.max(0, Number(e.target.value) || 0))}
                            style={inputStyle}
                        />
                    </Field>
                </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
                <StatCard title="Extra Per Month" value={fmtMoney(extra)} color={t.blue} />
                <StatCard
                    title="Months Saved"
                    value={monthsSaved !== null && monthsSaved > 0 ? `${monthsSaved} months` : monthsSaved === 0 ? "No change" : "—"}
                    color={monthsSaved > 0 ? t.green : t.muted}
                />
                <StatCard
                    title="Current Payoff"
                    value={basePayoff ? `~${basePayoff}mo` : "60mo+"}
                    sub="At your current payments"
                    color={t.muted}
                />
                <StatCard
                    title="Scenario Payoff"
                    value={scenPayoff ? `~${scenPayoff}mo` : "60mo+"}
                    sub="With extra payment"
                    color={scenPayoff && basePayoff && scenPayoff < basePayoff ? t.green : t.bright}
                />
            </div>

            <ComparisonChart
                baseline={baseTrajectory}
                scenario={scenTrajectory}
                scenarioLabel={`+${fmtMoney(extra)}/mo`}
            />

            {monthsSaved !== null && monthsSaved > 0 && (
                <div style={{ border: `1px solid ${t.border}`, background: t.bg1, borderRadius: 12, padding: 14 }}>
                    <SectionLabel text="What It Means" />
                    <div style={{ fontSize: 14, color: t.body, lineHeight: 1.8 }}>
                        Adding <strong style={{ color: t.blue }}>{fmtMoney(extra)}/month</strong> moves your estimated payoff{" "}
                        <strong style={{ color: t.green }}>{monthsSaved} months sooner</strong>. Each month of early payoff also
                        avoids that month's interest across all remaining debts — the actual savings compound as balances shrink faster.
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── SCENARIO: LUMP SUM ───────────────────────────────────────────────────────

function ScenarioLumpSum({ debts, baseTrajectory, extraPool, strategy, nowMonth }) {
    const [amount, setAmount] = useState(1000);
    const [targetId, setTargetId] = useState(debts[0]?.id || "focus");

    const scenTrajectory = useMemo(() => {
        const modified = cloneDebts(debts);

        if (targetId === "focus") {
            // Apply to first debt in strategy order (the focus debt)
            const ordered = sortedForStrategy(modified, strategy, 0, nowMonth);
            if (ordered[0]) {
                ordered[0].balance = Math.max(0, ordered[0].balance - (Number(amount) || 0));
            }
        } else {
            const d = modified.find((x) => x.id === targetId);
            if (d) d.balance = Math.max(0, d.balance - (Number(amount) || 0));
        }

        return buildTrajectory(
            modified.filter((d) => d.balance > 0),
            extraPool,
            strategy,
            nowMonth
        );
    }, [debts, extraPool, amount, targetId, strategy, nowMonth]);

    const basePayoff = baseTrajectory.find((p) => p.total === 0)?.month;
    const scenPayoff = scenTrajectory.find((p) => p.total === 0)?.month;
    const monthsSaved = basePayoff && scenPayoff ? basePayoff - scenPayoff : null;

    const focusDebt = sortedForStrategy(debts, strategy, 0, nowMonth)[0];

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Note text="Model the impact of applying a lump sum — tax refund, bonus, windfall — to a specific debt. Read-only: nothing changes in your actual data." />

            <div style={{ border: `1px solid ${t.border}`, background: t.bg1, borderRadius: 12, padding: 16 }}>
                <SectionLabel text="Lump Sum Setup" />
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
                    <Field label="Amount ($)">
                        <input
                            type="number"
                            value={amount}
                            min={0}
                            onChange={(e) => setAmount(Math.max(0, Number(e.target.value) || 0))}
                            style={inputStyle}
                        />
                    </Field>
                    <Field label="Apply to" help="'Focus debt' follows the plan's recommended target.">
                        <select value={targetId} onChange={(e) => setTargetId(e.target.value)} style={selectStyle}>
                            <option value="focus">Focus debt ({focusDebt?.name || "—"})</option>
                            {debts.map((d) => (
                                <option key={d.id} value={d.id}>
                                    {d.name} ({fmtMoney(d.balance)})
                                </option>
                            ))}
                        </select>
                    </Field>
                </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
                <StatCard title="Lump Sum" value={fmtMoney(amount)} color={t.blue} />
                <StatCard
                    title="Months Saved"
                    value={monthsSaved !== null && monthsSaved > 0 ? `${monthsSaved} months` : monthsSaved === 0 ? "No change" : "—"}
                    color={monthsSaved > 0 ? t.green : t.muted}
                />
                <StatCard title="Current Payoff" value={basePayoff ? `~${basePayoff}mo` : "60mo+"} color={t.muted} />
                <StatCard
                    title="Scenario Payoff"
                    value={scenPayoff ? `~${scenPayoff}mo` : "60mo+"}
                    color={scenPayoff && basePayoff && scenPayoff < basePayoff ? t.green : t.bright}
                />
            </div>

            <ComparisonChart
                baseline={baseTrajectory}
                scenario={scenTrajectory}
                scenarioLabel={`${fmtMoney(amount)} lump sum`}
            />

            {monthsSaved !== null && monthsSaved > 0 && (
                <div style={{ border: `1px solid ${t.border}`, background: t.bg1, borderRadius: 12, padding: 14 }}>
                    <SectionLabel text="What It Means" />
                    <div style={{ fontSize: 14, color: t.body, lineHeight: 1.8 }}>
                        A <strong style={{ color: t.blue }}>{fmtMoney(amount)}</strong> lump sum applied to{" "}
                        <strong style={{ color: t.amber }}>
                            {targetId === "focus" ? focusDebt?.name : debts.find((d) => d.id === targetId)?.name}
                        </strong>{" "}
                        moves your payoff <strong style={{ color: t.green }}>{monthsSaved} months sooner</strong>. The freed payment
                        then rolls forward, which is why the effect compounds beyond the initial balance reduction.
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── SCENARIO: CONSOLIDATION LOAN ─────────────────────────────────────────────

function ScenarioConsolidation({ debts, baseTrajectory, extraPool, strategy, nowMonth }) {
    const [loanApr, setLoanApr] = useState(12);
    const [termMonths, setTermMonths] = useState(48);
    const [includeIds, setIncludeIds] = useState(() => new Set(debts.map((d) => d.id)));

    function toggleDebt(id) {
        setIncludeIds((prev) => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    }

    const consolidatedDebts = debts.filter((d) => includeIds.has(d.id));
    const unconsolidatedDebts = debts.filter((d) => !includeIds.has(d.id));
    const consolidatedBalance = sumArr(consolidatedDebts, (d) => d.balance);

    // What you're currently paying toward these debts (actual payments, not just minimums)
    const consolidatedCurrentPayments = sumArr(consolidatedDebts, (d) => d.monthlyPayment || 0);
    // The minimum obligations being released (floor payments)
    const consolidatedMinPayments = sumArr(consolidatedDebts, (d) => d.minPayment || 0);

    // Calculate new loan payment: standard amortization
    const scenLoanPayment = useMemo(() => {
        const r = (Number(loanApr) || 0) / 100 / 12;
        const n = Number(termMonths) || 1;
        const P = consolidatedBalance;
        if (P <= 0) return 0;
        if (r === 0) return P / n;
        return (P * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
    }, [consolidatedBalance, loanApr, termMonths]);

    // Delta vs what you're actually paying (not just minimums)
    const paymentDelta = scenLoanPayment - consolidatedCurrentPayments;

    // Build scenario: replace consolidated debts with one fixed loan
    const scenTrajectory = useMemo(() => {
        const newLoan = {
            id: "__consolidation__",
            type: "loan",
            name: "Consolidation Loan",
            balance: consolidatedBalance,
            apr: Number(loanApr) || 0,
            promoApr: null,
            promoEndDate: null,
            minPayment: scenLoanPayment,
            monthlyPayment: scenLoanPayment,
        };

        const allDebts = [...unconsolidatedDebts, ...(consolidatedBalance > 0 ? [newLoan] : [])];
        const scenExtra = Math.max(
            0,
            sumArr(allDebts, (d) => Math.max(0, (d.monthlyPayment || 0) - (d.minPayment || 0)))
        );

        return buildTrajectory(
            allDebts.filter((d) => d.balance > 0),
            scenExtra,
            strategy,
            nowMonth
        );
    }, [consolidatedBalance, unconsolidatedDebts, loanApr, termMonths, scenLoanPayment, strategy, nowMonth]);

    const basePayoff = baseTrajectory.find((p) => p.total === 0)?.month;
    const scenPayoff = scenTrajectory.find((p) => p.total === 0)?.month;
    const monthsSaved = basePayoff && scenPayoff ? basePayoff - scenPayoff : null;

    // Total interest comparison
    const baseInterest = sumArr(debts, (d) => {
        // rough: balance × apr / 12 × estimated months
        const est = basePayoff || 36;
        return interestThisMonth(d.balance, effectiveApr(d, 0, nowMonth)) * est;
    });
    const scenInterest = scenLoanPayment * (Number(termMonths) || 1) - consolidatedBalance;

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Note text="Model replacing some or all debts with a consolidation loan. Enter the loan's APR and term, choose which debts to consolidate, and see if it actually helps." />

            <div style={{ border: `1px solid ${t.border}`, background: t.bg1, borderRadius: 12, padding: 16 }}>
                <SectionLabel text="Loan Terms" />
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginBottom: 20 }}>
                    <Field label="Loan APR (%)" help="The interest rate you'd get on the consolidation loan.">
                        <input
                            type="number"
                            value={loanApr}
                            min={0}
                            step={0.1}
                            onChange={(e) => setLoanApr(Math.max(0, Number(e.target.value) || 0))}
                            style={inputStyle}
                        />
                    </Field>
                    <Field label="Term (months)" help="How long you'd have to pay it off.">
                        <select value={termMonths} onChange={(e) => setTermMonths(Number(e.target.value))} style={selectStyle}>
                            <option value={12}>12 months (1 year)</option>
                            <option value={24}>24 months (2 years)</option>
                            <option value={36}>36 months (3 years)</option>
                            <option value={48}>48 months (4 years)</option>
                            <option value={60}>60 months (5 years)</option>
                            <option value={72}>72 months (6 years)</option>
                        </select>
                    </Field>
                </div>

                <SectionLabel text="Which Debts to Consolidate" />
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {debts.map((d) => (
                        <button
                            key={d.id}
                            onClick={() => toggleDebt(d.id)}
                            style={{
                                padding: "8px 14px",
                                borderRadius: 8,
                                border: `1px solid ${includeIds.has(d.id) ? t.blue : t.border}`,
                                background: includeIds.has(d.id) ? "#0c1a2e" : t.bg2,
                                color: includeIds.has(d.id) ? t.blue : t.muted,
                                fontSize: 13,
                                cursor: "pointer",
                                fontWeight: includeIds.has(d.id) ? 600 : 400,
                            }}
                        >
                            {includeIds.has(d.id) ? "✓ " : ""}{d.name} ({fmtMoney(d.balance)} @ {fmtPct(effectiveApr(d, 0, nowMonth))})
                        </button>
                    ))}
                </div>
            </div>

            {/* Payment exchange — the core of what consolidation actually does */}
            {consolidatedBalance > 0 && (
                <div style={{ border: `1px solid ${t.border}`, background: t.bg1, borderRadius: 12, padding: 16 }}>
                    <SectionLabel text="The Payment Exchange" />
                    <div style={{ fontSize: 13, color: t.muted, marginBottom: 14, lineHeight: 1.6 }}>
                        Consolidation replaces multiple payments with one. Here's exactly what you'd be trading.
                    </div>

                    {/* Debts being consolidated — what you're releasing */}
                    <div style={{ marginBottom: 14 }}>
                        <div style={{ fontSize: 12, color: t.subtle, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 8 }}>
                            Payments you'd stop making
                        </div>
                        <div style={{ display: "grid", gap: 6 }}>
                            {consolidatedDebts.map((d) => (
                                <div key={d.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 14, color: t.body, padding: "8px 12px", background: t.bg2, borderRadius: 8, border: `1px solid ${t.border}` }}>
                                    <span>{d.name}</span>
                                    <span style={{ display: "flex", gap: 20 }}>
                                        <span style={{ color: t.subtle, fontSize: 12 }}>{fmtMoney(d.balance)} balance</span>
                                        <span style={{ color: t.muted }}>min {fmtMoneyExact(d.minPayment)}</span>
                                        <span style={{ color: t.bright, fontWeight: 600 }}>{fmtMoneyExact(d.monthlyPayment || d.minPayment)}/mo</span>
                                    </span>
                                </div>
                            ))}
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: t.muted, padding: "6px 12px" }}>
                                <span>Total current payments</span>
                                <span style={{ color: t.red, fontWeight: 600 }}>−{fmtMoneyExact(consolidatedCurrentPayments)}/mo</span>
                            </div>
                        </div>
                    </div>

                    {/* Arrow divider */}
                    <div style={{ textAlign: "center", fontSize: 20, color: t.subtle, margin: "8px 0" }}>↕</div>

                    {/* New loan payment */}
                    <div>
                        <div style={{ fontSize: 12, color: t.subtle, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 8 }}>
                            Payment you'd take on
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, color: t.body, padding: "8px 12px", background: t.bg2, borderRadius: 8, border: `1px solid ${t.border}` }}>
                            <span>Consolidation Loan ({fmtPct(loanApr)} APR, {termMonths}mo)</span>
                            <span style={{ color: t.blue, fontWeight: 600 }}>{fmtMoneyExact(scenLoanPayment)}/mo</span>
                        </div>
                    </div>

                    {/* Net difference */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14, padding: "10px 12px", borderRadius: 8, border: `1px solid ${Math.abs(paymentDelta) < 10 ? t.border : paymentDelta > 0 ? "#7f1d1d" : "#14532d"}`, background: Math.abs(paymentDelta) < 10 ? "transparent" : paymentDelta > 0 ? "#1c0707" : "#071c0e" }}>
                        <span style={{ fontSize: 13, color: t.body }}>
                            Net monthly change
                        </span>
                        <span style={{ fontSize: 16, fontWeight: 700, color: paymentDelta > 50 ? t.red : paymentDelta < -50 ? t.green : t.muted }}>
                            {paymentDelta >= 0 ? "+" : ""}{fmtMoneyExact(paymentDelta)}/mo
                            <span style={{ fontSize: 12, fontWeight: 400, marginLeft: 8, color: t.subtle }}>
                                {paymentDelta > 10 ? "higher payment" : paymentDelta < -10 ? "lower payment — check the chart" : "roughly the same"}
                            </span>
                        </span>
                    </div>
                </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
                <StatCard title="Consolidated Balance" value={fmtMoney(consolidatedBalance)} sub="Total balance being replaced" color={t.blue} />
                <StatCard
                    title="New Loan Payment"
                    value={fmtMoneyExact(scenLoanPayment)}
                    sub={`Fixed payment over ${termMonths} months`}
                    color={t.bright}
                />
                <StatCard
                    title="Current Payments Released"
                    value={fmtMoneyExact(consolidatedCurrentPayments)}
                    sub="What you'd stop paying to those debts"
                    color={t.muted}
                />
                <StatCard
                    title="Months Saved"
                    value={monthsSaved !== null && monthsSaved > 0 ? `${monthsSaved} months` : monthsSaved === 0 ? "No change" : monthsSaved !== null && monthsSaved < 0 ? `${Math.abs(monthsSaved)}mo slower` : "—"}
                    color={monthsSaved > 0 ? t.green : monthsSaved < 0 ? t.red : t.muted}
                />
            </div>

            <ComparisonChart
                baseline={baseTrajectory}
                scenario={scenTrajectory}
                scenarioLabel={`${fmtPct(loanApr)} consolidation`}
            />

            <div style={{ border: `1px solid ${t.border}`, background: t.bg1, borderRadius: 12, padding: 14 }}>
                <SectionLabel text="What It Means" />
                <div style={{ display: "grid", gap: 8, fontSize: 14, color: t.body, lineHeight: 1.8 }}>
                    {consolidatedBalance <= 0 ? (
                        <div>Select debts above to consolidate.</div>
                    ) : (
                        <>
                            <div>
                                You'd replace <strong style={{ color: t.bright }}>{fmtMoneyExact(consolidatedCurrentPayments)}/month</strong> across{" "}
                                {consolidatedDebts.length} debt{consolidatedDebts.length !== 1 ? "s" : ""} with a single{" "}
                                <strong style={{ color: t.blue }}>{fmtMoneyExact(scenLoanPayment)}/month</strong> loan payment at{" "}
                                <strong style={{ color: t.bright }}>{fmtPct(loanApr)}</strong> over{" "}
                                <strong style={{ color: t.bright }}>{termMonths} months</strong>.
                            </div>
                            {paymentDelta > 100 && (
                                <div style={{ color: t.amber }}>
                                    ⚠ The new payment is <strong>{fmtMoneyExact(Math.abs(paymentDelta))}/month higher</strong> than
                                    what you're currently paying toward these debts. That can be fine if the lower rate saves significant
                                    interest — check whether the chart shows a shorter payoff.
                                </div>
                            )}
                            {paymentDelta < -100 && (
                                <div style={{ color: t.amber }}>
                                    ⚠ The new payment is <strong>{fmtMoneyExact(Math.abs(paymentDelta))}/month lower</strong> than
                                    what you're currently paying. A lower payment often means a longer term, not real savings.
                                    Check the chart — if the blue line is above the red, consolidation is actually slower.
                                </div>
                            )}
                            {monthsSaved !== null && monthsSaved > 0 && (
                                <div>
                                    The scenario reaches payoff approximately{" "}
                                    <strong style={{ color: t.green }}>{monthsSaved} months sooner</strong> than the current plan.
                                </div>
                            )}
                            {monthsSaved !== null && monthsSaved < 0 && (
                                <div style={{ color: t.red }}>
                                    ⚠ This consolidation would extend your payoff by approximately <strong>{Math.abs(monthsSaved)} months</strong>.
                                    Even if the monthly payment feels more manageable, you'd be in debt longer.
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

// ─── SCENARIO: PURCHASE COST ESTIMATOR ────────────────────────────────────────

function ScenarioPurchaseCost({ state }) {
    const cards = state.creditCards ?? [];
    const [selectedId, setSelectedId] = useState(cards[0]?.id || "");
    const [purchaseAmount, setPurchaseAmount] = useState(0);
    const [mode, setMode] = useState("current_behavior");

    const selectedCard = useMemo(
        () => cards.find((c) => c.id === selectedId) || cards[0] || null,
        [cards, selectedId]
    );

    function getEffectiveCardApr(card) {
        return Number(card?.promoApr) > 0 ? Number(card.promoApr) : Number(card?.apr) || 0;
    }

    function monthlyRate(apr) {
        return (Number(apr) || 0) / 100 / 12;
    }

    const result = useMemo(() => {
        if (!selectedCard || !purchaseAmount || purchaseAmount <= 0) return null;
        const apr = getEffectiveCardApr(selectedCard);
        const r = monthlyRate(apr);

        if (mode === "pay_now") {
            return { interest: 0, totalCost: Number(purchaseAmount), months: 0 };
        }

        if (mode === "3_months" || mode === "6_months") {
            const months = mode === "3_months" ? 3 : 6;
            let working = (Number(selectedCard.balance) || 0) + Number(purchaseAmount);
            let totalInterest = 0;
            const basePayment = Math.max(working / months, Number(selectedCard.minPayment) || 0);
            for (let i = 0; i < months; i++) {
                const interest = working * r;
                totalInterest += interest;
                working += interest;
                working -= Math.min(working, basePayment);
            }
            return { interest: totalInterest, totalCost: Number(purchaseAmount) + totalInterest, months };
        }

        if (mode === "minimum_only") {
            let working = (Number(selectedCard.balance) || 0) + Number(purchaseAmount);
            let totalInterest = 0;
            let months = 0;
            const floor = Math.max(Number(selectedCard.minPayment) || 0, 25);
            while (working > 0.01 && months < 240) {
                months++;
                const interest = working * r;
                totalInterest += interest;
                working += interest;
                const pay = Math.min(working, floor);
                working -= pay;
                if (pay <= interest + 0.01) break;
            }
            return { interest: totalInterest, totalCost: Number(purchaseAmount) + totalInterest, months };
        }

        // current_behavior
        let working = (Number(selectedCard.balance) || 0) + Number(purchaseAmount);
        let totalInterest = 0;
        let months = 0;
        const spend = Number(selectedCard.monthlySpend) || 0;
        const payment = Math.max(Number(selectedCard.monthlyPayment) || 0, Number(selectedCard.minPayment) || 0, 25);
        while (working > 0.01 && months < 240) {
            months++;
            working += spend;
            const interest = working * r;
            totalInterest += interest;
            working += interest;
            const pay = Math.min(working, payment);
            working -= pay;
            if (pay <= interest + spend + 0.01) break;
        }
        return { interest: totalInterest, totalCost: Number(purchaseAmount) + totalInterest, months };
    }, [selectedCard, purchaseAmount, mode]);

    const modeLabel = {
        pay_now: "Pay it off this month",
        "3_months": "3-month payoff",
        "6_months": "6-month payoff",
        minimum_only: "Minimum payments only",
        current_behavior: "Current card behavior",
    };

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Note text="See what a purchase actually costs in total once interest is included. Choose the card, enter the amount, and pick a repayment style." />

            <div style={{ border: `1px solid ${t.border}`, background: t.bg1, borderRadius: 12, padding: 16 }}>
                <SectionLabel text="Purchase Setup" />
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14 }}>
                    <Field label="Credit Card">
                        <select value={selectedCard?.id || ""} onChange={(e) => setSelectedId(e.target.value)} style={selectStyle}>
                            {cards.length === 0 ? (
                                <option value="">No cards entered yet</option>
                            ) : (
                                cards.map((c) => (
                                    <option key={c.id} value={c.id}>
                                        {c.name || "Card"} ({fmtPct(getEffectiveCardApr(c))} APR)
                                    </option>
                                ))
                            )}
                        </select>
                    </Field>
                    <Field label="Purchase Amount ($)">
                        <input
                            type="number"
                            value={purchaseAmount || ""}
                            onChange={(e) => setPurchaseAmount(parseFloat(e.target.value) || 0)}
                            style={inputStyle}
                        />
                    </Field>
                    <Field label="Repayment Style">
                        <select value={mode} onChange={(e) => setMode(e.target.value)} style={selectStyle}>
                            <option value="pay_now">Pay it off this month</option>
                            <option value="3_months">Pay over 3 months</option>
                            <option value="6_months">Pay over 6 months</option>
                            <option value="minimum_only">Minimum payments only</option>
                            <option value="current_behavior">Current card behavior</option>
                        </select>
                    </Field>
                </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
                <StatCard
                    title="Purchase Amount"
                    value={fmtMoneyExact(purchaseAmount)}
                    color={t.bright}
                />
                <StatCard
                    title="Estimated Interest"
                    value={fmtMoneyExact(result?.interest || 0)}
                    sub="Added by carrying the balance"
                    color={result?.interest > 0 ? t.red : t.muted}
                />
                <StatCard
                    title="True Total Cost"
                    value={fmtMoneyExact(result?.totalCost || purchaseAmount)}
                    sub="Purchase + interest"
                    color={t.bright}
                />
                <StatCard
                    title="Time to Clear"
                    value={
                        result
                            ? result.months === 0
                                ? "This month"
                                : result.months >= 240
                                    ? "Long-running"
                                    : `${result.months} months`
                            : "—"
                    }
                    color={t.amber}
                />
            </div>

            {result && selectedCard && purchaseAmount > 0 && (
                <div style={{ border: `1px solid ${t.border}`, background: t.bg1, borderRadius: 12, padding: 14 }}>
                    <SectionLabel text="Plain-English Impact" />
                    <div style={{ fontSize: 14, color: t.body, lineHeight: 1.8 }}>
                        Putting <strong style={{ color: t.bright }}>{fmtMoneyExact(purchaseAmount)}</strong> on{" "}
                        <strong style={{ color: t.amber }}>{selectedCard.name || "this card"}</strong> and
                        repaying via <strong style={{ color: t.bright }}>{modeLabel[mode]}</strong> adds approximately{" "}
                        <strong style={{ color: t.red }}>{fmtMoneyExact(result.interest)}</strong> in interest —
                        making the real cost of the purchase{" "}
                        <strong style={{ color: result.interest > purchaseAmount * 0.1 ? t.red : t.bright }}>
                            {fmtMoneyExact(result.totalCost)}
                        </strong>.
                        {result.interest > purchaseAmount * 0.25 && (
                            <span style={{ color: t.amber }}>
                                {" "}That's more than 25% on top of the sticker price — worth reconsidering the repayment plan.
                            </span>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── MAIN EXPORT ──────────────────────────────────────────────────────────────

const SCENARIO_TABS = [
    { id: "extra", label: "Extra Payment" },
    { id: "lump", label: "Lump Sum" },
    { id: "consolidation", label: "Consolidation Loan" },
    { id: "purchase", label: "Purchase Cost" },
];

export default function Scenarios({ state }) {
    const [activeScenario, setActiveScenario] = useState("extra");
    const nowMonth = useMemo(() => startOfMonth(new Date()), []);

    const { debts, extraPool, strategy, baseTrajectory } = useMemo(() => {
        const debts = buildBaseDebts(state);
        const extraPool = extraPoolFromDebts(debts);
        const strategy = chooseStrategy(debts, nowMonth);
        const baseTrajectory = buildTrajectory(debts, extraPool, strategy, nowMonth);
        return { debts, extraPool, strategy, baseTrajectory };
    }, [state]);

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 980, margin: "0 auto", padding: "0 0 48px" }}>
            {/* Header */}
            <div>
                <h2 style={{ fontSize: 14, fontWeight: 700, color: t.bright, margin: "0 0 4px", letterSpacing: "0.04em", textTransform: "uppercase" }}>
                    Scenarios
                </h2>
                <p style={{ fontSize: 13, color: t.muted, margin: 0, lineHeight: 1.7 }}>
                    Sandbox for modeling what-if changes. Nothing here touches your actual data.
                </p>
            </div>

            {/* Scenario sub-tabs */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {SCENARIO_TABS.map((s) => (
                    <button
                        key={s.id}
                        onClick={() => setActiveScenario(s.id)}
                        style={{
                            padding: "9px 16px",
                            borderRadius: 9,
                            border: `1px solid ${activeScenario === s.id ? t.blue : t.border}`,
                            background: activeScenario === s.id ? "#0c1a2e" : t.bg1,
                            color: activeScenario === s.id ? t.blue : t.muted,
                            fontSize: 13,
                            fontWeight: activeScenario === s.id ? 700 : 400,
                            cursor: "pointer",
                        }}
                    >
                        {s.label}
                    </button>
                ))}
            </div>

            {/* Scenario content */}
            {!debts.length && activeScenario !== "purchase" ? (
                <div style={{ border: `1px solid ${t.border}`, background: t.bg1, borderRadius: 12, padding: 20, color: t.muted, fontSize: 14 }}>
                    Add debts in the Debts tab first — scenarios need at least one active debt to model.
                </div>
            ) : activeScenario === "extra" ? (
                <ScenarioExtraPayment
                    debts={debts}
                    baseTrajectory={baseTrajectory}
                    extraPool={extraPool}
                    strategy={strategy}
                    nowMonth={nowMonth}
                />
            ) : activeScenario === "lump" ? (
                <ScenarioLumpSum
                    debts={debts}
                    baseTrajectory={baseTrajectory}
                    extraPool={extraPool}
                    strategy={strategy}
                    nowMonth={nowMonth}
                />
            ) : activeScenario === "consolidation" ? (
                <ScenarioConsolidation
                    debts={debts}
                    baseTrajectory={baseTrajectory}
                    extraPool={extraPool}
                    strategy={strategy}
                    nowMonth={nowMonth}
                />
            ) : (
                <ScenarioPurchaseCost state={state} />
            )}
        </div>
    );
}
