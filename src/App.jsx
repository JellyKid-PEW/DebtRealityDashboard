import { useEffect, useMemo, useState } from "react";
import Debts from "./Views/Debts.jsx";
import Expenses from "./Views/Expenses.jsx";
import Assets from "./Views/Assets.jsx";
import SummaryView from "./Views/SummaryView.jsx";
import Scenarios from "./Views/Scenarios.jsx";
import Plan from "./Views/Plan.jsx";
import AttackMap from "./Views/AttackMap.jsx";
import { calcAll, normalizeToMonthly } from "./calculations.js";

const STORAGE_KEY = "debt_reality_v1";

const DEFAULT_STATE = {
    incomes: [],
    creditCards: [],
    loans: [],
    expenses: [],
    assets: [],
    savingsBalance: 0,
    emergencyTarget: 2500,
    upcomingBills: 0,
    upcomingMins: 0,
    essentialCash: 0,
    paycheckAmount: 0,
    paycheckBills: 0,
    paycheckMins: 0,
    paycheckEssentials: 0,
    cardLockouts: {},
    planStartDate: null,      // ISO date string — when the plan was first committed
    lastSnapshot: null,       // { date, totalDebt, debts: [{id,name,balance}] }
    prevSnapshot: null,       // snapshot from the import before lastSnapshot — for delta display
    commitment: null,         // { date, planMonth, focusDebt, focusId, projectedBalances, totalProjected }
    commitHistory: [],        // [{ commitDate, verifyDate, focusDebt, overall, totalDelta, debtResults, daysSince }]
    lastImportedAt: null,     // ISO string — when data was last imported
};

function loadState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return DEFAULT_STATE;
        return { ...DEFAULT_STATE, ...JSON.parse(raw) };
    } catch {
        return DEFAULT_STATE;
    }
}

function exportJSON(state) {
    const blob = new Blob([JSON.stringify(state, null, 2)], {
        type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `debt-reality-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

function importJSON(file, currentState, onSuccess, onError) {
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const parsed = JSON.parse(e.target.result);
            // Preserve persisted UI fields that live in state but aren't in the data export
            const persisted = {
                savingsBalance: parsed.savingsBalance ?? currentState.savingsBalance ?? 0,
                emergencyTarget: parsed.emergencyTarget ?? currentState.emergencyTarget ?? 2500,
                upcomingBills: parsed.upcomingBills ?? currentState.upcomingBills ?? 0,
                upcomingMins: parsed.upcomingMins ?? currentState.upcomingMins ?? 0,
                essentialCash: parsed.essentialCash ?? currentState.essentialCash ?? 0,
                paycheckAmount: parsed.paycheckAmount ?? currentState.paycheckAmount ?? 0,
                paycheckBills: parsed.paycheckBills ?? currentState.paycheckBills ?? 0,
                paycheckMins: parsed.paycheckMins ?? currentState.paycheckMins ?? 0,
                paycheckEssentials: parsed.paycheckEssentials ?? currentState.paycheckEssentials ?? 0,
                cardLockouts: parsed.cardLockouts ?? currentState.cardLockouts ?? {},
                planStartDate: parsed.planStartDate ?? currentState.planStartDate ?? null,
                lastSnapshot: parsed.lastSnapshot ?? currentState.lastSnapshot ?? null,
                prevSnapshot: parsed.prevSnapshot ?? currentState.prevSnapshot ?? null,
                commitment: parsed.commitment ?? currentState.commitment ?? null,
                commitHistory: Array.isArray(parsed.commitHistory) ? parsed.commitHistory : (currentState.commitHistory ?? []),
                lastImportedAt: now,
            };

            onSuccess({
                incomes: Array.isArray(parsed.incomes) ? parsed.incomes : [],
                creditCards: Array.isArray(parsed.creditCards) ? parsed.creditCards : [],
                loans: Array.isArray(parsed.loans) ? parsed.loans : [],
                expenses: Array.isArray(parsed.expenses) ? parsed.expenses : [],
                assets: Array.isArray(parsed.assets) ? parsed.assets : [],
                ...persisted,
            });
        } catch {
            onError("Invalid JSON file.");
        }
    };
    reader.readAsText(file);
}

function importSummary(state) {
    const cards = (state.creditCards ?? []).filter((c) => Number(c.balance) > 0).length;
    const loans = (state.loans ?? []).filter((l) => Number(l.balance) > 0).length;
    const incomes = (state.incomes ?? []).length;
    const parts = [];
    if (cards) parts.push(`${cards} card${cards !== 1 ? "s" : ""}`);
    if (loans) parts.push(`${loans} loan${loans !== 1 ? "s" : ""}`);
    if (incomes) parts.push(`${incomes} income source${incomes !== 1 ? "s" : ""}`);
    return parts.length ? `Loaded: ${parts.join(", ")}` : "Loaded";
}

// ─── INCOME VIEW ──────────────────────────────────────────────────────────────

// ─── TABS ─────────────────────────────────────────────────────────────────────

const TABS = ["Attack Map", "Trajectory", "Debts", "Expenses", "Assets", "Scenarios", "Summary"];

// ─── APP ──────────────────────────────────────────────────────────────────────

export default function App() {
    const [state, setState] = useState(loadState);
    const [tab, setTab] = useState("Attack Map");
    const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
    const [importMsg, setImportMsg] = useState(null);

    useEffect(() => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }, [state]);

    useEffect(() => {
        function handleResize() {
            setIsMobile(window.innerWidth <= 768);
        }
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, []);

    const calc = useMemo(() => calcAll(state), [state]);

    function resetAll() {
        const confirmed = window.prompt('Type "reset" to clear all data. This cannot be undone.');
        if (confirmed?.toLowerCase() === "reset") {
            setState(DEFAULT_STATE);
        }
    }

    function handleImport(e) {
        const file = e.target.files?.[0];
        if (!file) return;
        importJSON(
            file,
            state,
            (newState) => {
                const now = new Date().toISOString();
                const totalDebt = [
                    ...(newState.creditCards ?? []),
                    ...(newState.loans ?? []),
                ].reduce((s, d) => s + (Number(d.balance) || 0), 0);

                // Build snapshot of current balances for future comparison
                const snapshot = {
                    date: now,
                    totalDebt,
                    debts: [
                        ...(newState.creditCards ?? []).map(c => ({ id: c.id, name: c.name, balance: Number(c.balance) || 0 })),
                        ...(newState.loans ?? []).map(l => ({ id: l.id, name: l.name, balance: Number(l.balance) || 0 })),
                    ],
                };

                // If there's an active commitment and a previous snapshot, archive the verification
                let archivedHistory = state.commitHistory ?? [];
                if (state.commitment && state.lastSnapshot) {
                    // Build a lightweight verification record to store in history
                    const prevTotal = state.lastSnapshot.totalDebt || 0;
                    const actualTotal = [
                        ...(newState.creditCards ?? []),
                        ...(newState.loans ?? []),
                    ].reduce((s, d) => s + (Number(d.balance) || 0), 0);
                    const totalDelta = state.commitment.totalProjected - actualTotal;
                    const daysSince = Math.round((new Date(now) - new Date(state.commitment.date)) / 86400000);
                    const overall = Math.abs(totalDelta) < 10 ? 'on-track' : totalDelta > 0 ? 'ahead' : 'behind';
                    archivedHistory = [
                        {
                            commitDate: state.commitment.date,
                            verifyDate: now,
                            focusDebt: state.commitment.focusDebt,
                            planMonth: state.commitment.planMonth,
                            overall,
                            totalDelta,
                            projectedTotal: state.commitment.totalProjected,
                            actualTotal,
                            daysSince,
                        },
                        ...archivedHistory,
                    ].slice(0, 24); // keep last 24 entries
                }

                const withMeta = {
                    ...newState,
                    lastSnapshot: snapshot,
                    planStartDate: newState.planStartDate || now,
                    prevSnapshot: state.lastSnapshot || null,
                    commitHistory: archivedHistory,
                    commitment: null,
                    lastImportedAt: now,
                };

                setState(withMeta);
                setImportMsg(importSummary(newState));
                setTimeout(() => setImportMsg(null), 4000);
                setTab("Attack Map");
            },
            alert
        );
        e.target.value = "";
    }

    function renderTab() {
        switch (tab) {
            case "Attack Map": return <AttackMap state={state} onUpdate={setState} setTab={setTab} />;
            case "Trajectory": return <Plan state={state} />;
            case "Debts": return <Debts state={state} onUpdate={setState} />;
            case "Expenses": return <Expenses state={state} onUpdate={setState} />;
            case "Assets": return <Assets state={state} onUpdate={setState} />;
            case "Scenarios": return <Scenarios state={state} />;
            case "Summary": return <SummaryView state={state} />;
            default: return <AttackMap state={state} onUpdate={setState} />;
        }
    }

    return (
        <div style={{ minHeight: "100vh", background: "#080b10", color: "#e2e8f0" }}>
            <div style={{ maxWidth: 1200, margin: "0 auto", padding: isMobile ? 14 : 20 }}>

                {/* App header */}
                <div style={{ marginBottom: 14 }}>
                    <h1 style={{ fontSize: isMobile ? 26 : 34, fontWeight: 700, margin: "0 0 4px", lineHeight: 1.1 }}>
                        Debt Reality
                    </h1>
                    <div style={{ color: "#64748b", fontSize: 13 }}>
                        Total debt: <span style={{ color: "#94a3b8" }}>${calc.totalDebt.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                        &nbsp;·&nbsp;
                        Monthly income: <span style={{ color: "#94a3b8" }}>${calc.monthlyIncome.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                        {state.lastImportedAt && (
                            <span style={{ color: "#475569", marginLeft: 8 }}>
                                · data as of {new Date(state.lastImportedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                            </span>
                        )}
                    </div>
                </div>

                {/* Data controls */}
                <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>

                    {/* Import — primary action */}
                    <label style={{ display: "block", flexShrink: 0 }}>
                        <input type="file" accept=".json" onChange={handleImport} style={{ display: "none" }} />
                        <span
                            style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 6,
                                height: 42,
                                padding: "0 18px",
                                borderRadius: 9,
                                cursor: "pointer",
                                background: "#f59e0b",
                                color: "#111827",
                                fontSize: 14,
                                fontWeight: 700,
                                userSelect: "none",
                            }}
                        >
                            ↑ Import JSON
                        </span>
                    </label>

                    {/* Export — secondary */}
                    <button
                        onClick={() => exportJSON(state)}
                        style={{
                            height: 42,
                            padding: "0 16px",
                            borderRadius: 9,
                            border: "1px solid #334155",
                            background: "#0f172a",
                            color: "#e2e8f0",
                            fontSize: 14,
                            fontWeight: 500,
                            cursor: "pointer",
                            flexShrink: 0,
                        }}
                    >
                        ↓ Export JSON
                    </button>

                    {/* Import confirmation */}
                    {importMsg && (
                        <div style={{ fontSize: 12, color: "#22c55e", padding: "0 4px" }}>
                            ✓ {importMsg}
                        </div>
                    )}

                    {/* Reset — suppressed, far right */}
                    <button
                        onClick={resetAll}
                        style={{
                            height: 42,
                            padding: "0 12px",
                            borderRadius: 9,
                            border: "none",
                            background: "transparent",
                            color: "#334155",
                            fontSize: 12,
                            cursor: "pointer",
                            marginLeft: "auto",
                            flexShrink: 0,
                        }}
                    >
                        Reset All
                    </button>
                </div>

                {/* Tab bar — horizontal scroll on mobile, auto-fit on desktop */}
                <div
                    style={{
                        display: "flex",
                        gap: 6,
                        marginBottom: 24,
                        overflowX: isMobile ? "auto" : "visible",
                        WebkitOverflowScrolling: "touch",
                        scrollbarWidth: "none",
                        msOverflowStyle: "none",
                        paddingBottom: isMobile ? 4 : 0,
                    }}
                >
                    {TABS.map((t) => {
                        const isPrimary = t === "Attack Map" || t === "Trajectory";
                        const isActive = tab === t;
                        return (
                            <button
                                key={t}
                                onClick={() => setTab(t)}
                                style={{
                                    padding: isMobile
                                        ? isPrimary ? "11px 16px" : "11px 12px"
                                        : "9px 14px",
                                    minHeight: 42,
                                    flexShrink: 0,
                                    borderRadius: 8,
                                    border: isActive ? "1px solid #f59e0b" : "1px solid #1e293b",
                                    background: isActive ? "#1a1200" : "transparent",
                                    color: isActive ? "#f59e0b" : isPrimary ? "#94a3b8" : "#475569",
                                    cursor: "pointer",
                                    fontSize: isMobile ? (isPrimary ? 14 : 13) : 13,
                                    fontWeight: isActive ? 700 : isPrimary ? 500 : 400,
                                    letterSpacing: isActive ? "0.01em" : "normal",
                                    transition: "all 0.15s",
                                    whiteSpace: "nowrap",
                                }}
                            >
                                {t}
                            </button>
                        );
                    })}
                </div>

                {renderTab()}
            </div>
        </div>
    );
}
