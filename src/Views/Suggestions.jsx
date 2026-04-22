import React, { useMemo } from "react";

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

function fmtMoney(n) {
    return `$${(Number(n) || 0).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`;
}

function fmtPct(n) {
    return `${(Number(n) || 0).toFixed(1)}%`;
}

function cardEffectiveApr(card) {
    return Number(card.promoApr) > 0 ? Number(card.promoApr) : (Number(card.apr) || 0);
}

function debtRows(state) {
    const cards = (state.creditCards ?? []).map((c) => ({
        id: c.id,
        type: "card",
        name: c.name || "Card",
        balance: Number(c.balance) || 0,
        apr: cardEffectiveApr(c),
        minPayment: Number(c.minPayment) || 0,
        monthlyPayment: Number(c.monthlyPayment) || 0,
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

function simulatePayoff(debts, strategy, extraMonthly = 0, maxMonths = 240) {
    const working = debts
        .filter((d) => d.balance > 0)
        .map((d) => ({ ...d }));

    let months = 0;
    let totalInterest = 0;

    while (working.some((d) => d.balance > 0.01) && months < maxMonths) {
        months += 1;

        for (const d of working) {
            if (d.balance <= 0) continue;
            const interest = d.balance * (d.apr / 100) / 12;
            d.balance += interest;
            totalInterest += interest;
        }

        for (const d of working) {
            if (d.balance <= 0) continue;
            const basePay = Math.min(d.balance, d.monthlyPayment || d.minPayment || 0);
            d.balance -= basePay;
        }

        let remaining = extraMonthly;
        const ordered = [...working]
            .filter((d) => d.balance > 0)
            .sort((a, b) => {
                if (strategy === "snowball") {
                    if (a.balance !== b.balance) return a.balance - b.balance;
                    return b.apr - a.apr;
                }
                if (a.apr !== b.apr) return b.apr - a.apr;
                return b.balance - a.balance;
            });

        for (const d of ordered) {
            if (remaining <= 0) break;
            const applied = Math.min(d.balance, remaining);
            d.balance -= applied;
            remaining -= applied;
        }
    }

    return { months, totalInterest };
}

function SectionTitle({ title, subtitle }) {
    return (
        <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: t.bright, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>
                {title}
            </div>
            {subtitle && <div style={{ fontSize: 13, color: t.muted, lineHeight: 1.6 }}>{subtitle}</div>}
        </div>
    );
}

function Card({ title, value, sub, color = t.bright }) {
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

export default function Suggestions({ state }) {
    const isMobile = window.innerWidth <= 768;

    const model = useMemo(() => {
        const debts = debtRows(state);

        const cards = debts.filter((d) => d.type === "card");
        const loans = debts.filter((d) => d.type === "loan");

        const highestApr = [...debts].sort((a, b) => b.apr - a.apr)[0];
        const smallestBalance = [...debts].filter((d) => d.balance > 0).sort((a, b) => a.balance - b.balance)[0];
        const largestBalance = [...debts].sort((a, b) => b.balance - a.balance)[0];

        const worstCardBehavior = [...cards].sort((a, b) => {
            const aGap = (a.monthlySpend || 0) - (a.monthlyPayment || 0);
            const bGap = (b.monthlySpend || 0) - (b.monthlyPayment || 0);
            return bGap - aGap;
        })[0];

        const extraMonthlyCapacity = Math.max(
            0,
            cards.reduce((sum, c) => sum + Math.max(0, (c.monthlyPayment || 0) - (c.minPayment || 0)), 0)
        );

        const avalanche = simulatePayoff(debts, "avalanche", extraMonthlyCapacity);
        const snowball = simulatePayoff(debts, "snowball", extraMonthlyCapacity);

        const methodRecommendation =
            avalanche.totalInterest < snowball.totalInterest
                ? "avalanche"
                : snowball.months < avalanche.months
                    ? "snowball"
                    : "avalanche";

        const suggestions = [];

        if (highestApr) {
            suggestions.push({
                title: "Best interest-saving target",
                main: highestApr.name,
                detail: `Highest APR at ${fmtPct(highestApr.apr)}. This is your avalanche priority.`,
            });
        }

        if (smallestBalance) {
            suggestions.push({
                title: "Fastest account to close",
                main: smallestBalance.name,
                detail: `Smallest balance at ${fmtMoney(smallestBalance.balance)}. This is your snowball priority.`,
            });
        }

        if (worstCardBehavior && (worstCardBehavior.monthlySpend - worstCardBehavior.monthlyPayment) > 0) {
            suggestions.push({
                title: "Card most likely undoing progress",
                main: worstCardBehavior.name,
                detail: `You are adding about ${fmtMoney(worstCardBehavior.monthlySpend)} and paying about ${fmtMoney(worstCardBehavior.monthlyPayment)} monthly.`,
            });
        }

        if (largestBalance) {
            suggestions.push({
                title: "Largest weight in the portfolio",
                main: largestBalance.name,
                detail: `Largest balance at ${fmtMoney(largestBalance.balance)}.`,
            });
        }

        return {
            debts,
            cards,
            loans,
            highestApr,
            smallestBalance,
            largestBalance,
            worstCardBehavior,
            extraMonthlyCapacity,
            avalanche,
            snowball,
            methodRecommendation,
            suggestions,
        };
    }, [state]);

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 980, margin: "0 auto", padding: "0 0 48px" }}>
            <div>
                <h2 style={{ fontSize: 14, fontWeight: 700, color: t.bright, margin: "0 0 4px", letterSpacing: "0.04em", textTransform: "uppercase" }}>
                    Suggestions
                </h2>
                <p style={{ fontSize: 13, color: t.muted, margin: 0, lineHeight: 1.7 }}>
                    This page suggests where extra money should go based on the debts and payment habits already entered into the app.
                </p>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, minmax(0, 1fr))", gap: 12 }}>
                <Card
                    title="Suggested Method"
                    value={model.methodRecommendation === "avalanche" ? "Avalanche" : "Snowball"}
                    sub={
                        model.methodRecommendation === "avalanche"
                            ? "Best for minimizing interest based on your current numbers."
                            : "Best for closing accounts faster based on your current numbers."
                    }
                    color={t.amber}
                />
                <Card
                    title="Extra Monthly Already Happening"
                    value={fmtMoney(model.extraMonthlyCapacity)}
                    sub="This is the amount above card minimums currently being paid each month."
                    color={t.green}
                />
                <Card
                    title="Worst Card Gap"
                    value={
                        model.worstCardBehavior
                            ? fmtMoney((model.worstCardBehavior.monthlySpend || 0) - (model.worstCardBehavior.monthlyPayment || 0))
                            : fmtMoney(0)
                    }
                    sub="Positive means a card is still growing month to month."
                    color={t.red}
                />
            </div>

            <div style={{ border: `1px solid ${t.border}`, background: t.bg1, borderRadius: 12, padding: 14 }}>
                <SectionTitle
                    title="Method Comparison"
                    subtitle="This compares how your current above-minimum payment behavior would perform under avalanche versus snowball."
                />

                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
                    <Card
                        title="Avalanche"
                        value={`${model.avalanche.months} months`}
                        sub={`Projected interest: ${fmtMoney(model.avalanche.totalInterest)}`}
                        color={t.blue}
                    />
                    <Card
                        title="Snowball"
                        value={`${model.snowball.months} months`}
                        sub={`Projected interest: ${fmtMoney(model.snowball.totalInterest)}`}
                        color={t.blue}
                    />
                </div>
            </div>

            <div style={{ border: `1px solid ${t.border}`, background: t.bg1, borderRadius: 12, padding: 14 }}>
                <SectionTitle
                    title="Recommended Priorities"
                    subtitle="These are the clearest action targets based on the balances, APRs, and payment behavior you entered."
                />

                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {model.suggestions.map((s, i) => (
                        <div key={i} style={{ border: `1px solid ${t.border}`, background: t.bg2, borderRadius: 10, padding: 12 }}>
                            <div style={{ color: t.muted, fontSize: 12, marginBottom: 4 }}>{s.title}</div>
                            <div style={{ color: t.bright, fontSize: 16, fontWeight: 600, marginBottom: 4 }}>{s.main}</div>
                            <div style={{ color: t.body, fontSize: 13, lineHeight: 1.6 }}>{s.detail}</div>
                        </div>
                    ))}
                </div>
            </div>

            <div style={{ border: `1px solid ${t.border}`, background: t.bg1, borderRadius: 12, padding: 14 }}>
                <SectionTitle
                    title="Simple Recommendation"
                    subtitle="If you want the app to tell you where extra money should go right now, this is the short answer."
                />

                <div>
                    If your goal is <strong style={{ color: t.bright }}>lowest total interest</strong>, send extra money to{" "}
                    <strong style={{ color: t.amber }}>{model.highestApr?.name || "—"}</strong>.
                </div>
                <div>
                    If your goal is <strong style={{ color: t.bright }}>closing an account fastest</strong>, send extra money to{" "}
                    <strong style={{ color: t.amber }}>{model.smallestBalance?.name || "—"}</strong>.
                </div>
                <div>
                    If your goal is <strong style={{ color: t.bright }}>stopping backward movement</strong>, first reduce spending pressure on{" "}
                    <strong style={{ color: t.amber }}>{model.worstCardBehavior?.name || "—"}</strong>.
                </div>
            </div>
        </div>
    );
}