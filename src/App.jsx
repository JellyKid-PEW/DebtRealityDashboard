import { useEffect, useMemo, useState } from "react";
import Debts from "./Views/Debts.jsx";
import Expenses from "./Views/Expenses.jsx";
import Assets from "./Views/Assets.jsx";
import SummaryView from "./Views/SummaryView.jsx";
import Scenarios from "./Views/Scenarios.jsx";
import Plan from "./Views/Plan.jsx";
import { calcAll, normalizeToMonthly } from "./calculations.js";

const STORAGE_KEY = "debt_reality_v1";

const DEFAULT_STATE = {
    incomes: [],
    creditCards: [],
    loans: [],
    expenses: [],
    assets: [],
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

function importJSON(file, onSuccess, onError) {
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const parsed = JSON.parse(e.target.result);
            onSuccess({
                incomes: Array.isArray(parsed.incomes) ? parsed.incomes : [],
                creditCards: Array.isArray(parsed.creditCards) ? parsed.creditCards : [],
                loans: Array.isArray(parsed.loans) ? parsed.loans : [],
                expenses: Array.isArray(parsed.expenses) ? parsed.expenses : [],
                assets: Array.isArray(parsed.assets) ? parsed.assets : [],
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

function IncomeView({ state, onUpdate }) {
    const incomes = state.incomes ?? [];

    const [draft, setDraft] = useState({
        id: "",
        name: "",
        owner: "Joint",
        amount: 0,
        frequency: "monthly",
        isNet: true,
    });

    function addIncome() {
        if (!draft.name.trim()) return;
        onUpdate({
            ...state,
            incomes: [...incomes, { ...draft, id: crypto.randomUUID() }],
        });
        setDraft({ id: "", name: "", owner: "Joint", amount: 0, frequency: "monthly", isNet: true });
    }

    function removeIncome(id) {
        onUpdate({ ...state, incomes: incomes.filter((x) => x.id !== id) });
    }

    const total = incomes.reduce(
        (sum, i) => sum + normalizeToMonthly(i.amount, i.frequency),
        0
    );

    const inputStyle = {
        minHeight: 44,
        borderRadius: 9,
        border: "1px solid #334155",
        background: "#111827",
        color: "#e2e8f0",
        padding: "10px 12px",
        fontSize: 15,
        outline: "none",
    };

    return (
        <div style={{ maxWidth: 900, margin: "0 auto", padding: "0 0 48px", color: "#e2e8f0" }}>
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 16 }}>
                Income
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 14 }}>
                <input
                    placeholder="Income source"
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    style={inputStyle}
                />
                <select
                    value={draft.owner}
                    onChange={(e) => setDraft({ ...draft, owner: e.target.value })}
                    style={inputStyle}
                >
                    <option value="A">Person A</option>
                    <option value="B">Person B</option>
                    <option value="Joint">Joint</option>
                </select>
                <input
                    type="number"
                    placeholder="Amount"
                    value={draft.amount || ""}
                    onChange={(e) => setDraft({ ...draft, amount: parseFloat(e.target.value) || 0 })}
                    style={inputStyle}
                />
                <select
                    value={draft.frequency}
                    onChange={(e) => setDraft({ ...draft, frequency: e.target.value })}
                    style={inputStyle}
                >
                    <option value="weekly">Weekly</option>
                    <option value="biweekly">Biweekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="annual">Annual</option>
                </select>
                <button
                    onClick={addIncome}
                    style={{
                        minHeight: 44,
                        borderRadius: 9,
                        border: "1px solid #334155",
                        background: "#0f172a",
                        color: "#e2e8f0",
                        fontSize: 14,
                        cursor: "pointer",
                    }}
                >
                    Add
                </button>
            </div>

            <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 16 }}>
                Combined monthly income:{" "}
                <strong style={{ color: "#e2e8f0" }}>${total.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong>
            </div>

            <div style={{ display: "grid", gap: 8 }}>
                {incomes.map((income) => (
                    <div
                        key={income.id}
                        style={{
                            border: "1px solid #334155",
                            borderRadius: 10,
                            padding: "12px 14px",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            background: "#0f172a",
                        }}
                    >
                        <div>
                            <div style={{ fontSize: 14, fontWeight: 500 }}>{income.name}</div>
                            <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 2 }}>
                                {income.owner} · {income.frequency} · ${income.amount}
                            </div>
                        </div>
                        <button
                            onClick={() => removeIncome(income.id)}
                            style={{
                                border: "1px solid #334155",
                                borderRadius: 7,
                                background: "transparent",
                                color: "#64748b",
                                fontSize: 12,
                                padding: "4px 10px",
                                cursor: "pointer",
                            }}
                        >
                            Remove
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ─── TABS ─────────────────────────────────────────────────────────────────────

const TABS = ["Plan", "Debts", "Expenses", "Income", "Assets", "Scenarios", "Summary"];

// ─── APP ──────────────────────────────────────────────────────────────────────

export default function App() {
    const [state, setState] = useState(loadState);
    const [tab, setTab] = useState("Plan");
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
            (newState) => {
                setState(newState);
                setImportMsg(importSummary(newState));
                setTimeout(() => setImportMsg(null), 4000);
                setTab("Plan");
            },
            alert
        );
        e.target.value = "";
    }

    function renderTab() {
        switch (tab) {
            case "Plan":       return <Plan state={state} />;
            case "Debts":      return <Debts state={state} onUpdate={setState} />;
            case "Expenses":   return <Expenses state={state} onUpdate={setState} />;
            case "Income":     return <IncomeView state={state} onUpdate={setState} />;
            case "Assets":     return <Assets state={state} onUpdate={setState} />;
            case "Scenarios":  return <Scenarios state={state} />;
            case "Summary":    return <SummaryView state={state} />;
            default:           return <Plan state={state} />;
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

                {/* Tab bar */}
                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: isMobile ? "1fr 1fr" : `repeat(${TABS.length}, auto)`,
                        gap: 6,
                        marginBottom: 24,
                    }}
                >
                    {TABS.map((t) => (
                        <button
                            key={t}
                            onClick={() => setTab(t)}
                            style={{
                                padding: isMobile ? "11px 8px" : "9px 14px",
                                minHeight: 42,
                                borderRadius: 8,
                                border: tab === t ? "1px solid #f59e0b" : "1px solid #1e293b",
                                background: tab === t ? "#1a1200" : "transparent",
                                color: tab === t ? "#f59e0b" : "#475569",
                                cursor: "pointer",
                                fontSize: 13,
                                fontWeight: tab === t ? 700 : 400,
                                letterSpacing: tab === t ? "0.01em" : "normal",
                                transition: "all 0.15s",
                            }}
                        >
                            {t}
                        </button>
                    ))}
                </div>

                {renderTab()}
            </div>
        </div>
    );
}
