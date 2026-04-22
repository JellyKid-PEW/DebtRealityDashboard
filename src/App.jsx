import { useEffect, useMemo, useState } from "react";
import Dashboard from "./Views/Dashboard.jsx";
import Debts from "./Views/Debts.jsx";
import Expenses from "./Views/Expenses.jsx";
import Assets from "./Views/Assets.jsx";
import Scenarios from "./Views/Scenarios.jsx";
import PartnerView from "./Views/PartnerView.jsx";
import { calcAll, normalizeToMonthly } from "./calculations.js";

const STORAGE_KEY = "debt_reality_v1";

const DEFAULT_STATE = {
    incomes: [],
    creditCards: [],
    loans: [],
    expenses: [],
    assets: []
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
        type: "application/json"
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
                assets: Array.isArray(parsed.assets) ? parsed.assets : []
            });
        } catch {
            onError("Invalid JSON file.");
        }
    };
    reader.readAsText(file);
}

function IncomeView({ state, onUpdate }) {
    const incomes = state.incomes ?? [];

    const [draft, setDraft] = useState({
        id: "",
        name: "",
        owner: "Joint",
        amount: 0,
        frequency: "monthly",
        isNet: true
    });

    function addIncome() {
        if (!draft.name.trim()) return;
        onUpdate({
            ...state,
            incomes: [
                ...incomes,
                {
                    ...draft,
                    id: crypto.randomUUID()
                }
            ]
        });
        setDraft({
            id: "",
            name: "",
            owner: "Joint",
            amount: 0,
            frequency: "monthly",
            isNet: true
        });
    }

    function removeIncome(id) {
        onUpdate({
            ...state,
            incomes: incomes.filter((x) => x.id !== id)
        });
    }

    const total = incomes.reduce(
        (sum, i) => sum + normalizeToMonthly(i.amount, i.frequency),
        0
    );

    return (
        <div style={{ maxWidth: 1000, margin: "0 auto", padding: 20, color: "#e2e8f0" }}>
            <h2 style={{ marginBottom: 16 }}>Income</h2>

            <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: 12,
                marginBottom: 16
            }}>
                <input
                    placeholder="Income source"
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
                <select
                    value={draft.owner}
                    onChange={(e) => setDraft({ ...draft, owner: e.target.value })}
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
                />
                <select
                    value={draft.frequency}
                    onChange={(e) => setDraft({ ...draft, frequency: e.target.value })}
                >
                    <option value="weekly">Weekly</option>
                    <option value="biweekly">Biweekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="annual">Annual</option>
                </select>
                <button onClick={addIncome}>Add Income</button>
            </div>

            <div style={{ marginBottom: 20 }}>
                <strong>Combined Monthly Income: </strong>${total.toFixed(2)}
            </div>

            <div style={{ display: "grid", gap: 8 }}>
                {incomes.map((income) => (
                    <div
                        key={income.id}
                        style={{
                            border: "1px solid #334155",
                            borderRadius: 8,
                            padding: 12,
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center"
                        }}
                    >
                        <div>
                            <div>{income.name}</div>
                            <div style={{ color: "#94a3b8", fontSize: 12 }}>
                                {income.owner} · {income.frequency} · ${income.amount}
                            </div>
                        </div>
                        <button onClick={() => removeIncome(income.id)}>Delete</button>
                    </div>
                ))}
            </div>
        </div>
    );
}

const tabs = [
    "Dashboard",
    "Income",
    "Debts",
    "Expenses",
    "Assets",
    "Scenarios",
    "Partner"
];

export default function App() {
    const [state, setState] = useState(loadState);
    const [tab, setTab] = useState("Dashboard");

    useEffect(() => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }, [state]);

    const calc = useMemo(() => calcAll(state), [state]);

    function resetAll() {
        const ok = window.confirm("Clear all saved data?");
        if (ok) {
            setState(DEFAULT_STATE);
        }
    }

    function handleImport(e) {
        const file = e.target.files?.[0];
        if (!file) return;
        importJSON(file, setState, alert);
        e.target.value = "";
    }

    function renderTab() {
        switch (tab) {
            case "Dashboard":
                return <Dashboard state={state} />;
            case "Income":
                return <IncomeView state={state} onUpdate={setState} />;
            case "Debts":
                return <Debts state={state} onUpdate={setState} />;
            case "Expenses":
                return <Expenses state={state} onUpdate={setState} />;
            case "Assets":
                return <Assets state={state} onUpdate={setState} />;
            case "Scenarios":
                return <Scenarios state={state} />;
            case "Partner":
                return <PartnerView state={state} />;
            default:
                return null;
        }
    }

    return (
        <div style={{ minHeight: "100vh", background: "#080b10", color: "#e2e8f0" }}>
            <div style={{ maxWidth: 1200, margin: "0 auto", padding: 20 }}>
                <h1 style={{ marginBottom: 10 }}>Debt Reality Dashboard</h1>

                <div style={{ marginBottom: 20, color: "#94a3b8" }}>
                    Monthly income: ${calc.monthlyIncome.toFixed(2)} | Total debt: ${calc.totalDebt.toFixed(2)}
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
                    {tabs.map((t) => (
                        <button
                            key={t}
                            onClick={() => setTab(t)}
                            style={{
                                padding: "10px 14px",
                                borderRadius: 8,
                                border: "1px solid #334155",
                                background: tab === t ? "#f59e0b" : "#0f172a",
                                color: tab === t ? "#111827" : "#e2e8f0",
                                cursor: "pointer"
                            }}
                        >
                            {t}
                        </button>
                    ))}
                </div>

                <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
                    <button onClick={() => exportJSON(state)}>Export JSON</button>
                    <label style={{ display: "inline-block" }}>
                        <input type="file" accept=".json" onChange={handleImport} style={{ display: "none" }} />
                        <span style={{
                            padding: "8px 12px",
                            border: "1px solid #334155",
                            borderRadius: 8,
                            cursor: "pointer",
                            background: "#0f172a"
                        }}>
                            Import JSON
                        </span>
                    </label>
                    <button onClick={resetAll}>Reset All</button>
                </div>

                {renderTab()}
            </div>
        </div>
    );
}