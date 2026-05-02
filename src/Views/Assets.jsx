import { useState, useCallback, useMemo } from "react";

// ─── S ───────────────────────
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

// ─── S ───────────────────────

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

// ─── E ───────────────────────

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

// ─── S ───────────────────────

const ASSET_CATEGORIES = [
  "Vehicle", "Real Estate", "Investment Account", "Savings",
  "Electronics", "Jewelry", "Collectibles", "Furniture",
  "Art", "Business", "Other",
];

// ─── S ───────────────────────

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

// ─── W ───────────────────────

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

// ─── R ───────────────────────

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

// ─── R ───────────────────────

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

// ─── T ───────────────────────


// ─── CSV IMPORT ENGINE ────────────────────────────────────────────────────────

// Column name aliases ─ maps common user column names to our field names
const COL_ALIASES = {
    name:           ["name", "asset", "item", "description", "asset name", "item name", "title"],
    category:       ["category", "type", "asset type", "asset category", "kind", "class"],
    estimatedValue: ["estimated value", "value", "estimated", "market value", "appraisal",
                     "worth", "est value", "est. value", "retail value", "fmv", "fair market value"],
    quickSaleValue: ["quick sale value", "quick sale", "sale value", "liquidation value",
                     "quick value", "sell value", "resale", "resale value", "quick"],
    priority:       ["priority", "sell?", "sell", "disposition", "status", "action"],
};

function normalizeHeader(h) {
    return (h ?? "").toString().toLowerCase().replace(/[$(),]/g, "").trim();
}

function matchColumn(header) {
    const norm = normalizeHeader(header);
    for (const [field, aliases] of Object.entries(COL_ALIASES)) {
        if (aliases.some(a => norm === a || norm.includes(a))) return field;
    }
    return null;
}

function parsePriority(val) {
    const v = (val ?? "").toString().toLowerCase().trim();
    if (["sell", "yes", "y", "1", "true", "selling"].includes(v)) return "sell";
    if (["maybe", "possibly", "consider", "2", "perhaps"].includes(v)) return "maybe";
    return "keep";
}

function parseCSV(text) {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) throw new Error("CSV must have a header row and at least one data row.");

    // Parse header
    const headers = lines[0].split(",").map(h => h.replace(/^"|"$/g, "").trim());
    const colMap = {}; // field -> column index
    headers.forEach((h, i) => {
        const field = matchColumn(h);
        if (field && !(field in colMap)) colMap[field] = i;
    });

    if (!colMap.name) throw new Error("Could not find a 'Name' column. Make sure one column is named 'Name' or 'Asset'.");

    // Parse rows
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // Handle quoted fields with commas inside
        const cells = [];
        let inQuote = false, cell = "";
        for (const ch of line + ",") {
            if (ch === '"') { inQuote = !inQuote; continue; }
            if (ch === "," && !inQuote) { cells.push(cell.trim()); cell = ""; continue; }
            cell += ch;
        }

        const name = cells[colMap.name]?.replace(/^"|"$/g,"").trim();
        if (!name) continue;

        const estRaw  = colMap.estimatedValue !== undefined ? cells[colMap.estimatedValue] : "";
        const qsvRaw  = colMap.quickSaleValue  !== undefined ? cells[colMap.quickSaleValue]  : "";
        const catRaw  = colMap.category        !== undefined ? cells[colMap.category]        : "";
        const priRaw  = colMap.priority        !== undefined ? cells[colMap.priority]        : "";

        const estimatedValue = parseFloat((estRaw ?? "").replace(/[$,]/g,"")) || 0;
        const quickSaleValue = parseFloat((qsvRaw ?? "").replace(/[$,]/g,"")) || estimatedValue * 0.7;
        const category       = catRaw?.trim() || "Other";
        const priority       = parsePriority(priRaw);

        rows.push({ id: uid(), name, category, estimatedValue, quickSaleValue, priority });
    }

    if (!rows.length) throw new Error("No valid rows found in CSV.");
    return { rows, colMap, headers };
}

// Template CSV content
const CSV_TEMPLATE = `Name,Category,Estimated Value,Quick Sale Value,Priority
2021 Honda Civic,Vehicle,18000,15000,keep
Living Room Furniture,Furniture,3500,1200,maybe
Gold Jewelry,Jewelry,2800,2000,sell
Investment Account,Investment Account,12000,12000,keep
`;

function downloadTemplate() {
    const blob = new Blob([CSV_TEMPLATE], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "assets-template.csv";
    a.click();
    URL.revokeObjectURL(url);
}

// ─── CSV IMPORT UI ────────────────────────────────────────────────────────────

function CsvImport({ onImport }) {
    const [stage, setStage] = useState("idle"); // idle | preview | error
    const [preview, setPreview] = useState(null); // { rows, colMap, headers }
    const [error, setError] = useState("");
    const [mode, setMode] = useState("merge"); // merge | replace

    function handleFile(e) {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const result = parseCSV(ev.target.result);
                setPreview(result);
                setStage("preview");
                setError("");
            } catch (err) {
                setError(err.message);
                setStage("error");
            }
        };
        reader.readAsText(file);
        e.target.value = "";
    }

    function handleConfirm() {
        if (!preview?.rows) return;
        onImport(preview.rows, mode);
        setStage("idle");
        setPreview(null);
    }

    function handleCancel() {
        setStage("idle");
        setPreview(null);
        setError("");
    }

    const is = {
        background: t.bg0, border: `1px solid ${t.border}`,
        borderRadius: 5, color: t.bright,
        padding: "5px 10px", fontFamily: mono, fontSize: 11, outline: "none",
    };

    if (stage === "idle") {
        return (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <label style={{ display: "block" }}>
                    <input type="file" accept=".csv,.txt" onChange={handleFile} style={{ display: "none" }} />
                    <span style={{
                        display: "inline-flex", alignItems: "center", gap: 5,
                        fontFamily: mono, fontSize: 11, fontWeight: 700,
                        background: t.bg2, color: t.body,
                        border: `1px solid ${t.border}`, borderRadius: 5,
                        padding: "5px 12px", cursor: "pointer", letterSpacing: "0.06em",
                        userSelect: "none",
                    }}>
                        ↑ Import CSV
                    </span>
                </label>
                <button onClick={downloadTemplate} style={{
                    fontFamily: mono, fontSize: 11, color: t.muted,
                    background: "transparent", border: "none", cursor: "pointer",
                    padding: 0, textDecoration: "underline", letterSpacing: "0.04em",
                }}>
                    Download template
                </button>
            </div>
        );
    }

    if (stage === "error") {
        return (
            <div style={{ border: `1px solid #7f1d1d`, background: "#1c0707", borderRadius: 8, padding: "12px 16px" }}>
                <div style={{ fontFamily: mono, fontSize: 11, fontWeight: 700, color: "#ef4444", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    CSV Import Error
                </div>
                <div style={{ fontFamily: mono, fontSize: 12, color: "#fca5a5", marginBottom: 10, lineHeight: 1.6 }}>{error}</div>
                <div style={{ fontFamily: mono, fontSize: 11, color: "#f87171", marginBottom: 10, lineHeight: 1.7 }}>
                    Expected columns: Name, Category, Estimated Value, Quick Sale Value, Priority.
                    Download the template for the exact format.
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                    <label>
                        <input type="file" accept=".csv,.txt" onChange={handleFile} style={{ display: "none" }} />
                        <span style={{ fontFamily: mono, fontSize: 11, fontWeight: 700, background: t.bg2, color: t.body, border: `1px solid ${t.border}`, borderRadius: 5, padding: "5px 12px", cursor: "pointer" }}>
                            Try another file
                        </span>
                    </label>
                    <button onClick={downloadTemplate} style={{ fontFamily: mono, fontSize: 11, color: t.muted, background: "transparent", border: "none", cursor: "pointer", textDecoration: "underline" }}>
                        Download template
                    </button>
                    <button onClick={handleCancel} style={{ fontFamily: mono, fontSize: 11, color: t.subtle, background: "transparent", border: "none", cursor: "pointer" }}>
                        Cancel
                    </button>
                </div>
            </div>
        );
    }

    // Preview stage
    return (
        <div style={{ border: `1px solid #166534`, background: "#052e16", borderRadius: 8, padding: "14px 16px" }}>
            <div style={{ fontFamily: mono, fontSize: 11, fontWeight: 700, color: "#22c55e", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                Preview — {preview.rows.length} asset{preview.rows.length !== 1 ? "s" : ""} found
            </div>

            {/* Column mapping summary */}
            <div style={{ fontFamily: mono, fontSize: 11, color: "#4ade80", marginBottom: 10, lineHeight: 1.7 }}>
                Detected columns: {Object.entries(preview.colMap).map(([f,i]) =>
                    `${preview.headers[i]} → ${f}`).join(" · ")}
            </div>

            {/* First 5 rows preview */}
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 }}>
                {preview.rows.slice(0, 5).map((r, i) => (
                    <div key={i} style={{ display: "flex", gap: 12, padding: "6px 10px", background: "#071c0e", borderRadius: 5, alignItems: "center", flexWrap: "wrap" }}>
                        <span style={{ fontFamily: mono, fontSize: 12, color: "#e2e8f0", minWidth: 140 }}>{r.name}</span>
                        <span style={{ fontFamily: mono, fontSize: 11, color: "#86efac" }}>{r.category}</span>
                        <span style={{ fontFamily: mono, fontSize: 11, color: "#4ade80", marginLeft: "auto" }}>{fmtMoney(r.estimatedValue)}</span>
                        <span style={{ fontFamily: mono, fontSize: 10, color:
                            r.priority === "sell" ? "#f87171" : r.priority === "maybe" ? "#fcd34d" : "#86efac",
                            background: r.priority === "sell" ? "#450a0a" : r.priority === "maybe" ? "#78350f44" : "#052e16",
                            padding: "2px 6px", borderRadius: 3, border: "none",
                        }}>{r.priority}</span>
                    </div>
                ))}
                {preview.rows.length > 5 && (
                    <div style={{ fontFamily: mono, fontSize: 11, color: "#4ade80", paddingLeft: 10 }}>
                        + {preview.rows.length - 5} more...
                    </div>
                )}
            </div>

            {/* Merge vs replace */}
            <div style={{ display: "flex", gap: 12, marginBottom: 14, alignItems: "center" }}>
                <span style={{ fontFamily: mono, fontSize: 11, color: "#86efac" }}>Import mode:</span>
                {[
                    { v: "merge",   label: "Add to existing" },
                    { v: "replace", label: "Replace all assets" },
                ].map(opt => (
                    <label key={opt.v} style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
                        <input type="radio" name="csvMode" value={opt.v} checked={mode === opt.v}
                            onChange={() => setMode(opt.v)} />
                        <span style={{ fontFamily: mono, fontSize: 11, color: mode === opt.v ? "#e2e8f0" : "#86efac" }}>
                            {opt.label}
                        </span>
                    </label>
                ))}
            </div>

            <div style={{ display: "flex", gap: 8 }}>
                <button onClick={handleConfirm} style={{
                    fontFamily: mono, fontSize: 11, fontWeight: 700,
                    background: "#166534", color: "#dcfce7",
                    border: "1px solid #166534", borderRadius: 5,
                    padding: "6px 16px", cursor: "pointer", letterSpacing: "0.06em",
                }}>
                    ✓ Import {preview.rows.length} asset{preview.rows.length !== 1 ? "s" : ""}
                </button>
                <button onClick={handleCancel} style={{
                    fontFamily: mono, fontSize: 11, color: "#4ade80",
                    background: "transparent", border: "none", cursor: "pointer",
                }}>
                    Cancel
                </button>
            </div>
        </div>
    );
}

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
  const handleCsvImport = (rows, mode) => {
      updateAssets(mode === "replace" ? rows : [...assets, ...rows]);
  };

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
          <CsvImport onImport={handleCsvImport} />
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
