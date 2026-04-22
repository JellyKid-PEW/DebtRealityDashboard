import { useState, useCallback, useId } from "react";

// ─── STYLE TOKENS ─────────────────────────────────────────────────────────────
const mono = "'IBM Plex Mono', 'Courier New', monospace";

const t = {
  bg0:      "#080b10",
  bg1:      "#0f1421",
  bg2:      "#141926",
  border:   "#1e293b",
  borderHi: "#334155",
  muted:    "#475569",
  subtle:   "#64748b",
  body:     "#94a3b8",
  bright:   "#e2e8f0",
  amber:    "#f59e0b",
  amberDim: "#78350f",
  red:      "#ef4444",
  redDim:   "#450a0a",
  green:    "#22c55e",
  greenDim: "#052e16",
  blue:     "#60a5fa",
};

// ─── SHARED PRIMITIVES ────────────────────────────────────────────────────────

const uid = () => Math.random().toString(36).slice(2, 9);

function fmtMoney(n) {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(n ?? 0);
}

const inputStyle = {
  fontFamily: mono,
  fontSize: 12,
  background: t.bg0,
  border: `1px solid ${t.border}`,
  borderRadius: 5,
  color: t.bright,
  padding: "6px 10px",
  width: "100%",
  outline: "none",
  transition: "border-color 0.15s",
};

const labelStyle = {
  fontFamily: mono,
  fontSize: 10,
  color: t.muted,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  display: "block",
  marginBottom: 4,
};

function Field({ label, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  );
}

function TextInput({ value, onChange, placeholder = "", onFocus, onBlur }) {
  return (
    <input
      type="text"
      value={value ?? ""}
      placeholder={placeholder}
      onChange={e => onChange(e.target.value)}
      onFocus={onFocus}
      onBlur={onBlur}
      style={inputStyle}
      onMouseEnter={e => (e.target.style.borderColor = t.borderHi)}
      onMouseLeave={e => (e.target.style.borderColor = t.border)}
    />
  );
}

function NumberInput({ value, onChange, placeholder = "0", min }) {
  return (
    <input
      type="number"
      value={value === 0 ? "" : (value ?? "")}
      placeholder={placeholder}
      min={min}
      onChange={e => onChange(parseFloat(e.target.value) || 0)}
      style={inputStyle}
      onMouseEnter={e => (e.target.style.borderColor = t.borderHi)}
      onMouseLeave={e => (e.target.style.borderColor = t.border)}
    />
  );
}

function SelectInput({ value, onChange, options }) {
  return (
    <select
      value={value ?? ""}
      onChange={e => onChange(e.target.value)}
      style={{ ...inputStyle, cursor: "pointer" }}
      onMouseEnter={e => (e.target.style.borderColor = t.borderHi)}
      onMouseLeave={e => (e.target.style.borderColor = t.border)}
    >
      {options.map(o =>
        typeof o === "string"
          ? <option key={o} value={o}>{o}</option>
          : <option key={o.value} value={o.value}>{o.label}</option>
      )}
    </select>
  );
}

function Btn({ children, onClick, variant = "ghost", type = "button" }) {
  const styles = {
    ghost:   { bg: t.bg2, border: t.border,   color: t.body,  hoverBg: "#1e293b" },
    primary: { bg: t.amber, border: t.amber,  color: "#0f1421", hoverBg: "#fbbf24" },
    danger:  { bg: t.redDim, border: "#7f1d1d", color: "#fca5a5", hoverBg: "#5c1111" },
    save:    { bg: t.greenDim, border: "#166534", color: "#86efac", hoverBg: "#14532d" },
  };
  const s = styles[variant] ?? styles.ghost;
  return (
    <button
      type={type}
      onClick={onClick}
      style={{
        fontFamily: mono, fontSize: 11, fontWeight: 700,
        background: s.bg, border: `1px solid ${s.border}`,
        color: s.color, borderRadius: 5,
        padding: "5px 12px", cursor: "pointer",
        letterSpacing: "0.06em", whiteSpace: "nowrap",
        transition: "background 0.12s, color 0.12s",
      }}
      onMouseEnter={e => (e.currentTarget.style.background = s.hoverBg)}
      onMouseLeave={e => (e.currentTarget.style.background = s.bg)}
    >
      {children}
    </button>
  );
}

function SectionHeader({ title, onAdd, addLabel = "+ Add" }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      marginBottom: 14,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 3, height: 16, borderRadius: 2, background: t.amber, flexShrink: 0 }} />
        <span style={{
          fontFamily: mono, fontSize: 11, fontWeight: 700,
          color: t.subtle, letterSpacing: "0.18em", textTransform: "uppercase",
        }}>{title}</span>
      </div>
      <Btn variant="primary" onClick={onAdd}>{addLabel}</Btn>
    </div>
  );
}

function EmptyRow({ message }) {
  return (
    <div style={{
      padding: "28px 20px", textAlign: "center",
      border: `1px dashed ${t.border}`, borderRadius: 8,
      fontFamily: mono, fontSize: 12, color: t.muted,
      lineHeight: 1.7,
    }}>
      {message}
    </div>
  );
}

// Inline expand/collapse animation wrapper
function Expandable({ open, children }) {
  return (
    <div style={{
      display: "grid",
      gridTemplateRows: open ? "1fr" : "0fr",
      transition: "grid-template-rows 0.22s cubic-bezier(0.4, 0, 0.2, 1)",
    }}>
      <div style={{ overflow: "hidden" }}>
        {children}
      </div>
    </div>
  );
}

// ─── CREDIT CARD LIST ─────────────────────────────────────────────────────────

const BLANK_CARD = {
  id: "", name: "", balance: 0, limit: 0, apr: 0,
  minPayment: 0, monthlySpend: 0, monthlyPayment: 0,
  promoApr: "", promoEnd: "",
};

function CardFormFields({ draft, setDraft }) {
  const f = (k) => (v) => setDraft(d => ({ ...d, [k]: v }));
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
      gap: 10,
      padding: "16px 0 4px",
    }}>
      <Field label="Card Name">
        <TextInput value={draft.name} onChange={f("name")} placeholder="e.g. Chase Freedom" />
      </Field>
      <Field label="Balance ($)">
        <NumberInput value={draft.balance} onChange={f("balance")} />
      </Field>
      <Field label="Limit ($)">
        <NumberInput value={draft.limit} onChange={f("limit")} />
      </Field>
      <Field label="APR (%)">
        <NumberInput value={draft.apr} onChange={f("apr")} placeholder="0.00" />
      </Field>
      <Field label="Min Payment ($/mo)">
        <NumberInput value={draft.minPayment} onChange={f("minPayment")} />
      </Field>
      <Field label="Avg Monthly Spend ($)">
        <NumberInput value={draft.monthlySpend} onChange={f("monthlySpend")} />
      </Field>
      <Field label="Avg Monthly Payment ($)">
        <NumberInput value={draft.monthlyPayment} onChange={f("monthlyPayment")} />
      </Field>
      <Field label="Promo APR (%) — optional">
        <NumberInput value={draft.promoApr} onChange={f("promoApr")} placeholder="e.g. 0" />
      </Field>
      <Field label="Promo End Date — optional">
        <TextInput value={draft.promoEnd} onChange={f("promoEnd")} placeholder="YYYY-MM-DD" />
      </Field>
    </div>
  );
}

function CardRow({ card, onSave, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]   = useState(card);

  const trend = card.monthlySpend > card.monthlyPayment ? "up"
    : card.monthlyPayment > card.monthlySpend ? "down" : "flat";

  const trendMeta = {
    up:   { symbol: "↑", color: t.red,   label: "spending > paying" },
    down: { symbol: "↓", color: t.green, label: "paying > spending" },
    flat: { symbol: "→", color: t.subtle, label: "balanced" },
  }[trend];

  const utilPct = card.limit > 0 ? (card.balance / card.limit * 100) : null;
  const utilColor = utilPct === null ? t.muted
    : utilPct > 70 ? t.red : utilPct > 50 ? t.amber : t.green;

  function handleSave() {
    if (!draft.name.trim()) return;
    onSave({ ...draft, id: card.id });
    setEditing(false);
  }

  function handleCancel() {
    setDraft(card);
    setEditing(false);
  }

  return (
    <div style={{
      background: t.bg1,
      border: `1px solid ${editing ? t.borderHi : t.border}`,
      borderRadius: 8,
      overflow: "hidden",
      transition: "border-color 0.15s",
      animation: "rowIn 0.18s ease",
    }}>
      {/* ── Summary row ── */}
      <div style={{
        display: "flex", alignItems: "center", flexWrap: "wrap",
        gap: 8, padding: "12px 14px",
        cursor: "default",
      }}>
        {/* Name */}
        <span style={{ fontFamily: mono, fontSize: 13, fontWeight: 700, color: t.bright, minWidth: 120, flex: "1 1 120px" }}>
          {card.name || <span style={{ color: t.muted, fontWeight: 400 }}>Unnamed Card</span>}
        </span>

        {/* Balance */}
        <div style={{ flex: "0 0 auto", textAlign: "right" }}>
          <span style={{ fontFamily: mono, fontSize: 13, color: t.red, fontWeight: 700 }}>{fmtMoney(card.balance)}</span>
          {utilPct !== null && (
            <span style={{ fontFamily: mono, fontSize: 10, color: utilColor, display: "block" }}>
              {utilPct.toFixed(0)}% of {fmtMoney(card.limit)}
            </span>
          )}
        </div>

        {/* APR */}
        <div style={{ flex: "0 0 auto", textAlign: "center" }}>
          <span style={{ fontFamily: mono, fontSize: 11, color: t.amber }}>{card.apr}% APR</span>
          {card.promoApr ? (
            <span style={{ fontFamily: mono, fontSize: 10, color: t.green, display: "block" }}>
              {card.promoApr}% promo
            </span>
          ) : null}
        </div>

        {/* Spend vs Payment */}
        <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontFamily: mono, fontSize: 11, color: t.muted }}>
            <span style={{ color: t.amber }}>{fmtMoney(card.monthlySpend)}</span>
            <span style={{ color: t.muted }}> in / </span>
            <span style={{ color: t.green }}>{fmtMoney(card.monthlyPayment)}</span>
            <span style={{ color: t.muted }}> out</span>
          </span>
          <span style={{
            fontFamily: mono, fontSize: 18, fontWeight: 700,
            color: trendMeta.color, title: trendMeta.label,
            lineHeight: 1,
          }} title={trendMeta.label}>
            {trendMeta.symbol}
          </span>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 6, marginLeft: "auto", flexShrink: 0 }}>
          <Btn variant="ghost" onClick={() => { setDraft(card); setEditing(e => !e); }}>
            {editing ? "Cancel" : "Edit"}
          </Btn>
          <Btn variant="danger" onClick={() => onDelete(card.id)}>Delete</Btn>
        </div>
      </div>

      {/* ── Inline form ── */}
      <Expandable open={editing}>
        <div style={{
          borderTop: `1px solid ${t.border}`,
          background: t.bg2,
          padding: "0 14px 16px",
        }}>
          <CardFormFields draft={draft} setDraft={setDraft} />
          <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
            <Btn variant="ghost" onClick={handleCancel}>Cancel</Btn>
            <Btn variant="save" onClick={handleSave}>Save Card</Btn>
          </div>
        </div>
      </Expandable>
    </div>
  );
}

function AddCardRow({ onSave, onCancel }) {
  const [draft, setDraft] = useState({ ...BLANK_CARD, id: uid() });
  function handleSave() {
    if (!draft.name.trim()) return;
    onSave(draft);
  }
  return (
    <div style={{
      background: t.bg2,
      border: `1px solid ${t.amber}44`,
      borderRadius: 8,
      padding: "4px 14px 16px",
      animation: "rowIn 0.18s ease",
    }}>
      <p style={{ fontFamily: mono, fontSize: 10, color: t.amber, letterSpacing: "0.15em", padding: "12px 0 4px", margin: 0 }}>
        NEW CARD
      </p>
      <CardFormFields draft={draft} setDraft={setDraft} />
      <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
        <Btn variant="ghost" onClick={onCancel}>Cancel</Btn>
        <Btn variant="save" onClick={handleSave}>Save Card</Btn>
      </div>
    </div>
  );
}

// ─── LOAN LIST ────────────────────────────────────────────────────────────────

const LOAN_TYPES = ["car", "personal", "consolidation", "mortgage", "other"];

const BLANK_LOAN = {
  id: "", name: "", type: "personal", balance: 0,
  apr: 0, monthlyPayment: 0, termRemainingMonths: 0, extraPayment: 0,
};

const LOAN_TYPE_COLORS = {
  car: "#60a5fa", personal: "#a78bfa", consolidation: "#f472b6",
  mortgage: "#34d399", other: t.subtle,
};

function LoanFormFields({ draft, setDraft }) {
  const f = (k) => (v) => setDraft(d => ({ ...d, [k]: v }));
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
      gap: 10, padding: "16px 0 4px",
    }}>
      <Field label="Loan Name">
        <TextInput value={draft.name} onChange={f("name")} placeholder="e.g. Toyota Loan" />
      </Field>
      <Field label="Type">
        <SelectInput value={draft.type} onChange={f("type")} options={LOAN_TYPES} />
      </Field>
      <Field label="Balance ($)">
        <NumberInput value={draft.balance} onChange={f("balance")} />
      </Field>
      <Field label="APR (%)">
        <NumberInput value={draft.apr} onChange={f("apr")} placeholder="0.00" />
      </Field>
      <Field label="Monthly Payment ($)">
        <NumberInput value={draft.monthlyPayment} onChange={f("monthlyPayment")} />
      </Field>
      <Field label="Months Remaining — optional">
        <NumberInput value={draft.termRemainingMonths} onChange={f("termRemainingMonths")} placeholder="e.g. 36" min={0} />
      </Field>
      <Field label="Extra Payment ($/mo) — optional">
        <NumberInput value={draft.extraPayment} onChange={f("extraPayment")} placeholder="0" min={0} />
      </Field>
    </div>
  );
}

function LoanRow({ loan, onSave, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]   = useState(loan);

  const typeColor = LOAN_TYPE_COLORS[loan.type] ?? t.subtle;
  const totalPayment = (loan.monthlyPayment ?? 0) + (loan.extraPayment ?? 0);

  function handleSave() {
    if (!draft.name.trim()) return;
    onSave({ ...draft, id: loan.id });
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
      <div style={{
        display: "flex", alignItems: "center", flexWrap: "wrap",
        gap: 8, padding: "12px 14px",
      }}>
        {/* Name + type badge */}
        <div style={{ flex: "1 1 140px", display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontFamily: mono, fontSize: 13, fontWeight: 700, color: t.bright }}>
            {loan.name || <span style={{ color: t.muted, fontWeight: 400 }}>Unnamed Loan</span>}
          </span>
          <span style={{
            fontFamily: mono, fontSize: 10, color: typeColor,
            textTransform: "uppercase", letterSpacing: "0.1em",
          }}>{loan.type}</span>
        </div>

        {/* Balance */}
        <span style={{ fontFamily: mono, fontSize: 13, color: t.red, fontWeight: 700, flex: "0 0 auto" }}>
          {fmtMoney(loan.balance)}
        </span>

        {/* APR */}
        <span style={{ fontFamily: mono, fontSize: 11, color: t.amber, flex: "0 0 auto" }}>
          {loan.apr}% APR
        </span>

        {/* Payment */}
        <div style={{ flex: "0 0 auto", textAlign: "right" }}>
          <span style={{ fontFamily: mono, fontSize: 11, color: t.green }}>
            {fmtMoney(totalPayment)}<span style={{ color: t.muted }}>/mo</span>
          </span>
          {loan.extraPayment > 0 && (
            <span style={{ fontFamily: mono, fontSize: 10, color: t.subtle, display: "block" }}>
              incl. {fmtMoney(loan.extraPayment)} extra
            </span>
          )}
        </div>

        {/* Term remaining */}
        {loan.termRemainingMonths > 0 && (
          <span style={{ fontFamily: mono, fontSize: 11, color: t.muted, flex: "0 0 auto" }}>
            {loan.termRemainingMonths}mo left
          </span>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: 6, marginLeft: "auto", flexShrink: 0 }}>
          <Btn variant="ghost" onClick={() => { setDraft(loan); setEditing(e => !e); }}>
            {editing ? "Cancel" : "Edit"}
          </Btn>
          <Btn variant="danger" onClick={() => onDelete(loan.id)}>Delete</Btn>
        </div>
      </div>

      <Expandable open={editing}>
        <div style={{ borderTop: `1px solid ${t.border}`, background: t.bg2, padding: "0 14px 16px" }}>
          <LoanFormFields draft={draft} setDraft={setDraft} />
          <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
            <Btn variant="ghost" onClick={() => { setDraft(loan); setEditing(false); }}>Cancel</Btn>
            <Btn variant="save" onClick={handleSave}>Save Loan</Btn>
          </div>
        </div>
      </Expandable>
    </div>
  );
}

function AddLoanRow({ onSave, onCancel }) {
  const [draft, setDraft] = useState({ ...BLANK_LOAN, id: uid() });
  return (
    <div style={{
      background: t.bg2, border: `1px solid ${t.amber}44`,
      borderRadius: 8, padding: "4px 14px 16px",
      animation: "rowIn 0.18s ease",
    }}>
      <p style={{ fontFamily: mono, fontSize: 10, color: t.amber, letterSpacing: "0.15em", padding: "12px 0 4px", margin: 0 }}>
        NEW LOAN
      </p>
      <LoanFormFields draft={draft} setDraft={setDraft} />
      <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
        <Btn variant="ghost" onClick={onCancel}>Cancel</Btn>
        <Btn variant="save" onClick={() => { if (!draft.name.trim()) return; onSave(draft); }}>Save Loan</Btn>
      </div>
    </div>
  );
}

// ─── TOTALS STRIP ─────────────────────────────────────────────────────────────

function TotalsStrip({ cards, loans }) {
  const totalCard = cards.reduce((s, c) => s + (c.balance ?? 0), 0);
  const totalLoan = loans.reduce((s, l) => s + (l.balance ?? 0), 0);
  const total = totalCard + totalLoan;

  if (total === 0) return null;

  return (
    <div style={{
      display: "flex", flexWrap: "wrap", gap: 10,
      padding: "14px 16px",
      background: t.bg1, border: `1px solid ${t.border}`,
      borderRadius: 8, marginBottom: 20,
    }}>
      {[
        { label: "Total Debt", value: total, color: t.red },
        { label: "Credit Cards", value: totalCard, color: t.amber },
        { label: "Loans", value: totalLoan, color: t.blue },
      ].map(({ label, value, color }) => (
        <div key={label} style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 100 }}>
          <span style={{ fontFamily: mono, fontSize: 10, color: t.muted, letterSpacing: "0.12em", textTransform: "uppercase" }}>{label}</span>
          <span style={{ fontFamily: mono, fontSize: 18, fontWeight: 700, color }}>{fmtMoney(value)}</span>
        </div>
      ))}
    </div>
  );
}

// ─── MAIN EXPORT ──────────────────────────────────────────────────────────────

export default function Debts({ state, onUpdate }) {
  const [addingCard, setAddingCard] = useState(false);
  const [addingLoan, setAddingLoan] = useState(false);

  const cards = state.creditCards ?? [];
  const loans = state.loans ?? [];

  const updateCards = useCallback((newCards) => {
    onUpdate({ ...state, creditCards: newCards });
  }, [state, onUpdate]);

  const updateLoans = useCallback((newLoans) => {
    onUpdate({ ...state, loans: newLoans });
  }, [state, onUpdate]);

  // Card handlers
  const handleAddCard   = (card) => { updateCards([...cards, card]); setAddingCard(false); };
  const handleSaveCard  = (card) => updateCards(cards.map(c => c.id === card.id ? card : c));
  const handleDeleteCard= (id)   => updateCards(cards.filter(c => c.id !== id));

  // Loan handlers
  const handleAddLoan   = (loan) => { updateLoans([...loans, loan]); setAddingLoan(false); };
  const handleSaveLoan  = (loan) => updateLoans(loans.map(l => l.id === loan.id ? loan : l));
  const handleDeleteLoan= (id)   => updateLoans(loans.filter(l => l.id !== id));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32, maxWidth: 860, margin: "0 auto", padding: "0 0 48px" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;700&display=swap');
        @keyframes rowIn {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        input[type=number]::-webkit-inner-spin-button { opacity: 0.3; }
        input::placeholder, select::placeholder { color: #475569; }
      `}</style>

      {/* Totals */}
      <TotalsStrip cards={cards} loans={loans} />

      {/* ── CREDIT CARDS ───────────────────────────────── */}
      <section>
        <SectionHeader
          title={`Credit Cards (${cards.length})`}
          onAdd={() => { setAddingCard(true); setAddingLoan(false); }}
          addLabel="+ Add Card"
        />

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {addingCard && (
            <AddCardRow
              onSave={handleAddCard}
              onCancel={() => setAddingCard(false)}
            />
          )}
          {cards.length === 0 && !addingCard && (
            <EmptyRow message={
              <>No credit cards yet.<br />Click <strong style={{ color: t.subtle }}>+ Add Card</strong> to start tracking.</>
            } />
          )}
          {cards.map(card => (
            <CardRow
              key={card.id}
              card={card}
              onSave={handleSaveCard}
              onDelete={handleDeleteCard}
            />
          ))}
        </div>
      </section>

      {/* ── LOANS ──────────────────────────────────────── */}
      <section>
        <SectionHeader
          title={`Loans (${loans.length})`}
          onAdd={() => { setAddingLoan(true); setAddingCard(false); }}
          addLabel="+ Add Loan"
        />

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {addingLoan && (
            <AddLoanRow
              onSave={handleAddLoan}
              onCancel={() => setAddingLoan(false)}
            />
          )}
          {loans.length === 0 && !addingLoan && (
            <EmptyRow message={
              <>No loans added yet.<br />Car loans, mortgages, personal loans — track them all here.</>
            } />
          )}
          {loans.map(loan => (
            <LoanRow
              key={loan.id}
              loan={loan}
              onSave={handleSaveLoan}
              onDelete={handleDeleteLoan}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
