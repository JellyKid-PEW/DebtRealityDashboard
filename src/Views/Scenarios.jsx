import React, { useMemo, useState } from "react";
import {
    ResponsiveContainer,
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    BarChart,
    Bar,
    Legend,
} from "recharts";
import { calcAll } from "../calculations.js";

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

const BLANK = {
    extraMonthly: 0,
    reduceCardSpend: 0,
    lumpSum: 0,
    assetSale: 0,
    strategy: "avalanche",
    months: 24,
};

function fmtMoney(n) {
    return `$${(Number(n) || 0).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`;
}

function fmtPct(n) {
    return `${(Number(n) || 0).toFixed(1)}%`;
}

function debtSort(a, b, strategy) {
    if (strategy === "snowball") {
        if ((a.balance ?? 0) !== (b.balance ?? 0)) return (a.balance ?? 0) - (b.balance ?? 0);
        return (b.apr ?? 0) - (a.apr ?? 0);
    }
    if ((a.apr ?? 0) !== (b.apr ?? 0)) return (b.apr ?? 0) - (a.apr ?? 0);
    return (b.balance ?? 0) - (a.balance ?? 0);
}

function cloneDebts(state) {
    const cards = (state.creditCards ?? []).map((c) => ({
        id: c.id,
        type: "card",
        name: c.name || "Card",
        balance: Number(c.balance) || 0,
        apr: Number(c.promoApr) > 0 ? Number(c.promoApr) : (Number(c.apr) || 0),
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
        minPayment: Number(l.monthlyPayment) || 0,
        monthlyPayment: Number(l.monthlyPayment) || 0,
        monthlySpend: 0,
    }));

    return [...cards, ...loans];
}

function allocateExtra(debts, extra, strategy) {
    let remaining = Number(extra) || 0;
    if (remaining <= 0) return debts;

    const ordered = [...debts]
        .filter((d) => d.balance > 0)
        .sort((a, b) => debtSort(a, b, strategy));

    for (const target of ordered) {
        if (remaining <= 0) break;
        const applied = Math.min(target.balance, remaining);
        target.balance -= applied;
        target._extraPrincipal = (target._extraPrincipal || 0) + applied;
        remaining -= applied;
    }

    return debts;
}

function allocateLumpSum(debts, lump, strategy) {
    let remaining = Number(lump) || 0;
    if (remaining <= 0) return debts;

    const ordered = [...debts]
        .filter((d) => d.balance > 0)
        .sort((a, b) => debtSort(a, b, strategy));

    for (const target of ordered) {
        if (remaining <= 0) break;
        const applied = Math.min(target.balance, remaining);
        target.balance -= applied;
        target._lumpApplied = (target._lumpApplied || 0) + applied;
        remaining -= applied;
    }

    return debts;
}

function runPortfolioSimulation(state, inputs) {
    const debts = cloneDebts(state);
    const months = Math.max(1, Number(inputs.months) || 24);
    const strategy = inputs.strategy || "avalanche";
    const extraMonthly = Math.max(0, Number(inputs.extraMonthly) || 0);
    const reduceCardSpend = Math.max(0, Number(inputs.reduceCardSpend) || 0);
    const lumpSum = Math.max(0, Number(inputs.lumpSum) || 0) + Math.max(0, Number(inputs.assetSale) || 0);

    allocateLumpSum(debts, lumpSum, strategy);

    const monthlySeries = [];
    let totalInterestPaid = 0;
    let totalPrincipalPaid = 0;
    let totalNewCharges = 0;

    for (let month = 1; month <= months; month++) {
        let monthInterest = 0;
        let monthPrincipal = 0;
        let monthNewCharges = 0;

        debts.forEach((d) => {
            d._extraPrincipal = 0;
        });

        const cards = debts.filter((d) => d.type === "card" && d.balance > 0);
        const totalCardSpend = cards.reduce((sum, c) => sum + (c.monthlySpend || 0), 0);
        const spendReduction = Math.min(totalCardSpend, reduceCardSpend);

        for (const card of cards) {
            const proportion = totalCardSpend > 0 ? (card.monthlySpend || 0) / totalCardSpend : 0;
            const reducedSpend = Math.max(0, (card.monthlySpend || 0) - spendReduction * proportion);
            card.balance += reducedSpend;
            monthNewCharges += reducedSpend;
        }

        for (const debt of debts) {
            if (debt.balance <= 0) continue;
            const interest = debt.balance * (debt.apr / 100) / 12;
            debt.balance += interest;
            monthInterest += interest;
        }

        for (const debt of debts) {
            if (debt.balance <= 0) continue;
            const pay = Math.min(debt.balance, debt.monthlyPayment || debt.minPayment || 0);
            debt.balance -= pay;
            monthPrincipal += pay;
        }

        allocateExtra(debts, extraMonthly, strategy);
        monthPrincipal += debts.reduce((sum, d) => sum + (d._extraPrincipal || 0), 0);

        const totalDebt = debts.reduce((sum, d) => sum + Math.max(0, d.balance), 0);

        totalInterestPaid += monthInterest;
        totalPrincipalPaid += monthPrincipal;
        totalNewCharges += monthNewCharges;

        monthlySeries.push({
            month,
            totalDebt,
            interest: monthInterest,
            principal: monthPrincipal,
            newCharges: monthNewCharges,
        });
    }

    const rankedDebts = [...debts].sort((a, b) => debtSort(a, b, strategy));

    return {
        months,
        strategy,
        endingDebt: monthlySeries[monthlySeries.length - 1]?.totalDebt ?? 0,
        totalInterestPaid,
        totalPrincipalPaid,
        totalNewCharges,
        monthlySeries,
        rankedDebts,
    };
}

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

function SummaryCard({ label, value, sub, color = t.bright }) {
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
                {label}
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
            {sub && <div style={{ fontSize: 12, color: t.subtle, marginTop: 4, lineHeight: 1.5 }}>{sub}</div>}
        </div>
    );
}

function MiniLineChart({ currentSeries, scenarioSeries }) {
    const data = currentSeries.map((row, i) => ({
        month: `M${row.month}`,
        current: Number(row.totalDebt.toFixed(2)),
        scenario: Number((scenarioSeries[i]?.totalDebt ?? 0).toFixed(2)),
    }));

    return (
        <div style={{ border: `1px solid ${t.border}`, background: t.bg1, borderRadius: 12, padding: 14, height: 360 }}>
            <SectionTitle
                title="Total Debt Over Time"
                subtitle="Red is your current path. Green is the scenario path."
            />
            <ResponsiveContainer width="100%" height="85%">
                <LineChart data={data}>
                    <CartesianGrid stroke="#1e293b" />
                    <XAxis dataKey="month" stroke={t.muted} />
                    <YAxis stroke={t.muted} />
                    <Tooltip
                        contentStyle={{ background: t.bg2, border: `1px solid ${t.border}`, color: t.bright }}
                        formatter={(value) => fmtMoney(value)}
                    />
                    <Legend />
                    <Line type="monotone" dataKey="current" stroke={t.red} strokeWidth={3} dot={false} name="Current Path" />
                    <Line type="monotone" dataKey="scenario" stroke={t.green} strokeWidth={3} dot={false} name="Scenario Path" />
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
}

function LegendBar({ label, width, color }) {
    return (
        <div style={{ display: "grid", gridTemplateColumns: "72px 1fr", gap: 8, alignItems: "center" }}>
            <div style={{ fontSize: 12, color: t.muted }}>{label}</div>
            <div style={{ height: 10, background: "#1e293b", borderRadius: 999, overflow: "hidden" }}>
                <div style={{ width, height: "100%", background: color }} />
            </div>
        </div>
    );
}

function DebtBreakdown({ currentDebts }) {
    const data = currentDebts.map((debt) => ({
        name: debt.name,
        balance: Number(debt.balance.toFixed(2)),
        apr: Number(debt.apr.toFixed(1)),
        type: debt.type,
    }));

    return (
        <div style={{ border: `1px solid ${t.border}`, background: t.bg1, borderRadius: 12, padding: 14, height: 360 }}>
            <SectionTitle
                title="Where Your Debt Is Sitting Right Now"
                subtitle="Longer bars mean larger balances."
            />
            <ResponsiveContainer width="100%" height="85%">
                <BarChart data={data} layout="vertical" margin={{ left: 10, right: 10 }}>
                    <CartesianGrid stroke="#1e293b" />
                    <XAxis type="number" stroke={t.muted} />
                    <YAxis type="category" dataKey="name" stroke={t.muted} width={90} />
                    <Tooltip
                        contentStyle={{ background: t.bg2, border: `1px solid ${t.border}`, color: t.bright }}
                        formatter={(value, name, props) =>
                            name === "balance"
                                ? [fmtMoney(value), "Balance"]
                                : [value, name]
                        }
                    />
                    <Bar dataKey="balance" fill={t.amber} radius={[0, 6, 6, 0]} />
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}

function AllocationBars({ series }) {
    const data = series.map((row) => ({
        month: `M${row.month}`,
        interest: Number(row.interest.toFixed(2)),
        principal: Number(row.principal.toFixed(2)),
        newCharges: Number(row.newCharges.toFixed(2)),
    }));

    return (
        <div style={{ border: `1px solid ${t.border}`, background: t.bg1, borderRadius: 12, padding: 14, height: 380 }}>
            <SectionTitle
                title="How Monthly Money Is Moving"
                subtitle="This shows interest cost, actual payoff, and new charges added back in."
            />
            <ResponsiveContainer width="100%" height="85%">
                <BarChart data={data}>
                    <CartesianGrid stroke="#1e293b" />
                    <XAxis dataKey="month" stroke={t.muted} />
                    <YAxis stroke={t.muted} />
                    <Tooltip
                        contentStyle={{ background: t.bg2, border: `1px solid ${t.border}`, color: t.bright }}
                        formatter={(value) => fmtMoney(value)}
                    />
                    <Legend />
                    <Bar dataKey="interest" stackId="a" fill={t.red} />
                    <Bar dataKey="principal" stackId="a" fill={t.green} />
                    <Bar dataKey="newCharges" stackId="a" fill={t.amber} />
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}

function BarRow({ label, value, maxValue, color }) {
    const width = `${(Math.max(0, value) / maxValue) * 100}%`;
    return (
        <div style={{ display: "grid", gridTemplateColumns: "92px 1fr 96px", gap: 8, alignItems: "center" }}>
            <div style={{ fontSize: 12, color: t.muted }}>{label}</div>
            <div style={{ height: 10, background: "#1e293b", borderRadius: 999, overflow: "hidden" }}>
                <div style={{ width, height: "100%", background: color }} />
            </div>
            <div style={{ fontSize: 12, color: t.body, textAlign: "right" }}>{fmtMoney(value)}</div>
        </div>
    );
}

function Field({ label, help, children }) {
    return (
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 13, color: t.body }}>{label}</span>
            {children}
            {help && <span style={{ fontSize: 12, color: t.subtle, lineHeight: 1.5 }}>{help}</span>}
        </label>
    );
}

const inputStyle = {
    width: "100%",
    minHeight: 46,
    borderRadius: 10,
    border: `1px solid ${t.border}`,
    background: t.bg2,
    color: t.bright,
    padding: "10px 12px",
    fontSize: 16,
    outline: "none",
    boxSizing: "border-box",
};

function NumberInput({ value, onChange }) {
    return (
        <input
            type="number"
            value={value || ""}
            onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
            style={{
                ...inputStyle,
                appearance: "textfield",
                MozAppearance: "textfield",
            }}
        />
    );
}

function ExplanationBox({ strategy }) {
    return (
        <div
            style={{
                border: `1px solid ${t.border}`,
                background: t.bg1,
                borderRadius: 12,
                padding: 14,
            }}
        >
            <SectionTitle
                title="How To Read This Page"
                subtitle="These are the meanings behind the visuals so the simulator is easier to interpret."
            />

            <div style={{ display: "grid", gap: 10, color: t.body, fontSize: 14, lineHeight: 1.7 }}>
                <div>
                    <strong style={{ color: t.bright }}>Current path</strong> means your debt continues based on the spending and payment habits already entered in the app.
                </div>
                <div>
                    <strong style={{ color: t.bright }}>Scenario path</strong> means the same debts, but with the extra payment, spending reduction, lump sum, or asset sale you entered above.
                </div>
                <div>
                    <strong style={{ color: t.bright }}>Strategy</strong> tells the simulator where extra money goes after regular monthly payments:
                    {" "}
                    {strategy === "avalanche"
                        ? "Avalanche = highest APR first."
                        : "Snowball = smallest balance first."}
                </div>
            </div>
        </div>
    );
}

function payoffOrderReason(strategy) {
    return strategy === "avalanche"
        ? "highest APR first"
        : "smallest balance first";
}

function estimatePayoffMonths(state, inputs, maxMonths = 240) {
    const result = runPortfolioSimulation(state, { ...inputs, months: maxMonths });
    const hitZeroMonth = result.monthlySeries.find((m) => m.totalDebt <= 0.01)?.month;
    return hitZeroMonth || maxMonths;
}

function improvementLabel(deltaDebt, deltaInterest) {
    if (deltaDebt >= 10000 || deltaInterest >= 3000) return "Strong";
    if (deltaDebt >= 3000 || deltaInterest >= 1000) return "Moderate";
    if (deltaDebt > 0 || deltaInterest > 0) return "Minor";
    return "None";
}

function firstTargetName(state, strategy) {
    const debts = cloneDebts(state)
        .filter((d) => d.balance > 0)
        .sort((a, b) => debtSort(a, b, strategy));
    return debts[0]?.name || "—";
}

export default function Scenarios({ state }) {
    const [inputs, setInputs] = useState(BLANK);

    const baseCalc = useMemo(() => calcAll(state), [state]);

    const currentProjection = useMemo(
        () =>
            runPortfolioSimulation(state, {
                ...BLANK,
                strategy: inputs.strategy,
                months: inputs.months,
            }),
        [state, inputs.strategy, inputs.months]
    );

    const scenarioProjection = useMemo(
        () => runPortfolioSimulation(state, inputs),
        [state, inputs]
    );

    const currentDebts = useMemo(() => cloneDebts(state), [state]);

    const deltaDebt = currentProjection.endingDebt - scenarioProjection.endingDebt;
    const deltaInterest = currentProjection.totalInterestPaid - scenarioProjection.totalInterestPaid;
    const deltaCharges = currentProjection.totalNewCharges - scenarioProjection.totalNewCharges;

    const isMobile = window.innerWidth <= 768;

    const currentPayoffMonths = useMemo(
        () =>
            estimatePayoffMonths(state, {
                ...BLANK,
                strategy: inputs.strategy,
            }),
        [state, inputs.strategy]
    );

    const scenarioPayoffMonths = useMemo(
        () => estimatePayoffMonths(state, inputs),
        [state, inputs]
    );

    const monthsSaved = Math.max(0, currentPayoffMonths - scenarioPayoffMonths);
    const improvement = improvementLabel(deltaDebt, deltaInterest);
    const firstTarget = firstTargetName(state, inputs.strategy);
    const routingReason = payoffOrderReason(inputs.strategy);

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
                    Portfolio Scenarios
                </h2>
                <p style={{ fontSize: 13, color: t.muted, margin: 0, lineHeight: 1.7 }}>
                    This page compares your current debt path to an improved scenario using all cards and loans together.
                </p>
            </div>

            <div
                style={{
                    border: `1px solid ${t.border}`,
                    background: t.bg1,
                    borderRadius: 12,
                    padding: 14,
                }}
            >
                <SectionTitle
                    title="Scenario Controls"
                    subtitle="Enter the changes you want to test. The simulator updates the full portfolio, not just one card."
                />

                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))",
                        gap: 14,
                    }}
                >
                    <Field
                        label="Extra Monthly Payment ($)"
                        help="Extra money added each month on top of your normal payments."
                    >
                        <NumberInput
                            value={inputs.extraMonthly}
                            onChange={(v) => setInputs({ ...inputs, extraMonthly: v })}
                        />
                    </Field>

                    <Field
                        label="Reduce Card Spending By ($ / month)"
                        help="How much new card spending you want to cut each month."
                    >
                        <NumberInput
                            value={inputs.reduceCardSpend}
                            onChange={(v) => setInputs({ ...inputs, reduceCardSpend: v })}
                        />
                    </Field>

                    <Field
                        label="One-Time Lump Sum ($)"
                        help="A one-time amount you can apply immediately."
                    >
                        <NumberInput
                            value={inputs.lumpSum}
                            onChange={(v) => setInputs({ ...inputs, lumpSum: v })}
                        />
                    </Field>

                    <Field
                        label="Asset Sale Applied To Debt ($)"
                        help="Money raised from collectibles or other items sold."
                    >
                        <NumberInput
                            value={inputs.assetSale}
                            onChange={(v) => setInputs({ ...inputs, assetSale: v })}
                        />
                    </Field>

                    <Field
                        label="Payoff Strategy"
                        help="This controls where extra money goes after normal payments."
                    >
                        <select
                            value={inputs.strategy}
                            onChange={(e) => setInputs({ ...inputs, strategy: e.target.value })}
                            style={inputStyle}
                        >
                            <option value="avalanche">Avalanche — highest APR first</option>
                            <option value="snowball">Snowball — smallest balance first</option>
                        </select>
                    </Field>

                    <Field
                        label="Projection Window"
                        help="How many months forward you want the simulation to look."
                    >
                        <select
                            value={inputs.months}
                            onChange={(e) => setInputs({ ...inputs, months: Number(e.target.value) })}
                            style={inputStyle}
                        >
                            <option value={12}>12 months</option>
                            <option value={24}>24 months</option>
                            <option value={36}>36 months</option>
                            <option value={48}>48 months</option>
                        </select>
                    </Field>
                </div>
            </div>

            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: isMobile ? "1fr" : "repeat(4, minmax(0, 1fr))",
                    gap: 12,
                }}
            >
                <SummaryCard
                    label="Current Ending Debt"
                    value={fmtMoney(currentProjection.endingDebt)}
                    sub={`If nothing changes over the next ${inputs.months} months.`}
                    color={t.red}
                />
                <SummaryCard
                    label="Scenario Ending Debt"
                    value={fmtMoney(scenarioProjection.endingDebt)}
                    sub={`With your selected scenario and ${inputs.strategy} strategy.`}
                    color={t.green}
                />
                <SummaryCard
                    label="Debt Reduced vs Current"
                    value={fmtMoney(deltaDebt)}
                    sub="How much lower the scenario ends compared to your current path."
                    color={deltaDebt >= 0 ? t.green : t.red}
                />
                <SummaryCard
                    label="Interest Saved"
                    value={fmtMoney(deltaInterest)}
                    sub={`New charges reduced by ${fmtMoney(deltaCharges)} over the projection.`}
                    color={deltaInterest >= 0 ? t.green : t.red}
                />
            </div>

            <div
                style={{
                    border: `1px solid ${t.border}`,
                    background: t.bg1,
                    borderRadius: 12,
                    padding: 14,
                }}
            >
                <SectionTitle
                    title="Scenario Takeaway"
                    subtitle="This is the plain-English explanation of what your current change is actually doing."
                />

                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: isMobile ? "1fr" : "repeat(3, minmax(0, 1fr))",
                        gap: 12,
                        marginBottom: 14,
                    }}
                >
                    <SummaryCard
                        label="Extra Money Goes First To"
                        value={firstTarget}
                        sub={`Because this strategy targets ${routingReason}.`}
                        color={t.amber}
                    />
                    <SummaryCard
                        label="Time Saved"
                        value={monthsSaved > 0 ? `${monthsSaved} months` : "No major change"}
                        sub="Rough payoff acceleration compared to your current path."
                        color={monthsSaved > 0 ? t.green : t.muted}
                    />
                    <SummaryCard
                        label="Improvement Level"
                        value={improvement}
                        sub="A quick read on whether this change is small or meaningful."
                        color={
                            improvement === "Strong"
                                ? t.green
                                : improvement === "Moderate"
                                    ? t.amber
                                    : improvement === "Minor"
                                        ? t.blue
                                        : t.muted
                        }
                    />
                </div>

                <div
                    style={{
                        color: t.body,
                        lineHeight: 1.8,
                        fontSize: 14,
                        display: "grid",
                        gap: 8,
                    }}
                >
                    <div>
                        With an extra change of{" "}
                        <strong style={{ color: t.bright }}>
                            {fmtMoney(inputs.extraMonthly)}
                        </strong>
                        {inputs.reduceCardSpend > 0 && (
                            <>
                                {" "}and a spending reduction of{" "}
                                <strong style={{ color: t.bright }}>
                                    {fmtMoney(inputs.reduceCardSpend)}/month
                                </strong>
                            </>
                        )}
                        {inputs.lumpSum > 0 && (
                            <>
                                {" "}plus a one-time lump sum of{" "}
                                <strong style={{ color: t.bright }}>
                                    {fmtMoney(inputs.lumpSum)}
                                </strong>
                            </>
                        )}
                        {inputs.assetSale > 0 && (
                            <>
                                {" "}and asset sale proceeds of{" "}
                                <strong style={{ color: t.bright }}>
                                    {fmtMoney(inputs.assetSale)}
                                </strong>
                            </>
                        )}
                        , the simulator sends extra money first to{" "}
                        <strong style={{ color: t.amber }}>{firstTarget}</strong>.
                    </div>

                    <div>
                        Over the next{" "}
                        <strong style={{ color: t.bright }}>{inputs.months} months</strong>,
                        this lowers projected ending debt by{" "}
                        <strong style={{ color: deltaDebt >= 0 ? t.green : t.red }}>
                            {fmtMoney(deltaDebt)}
                        </strong>
                        {" "}and saves about{" "}
                        <strong style={{ color: deltaInterest >= 0 ? t.green : t.red }}>
                            {fmtMoney(deltaInterest)}
                        </strong>
                        {" "}in interest.
                    </div>

                    <div>
                        Rough payoff estimate:
                        {" "}
                        <strong style={{ color: t.red }}>{currentPayoffMonths} months</strong>
                        {" "}on your current path versus{" "}
                        <strong style={{ color: t.green }}>{scenarioPayoffMonths} months</strong>
                        {" "}with this scenario.
                    </div>

                    <div>
                        Best next move:
                        {" "}
                        <strong style={{ color: t.bright }}>
                            {inputs.extraMonthly > 0 || inputs.reduceCardSpend > 0 || inputs.lumpSum > 0 || inputs.assetSale > 0
                                ? `keep ${inputs.strategy} and focus extra money on ${firstTarget}`
                                : `enter an extra payment or spending reduction to see a meaningful difference`}
                        </strong>
                        .
                    </div>
                </div>
            </div>

            <ExplanationBox strategy={inputs.strategy} />

            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: isMobile ? "1fr" : "1.2fr 1fr",
                    gap: 12,
                }}
            >
                <MiniLineChart
                    currentSeries={currentProjection.monthlySeries}
                    scenarioSeries={scenarioProjection.monthlySeries}
                />
                <DebtBreakdown currentDebts={currentDebts} />
            </div>

            <AllocationBars series={scenarioProjection.monthlySeries.slice(0, 6)} />

            <div
                style={{
                    border: `1px solid ${t.border}`,
                    background: t.bg1,
                    borderRadius: 12,
                    padding: 14,
                }}
            >
                <SectionTitle
                    title={`Ranked Payoff Order (${inputs.strategy})`}
                    subtitle="This is the order extra money gets applied after your regular monthly payments."
                />

                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {scenarioProjection.rankedDebts.map((debt, i) => {
                        const reason =
                            inputs.strategy === "avalanche"
                                ? "Targeted for highest APR."
                                : "Targeted for smallest balance.";

                        return (
                            <div
                                key={`${debt.type}-${debt.id}`}
                                style={{
                                    border: `1px solid ${t.border}`,
                                    borderRadius: 10,
                                    padding: 12,
                                    background: t.bg2,
                                }}
                            >
                                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                                    <div>
                                        <div style={{ color: t.bright, fontSize: 14, fontWeight: 600 }}>
                                            #{i + 1} · {debt.name}
                                        </div>
                                        <div style={{ color: t.subtle, fontSize: 12, marginTop: 2 }}>
                                            {debt.type === "card" ? "Credit Card" : "Loan"} · {reason}
                                        </div>
                                    </div>

                                    <div style={{ textAlign: isMobile ? "left" : "right" }}>
                                        <div style={{ color: t.body, fontSize: 13 }}>{fmtMoney(debt.balance)} remaining</div>
                                        <div style={{ color: t.muted, fontSize: 12 }}>
                                            {fmtPct(debt.apr)} APR · {fmtMoney(debt.monthlyPayment)}/mo
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

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
                    subtitle="This is the fastest summary of what the simulator is saying."
                />

                <div style={{ color: t.body, lineHeight: 1.8, fontSize: 14 }}>
                    <div>
                        Live debt direction from your current app data:{" "}
                        <strong
                            style={{
                                color:
                                    baseCalc.netDebtChange.direction === "decreasing"
                                        ? t.green
                                        : baseCalc.netDebtChange.direction === "increasing"
                                            ? t.red
                                            : t.amber,
                            }}
                        >
                            {baseCalc.netDebtChange.direction}
                        </strong>
                    </div>
                    <div>
                        Over the next {inputs.months} months, this scenario changes projected ending debt by{" "}
                        <strong style={{ color: deltaDebt >= 0 ? t.green : t.red }}>
                            {fmtMoney(deltaDebt)}
                        </strong>.
                    </div>
                    <div>
                        Strategy selected: <strong style={{ color: t.amber }}>{inputs.strategy}</strong>.
                    </div>
                </div>
            </div>
        </div>
    );
}