import { useState, useCallback, useMemo } from "react";
import { normalizeToMonthly } from "../calculations.js";

// ─── STYLE TOKENS (mirrors app palette) ──────────────────────────────────────
const mono = "'IBM Plex Mono', 'Courier New', monospace";

const t = {
  bg0: "#080b10", bg1: "#0f1421", bg2: "#141926",
  border: "#1e293b", borderHi: "#334155",
  muted: "#475569", subtle: "#64748b", body: "#94a3b8", bright: "#e2e8f0",
  amber: "#f59e0b", amberDim: "#78350f",
  red: "#ef4444", redDim: "#450a0a",
  green: "#22c55e", greenDim: "#052e16",
  blue: "#60a5fa", teal: "#2dd4bf",
};

const uid = () => Math.random().toString(36).slice(2, 9);

function fmtMoney(n) {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(n ?? 0);
}

// ─── PRIMITIVES ───────────────────────────────────────────────────────────────

const inputStyle = {
  fontFamily: mono, fontSize: 12,
  background: t.bg0, border: `1px solid ${t.border}`,
  borderRadius: 5, color: t.bright,
  padding: "6px 10px", width: "100%", outline: "none",
  transition: "border-color 0.15s",
};

const labelStyle = {
  fontFamily: mono, fontSize: 10, color: t.muted,
  letterSpacing: "0.12em", textTransform: "uppercase",
  display: "block", marginBottom: 4,
};

function Field({ label, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  );
}

function TextInput({ value, onChange, placeholder = "" }) {
  return (
    <input type="text" value={value ?? ""} placeholder={placeholder}
      onChange={e => onChange(e.target.value)} style={inputStyle}
      onFocus={e => (e.target.style.borderColor = t.borderHi)}
      onBlur={e => (e.target.style.borderColor = t.border)}
    />
  );
}

function NumberInput({ value, onChange, placeholder = "0" }) {
  return (
    <input type="number" value={value === 0 ? "" : (value ?? "")}
      placeholder={placeholder}
      onChange={e => onChange(parseFloat(e.target.value) || 0)}
      style={inputStyle}
      onFocus={e => (e.target.style.borderColor = t.borderHi)}
      onBlur={e => (e.target.style.borderColor = t.border)}
    />
  );
}

function SelectInput({ value, onChange, options }) {
  return (
    <select value={value ?? ""} onChange={e => onChange(e.target.value)}
      style={{ ...inputStyle, cursor: "pointer" }}
      onFocus={e => (e.target.style.borderColor = t.borderHi)}
      onBlur={e => (e.target.style.borderColor = t.border)}
    >
      {options.map(o =>
        typeof o === "string"
          ? <option key={o} value={o}>{o}</option>
          : <option key={o.value} value={o.value}>{o.label}</option>
      )}
    </select>
  );
}

function CheckboxInput({ label, checked, onChange }) {
  return (
    <label style={{
      display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
      fontFamily: mono, fontSize: 12, color: t.body, userSelect: "none",
      padding: "6px 0",
    }}>
      <div
        onClick={() => onChange(!checked)}
        style={{
          width: 16, height: 16, borderRadius: 3, flexShrink: 0,
          border: `1px solid ${checked ? t.teal : t.border}`,
          background: checked ? t.teal + "22" : t.bg0,
          display: "flex", alignItems: "center", justifyContent: "center",
          transition: "all 0.12s", cursor: "pointer",
        }}
      >
        {checked && <span style={{ color: t.teal, fontSize: 10, lineHeight: 1 }}>✓</span>}
      </div>
      {label}
    </label>
  );
}

function Btn({ children, onClick, variant = "ghost" }) {
  const styles = {
    ghost:   { bg: t.bg2, border: t.border, color: t.body,    hoverBg: "#1e293b" },
    primary: { bg: t.amber, border: t.amber, color: "#0f1421", hoverBg: "#fbbf24" },
    danger:  { bg: t.redDim, border: "#7f1d1d", color: "#fca5a5", hoverBg: "#5c1111" },
    save:    { bg: t.greenDim, border: "#166534", color: "#86efac", hoverBg: "#14532d" },
  };
  const s = styles[variant];
  return (
    <button onClick={onClick} style={{
      fontFamily: mono, fontSize: 11, fontWeight: 700,
      background: s.bg, border: `1px solid ${s.border}`,
      color: s.color, borderRadius: 5, padding: "5px 12px",
      cursor: "pointer", letterSpacing: "0.06em", whiteSpace: "nowrap",
      transition: "background 0.12s",
    }}
      onMouseEnter={e => (e.currentTarget.style.background = s.hoverBg)}
      onMouseLeave={e => (e.currentTarget.style.background = s.bg)}
    >{children}</button>
  );
}

function Expandable({ open, children }) {
  return (
    <div style={{
      display: "grid",
      gridTemplateRows: open ? "1fr" : "0fr",
      transition: "grid-template-rows 0.22s cubic-bezier(0.4,0,0.2,1)",
    }}>
      <div style={{ overflow: "hidden" }}>{children}</div>
    </div>
  );
}

// ─── CATEGORY BADGE ───────────────────────────────────────────────────────────

// Assign a consistent hue to a category string
const CAT_COLORS = [
  "#60a5fa","#a78bfa","#f472b6","#34d399","#fbbf24",
  "#f87171","#2dd4bf","#818cf8","#fb923c","#a3e635",
];
const catColorCache = {};
function catColor(category) {
  if (!catColorCache[category]) {
    const idx = Object.keys(catColorCache).length % CAT_COLORS.length;
    catColorCache[category] = CAT_COLORS[idx];
  }
  return catColorCache[category];
}

function CategoryBadge({ category }) {
  const color = catColor(category ?? "Other");
  return (
    <span style={{
      fontFamily: mono, fontSize: 10, color,
      border: `1px solid ${color}44`,
      background: color + "14",
      padding: "2px 8px", borderRadius: 10,
      letterSpacing: "0.06em", whiteSpace: "nowrap",
    }}>{category || "Other"}</span>
  );
}

// ─── FREQUENCY DISPLAY ────────────────────────────────────────────────────────

const FREQ_OPTIONS = ["weekly", "biweekly", "monthly", "annual"];

function freqLabel(freq) {
  return { weekly: "wk", biweekly: "2wk", monthly: "mo", annual: "yr" }[freq] ?? freq;
}

// ─── EXPENSE FORM FIELDS ──────────────────────────────────────────────────────

const COMMON_CATEGORIES = [
  "Housing", "Food & Groceries", "Transport", "Utilities",
  "Healthcare", "Insurance", "Entertainment", "Education",
  "Clothing", "Personal Care", "Subscriptions", "Childcare",
  "Savings", "Dining Out", "Travel", "Other",
];

function ExpenseFormFields({ draft, setDraft }) {
  const f = (k) => (v) => setDraft(d => ({ ...d, [k]: v }));
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
      gap: 10, padding: "16px 0 4px",
      alignItems: "end",
    }}>
      <div style={{ gridColumn: "span 2" }}>
        <Field label="Expense Name">
          <TextInput value={draft.name} onChange={f("name")} placeholder="e.g. Rent, Netflix, Gym" />
        </Field>
      </div>
      <Field label="Category">
        {/* Editable datalist for flexibility */}
        <div style={{ position: "relative" }}>
          <input
            list="expense-cats"
            value={draft.category ?? ""}
            placeholder="e.g. Housing"
            onChange={e => f("category")(e.target.value)}
            style={inputStyle}
            onFocus={e => (e.target.style.borderColor = t.borderHi)}
            onBlur={e => (e.target.style.borderColor = t.border)}
          />
          <datalist id="expense-cats">
            {COMMON_CATEGORIES.map(c => <option key={c} value={c} />)}
          </datalist>
        </div>
      </Field>
      <Field label="Amount ($)">
        <NumberInput value={draft.amount} onChange={f("amount")} />
      </Field>
      <Field label="Frequency">
        <SelectInput value={draft.frequency} onChange={f("frequency")} options={FREQ_OPTIONS} />
      </Field>
      <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: 2 }}>
        <CheckboxInput
          label="Essential expense"
          checked={draft.essential ?? true}
          onChange={f("essential")}
        />
      </div>
    </div>
  );
}

// ─── EXPENSE ROW ──────────────────────────────────────────────────────────────

function ExpenseRow({ expense, onSave, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(expense);

  const monthly = normalizeToMonthly(expense.amount, expense.frequency);

  function handleSave() {
    if (!draft.name.trim()) return;
    onSave({ ...draft, id: expense.id });
    setEditing(false);
  }

  function handleCancel() {
    setDraft(expense);
    setEditing(false);
  }

  return (
    <div style={{
      background: t.bg1,
      border: `1px solid ${editing ? t.borderHi : t.border}`,
      borderRadius: 8, overflow: "hidden",
      transition: "border-color 0.15s",
      animation: "rowIn 0.18s ease",
    }}>
      {/* Summary row */}
      <div style={{
        display: "flex", alignItems: "center", flexWrap: "wrap",
        gap: 8, padding: "11px 14px",
      }}>
        {/* Essential marker */}
        <div
          title={expense.essential ? "Essential" : "Discretionary"}
          style={{
            width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
            background: expense.essential ? t.teal : t.muted,
            boxShadow: expense.essential ? `0 0 5px ${t.teal}88` : "none",
          }}
        />

        {/* Name */}
        <span style={{ fontFamily: mono, fontSize: 13, fontWeight: 700, color: t.bright, flex: "1 1 120px", minWidth: 100 }}>
          {expense.name || <span style={{ color: t.muted, fontWeight: 400 }}>Unnamed</span>}
        </span>

        {/* Category badge */}
        <CategoryBadge category={expense.category} />

        {/* Amount */}
        <div style={{ flex: "0 0 auto", textAlign: "right" }}>
          <span style={{ fontFamily: mono, fontSize: 13, color: t.amber, fontWeight: 700 }}>
            {fmtMoney(expense.amount)}
            <span style={{ color: t.muted, fontWeight: 400, fontSize: 11 }}>/{freqLabel(expense.frequency)}</span>
          </span>
          {expense.frequency !== "monthly" && (
            <span style={{ fontFamily: mono, fontSize: 10, color: t.subtle, display: "block" }}>
              {fmtMoney(monthly)}/mo
            </span>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 6, marginLeft: "auto", flexShrink: 0 }}>
          <Btn variant="ghost" onClick={() => { setDraft(expense); setEditing(e => !e); }}>
            {editing ? "Cancel" : "Edit"}
          </Btn>
          <Btn variant="danger" onClick={() => onDelete(expense.id)}>Delete</Btn>
        </div>
      </div>

      <Expandable open={editing}>
        <div style={{ borderTop: `1px solid ${t.border}`, background: t.bg2, padding: "0 14px 16px" }}>
          <ExpenseFormFields draft={draft} setDraft={setDraft} />
          <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
            <Btn variant="ghost" onClick={handleCancel}>Cancel</Btn>
            <Btn variant="save" onClick={handleSave}>Save Expense</Btn>
          </div>
        </div>
      </Expandable>
    </div>
  );
}

function AddExpenseRow({ onSave, onCancel }) {
  const [draft, setDraft] = useState({
    id: uid(), name: "", category: "", amount: 0, frequency: "monthly", essential: true,
  });
  return (
    <div style={{
      background: t.bg2, border: `1px solid ${t.amber}44`,
      borderRadius: 8, padding: "4px 14px 16px",
      animation: "rowIn 0.18s ease",
    }}>
      <p style={{ fontFamily: mono, fontSize: 10, color: t.amber, letterSpacing: "0.15em", padding: "12px 0 4px", margin: 0 }}>
        NEW EXPENSE
      </p>
      <ExpenseFormFields draft={draft} setDraft={setDraft} />
      <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
        <Btn variant="ghost" onClick={onCancel}>Cancel</Btn>
        <Btn variant="save" onClick={() => { if (!draft.name.trim()) return; onSave(draft); }}>Save Expense</Btn>
      </div>
    </div>
  );
}

// ─── TOTALS HEADER ────────────────────────────────────────────────────────────

function TotalsHeader({ expenses }) {
  const totalMonthly = useMemo(
    () => expenses.reduce((s, e) => s + normalizeToMonthly(e.amount, e.frequency), 0),
    [expenses]
  );
  const essentialMonthly = useMemo(
    () => expenses.filter(e => e.essential).reduce((s, e) => s + normalizeToMonthly(e.amount, e.frequency), 0),
    [expenses]
  );
  const discretionaryMonthly = totalMonthly - essentialMonthly;

  // Group by category for a mini breakdown
  const byCat = useMemo(() => {
    const map = {};
    expenses.forEach(e => {
      const cat = e.category || "Other";
      map[cat] = (map[cat] ?? 0) + normalizeToMonthly(e.amount, e.frequency);
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [expenses]);

  if (expenses.length === 0) return null;

  return (
    <div style={{
      background: t.bg1, border: `1px solid ${t.border}`,
      borderRadius: 10, padding: "16px 20px", marginBottom: 20,
      display: "flex", flexWrap: "wrap", gap: 20, alignItems: "flex-start",
    }}>
      {/* Key numbers */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 20, flex: "1 1 auto" }}>
        {[
          { label: "Monthly Baseline", value: totalMonthly, color: t.amber },
          { label: "Essential", value: essentialMonthly, color: t.teal },
          { label: "Discretionary", value: discretionaryMonthly, color: t.subtle },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontFamily: mono, fontSize: 10, color: t.muted, letterSpacing: "0.12em", textTransform: "uppercase" }}>{label}</span>
            <span style={{ fontFamily: mono, fontSize: 20, fontWeight: 700, color }}>{fmtMoney(value)}</span>
          </div>
        ))}
      </div>

      {/* Top categories mini-bar */}
      {byCat.length > 0 && (
        <div style={{ flex: "1 1 200px", minWidth: 180 }}>
          <p style={{ fontFamily: mono, fontSize: 10, color: t.muted, letterSpacing: "0.12em", textTransform: "uppercase", margin: "0 0 8px" }}>
            Top Categories
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {byCat.map(([cat, amt]) => {
              const pct = totalMonthly > 0 ? (amt / totalMonthly) * 100 : 0;
              const color = catColor(cat);
              return (
                <div key={cat} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontFamily: mono, fontSize: 10, color: t.body, width: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cat}</span>
                  <div style={{ flex: 1, height: 4, background: t.border, borderRadius: 2, overflow: "hidden" }}>
                    <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 2, transition: "width 0.4s ease" }} />
                  </div>
                  <span style={{ fontFamily: mono, fontSize: 10, color, width: 50, textAlign: "right" }}>{fmtMoney(amt)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── LEGEND ───────────────────────────────────────────────────────────────────

function Legend() {
  return (
    <div style={{ display: "flex", gap: 16, marginBottom: 10, flexWrap: "wrap" }}>
      {[
        { color: t.teal, label: "Essential" },
        { color: t.muted, label: "Discretionary" },
      ].map(({ color, label }) => (
        <div key={label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: color }} />
          <span style={{ fontFamily: mono, fontSize: 10, color: t.muted }}>{label}</span>
        </div>
      ))}
    </div>
  );
}

// ─── MAIN EXPORT ──────────────────────────────────────────────────────────────

export default function Expenses({ state, onUpdate }) {
  const [adding, setAdding] = useState(false);
  const expenses = state.expenses ?? [];

  const updateExpenses = useCallback((newExpenses) => {
    onUpdate({ ...state, expenses: newExpenses });
  }, [state, onUpdate]);

  const handleAdd    = (e) => { updateExpenses([...expenses, e]); setAdding(false); };
  const handleSave   = (e) => updateExpenses(expenses.map(x => x.id === e.id ? e : x));
  const handleDelete = (id) => updateExpenses(expenses.filter(x => x.id !== id));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0, maxWidth: 860, margin: "0 auto", padding: "0 0 48px" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;700&display=swap');
        @keyframes rowIn {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        input[type=number]::-webkit-inner-spin-button { opacity: 0.3; }
      `}</style>

      {/* Totals header */}
      <TotalsHeader expenses={expenses} />

      {/* Section header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 3, height: 16, borderRadius: 2, background: t.amber, flexShrink: 0 }} />
          <span style={{ fontFamily: mono, fontSize: 11, fontWeight: 700, color: t.subtle, letterSpacing: "0.18em", textTransform: "uppercase" }}>
            Expenses ({expenses.length})
          </span>
        </div>
        <button
          onClick={() => setAdding(true)}
          style={{
            fontFamily: mono, fontSize: 11, fontWeight: 700,
            background: t.amber, color: "#0f1421",
            border: `1px solid ${t.amber}`, borderRadius: 5,
            padding: "5px 12px", cursor: "pointer", letterSpacing: "0.06em",
          }}
        >+ Add Expense</button>
      </div>

      {/* Legend */}
      <Legend />

      {/* List */}
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {adding && <AddExpenseRow onSave={handleAdd} onCancel={() => setAdding(false)} />}

        {expenses.length === 0 && !adding && (
          <div style={{
            padding: "28px 20px", textAlign: "center",
            border: `1px dashed ${t.border}`, borderRadius: 8,
            fontFamily: mono, fontSize: 12, color: t.muted, lineHeight: 1.8,
          }}>
            No expenses added yet.<br />
            Track rent, groceries, subscriptions — everything that leaves your account.
          </div>
        )}

        {expenses.map(expense => (
          <ExpenseRow
            key={expense.id}
            expense={expense}
            onSave={handleSave}
            onDelete={handleDelete}
          />
        ))}
      </div>
    </div>
  );
}
