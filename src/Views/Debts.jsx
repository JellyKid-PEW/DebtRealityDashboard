import React, { useCallback, useMemo, useState } from "react";

const t = {
    bg0: "#080b10",
    bg1: "#0f172a",
    bg2: "#111827",
    border: "#334155",
    borderHi: "#475569",
    bright: "#e2e8f0",
    body: "#cbd5e1",
    muted: "#94a3b8",
    subtle: "#64748b",
    amber: "#f59e0b",
    amberDim: "rgba(245,158,11,0.12)",
    green: "#22c55e",
    greenDim: "rgba(34,197,94,0.12)",
    red: "#ef4444",
    redDim: "rgba(239,68,68,0.12)",
    blue: "#38bdf8",
    blueDim: "rgba(56,189,248,0.12)",
};

const mono = `'IBM Plex Mono', 'Courier New', monospace`;

const LOAN_TYPES = ["car", "personal", "consolidation", "mortgage", "other"];

const BLANK_CARD = {
    id: "",
    name: "",
    dueDay: 0,
    sortOrder: 0,
    balance: 0,
    limit: 0,
    apr: 0,
    minPayment: 0,
    monthlySpend: 0,
    monthlyPayment: 0,
    promoApr: "",
    promoEnd: "",
};

const BLANK_LOAN = {
    id: "",
    name: "",
    dueDay: 0,
    sortOrder: 0,
    type: "personal",
    balance: 0,
    apr: 0,
    monthlyPayment: 0,
    termRemainingMonths: 0,
    extraPayment: 0,
};

function uid() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return Math.random().toString(36).slice(2, 10);
}

function fmtMoney(n) {
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(Number(n) || 0);
}

function fmtPct(n) {
    return `${(Number(n) || 0).toFixed(1)}%`;
}

function normalizeOrder(items) {
    return items.map((item, index) => ({ ...item, sortOrder: index }));
}

function sortByOrder(items) {
    return [...items].sort((a, b) => (a.sortOrder ?? 9999) - (b.sortOrder ?? 9999));
}

function reorderByIds(items, draggedId, targetId) {
    const ordered = sortByOrder(items);
    const from = ordered.findIndex((x) => x.id === draggedId);
    const to = ordered.findIndex((x) => x.id === targetId);
    if (from === -1 || to === -1 || from === to) return ordered;

    const next = [...ordered];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return normalizeOrder(next);
}

function effectiveApr(card) {
    return card.promoApr != null && card.promoApr !== "" && Number(card.promoApr) > 0
        ? Number(card.promoApr)
        : Number(card.apr) || 0;
}

function SectionHeader({ title, onAdd, addLabel }) {
    return (
        <div
            style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 14,
                gap: 12,
            }}
        >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 3, height: 16, borderRadius: 2, background: t.amber, flexShrink: 0 }} />
                <span
                    style={{
                        fontFamily: mono,
                        fontSize: 11,
                        fontWeight: 700,
                        color: t.subtle,
                        letterSpacing: "0.18em",
                        textTransform: "uppercase",
                    }}
                >
                    {title}
                </span>
            </div>

            <Btn variant="primary" onClick={onAdd}>
                {addLabel}
            </Btn>
        </div>
    );
}

function TotalsStrip({ cards, loans }) {
    const totalCard = cards.reduce((s, c) => s + (c.balance ?? 0), 0);
    const totalLoan = loans.reduce((s, l) => s + (l.balance ?? 0), 0);
    const total = totalCard + totalLoan;

    if (total === 0) return null;

    return (
        <div
            style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 10,
                padding: "14px 16px",
                background: t.bg1,
                border: `1px solid ${t.border}`,
                borderRadius: 8,
                marginBottom: 20,
            }}
        >
            {[
                { label: "Total Debt", value: total, color: t.red },
                { label: "Credit Cards", value: totalCard, color: t.amber },
                { label: "Loans", value: totalLoan, color: t.blue },
            ].map(({ label, value, color }) => (
                <div key={label} style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 120 }}>
                    <span
                        style={{
                            fontFamily: mono,
                            fontSize: 10,
                            color: t.muted,
                            letterSpacing: "0.12em",
                            textTransform: "uppercase",
                        }}
                    >
                        {label}
                    </span>
                    <span style={{ fontFamily: mono, fontSize: 18, fontWeight: 700, color }}>
                        {fmtMoney(value)}
                    </span>
                </div>
            ))}
        </div>
    );
}

function EmptyRow({ message }) {
    return (
        <div
            style={{
                padding: "28px 20px",
                textAlign: "center",
                border: `1px dashed ${t.border}`,
                borderRadius: 8,
                fontFamily: mono,
                fontSize: 12,
                color: t.muted,
                lineHeight: 1.7,
            }}
        >
            {message}
        </div>
    );
}

function Expandable({ open, children }) {
    return (
        <div
            style={{
                display: "grid",
                gridTemplateRows: open ? "1fr" : "0fr",
                transition: "grid-template-rows 0.22s cubic-bezier(0.4, 0, 0.2, 1)",
            }}
        >
            <div style={{ overflow: "hidden" }}>{children}</div>
        </div>
    );
}

function Btn({ children, onClick, variant = "ghost", type = "button" }) {
    const styles = {
        ghost: { bg: t.bg2, border: t.border, color: t.body, hoverBg: "#1e293b" },
        primary: { bg: t.amber, border: t.amber, color: "#0f1421", hoverBg: "#fbbf24" },
        danger: { bg: t.redDim, border: "#7f1d1d", color: "#fca5a5", hoverBg: "#5c1111" },
        save: { bg: t.greenDim, border: "#166534", color: "#86efac", hoverBg: "#14532d" },
    };
    const s = styles[variant] ?? styles.ghost;

    return (
        <button
            type={type}
            onClick={onClick}
            style={{
                fontFamily: mono,
                fontSize: 11,
                fontWeight: 700,
                background: s.bg,
                border: `1px solid ${s.border}`,
                color: s.color,
                borderRadius: 5,
                padding: "6px 12px",
                cursor: "pointer",
                letterSpacing: "0.06em",
                whiteSpace: "nowrap",
                transition: "background 0.12s, color 0.12s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = s.hoverBg)}
            onMouseLeave={(e) => (e.currentTarget.style.background = s.bg)}
        >
            {children}
        </button>
    );
}

function Field({ label, children }) {
    return (
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span
                style={{
                    fontFamily: mono,
                    fontSize: 10,
                    color: t.muted,
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                }}
            >
                {label}
            </span>
            {children}
        </label>
    );
}

function TextInput({ value, onChange, placeholder = "" }) {
    return (
        <input
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            style={{
                width: "100%",
                minHeight: 38,
                background: t.bg2,
                color: t.bright,
                border: `1px solid ${t.border}`,
                borderRadius: 6,
                padding: "8px 10px",
                fontFamily: mono,
                fontSize: 12,
                outline: "none",
                boxSizing: "border-box",
            }}
        />
    );
}

function NumberInput({ value, onChange, placeholder = "", min }) {
    return (
        <input
            type="number"
            min={min}
            value={value ?? ""}
            onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
            placeholder={placeholder}
            style={{
                width: "100%",
                minHeight: 38,
                background: t.bg2,
                color: t.bright,
                border: `1px solid ${t.border}`,
                borderRadius: 6,
                padding: "8px 10px",
                fontFamily: mono,
                fontSize: 12,
                outline: "none",
                boxSizing: "border-box",
            }}
        />
    );
}

function SelectInput({ value, onChange, options }) {
    return (
        <select
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value)}
            style={{
                width: "100%",
                minHeight: 38,
                background: t.bg2,
                color: t.bright,
                border: `1px solid ${t.border}`,
                borderRadius: 6,
                padding: "8px 10px",
                fontFamily: mono,
                fontSize: 12,
                outline: "none",
                boxSizing: "border-box",
            }}
        >
            {options.map((opt) => (
                <option key={opt} value={opt}>
                    {opt}
                </option>
            ))}
        </select>
    );
}

function MetricPill({ label, value, color = t.body, bg = t.bg2 }) {
    return (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                gap: 2,
                minWidth: 95,
                padding: "7px 9px",
                borderRadius: 7,
                background: bg,
                border: `1px solid ${t.border}`,
            }}
        >
            <span
                style={{
                    fontFamily: mono,
                    fontSize: 9,
                    color: t.muted,
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                }}
            >
                {label}
            </span>
            <span style={{ fontFamily: mono, fontSize: 13, fontWeight: 700, color }}>{value}</span>
        </div>
    );
}

function DragHandle() {
    return (
        <div
            title="Drag to reorder"
            style={{
                userSelect: "none",
                cursor: "grab",
                color: t.subtle,
                fontFamily: mono,
                fontSize: 16,
                lineHeight: 1,
                padding: "2px 6px",
            }}
        >
            ⋮⋮
        </div>
    );
}

function CardFormFields({ draft, setDraft }) {
    const f = (k) => (v) => setDraft((d) => ({ ...d, [k]: v }));

    return (
        <div
            style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
                gap: 10,
                padding: "16px 0 4px",
            }}
        >
            <Field label="Card Name">
                <TextInput value={draft.name} onChange={f("name")} placeholder="e.g. Chase Freedom" />
            </Field>
            <Field label="Due Day (1–31)">
                <NumberInput value={draft.dueDay} onChange={f("dueDay")} min={1} />
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

function LoanFormFields({ draft, setDraft }) {
    const f = (k) => (v) => setDraft((d) => ({ ...d, [k]: v }));

    return (
        <div
            style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
                gap: 10,
                padding: "16px 0 4px",
            }}
        >
            <Field label="Loan Name">
                <TextInput value={draft.name} onChange={f("name")} placeholder="e.g. Toyota Loan" />
            </Field>
            <Field label="Due Day (1–31)">
                <NumberInput value={draft.dueDay} onChange={f("dueDay")} min={1} />
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
                <NumberInput value={draft.termRemainingMonths} onChange={f("termRemainingMonths")} min={0} />
            </Field>
            <Field label="Extra Payment ($/mo) — optional">
                <NumberInput value={draft.extraPayment} onChange={f("extraPayment")} min={0} />
            </Field>
        </div>
    );
}

function AddCardRow({ onSave, onCancel, nextOrder }) {
    const [draft, setDraft] = useState({ ...BLANK_CARD, id: uid(), sortOrder: nextOrder });

    function handleSave() {
        if (!draft.name.trim()) return;
        onSave({
            ...draft,
            id: draft.id || uid(),
            sortOrder: nextOrder,
        });
    }

    return (
        <div
            style={{
                background: t.bg1,
                border: `1px solid ${t.borderHi}`,
                borderRadius: 8,
                padding: "0 14px 14px",
            }}
        >
            <p
                style={{
                    fontFamily: mono,
                    fontWeight: 700,
                    fontSize: 10,
                    color: t.amber,
                    letterSpacing: "0.15em",
                    padding: "12px 0 4px",
                    margin: 0,
                }}
            >
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

function AddLoanRow({ onSave, onCancel, nextOrder }) {
    const [draft, setDraft] = useState({ ...BLANK_LOAN, id: uid(), sortOrder: nextOrder });

    function handleSave() {
        if (!draft.name.trim()) return;
        onSave({
            ...draft,
            id: draft.id || uid(),
            sortOrder: nextOrder,
        });
    }

    return (
        <div
            style={{
                background: t.bg1,
                border: `1px solid ${t.borderHi}`,
                borderRadius: 8,
                padding: "0 14px 14px",
            }}
        >
            <p
                style={{
                    fontFamily: mono,
                    fontWeight: 700,
                    fontSize: 10,
                    color: t.amber,
                    letterSpacing: "0.15em",
                    padding: "12px 0 4px",
                    margin: 0,
                }}
            >
                NEW LOAN
            </p>

            <LoanFormFields draft={draft} setDraft={setDraft} />

            <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
                <Btn variant="ghost" onClick={onCancel}>Cancel</Btn>
                <Btn variant="save" onClick={handleSave}>Save Loan</Btn>
            </div>
        </div>
    );
}

function CardRow({ card, onSave, onDelete, draggableProps }) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(card);

    const trend =
        card.monthlySpend > card.monthlyPayment
            ? "up"
            : card.monthlyPayment > card.monthlySpend
                ? "down"
                : "flat";

    const trendMeta = {
        up: { symbol: "↑", color: t.red, label: "spending > paying" },
        down: { symbol: "↓", color: t.green, label: "paying > spending" },
        flat: { symbol: "→", color: t.subtle, label: "balanced" },
    }[trend];

    const utilPct = card.limit > 0 ? (card.balance / card.limit) * 100 : null;
    const utilColor =
        utilPct == null ? t.muted : utilPct > 70 ? t.red : utilPct > 50 ? t.amber : t.green;

    function handleSave() {
        if (!draft.name.trim()) return;
        onSave({ ...draft, id: card.id, sortOrder: card.sortOrder ?? 0 });
        setEditing(false);
    }

    function handleCancel() {
        setDraft(card);
        setEditing(false);
    }

    return (
        <div
            draggable
            onDragStart={draggableProps.onDragStart}
            onDragOver={draggableProps.onDragOver}
            onDrop={draggableProps.onDrop}
            style={{
                background: t.bg1,
                border: `1px solid ${editing ? t.borderHi : t.border}`,
                borderRadius: 8,
                overflow: "hidden",
                transition: "border-color 0.15s",
            }}
        >
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: 8,
                    padding: "12px 14px",
                }}
            >
                <DragHandle />

                <span
                    style={{
                        fontFamily: mono,
                        fontSize: 13,
                        fontWeight: 700,
                        color: t.bright,
                        minWidth: 120,
                        flex: "1 1 120px",
                    }}
                >
                    {card.name || <span style={{ color: t.muted, fontWeight: 400 }}>Unnamed Card</span>}
                </span>

                {card.groupName ? (
                    <span
                        style={{
                            fontFamily: mono,
                            fontSize: 10,
                            color: t.blue,
                            background: t.blueDim,
                            border: `1px solid #164e63`,
                            borderRadius: 999,
                            padding: "4px 8px",
                            letterSpacing: "0.08em",
                            textTransform: "uppercase",
                        }}
                    >
                        {card.groupName}
                    </span>
                ) : null}

                <MetricPill label="Due" value={card.dueDay ? `${card.dueDay}` : "-"} color={t.blue} />
                <MetricPill label="Balance" value={fmtMoney(card.balance)} color={t.red} />
                <MetricPill label="APR" value={fmtPct(card.apr)} color={t.amber} />
                <MetricPill label="Min" value={fmtMoney(card.minPayment)} color={t.bright} />
                <MetricPill label="Avg Pay" value={fmtMoney(card.monthlyPayment)} color={t.green} />
                <MetricPill label="Avg Spend" value={fmtMoney(card.monthlySpend)} color={trendMeta.color} />
                <MetricPill label="Trend" value={`${trendMeta.symbol} ${trendMeta.label}`} color={trendMeta.color} />

                {utilPct != null && (
                    <MetricPill label="Utilization" value={`${utilPct.toFixed(0)}%`} color={utilColor} />
                )}

                <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
                    <Btn variant="ghost" onClick={() => setEditing((v) => !v)}>
                        {editing ? "Close" : "Edit"}
                    </Btn>
                    <Btn variant="danger" onClick={() => onDelete(card.id)}>
                        Delete
                    </Btn>
                </div>
            </div>

            <Expandable open={editing}>
                <div style={{ padding: "0 14px 14px" }}>
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

function LoanRow({ loan, onSave, onDelete, draggableProps }) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(loan);

    const totalPayment = (loan.monthlyPayment ?? 0) + (loan.extraPayment ?? 0);

    function handleSave() {
        if (!draft.name.trim()) return;
        onSave({ ...draft, id: loan.id, sortOrder: loan.sortOrder ?? 0 });
        setEditing(false);
    }

    function handleCancel() {
        setDraft(loan);
        setEditing(false);
    }

    return (
        <div
            draggable
            onDragStart={draggableProps.onDragStart}
            onDragOver={draggableProps.onDragOver}
            onDrop={draggableProps.onDrop}
            style={{
                background: t.bg1,
                border: `1px solid ${editing ? t.borderHi : t.border}`,
                borderRadius: 8,
                overflow: "hidden",
                transition: "border-color 0.15s",
            }}
        >
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: 8,
                    padding: "12px 14px",
                }}
            >
                <DragHandle />

                <span
                    style={{
                        fontFamily: mono,
                        fontSize: 13,
                        fontWeight: 700,
                        color: t.bright,
                        minWidth: 120,
                        flex: "1 1 120px",
                    }}
                >
                    {loan.name || <span style={{ color: t.muted, fontWeight: 400 }}>Unnamed Loan</span>}
                </span>

                {loan.groupName ? (
                    <span
                        style={{
                            fontFamily: mono,
                            fontSize: 10,
                            color: t.blue,
                            background: t.blueDim,
                            border: `1px solid #164e63`,
                            borderRadius: 999,
                            padding: "4px 8px",
                            letterSpacing: "0.08em",
                            textTransform: "uppercase",
                        }}
                    >
                        {loan.groupName}
                    </span>
                ) : null}

                <MetricPill label="Due" value={loan.dueDay ? `${loan.dueDay}` : "-"} color={t.blue} />
                <MetricPill label="Balance" value={fmtMoney(loan.balance)} color={t.red} />
                <MetricPill label="APR" value={fmtPct(loan.apr)} color={t.amber} />
                <MetricPill label="Payment" value={fmtMoney(loan.monthlyPayment)} color={t.green} />
                <MetricPill label="Extra" value={fmtMoney(loan.extraPayment)} color={t.blue} />
                <MetricPill label="Total" value={fmtMoney(totalPayment)} color={t.bright} />
                <MetricPill label="Type" value={loan.type} color={t.body} />

                <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
                    <Btn variant="ghost" onClick={() => setEditing((v) => !v)}>
                        {editing ? "Close" : "Edit"}
                    </Btn>
                    <Btn variant="danger" onClick={() => onDelete(loan.id)}>
                        Delete
                    </Btn>
                </div>
            </div>

            <Expandable open={editing}>
                <div style={{ padding: "0 14px 14px" }}>
                    <LoanFormFields draft={draft} setDraft={setDraft} />
                    <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
                        <Btn variant="ghost" onClick={handleCancel}>Cancel</Btn>
                        <Btn variant="save" onClick={handleSave}>Save Loan</Btn>
                    </div>
                </div>
            </Expandable>
        </div>
    );
}

export default function Debts({ state, onUpdate }) {
    const [addingCard, setAddingCard] = useState(false);
    const [addingLoan, setAddingLoan] = useState(false);

    const cards = useMemo(() => sortByOrder(state.creditCards ?? []), [state.creditCards]);
    const loans = useMemo(() => sortByOrder(state.loans ?? []), [state.loans]);

    const [draggingCardId, setDraggingCardId] = useState(null);
    const [draggingLoanId, setDraggingLoanId] = useState(null);

    const updateCards = useCallback(
        (newCards) => {
            onUpdate({ ...state, creditCards: normalizeOrder(newCards) });
        },
        [state, onUpdate]
    );

    const updateLoans = useCallback(
        (newLoans) => {
            onUpdate({ ...state, loans: normalizeOrder(newLoans) });
        },
        [state, onUpdate]
    );

    const handleAddCard = (card) => {
        updateCards([...cards, { ...card, sortOrder: cards.length }]);
        setAddingCard(false);
    };

    const handleSaveCard = (card) => {
        updateCards(cards.map((c) => (c.id === card.id ? card : c)));
    };

    const handleDeleteCard = (id) => {
        updateCards(cards.filter((c) => c.id !== id));
    };

    const handleAddLoan = (loan) => {
        updateLoans([...loans, { ...loan, sortOrder: loans.length }]);
        setAddingLoan(false);
    };

    const handleSaveLoan = (loan) => {
        updateLoans(loans.map((l) => (l.id === loan.id ? loan : l)));
    };

    const handleDeleteLoan = (id) => {
        updateLoans(loans.filter((l) => l.id !== id));
    };

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 32, maxWidth: 980, margin: "0 auto", padding: "0 0 48px" }}>
            <TotalsStrip cards={cards} loans={loans} />

            <section>
                <SectionHeader
                    title={`Credit Cards (${cards.length})`}
                    onAdd={() => {
                        setAddingCard(true);
                        setAddingLoan(false);
                    }}
                    addLabel="+ Add Card"
                />

                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {addingCard && (
                        <AddCardRow
                            nextOrder={cards.length}
                            onSave={handleAddCard}
                            onCancel={() => setAddingCard(false)}
                        />
                    )}

                    {cards.length === 0 && !addingCard && (
                        <EmptyRow
                            message={
                                <>
                                    No credit cards yet.
                                    <br />
                                    Click <strong style={{ color: t.subtle }}>+ Add Card</strong> to start tracking.
                                </>
                            }
                        />
                    )}

                    {cards.map((card) => (
                        <CardRow
                            key={card.id}
                            card={card}
                            onSave={handleSaveCard}
                            onDelete={handleDeleteCard}
                            draggableProps={{
                                onDragStart: () => setDraggingCardId(card.id),
                                onDragOver: (e) => e.preventDefault(),
                                onDrop: (e) => {
                                    e.preventDefault();
                                    if (!draggingCardId) return;
                                    updateCards(reorderByIds(cards, draggingCardId, card.id));
                                    setDraggingCardId(null);
                                },
                            }}
                        />
                    ))}
                </div>
            </section>

            <section>
                <SectionHeader
                    title={`Loans (${loans.length})`}
                    onAdd={() => {
                        setAddingLoan(true);
                        setAddingCard(false);
                    }}
                    addLabel="+ Add Loan"
                />

                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {addingLoan && (
                        <AddLoanRow
                            nextOrder={loans.length}
                            onSave={handleAddLoan}
                            onCancel={() => setAddingLoan(false)}
                        />
                    )}

                    {loans.length === 0 && !addingLoan && (
                        <EmptyRow
                            message={
                                <>
                                    No loans added yet.
                                    <br />
                                    Car loans, mortgages, personal loans — track them all here.
                                </>
                            }
                        />
                    )}

                    {loans.map((loan) => (
                        <LoanRow
                            key={loan.id}
                            loan={loan}
                            onSave={handleSaveLoan}
                            onDelete={handleDeleteLoan}
                            draggableProps={{
                                onDragStart: () => setDraggingLoanId(loan.id),
                                onDragOver: (e) => e.preventDefault(),
                                onDrop: (e) => {
                                    e.preventDefault();
                                    if (!draggingLoanId) return;
                                    updateLoans(reorderByIds(loans, draggingLoanId, loan.id));
                                    setDraggingLoanId(null);
                                },
                            }}
                        />
                    ))}
                </div>
            </section>
        </div>
    );
}