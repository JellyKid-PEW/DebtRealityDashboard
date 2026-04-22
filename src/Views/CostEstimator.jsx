import React, { useMemo, useState } from "react";

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

function monthlyRate(apr) {
    return (Number(apr) || 0) / 100 / 12;
}

function getEffectiveApr(card) {
    return Number(card?.promoApr) > 0 ? Number(card.promoApr) : (Number(card?.apr) || 0);
}

function estimateFixedMonthsCost(balance, purchaseAmount, apr, months, paymentFloor = 0) {
    const r = monthlyRate(apr);
    let working = (Number(balance) || 0) + (Number(purchaseAmount) || 0);
    let totalInterest = 0;

    if (months <= 0) {
        return {
            interest: 0,
            totalCost: purchaseAmount,
            months: 0,
            endingBalance: working,
        };
    }

    const basePayment = Math.max(working / months, paymentFloor);

    for (let i = 0; i < months; i++) {
        const interest = working * r;
        totalInterest += interest;
        working += interest;
        const payment = Math.min(working, basePayment);
        working -= payment;
    }

    return {
        interest: totalInterest,
        totalCost: (Number(purchaseAmount) || 0) + totalInterest,
        months,
        endingBalance: working,
    };
}

function estimateMinimumOnly(balance, purchaseAmount, apr, minPayment, maxMonths = 240) {
    const r = monthlyRate(apr);
    let working = (Number(balance) || 0) + (Number(purchaseAmount) || 0);
    let totalInterest = 0;
    let months = 0;
    const paymentFloor = Math.max(Number(minPayment) || 0, 25);

    while (working > 0.01 && months < maxMonths) {
        months += 1;
        const interest = working * r;
        totalInterest += interest;
        working += interest;

        const payment = Math.min(working, paymentFloor);
        working -= payment;

        if (payment <= interest + 0.01) {
            // negative/near-negative amortization protection
            break;
        }
    }

    return {
        interest: totalInterest,
        totalCost: (Number(purchaseAmount) || 0) + totalInterest,
        months,
        endingBalance: working,
    };
}

function estimateCurrentBehavior(card, purchaseAmount, maxMonths = 240) {
    const apr = getEffectiveApr(card);
    const r = monthlyRate(apr);

    let working = (Number(card?.balance) || 0) + (Number(purchaseAmount) || 0);
    let totalInterest = 0;
    let months = 0;

    const monthlySpend = Number(card?.monthlySpend) || 0;
    const monthlyPayment = Math.max(Number(card?.monthlyPayment) || 0, Number(card?.minPayment) || 0, 25);

    while (working > 0.01 && months < maxMonths) {
        months += 1;

        // simulate ordinary new charges continuing
        working += monthlySpend;

        const interest = working * r;
        totalInterest += interest;
        working += interest;

        const payment = Math.min(working, monthlyPayment);
        working -= payment;

        if (payment <= interest + monthlySpend + 0.01) {
            // card is effectively not shrinking under current behavior
            break;
        }
    }

    return {
        interest: totalInterest,
        totalCost: (Number(purchaseAmount) || 0) + totalInterest,
        months,
        endingBalance: working,
    };
}

function getImpactLabel(mode, result, card, purchaseAmount) {
    const monthlySpend = Number(card?.monthlySpend) || 0;
    const monthlyPayment = Number(card?.monthlyPayment) || 0;
    const minPayment = Number(card?.minPayment) || 0;

    if (mode === "pay_now") {
        return "Low impact — manageable if paid off immediately.";
    }

    if (mode === "current_behavior") {
        if (monthlyPayment <= monthlySpend) {
            return "High impact — this card is already under pressure, and this purchase likely makes payoff harder.";
        }
        if (result.months >= 240 || result.endingBalance > 0.01) {
            return "High impact — at current behavior, this purchase is likely to linger and add significant cost.";
        }
        if (result.interest > purchaseAmount * 0.25) {
            return "Moderate to high impact — this purchase should clear eventually, but at a noticeable added cost.";
        }
        return "Moderate impact — this purchase is absorbable, but not free.";
    }

    if (mode === "minimum_only") {
        if (minPayment <= 0) {
            return "Unclear impact — minimum payment data is missing.";
        }
        if (result.months >= 240 || result.endingBalance > 0.01) {
            return "Very high impact — minimum payments are not enough to clear this efficiently.";
        }
        return "High impact — minimum-pay behavior makes this purchase much more expensive.";
    }

    if (result.interest <= purchaseAmount * 0.05) {
        return "Low impact — relatively manageable under this payoff plan.";
    }
    if (result.interest <= purchaseAmount * 0.20) {
        return "Moderate impact — noticeable added cost, but still contained.";
    }
    return "High impact — this purchase becomes meaningfully more expensive over time.";
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

export default function CostEstimator({ state }) {
    const isMobile = window.innerWidth <= 768;
    const cards = state.creditCards ?? [];

    const [selectedId, setSelectedId] = useState(cards[0]?.id || "");
    const [purchaseAmount, setPurchaseAmount] = useState(0);
    const [mode, setMode] = useState("current_behavior");

    const selectedCard = useMemo(
        () => cards.find((c) => c.id === selectedId) || cards[0] || null,
        [cards, selectedId]
    );

    const result = useMemo(() => {
        if (!selectedCard || !purchaseAmount || purchaseAmount <= 0) {
            return null;
        }

        const apr = getEffectiveApr(selectedCard);

        if (mode === "pay_now") {
            return {
                interest: 0,
                totalCost: Number(purchaseAmount),
                months: 0,
                endingBalance: (Number(selectedCard.balance) || 0) + Number(purchaseAmount),
            };
        }

        if (mode === "3_months") {
            return estimateFixedMonthsCost(
                selectedCard.balance,
                purchaseAmount,
                apr,
                3,
                selectedCard.minPayment
            );
        }

        if (mode === "6_months") {
            return estimateFixedMonthsCost(
                selectedCard.balance,
                purchaseAmount,
                apr,
                6,
                selectedCard.minPayment
            );
        }

        if (mode === "minimum_only") {
            return estimateMinimumOnly(
                selectedCard.balance,
                purchaseAmount,
                apr,
                selectedCard.minPayment
            );
        }

        return estimateCurrentBehavior(selectedCard, purchaseAmount);
    }, [selectedCard, purchaseAmount, mode]);

    const impactText = result && selectedCard
        ? getImpactLabel(mode, result, selectedCard, purchaseAmount)
        : "Enter a purchase amount and choose a card to estimate the real-world cost.";

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 980, margin: "0 auto", padding: "0 0 48px" }}>
            <div>
                <h2 style={{ fontSize: 14, fontWeight: 700, color: t.bright, margin: "0 0 4px", letterSpacing: "0.04em", textTransform: "uppercase" }}>
                    Cost Estimator
                </h2>
                <p style={{ fontSize: 13, color: t.muted, margin: 0, lineHeight: 1.7 }}>
                    Use this page to estimate what a purchase on a credit card likely costs in the real world based on how you expect it to be paid back.
                </p>
            </div>

            <div style={{ border: `1px solid ${t.border}`, background: t.bg1, borderRadius: 12, padding: 14 }}>
                <SectionTitle
                    title="Purchase Setup"
                    subtitle="Choose a card, enter the amount, and tell the estimator how you expect the purchase to be paid back."
                />

                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: isMobile ? "1fr" : "repeat(3, minmax(0, 1fr))",
                        gap: 14,
                    }}
                >
                    <Field
                        label="Credit Card"
                        help="The purchase will be evaluated against this card's balance, APR, and payment behavior."
                    >
                        <select
                            value={selectedCard?.id || ""}
                            onChange={(e) => setSelectedId(e.target.value)}
                            style={inputStyle}
                        >
                            {cards.length === 0 ? (
                                <option value="">No cards entered yet</option>
                            ) : (
                                cards.map((card) => (
                                    <option key={card.id} value={card.id}>
                                        {card.name || "Card"}
                                    </option>
                                ))
                            )}
                        </select>
                    </Field>

                    <Field
                        label="Purchase Amount ($)"
                        help="The amount you are thinking about putting on the card right now."
                    >
                        <input
                            type="number"
                            value={purchaseAmount || ""}
                            onChange={(e) => setPurchaseAmount(parseFloat(e.target.value) || 0)}
                            style={inputStyle}
                        />
                    </Field>

                    <Field
                        label="Repayment Style"
                        help="Choose the payoff pattern you want the estimator to assume."
                    >
                        <select
                            value={mode}
                            onChange={(e) => setMode(e.target.value)}
                            style={inputStyle}
                        >
                            <option value="pay_now">Pay it off this month</option>
                            <option value="3_months">Pay over 3 months</option>
                            <option value="6_months">Pay over 6 months</option>
                            <option value="minimum_only">Minimum payments only</option>
                            <option value="current_behavior">Use current card behavior</option>
                        </select>
                    </Field>
                </div>
            </div>

            {selectedCard && (
                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: isMobile ? "1fr" : "repeat(4, minmax(0, 1fr))",
                        gap: 12,
                    }}
                >
                    <Card
                        title="Current Card Balance"
                        value={fmtMoney(selectedCard.balance)}
                        sub="What is already sitting on this card."
                        color={t.blue}
                    />
                    <Card
                        title="APR"
                        value={fmtPct(getEffectiveApr(selectedCard))}
                        sub="Interest rate currently used for this estimate."
                        color={t.amber}
                    />
                    <Card
                        title="Average Monthly Payment"
                        value={fmtMoney(selectedCard.monthlyPayment)}
                        sub="What you currently tend to pay toward this card."
                        color={t.green}
                    />
                    <Card
                        title="Monthly Spend Behavior"
                        value={fmtMoney(selectedCard.monthlySpend)}
                        sub="What you currently tend to add to this card each month."
                        color={t.red}
                    />
                </div>
            )}

            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: isMobile ? "1fr" : "repeat(4, minmax(0, 1fr))",
                    gap: 12,
                }}
            >
                <Card
                    title="Purchase Amount"
                    value={fmtMoney(purchaseAmount)}
                    sub="The amount being estimated."
                    color={t.bright}
                />
                <Card
                    title="Estimated Interest Added"
                    value={fmtMoney(result?.interest || 0)}
                    sub="Approximate interest created by this purchase under the selected repayment style."
                    color={t.red}
                />
                <Card
                    title="Estimated Total Cost"
                    value={fmtMoney(result?.totalCost || purchaseAmount)}
                    sub="Purchase amount plus estimated interest."
                    color={t.green}
                />
                <Card
                    title="Rough Time To Clear"
                    value={
                        result
                            ? result.months === 0
                                ? "This month"
                                : result.months >= 240 || result.endingBalance > 0.01
                                    ? "Long-running"
                                    : `${result.months} months`
                            : "—"
                    }
                    sub="A rough estimate, not a perfect amortization schedule."
                    color={t.amber}
                />
            </div>

            <div style={{ border: `1px solid ${t.border}`, background: t.bg1, borderRadius: 12, padding: 14 }}>
                <SectionTitle
                    title="Plain-English Impact"
                    subtitle="This is the takeaway you can use in the moment."
                />

                <div style={{ color: t.body, lineHeight: 1.8, fontSize: 14, display: "grid", gap: 8 }}>
                    <div>
                        If you put{" "}
                        <strong style={{ color: t.bright }}>{fmtMoney(purchaseAmount)}</strong>
                        {" "}on{" "}
                        <strong style={{ color: t.amber }}>{selectedCard?.name || "this card"}</strong>
                        {" "}and repay it using{" "}
                        <strong style={{ color: t.bright }}>
                            {mode === "pay_now"
                                ? "pay it off this month"
                                : mode === "3_months"
                                    ? "a 3-month payoff"
                                    : mode === "6_months"
                                        ? "a 6-month payoff"
                                        : mode === "minimum_only"
                                            ? "minimum payments only"
                                            : "your current card behavior"}
                        </strong>
                        , the estimated added interest is{" "}
                        <strong style={{ color: t.red }}>{fmtMoney(result?.interest || 0)}</strong>.
                    </div>

                    <div>
                        That makes the total estimated cost of the purchase about{" "}
                        <strong style={{ color: t.green }}>{fmtMoney(result?.totalCost || purchaseAmount)}</strong>.
                    </div>

                    <div>
                        <strong style={{ color: t.bright }}>Impact:</strong> {impactText}
                    </div>
                </div>
            </div>
        </div>
    );
}