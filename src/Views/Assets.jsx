import { useState, useCallback, useMemo } from "react";

// ─── STYLE TOKENS ─────────────────────────────────────────────────────────────
const mono = "'IBM Plex Mono', 'Courier New', monospace";

const t = {
  bg0: "#080b10", bg1: "#0f1421", bg2: "#141926",
  border: "#1e293b", borderHi: "#334155",
  muted: "#475569", subtle: "#64748b", body: "#94a3b8", bright: "#e2e8f0",
  amber: "#f59e0b",
  red: "#ef4444",   redDim: "#450a0a",
  green: "#22c55e", greenDim: "#052e16",
  blue: "#60a5fa",
  keep:  { fg: "#22c55e", bg: "#052e16", border: "#166534" },
  maybe: { fg: "#f59e0b", bg: "#78350f22", border: "#92400e" },
  sell:  { fg: "#f87171", bg: "#450a0a",  border: "#7f1d1d" },
};

const uid = () => Math.random().toString(36).slice(2, 9);

function fmtMoney(n) {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(n ?? 0);
}

function fmtPct(n) {
  return `${(n * 100).toFixed(0)}%`;
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
      placeholder={placeholder} min={0}
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

function Btn({ children, onClick, variant = "ghost" }) {
  const styles = {
    ghost:   { bg: t.bg2, border: t.border, color: t.body, hoverBg: "#1e293b" },
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

// ─── PRIORITY TOGGLE ──────────────────────────────────────────────────────────

const PRIORITIES = ["keep", "maybe", "sell"];

function PriorityToggle({ value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {PRIORITIES.map(p => {
        const theme = t[p];
        const active = value === p;
        return (
          <button key={p} onClick={() => onChange(p)} style={{
            fontFamily: mono, fontSize: 10, fontWeight: 700,
            padding: "5px 10px", borderRadius: 4, cursor: "pointer",
            letterSpacing: "0.08em", textTransform: "uppercase",
            background: active ? theme.bg : t.bg0,
            border: `1px solid ${active ? theme.border : t.border}`,
            color: active ? theme.fg : t.muted,
            transition: "all 0.12s",
          }}>
            {p}
          </button>
        );
      })}
    </div>
  );
}

function PriorityBadge({ priority }) {
  const theme = t[priority] ?? t.maybe;
  return (
    <span style={{
      fontFamily: mono, fontSize: 10, fontWeight: 700,
      padding: "2px 9px", borderRadius: 10,
      background: theme.bg, border: `1px solid ${theme.border}44`,
      color: theme.fg, letterSpacing: "0.08em", textTransform: "uppercase",
    }}>{priority}</span>
  );
}

// ─── ASSET CATEGORIES ─────────────────────────────────────────────────────────

const ASSET_CATEGORIES = [
  "Vehicle", "Real Estate", "Investment Account", "Savings",
  "Electronics", "Jewelry", "Collectibles", "Furniture",
  "Art", "Business", "Other",
];

// ─── ASSET FORM FIELDS ────────────────────────────────────────────────────────

function AssetFormFields({ draft, setDraft }) {
  const f = (k) => (v) => setDraft(d => ({ ...d, [k]: v }));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "16px 0 4px" }}>
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
        gap: 10,
      }}>
        <div style={{ gridColumn: "span 2" }}>
          <Field label="Asset Name">
            <TextInput value={draft.name} onChange={f("name")} placeholder="e.g. 2021 Honda Civic" />
          </Field>
        </div>
        <Field label="Category">
          <div>
            <input
              list="asset-cats"
              value={draft.category ?? ""}
              placeholder="e.g. Vehicle"
              onChange={e => f("category")(e.target.value)}
              style={inputStyle}
              onFocus={e => (e.target.style.borderColor = t.borderHi)}
              onBlur={e => (e.target.style.borderColor = t.border)}
            />
            <datalist id="asset-cats">
              {ASSET_CATEGORIES.map(c => <option key={c} value={c} />)}
            </datalist>
          </div>
        </Field>
        <Field label="Estimated Value ($)">
          <NumberInput value={draft.estimatedValue} onChange={f("estimatedValue")} />
        </Field>
        <Field label="Quick Sale Value ($)">
          <NumberInput value={draft.quickSaleValue} onChange={f("quickSaleValue")} placeholder="If sold quickly" />
        </Field>
      </div>

      <Field label="Priority — would you sell this to pay down debt?">
        <div style={{ marginTop: 4 }}>
          <PriorityToggle value={draft.priority ?? "keep"} onChange={f("priority")} />
          <p style={{ fontFamily: mono, fontSize: 10, color: t.muted, margin: "8px 0 0", lineHeight: 1.6 }}>
            {draft.priority === "keep"  && "You plan to keep this asset regardless."}
            {draft.priority === "maybe" && "You might sell this if things got tight."}
            {draft.priority === "sell"  && "You're actively considering selling this."}
          </p>
        </div>
      </Field>
    </div>
  );
}

// ─── ASSET ROW ────────────────────────────────────────────────────────────────

function AssetRow({ asset, onSave, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(asset);

  const haircut = asset.estimatedValue > 0
    ? 1 - (asset.quickSaleValue / asset.estimatedValue)
    : null;

  function handleSave() {
    if (!draft.name.trim()) return;
    onSave({ ...draft, id: asset.id });
    setEditing(false);
  }

  function handleCancel() {
    setDraft(asset);
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
        gap: 10, padding: "12px 14px",
      }}>
        {/* Name + category */}
        <div style={{ flex: "1 1 150px", minWidth: 130 }}>
          <div style={{ fontFamily: mono, fontSize: 13, fontWeight: 700, color: t.bright, marginBottom: 2 }}>
            {asset.name || <span style={{ color: t.muted, fontWeight: 400 }}>Unnamed Asset</span>}
          </div>
          {asset.category && (
            <span style={{ fontFamily: mono, fontSize: 10, color: t.subtle }}>{asset.category}</span>
          )}
        </div>

        {/* Priority badge */}
        <PriorityBadge priority={asset.priority ?? "keep"} />

        {/* Estimated value */}
        <div style={{ flex: "0 0 auto", textAlign: "right" }}>
          <div style={{ fontFamily: mono, fontSize: 13, fontWeight: 700, color: t.green }}>
            {fmtMoney(asset.estimatedValue)}
          </div>
          <div style={{ fontFamily: mono, fontSize: 10, color: t.subtle }}>estimated</div>
        </div>

        {/* Quick sale value + haircut */}
        {asset.quickSaleValue > 0 && (
          <div style={{ flex: "0 0 auto", textAlign: "right" }}>
            <div style={{ fontFamily: mono, fontSize: 12, color: t.amber, fontWeight: 700 }}>
              {fmtMoney(asset.quickSaleValue)}
            </div>
            <div style={{ fontFamily: mono, fontSize: 10, color: t.muted }}>
              quick sale
              {haircut !== null && haircut > 0 && (
                <span style={{ color: t.red }}> (−{fmtPct(haircut)})</span>
              )}
            </div>
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: 6, marginLeft: "auto", flexShrink: 0 }}>
          <Btn variant="ghost" onClick={() => { setDraft(asset); setEditing(e => !e); }}>
            {editing ? "Cancel" : "Edit"}
          </Btn>
          <Btn variant="danger" onClick={() => onDelete(asset.id)}>Delete</Btn>
        </div>
      </div>

      <Expandable open={editing}>
        <div style={{ borderTop: `1px solid ${t.border}`, background: t.bg2, padding: "0 14px 16px" }}>
          <AssetFormFields draft={draft} setDraft={setDraft} />
          <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
            <Btn variant="ghost" onClick={handleCancel}>Cancel</Btn>
            <Btn variant="save" onClick={handleSave}>Save Asset</Btn>
          </div>
        </div>
      </Expandable>
    </div>
  );
}

function AddAssetRow({ onSave, onCancel }) {
  const [draft, setDraft] = useState({
    id: uid(), name: "", category: "", estimatedValue: 0, quickSaleValue: 0, priority: "keep",
  });
  return (
    <div style={{
      background: t.bg2, border: `1px solid ${t.amber}44`,
      borderRadius: 8, padding: "4px 14px 16px",
      animation: "rowIn 0.18s ease",
    }}>
      <p style={{ fontFamily: mono, fontSize: 10, color: t.amber, letterSpacing: "0.15em", padding: "12px 0 4px", margin: 0 }}>
        NEW ASSET
      </p>
      <AssetFormFields draft={draft} setDraft={setDraft} />
      <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
        <Btn variant="ghost" onClick={onCancel}>Cancel</Btn>
        <Btn variant="save" onClick={() => { if (!draft.name.trim()) return; onSave(draft); }}>Save Asset</Btn>
      </div>
    </div>
  );
}

// ─── TOTALS HEADER ────────────────────────────────────────────────────────────

function TotalsHeader({ assets }) {
  const totalEstimated = useMemo(
    () => assets.reduce((s, a) => s + (a.estimatedValue ?? 0), 0),
    [assets]
  );

  const quickSaleItems = useMemo(
    () => assets.filter(a => a.priority === "maybe" || a.priority === "sell"),
    [assets]
  );

  const quickSaleTotal = useMemo(
    () => quickSaleItems.reduce((s, a) => s + (a.quickSaleValue ?? 0), 0),
    [quickSaleItems]
  );

  const sellItems = assets.filter(a => a.priority === "sell");

  if (assets.length === 0) return null;

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
      gap: 10, marginBottom: 20,
    }}>
      {/* Total estimated value */}
      <div style={{
        background: t.bg1, border: `1px solid ${t.border}`,
        borderRadius: 10, padding: "16px 20px",
        borderLeft: `3px solid ${t.green}`,
      }}>
        <div style={{ fontFamily: mono, fontSize: 10, color: t.muted, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 6 }}>
          Total Estimated Value
        </div>
        <div style={{ fontFamily: mono, fontSize: 24, fontWeight: 700, color: t.green }}>
          {fmtMoney(totalEstimated)}
        </div>
        <div style={{ fontFamily: mono, fontSize: 10, color: t.subtle, marginTop: 4 }}>
          {assets.length} asset{assets.length !== 1 ? "s" : ""} tracked
        </div>
      </div>

      {/* Quick-sale total */}
      <div style={{
        background: t.bg1, border: `1px solid ${t.border}`,
        borderRadius: 10, padding: "16px 20px",
        borderLeft: `3px solid ${t.amber}`,
      }}>
        <div style={{ fontFamily: mono, fontSize: 10, color: t.muted, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 6 }}>
          Quick-Sale Total
        </div>
        <div style={{ fontFamily: mono, fontSize: 24, fontWeight: 700, color: t.amber }}>
          {fmtMoney(quickSaleTotal)}
        </div>
        <div style={{ fontFamily: mono, fontSize: 10, color: t.subtle, marginTop: 4 }}>
          {quickSaleItems.length} item{quickSaleItems.length !== 1 ? "s" : ""} marked maybe/sell
        </div>
      </div>

      {/* Sell-now total */}
      {sellItems.length > 0 && (
        <div style={{
          background: t.redDim, border: `1px solid #7f1d1d`,
          borderRadius: 10, padding: "16px 20px",
          borderLeft: `3px solid ${t.red}`,
        }}>
          <div style={{ fontFamily: mono, fontSize: 10, color: "#fca5a5", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 6 }}>
            Actively Selling
          </div>
          <div style={{ fontFamily: mono, fontSize: 24, fontWeight: 700, color: "#fef2f2" }}>
            {fmtMoney(sellItems.reduce((s, a) => s + (a.quickSaleValue ?? 0), 0))}
          </div>
          <div style={{ fontFamily: mono, fontSize: 10, color: "#fca5a5", marginTop: 4 }}>
            {sellItems.length} item{sellItems.length !== 1 ? "s" : ""} marked sell
          </div>
        </div>
      )}
    </div>
  );
}

// ─── PRIORITY FILTER ──────────────────────────────────────────────────────────

function PriorityFilter({ active, onChange }) {
  const options = [
    { value: "all",   label: "All" },
    { value: "keep",  label: "Keep" },
    { value: "maybe", label: "Maybe" },
    { value: "sell",  label: "Sell" },
  ];
  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
      {options.map(o => {
        const isActive = active === o.value;
        const theme = o.value !== "all" ? t[o.value] : null;
        return (
          <button key={o.value} onClick={() => onChange(o.value)} style={{
            fontFamily: mono, fontSize: 10, fontWeight: 700,
            padding: "4px 10px", borderRadius: 4, cursor: "pointer",
            letterSpacing: "0.08em",
            background: isActive ? (theme?.bg ?? t.bg2) : t.bg0,
            border: `1px solid ${isActive ? (theme?.border ?? t.borderHi) : t.border}`,
            color: isActive ? (theme?.fg ?? t.bright) : t.muted,
            transition: "all 0.12s",
          }}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── MAIN EXPORT ──────────────────────────────────────────────────────────────

export default function Assets({ state, onUpdate }) {
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState("all");

  const assets = state.assets ?? [];

  const updateAssets = useCallback((newAssets) => {
    onUpdate({ ...state, assets: newAssets });
  }, [state, onUpdate]);

  const handleAdd    = (a) => { updateAssets([...assets, a]); setAdding(false); };
  const handleSave   = (a) => updateAssets(assets.map(x => x.id === a.id ? a : x));
  const handleDelete = (id) => updateAssets(assets.filter(x => x.id !== id));

  const filtered = filter === "all" ? assets : assets.filter(a => a.priority === filter);

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

      {/* Totals */}
      <TotalsHeader assets={assets} />

      {/* Section header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 10, flexWrap: "wrap", gap: 8,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 3, height: 16, borderRadius: 2, background: t.amber, flexShrink: 0 }} />
          <span style={{ fontFamily: mono, fontSize: 11, fontWeight: 700, color: t.subtle, letterSpacing: "0.18em", textTransform: "uppercase" }}>
            Assets ({assets.length})
          </span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <PriorityFilter active={filter} onChange={setFilter} />
          <button onClick={() => setAdding(true)} style={{
            fontFamily: mono, fontSize: 11, fontWeight: 700,
            background: t.amber, color: "#0f1421",
            border: `1px solid ${t.amber}`, borderRadius: 5,
            padding: "5px 12px", cursor: "pointer", letterSpacing: "0.06em",
          }}>+ Add Asset</button>
        </div>
      </div>

      {/* Explanation */}
      <p style={{ fontFamily: mono, fontSize: 11, color: t.muted, margin: "0 0 12px", lineHeight: 1.7 }}>
        Mark assets as <span style={{ color: t[`keep`].fg }}>keep</span>,{" "}
        <span style={{ color: t[`maybe`].fg }}>maybe</span>, or{" "}
        <span style={{ color: t[`sell`].fg }}>sell</span> to model what you could
        raise quickly to pay down debt. Quick Sale Value reflects what you'd realistically get in a fast sale.
      </p>

      {/* List */}
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {adding && <AddAssetRow onSave={handleAdd} onCancel={() => setAdding(false)} />}

        {filtered.length === 0 && !adding && (
          <div style={{
            padding: "28px 20px", textAlign: "center",
            border: `1px dashed ${t.border}`, borderRadius: 8,
            fontFamily: mono, fontSize: 12, color: t.muted, lineHeight: 1.8,
          }}>
            {assets.length === 0
              ? <>No assets yet.<br />Add vehicles, savings accounts, investments — anything with value.</>
              : <>No assets with priority "{filter}" — <button onClick={() => setFilter("all")} style={{ fontFamily: mono, fontSize: 12, color: t.amber, background: "none", border: "none", cursor: "pointer", padding: 0 }}>show all</button>.</>
            }
          </div>
        )}

        {filtered.map(asset => (
          <AssetRow
            key={asset.id}
            asset={asset}
            onSave={handleSave}
            onDelete={handleDelete}
          />
        ))}
      </div>
    </div>
  );
}
