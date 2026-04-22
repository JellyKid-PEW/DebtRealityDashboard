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

function estimateExtraPool(debts) {
    return Math.max(
        0,
        sum(debts, (d) => Math.max(0, (d.monthlyPayment || 0) - (d.minPayment || 0)))
    );
}

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

        if (Math.abs(firstApr - secondApr) <= 1.5) {
            return [first, second];
        }
    }

    return [first];
}

function cloneDebt(debt) {
    return {
        ...debt,
        balance: Number(debt.balance) || 0,
    };
}

function simulatePhase(targetGroup, remainingDebts, rollingPool, monthOffsetStart, nowMonth) {
    const targets = targetGroup.map(cloneDebt);
    const targetIds = new Set(targets.map((d) => d.id));

    const targetBasePayments = sum(targets, (d) => d.monthlyPayment || 0);
    const monthlyToGroup = rollingPool + targetBasePayments;

    let monthOffset = monthOffsetStart;
    let roughMonths = 0;
    let interestRemovedAtStart = sum(
        targets,
        (d) => estimateInterestThisMonth(d.balance, effectiveAprAtMonth(d, monthOffsetStart, nowMonth))
    );

    while (sum(targets, (d) => d.balance) > 0.01 && roughMonths < 240) {
        roughMonths += 1;

        for (const debt of targets) {
            if (debt.balance <= 0) continue;
            const apr = effectiveAprAtMonth(debt, monthOffset, nowMonth);
            const interest = estimateInterestThisMonth(debt.balance, apr);
            debt.balance += interest;
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

    const freedPayments = targetBasePayments;
    const remaining = remainingDebts.filter((d) => !targetIds.has(d.id));

    return {
        roughMonths,
        monthlyToGroup,
        interestRemovedAtStart,
        freedPayments,
        remaining,
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

        const resultText =
            targets.length === 1
                ? `${targets[0].name} likely cleared.`
                : `${targetNames.join(" and ")} likely cleared.`;

        phases.push({
            title: makePhaseTitle(phaseIndex, strategy),
            targets,
            focusText: targetNames.join(", "),
            paymentAllocation,
            roughMonths: simulated.roughMonths,
            interestRelief: simulated.interestRemovedAtStart,
            resultText,
        });

        rollingPool += simulated.freedPayments;
        monthOffset += simulated.roughMonths;
        remaining = simulated.remaining;
        phaseIndex += 1;
    }

    return phases;
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

function Card({ title, value, sub, color = t.bright }) {
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

function PlanBlock({ phase, strategy }) {
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
                title={phase.title}
                subtitle={
                    strategy === "avalanche"
                        ? "This phase prioritizes the balances costing the most interest first."
                        : "This phase prioritizes the balances that can be closed fastest first."
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
                    finishing this phase should remove about{" "}
                    <strong style={{ color: t.green }}>{fmtMoney(phase.interestRelief)}/month</strong>{" "}
                    of current interest drag.
                </div>
            </div>
        </div>
    );
}

export default function Plan({ state }) {
    const isMobile = window.innerWidth <= 768;
    const nowMonth = startOfMonth(new Date());

    const model = useMemo(() => {
        const debts = buildDebts(state);
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
            strategy,
            extraPool,
            phases,
            totalDebt,
            monthlyInterest,
            firstTarget,
            targetInterest,
            oneYearPhases,
            oneYearNames,
            oneYearInterestRelief,
            oneYearMonthsCovered: monthAccumulator,
        };
    }, [state]);

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
                    title="Plan"
                    subtitle="Add debts first, then this page will build a recommended payoff plan."
                />
                <div style={{ color: t.body, fontSize: 14 }}>No debts available yet.</div>
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
                    Plan
                </h2>
                <p style={{ fontSize: 13, color: t.muted, margin: 0, lineHeight: 1.7 }}>
                    This page turns your current debt data into a payoff plan using Focus / Payment Allocation / Result language and rolling payment capacity.
                </p>
            </div>

            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: isMobile ? "1fr" : "repeat(4, minmax(0, 1fr))",
                    gap: 12,
                }}
            >
                <Card
                    title="Recommended Strategy"
                    value={model.strategy === "avalanche" ? "Avalanche" : "Snowball"}
                    sub={model.strategy === "avalanche" ? "Highest APR first." : "Smallest balance first."}
                    color={t.amber}
                />
                <Card
                    title="Total Debt"
                    value={fmtMoney(model.totalDebt)}
                    sub="All active cards and loans combined."
                    color={t.bright}
                />
                <Card
                    title="Monthly Interest Estimate"
                    value={fmtMoney(model.monthlyInterest)}
                    sub="Approximate monthly interest burden at current balances."
                    color={t.red}
                />
                <Card
                    title="Extra Payment Pool"
                    value={fmtMoney(model.extraPool)}
                    sub="Estimated money already being paid above minimums."
                    color={t.green}
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
                    title="Quick Read"
                    subtitle="This is the shortest explanation of what the current plan is saying."
                />

                <div style={{ display: "grid", gap: 8, color: t.body, fontSize: 14, lineHeight: 1.8 }}>
                    <div>
                        Recommended first target:{" "}
                        <strong style={{ color: t.amber }}>{model.firstTarget?.name || "—"}</strong>
                        {model.firstTarget && (
                            <>
                                {" "}at <strong style={{ color: t.bright }}>{fmtPct(effectiveAprAtMonth(model.firstTarget, 0, nowMonth))}</strong> with a balance of{" "}
                                <strong style={{ color: t.bright }}>{fmtMoney(model.firstTarget.balance)}</strong>.
                            </>
                        )}
                    </div>

                    <div>
                        Your current debt load is costing about{" "}
                        <strong style={{ color: t.red }}>{fmtMoney(model.monthlyInterest)}/month</strong>{" "}
                        in interest across all cards and loans.
                    </div>

                    {model.firstTarget && (
                        <div>
                            The first target{" "}
                            <strong style={{ color: t.amber }}>{model.firstTarget.name}</strong>{" "}
                            alone is costing about{" "}
                            <strong style={{ color: t.red }}>{fmtMoney(model.targetInterest)}/month</strong>{" "}
                            in interest.
                        </div>
                    )}

                    {model.phases[0] && (
                        <div>
                            Finishing{" "}
                            <strong style={{ color: t.amber }}>Phase 1</strong>{" "}
                            should remove about{" "}
                            <strong style={{ color: t.green }}>{fmtMoney(model.phases[0].interestRelief)}/month</strong>{" "}
                            of monthly interest drag.
                        </div>
                    )}

                    {model.firstTarget && (
                        <div>
                            Best next move:{" "}
                            <strong style={{ color: t.bright }}>
                                keep minimums on everything else and direct the extra pool to {model.firstTarget.name}
                            </strong>.
                        </div>
                    )}
                </div>
            </div>

            {model.phases.slice(0, 3).map((phase) => (
                <PlanBlock key={phase.title} phase={phase} strategy={model.strategy} />
            ))}

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
                    subtitle="This is a rough first-year picture based on rolling payment capacity, not a perfect amortization schedule."
                />

                <div style={{ display: "grid", gap: 8, color: t.body, fontSize: 14, lineHeight: 1.8 }}>
                    <div>
                        <strong style={{ color: t.bright }}>Likely focus this year:</strong>{" "}
                        {model.oneYearNames.join(", ")}
                    </div>

                    <div>
                        <strong style={{ color: t.bright }}>Approximate timeline covered:</strong>{" "}
                        about{" "}
                        <strong style={{ color: t.green }}>
                            {model.oneYearMonthsCovered} month{model.oneYearMonthsCovered === 1 ? "" : "s"}
                        </strong>{" "}
                        of targeted payoff effort.
                    </div>

                    <div>
                        <strong style={{ color: t.bright }}>Potential monthly interest relief:</strong>{" "}
                        if these early phases are completed, about{" "}
                        <strong style={{ color: t.green }}>{fmtMoney(model.oneYearInterestRelief)}/month</strong>{" "}
                        of current monthly interest drag should be removed.
                    </div>

                    <div>
                        <strong style={{ color: t.bright }}>What that means:</strong>{" "}
                        as balances are cleared, their former monthly payments roll forward into the next targets, which is why later phases should move faster than earlier ones.
                    </div>
                </div>
            </div>
        </div>
    );
}