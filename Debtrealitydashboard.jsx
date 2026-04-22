import { useState, useMemo } from "react";
import { calcAll, calcNetDebtChange } from "../calculations.js";

// ─── STYLE TOKENS ─────────────────────────────────────────────────────────────
const mono = "'IBM Plex Mono', 'Courier New', monospace";

const t = {
  bg0: "#080b10", bg1: "#0f1421", bg2: "#141926", bg3: "#1a2030",
  border: "#1e293b", borderHi: "#334155", borderAmber: "#92400e",
  muted: "#475569", subtle: "#64748b", body: "#94a3b8", bright: "#e2e8f0",
  amber: "#f59e0b", amberDim: "#78350f", amberFaint: "#f59e0b11",
  red: "#ef4444",   redDim: "#450a0a",   redFaint: "#ef444411",
  green: "#22c55e", greenDim: "#052e16", greenFaint: "#22c55e11",
  blue: "#60a5fa",  blueFaint: "#60a5fa11",
  teal: "#2dd4bf",
};

// ─── MATH HELPERS ─────────────────────────────────────────────────────────────

/**
 * Months to pay off a balance given APR and monthly payment.
 * Returns Infinity if payment can't cover interest, or 0 if balance ≤ 0.
 */
function payoffMonths(balance, apr, monthlyPayment) {
  if (balance <= 0) return 0;
  const rate = apr / 100 / 12;
  if (rate === 0) {
    return monthlyPayment > 0 ? Math.ceil(balance / monthlyPayment) : Infinity;
  }
  const interestPerMonth = balance * rate;
  if (monthlyPayment <= interestPerMonth) return Infinity;
  return Math.ceil(Math.log(monthlyPayment / (monthlyPayment - interestPerMonth)) / Math.log(1 + rate));
}

/**
 * Total interest paid over the life of a loan given months to payoff.
 */
function totalInterestPaid(balance, monthlyPayment, months) {
  if (!isFinite(months) || months <= 0) return Infinity;
  return Math.max(0, monthlyPayment * months - balance);
}

/**
 * Monthly interest accruing on a balance at given APR.
 */
function monthlyInterest(balance, apr) {
  return balance * (apr / 100 / 12);
}

function fmtMoney(n, opts = {}) {
  if (!isFinite(n)) return "—";
  const abs = Math.abs(n);
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: opts.cents ? 2 : 0,
    maximumFractionDigits: opts.cents ? 2 : 0,
  }).format(abs);
}

function fmtMonths(m) {
  if (!isFinite(m) || m <= 0) return null;
  if (m < 12) return `${Math.round(m)} month${m === 1 ? "" : "s"}`;
  const yrs = Math.floor(m / 12);
  const mos = Math.round(m % 12);
  return mos > 0 ? `${yrs}yr ${mos}mo` : `${yrs} year${yrs === 1 ? "" : "s"}`;
}

function fmtDir(direction) {
  return { increasing: "increasing ↑", flat: "roughly flat →", decreasing: "decreasing ↓" }[direction] ?? direction;
}

function dirColor(direction) {
  return { increasing: t.red, flat: t.amber, decreasing: t.green }[direction] ?? t.muted;
}

// ─── PRIMITIVES ───────────────────────────────────────────────────────────────

const inputStyle = {
  fontFamily: mono, fontSize: 13,
  background: t.bg0, border: `1px solid ${t.border}`,
  borderRadius: 6, color: t.bright,
  padding: "9px 12px", width: "100%", outline: "none",
  transition: "border-color 0.15s, box-shadow 0.15s",
};

const labelStyle = {
  fontFamily: mono, fontSize: 10, color: t.muted,
  letterSpacing: "0.13em", textTransform: "uppercase",
  display: "block", marginBottom: 5,
};

const hintStyle = {
  fontFamily: mono, fontSize: 10, color: t.muted,
  marginTop: 4, lineHeight: 1.5,
};

function Field({ label, hint, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <label style={labelStyle}>{label}</label>
      {children}
      {hint && <span style={hintStyle}>{hint}</span>}
    </div>
  );
}

function NumberInput({ value, onChange, placeholder = "0" }) {
  return (
    <input
      type="number"
      min={0}
      value={value === 0 ? "" : (value ?? "")}
      placeholder={placeholder}
      onChange={e => onChange(parseFloat(e.target.value) || 0)}
      style={inputStyle}
      onFocus={e => {
        e.target.style.borderColor = t.amber;
        e.target.style.boxShadow = `0 0 0 2px ${t.amber}22`;
      }}
      onBlur={e => {
        e.target.style.borderColor = t.border;
        e.target.style.boxShadow = "none";
      }}
    />
  );
}

function SelectInput({ value, onChange, options, placeholder }) {
  return (
    <select
      value={value ?? ""}
      onChange={e => onChange(e.target.value)}
      style={{ ...inputStyle, cursor: "pointer" }}
      onFocus={e => {
        e.target.style.borderColor = t.amber;
        e.target.style.boxShadow = `0 0 0 2px ${t.amber}22`;
      }}
      onBlur={e => {
        e.target.style.borderColor = t.border;
        e.target.style.boxShadow = "none";
      }}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

// ─── RESULT BLOCK ─────────────────────────────────────────────────────────────

/**
 * A single insight line with an icon, colored value, and plain-English label.
 */
function InsightLine({ icon, text, value, valueColor, sub }) {
  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: 10,
      padding: "10px 0",
      borderBottom: `1px solid ${t.border}`,
    }}>
      <span style={{ fontSize: 15, flexShrink: 0, lineHeight: 1.4, marginTop: 1 }}>{icon}</span>
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 6 }}>
          <span style={{
            fontFamily: mono, fontSize: 13,
            fontWeight: 700, color: valueColor ?? t.bright,
            whiteSpace: "nowrap",
          }}>{value}</span>
          <span style={{ fontFamily: mono, fontSize: 12, color: t.body, lineHeight: 1.5 }}>{text}</span>
        </div>
        {sub && (
          <div style={{ fontFamily: mono, fontSize: 11, color: t.subtle, marginTop: 3 }}>{sub}</div>
        )}
      </div>
    </div>
  );
}

/**
 * A grouped result section with a header and insight lines.
 */
function ResultSection({ title, accentColor, children, isEmpty }) {
  if (isEmpty) return null;
  return (
    <div style={{
      background: t.bg1,
      border: `1px solid ${t.border}`,
      borderLeft: `3px solid ${accentColor}`,
      borderRadius: 8,
      overflow: "hidden",
      animation: "fadeSlide 0.2s ease",
    }}>
      <div style={{
        padding: "10px 16px",
        background: accentColor + "0d",
        borderBottom: `1px solid ${t.border}`,
      }}>
        <span style={{
          fontFamily: mono, fontSize: 10, fontWeight: 700,
          color: accentColor, letterSpacing: "0.15em", textTransform: "uppercase",
        }}>{title}</span>
      </div>
      <div style={{ padding: "2px 16px 6px" }}>
        {children}
      </div>
    </div>
  );
}

// ─── INPUT PANEL ──────────────────────────────────────────────────────────────

function InputPanel({ inputs, setInputs, cards }) {
  const set = (k) => (v) => setInputs(prev => ({ ...prev, [k]: v }));

  const cardOptions = cards.map(c => ({
    value: c.id,
    label: `${c.name} — ${fmtMoney(c.balance)} @ ${c.apr}% APR`,
  }));

  return (
    <div style={{
      background: t.bg1,
      border: `1px solid ${t.borderAmber}`,
      borderRadius: 10,
      overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 18px",
        background: t.amberFaint,
        borderBottom: `1px solid ${t.border}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 14 }}>🧪</span>
          <span style={{
            fontFamily: mono, fontSize: 11, fontWeight: 700,
            color: t.amber, letterSpacing: "0.15em", textTransform: "uppercase",
          }}>
            Scenario Inputs
          </span>
        </div>
        <button
          onClick={() => setInputs(BLANK)}
          style={{
            fontFamily: mono, fontSize: 10, fontWeight: 700,
            background: t.bg2, border: `1px solid ${t.border}`,
            color: t.muted, borderRadius: 5,
            padding: "4px 10px", cursor: "pointer",
            letterSpacing: "0.08em", transition: "color 0.12s, border-color 0.12s",
          }}
          onMouseEnter={e => { e.currentTarget.style.color = t.bright; e.currentTarget.style.borderColor = t.borderHi; }}
          onMouseLeave={e => { e.currentTarget.style.color = t.muted; e.currentTarget.style.borderColor = t.border; }}
        >
          ↺ Reset
        </button>
      </div>

      {/* Fields */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
        gap: 16, padding: "18px",
      }}>
        {/* Target card — always first so other fields make context */}
        <div style={{ gridColumn: "1 / -1" }}>
          <Field
            label="Target Card (optional)"
            hint="Most scenarios apply to this card. Leave blank to use your highest-balance card."
          >
            <SelectInput
              value={inputs.cardId}
              onChange={set("cardId")}
              options={cardOptions}
              placeholder={cards.length === 0 ? "No cards added yet" : "— select a card —"}
            />
          </Field>
        </div>

        <Field label="Purchase Amount ($)" hint="What would this purchase add to the card?">
          <NumberInput value={inputs.purchaseAmount} onChange={set("purchaseAmount")} placeholder="e.g. 500" />
        </Field>

        <Field label="Lump Sum Payment ($)" hint="One-time extra payment toward the card.">
          <NumberInput value={inputs.lumpSum} onChange={set("lumpSum")} placeholder="e.g. 1000" />
        </Field>

        <Field label="Monthly Payment Increase ($)" hint="Extra you could pay every month going forward.">
          <NumberInput value={inputs.extraMonthly} onChange={set("extraMonthly")} placeholder="e.g. 100" />
        </Field>

        <Field label="Asset Sale Amount ($)" hint="Proceeds from selling something — applied to total debt.">
          <NumberInput value={inputs.assetSale} onChange={set("assetSale")} placeholder="e.g. 3000" />
        </Field>
      </div>
    </div>
  );
}

// ─── SCENARIO CALCULATIONS ────────────────────────────────────────────────────

function runScenario(inputs, state) {
  const { creditCards = [], loans = [] } = state;

  // Resolve target card
  let card = inputs.cardId
    ? creditCards.find(c => c.id === inputs.cardId)
    : [...creditCards].sort((a, b) => b.balance - a.balance)[0];

  const baseCalc  = calcAll(state);
  const baseDir   = calcNetDebtChange(creditCards);

  // ── Purchase impact ──────────────────────────────────────────────────────
  let purchase = null;
  if (inputs.purchaseAmount > 0 && card) {
    const apr = card.promoApr || card.apr;
    const newBalance = card.balance + inputs.purchaseAmount;
    const payment = card.monthlyPayment || card.minPayment || 0;

    const monthsBefore = payoffMonths(card.balance, apr, payment);
    const monthsAfter  = payoffMonths(newBalance, apr, payment);
    const intBefore    = totalInterestPaid(card.balance, payment, monthsBefore);
    const intAfter     = totalInterestPaid(newBalance, payment, monthsAfter);

    const extraInterest = isFinite(intAfter) && isFinite(intBefore) ? intAfter - intBefore : null;
    const extraMonths   = isFinite(monthsAfter) && isFinite(monthsBefore)
      ? Math.max(0, monthsAfter - monthsBefore) : null;

    purchase = { card, newBalance, extraInterest, extraMonths, apr };
  }

  // ── Lump sum impact ──────────────────────────────────────────────────────
  let lump = null;
  if (inputs.lumpSum > 0 && card) {
    const apr = card.promoApr || card.apr;
    const payment = card.monthlyPayment || card.minPayment || 0;
    const reducedBalance = Math.max(0, card.balance - inputs.lumpSum);

    const monthsBefore = payoffMonths(card.balance, apr, payment);
    const monthsAfter  = payoffMonths(reducedBalance, apr, payment);
    const intBefore    = totalInterestPaid(card.balance, payment, monthsBefore);
    const intAfter     = totalInterestPaid(reducedBalance, payment, monthsAfter);

    const savedInterest = isFinite(intBefore) && isFinite(intAfter) ? intBefore - intAfter : null;
    const savedMonths   = isFinite(monthsBefore) && isFinite(monthsAfter)
      ? Math.max(0, monthsBefore - monthsAfter) : null;

    lump = { card, reducedBalance, savedInterest, savedMonths, lumpApplied: Math.min(inputs.lumpSum, card.balance) };
  }

  // ── Extra monthly impact ──────────────────────────────────────────────────
  let extra = null;
  if (inputs.extraMonthly > 0 && card) {
    const apr = card.promoApr || card.apr;
    const basePay    = card.monthlyPayment || card.minPayment || 0;
    const newPay     = basePay + inputs.extraMonthly;

    const monthsBefore = payoffMonths(card.balance, apr, basePay);
    const monthsAfter  = payoffMonths(card.balance, apr, newPay);
    const intBefore    = totalInterestPaid(card.balance, basePay, monthsBefore);
    const intAfter     = totalInterestPaid(card.balance, newPay, monthsAfter);

    const savedInterest = isFinite(intBefore) && isFinite(intAfter) ? intBefore - intAfter : null;
    const savedMonths   = isFinite(monthsBefore) && isFinite(monthsAfter)
      ? Math.max(0, monthsBefore - monthsAfter) : null;

    extra = { card, newPay, savedInterest, savedMonths };
  }

  // ── Asset sale impact ────────────────────────────────────────────────────
  let asset = null;
  if (inputs.assetSale > 0) {
    const allBalances = [
      ...creditCards.map(c => c.balance),
      ...loans.map(l => l.balance),
    ];
    const totalDebt = allBalances.reduce((s, b) => s + b, 0);
    const newTotalDebt = Math.max(0, totalDebt - inputs.assetSale);

    // Monthly interest saved — proportionally reduce from highest interest first
    const baseMonthlyInterest = creditCards.reduce(
      (s, c) => s + monthlyInterest(c.balance, c.promoApr || c.apr), 0
    );

    // Apply sale to cards highest-APR first to estimate interest drop
    let remaining = inputs.assetSale;
    let newCardInterest = 0;
    const sortedCards = [...creditCards].sort((a, b) => (b.promoApr || b.apr) - (a.promoApr || a.apr));
    for (const c of sortedCards) {
      const apr = c.promoApr || c.apr;
      const applied = Math.min(remaining, c.balance);
      const newBal = c.balance - applied;
      newCardInterest += monthlyInterest(newBal, apr);
      remaining -= applied;
      if (remaining <= 0) break;
    }
    // Add back any cards not touched
    const touchedIds = new Set(sortedCards.map(c => c.id));
    for (const c of creditCards) {
      if (!touchedIds.has(c.id)) newCardInterest += monthlyInterest(c.balance, c.promoApr || c.apr);
    }

    const interestDropPerMonth = baseMonthlyInterest - newCardInterest;
    asset = { totalDebt, newTotalDebt, interestDropPerMonth };
  }

  // ── Combined net debt change ──────────────────────────────────────────────
  // Model a modified state with scenario adjustments applied
  const hasAny = inputs.purchaseAmount > 0 || inputs.lumpSum > 0
    || inputs.extraMonthly > 0 || inputs.assetSale > 0;

  let combined = null;
  if (hasAny && card) {
    // Build hypothetical credit cards
    let hypoCards = creditCards.map(c => ({ ...c }));
    const idx = hypoCards.findIndex(c => c.id === card.id);

    if (idx !== -1) {
      // Apply purchase
      if (inputs.purchaseAmount > 0) {
        hypoCards[idx] = {
          ...hypoCards[idx],
          balance: hypoCards[idx].balance + inputs.purchaseAmount,
          monthlySpend: hypoCards[idx].monthlySpend + inputs.purchaseAmount / 12,
        };
      }
      // Apply lump sum (one-time; doesn't change monthly payment — just reduces balance)
      if (inputs.lumpSum > 0) {
        hypoCards[idx] = {
          ...hypoCards[idx],
          balance: Math.max(0, hypoCards[idx].balance - inputs.lumpSum),
        };
      }
      // Apply extra monthly payment
      if (inputs.extraMonthly > 0) {
        hypoCards[idx] = {
          ...hypoCards[idx],
          monthlyPayment: (hypoCards[idx].monthlyPayment || 0) + inputs.extraMonthly,
        };
      }
    }

    // Apply asset sale proportionally across all cards
    if (inputs.assetSale > 0) {
      let rem = inputs.assetSale;
      hypoCards = hypoCards.map(c => {
        if (rem <= 0) return c;
        const applied = Math.min(rem, c.balance);
        rem -= applied;
        return { ...c, balance: c.balance - applied };
      });
    }

    const hypoDir = calcNetDebtChange(hypoCards);
    combined = {
      baseDirAmount: baseDir.amount,
      baseDirection: baseDir.direction,
      hypoAmount: hypoDir.amount,
      hypoDirection: hypoDir.direction,
      directionChanged: baseDir.direction !== hypoDir.direction,
    };
  }

  return { purchase, lump, extra, asset, combined, card, baseDir };
}

// ─── RESULTS PANEL ────────────────────────────────────────────────────────────

function ResultsPanel({ results, inputs }) {
  const { purchase, lump, extra, asset, combined, card, baseDir } = results;

  const hasAnyInput = inputs.purchaseAmount > 0 || inputs.lumpSum > 0
    || inputs.extraMonthly > 0 || inputs.assetSale > 0;

  if (!hasAnyInput) {
    return (
      <div style={{
        background: t.bg1, border: `1px solid ${t.border}`,
        borderRadius: 10, padding: "36px 24px", textAlign: "center",
      }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>🔭</div>
        <p style={{ fontFamily: mono, fontSize: 13, color: t.subtle, margin: 0, lineHeight: 1.7 }}>
          Enter a value above to model a scenario.<br />
          <span style={{ color: t.muted, fontSize: 11 }}>
            Your real data is untouched — these are hypothetical projections only.
          </span>
        </p>
      </div>
    );
  }

  const noCardWarning = hasAnyInput && !card && (inputs.purchaseAmount > 0 || inputs.lumpSum > 0 || inputs.extraMonthly > 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

      {/* No-card warning */}
      {noCardWarning && (
        <div style={{
          padding: "12px 16px",
          background: t.amberFaint,
          border: `1px solid ${t.borderAmber}`,
          borderRadius: 8,
          fontFamily: mono, fontSize: 12, color: t.amber,
        }}>
          ⚠ No credit cards found. Add a card first to model purchase and payment scenarios.
        </div>
      )}

      {/* Purchase */}
      <ResultSection
        title="If You Make This Purchase"
        accentColor={t.red}
        isEmpty={!purchase}
      >
        {purchase && <>
          <InsightLine
            icon="💳"
            value={fmtMoney(purchase.extraInterest)}
            valueColor={t.red}
            text={`in additional interest over the life of the card`}
            sub={`Balance grows from ${fmtMoney(purchase.card.balance)} to ${fmtMoney(purchase.newBalance)} at ${purchase.apr}% APR`}
          />
          <InsightLine
            icon="⏳"
            value={purchase.extraMonths != null ? `~${fmtMonths(purchase.extraMonths)} longer` : "—"}
            valueColor={t.red}
            text={`to pay off ${purchase.card.name}`}
            sub={purchase.extraMonths === 0 ? "Less than one additional month at current payment rate" : undefined}
          />
        </>}
      </ResultSection>

      {/* Lump sum */}
      <ResultSection
        title="If You Make a Lump Sum Payment"
        accentColor={t.green}
        isEmpty={!lump}
      >
        {lump && <>
          <InsightLine
            icon="📉"
            value={`−${fmtMoney(lump.lumpApplied)}`}
            valueColor={t.green}
            text={`off your ${lump.card.name} balance`}
            sub={`Balance drops from ${fmtMoney(lump.card.balance)} to ${fmtMoney(lump.reducedBalance)}`}
          />
          {lump.savedInterest != null && (
            <InsightLine
              icon="💰"
              value={`~${fmtMoney(lump.savedInterest)} saved`}
              valueColor={t.green}
              text={`in interest you'll never pay`}
            />
          )}
          {lump.savedMonths != null && lump.savedMonths > 0 && (
            <InsightLine
              icon="📅"
              value={`~${fmtMonths(lump.savedMonths)} sooner`}
              valueColor={t.green}
              text={`payoff at your current monthly payment`}
            />
          )}
          {lump.savedMonths === 0 && (
            <InsightLine
              icon="📅"
              value="Less than 1 month"
              valueColor={t.amber}
              text="difference in payoff timeline — payment amount is the bigger lever here"
            />
          )}
        </>}
      </ResultSection>

      {/* Extra monthly */}
      <ResultSection
        title="If You Increase Monthly Payments"
        accentColor={t.teal}
        isEmpty={!extra}
      >
        {extra && <>
          <InsightLine
            icon="📆"
            value={extra.savedMonths != null ? `~${fmtMonths(extra.savedMonths)} sooner` : "—"}
            valueColor={t.teal}
            text={`payoff on ${extra.card.name} by paying ${fmtMoney(extra.newPay)}/mo instead`}
          />
          {extra.savedInterest != null && (
            <InsightLine
              icon="💰"
              value={`~${fmtMoney(extra.savedInterest)} saved`}
              valueColor={t.teal}
              text="in interest over the life of the card"
            />
          )}
        </>}
      </ResultSection>

      {/* Asset sale */}
      <ResultSection
        title="If You Apply Asset Sale Proceeds"
        accentColor={t.blue}
        isEmpty={!asset}
      >
        {asset && <>
          <InsightLine
            icon="🏷️"
            value={`${fmtMoney(asset.totalDebt)} → ${fmtMoney(asset.newTotalDebt)}`}
            valueColor={t.blue}
            text="total debt after applying proceeds"
          />
          {asset.interestDropPerMonth > 0 && (
            <InsightLine
              icon="📉"
              value={`−${fmtMoney(asset.interestDropPerMonth, { cents: true })}/mo`}
              valueColor={t.blue}
              text="less in monthly interest charges"
              sub="Applied to highest-APR cards first"
            />
          )}
        </>}
      </ResultSection>

      {/* Combined summary */}
      {combined && (
        <div style={{
          background: combined.directionChanged
            ? (combined.hypoDirection === "decreasing" ? t.greenFaint : t.redFaint)
            : t.bg1,
          border: `1px solid ${combined.directionChanged
            ? (combined.hypoDirection === "decreasing" ? t.green + "44" : t.red + "44")
            : t.border}`,
          borderRadius: 10,
          padding: "16px 18px",
          animation: "fadeSlide 0.2s ease",
        }}>
          <div style={{
            fontFamily: mono, fontSize: 10, fontWeight: 700,
            color: t.amber, letterSpacing: "0.15em", textTransform: "uppercase",
            marginBottom: 12,
          }}>
            Combined Net Effect
          </div>

          {/* Direction comparison */}
          <div style={{
            display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
            marginBottom: 10,
          }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontFamily: mono, fontSize: 10, color: t.muted, marginBottom: 4 }}>TODAY</div>
              <div style={{
                fontFamily: mono, fontSize: 14, fontWeight: 700,
                color: dirColor(combined.baseDirection),
                padding: "6px 12px", borderRadius: 6,
                background: dirColor(combined.baseDirection) + "1a",
                border: `1px solid ${dirColor(combined.baseDirection)}33`,
              }}>
                {fmtDir(combined.baseDirection)}
              </div>
              <div style={{ fontFamily: mono, fontSize: 11, color: t.subtle, marginTop: 3 }}>
                {fmtMoney(combined.baseDirAmount)}/mo
              </div>
            </div>

            <div style={{ fontFamily: mono, fontSize: 20, color: t.muted }}>→</div>

            <div style={{ textAlign: "center" }}>
              <div style={{ fontFamily: mono, fontSize: 10, color: t.muted, marginBottom: 4 }}>WITH SCENARIO</div>
              <div style={{
                fontFamily: mono, fontSize: 14, fontWeight: 700,
                color: dirColor(combined.hypoDirection),
                padding: "6px 12px", borderRadius: 6,
                background: dirColor(combined.hypoDirection) + "1a",
                border: `1px solid ${dirColor(combined.hypoDirection)}33`,
              }}>
                {fmtDir(combined.hypoDirection)}
              </div>
              <div style={{ fontFamily: mono, fontSize: 11, color: t.subtle, marginTop: 3 }}>
                {fmtMoney(combined.hypoAmount)}/mo
              </div>
            </div>
          </div>

          {/* Direction change callout */}
          {combined.directionChanged && (
            <div style={{
              fontFamily: mono, fontSize: 12,
              color: combined.hypoDirection === "decreasing" ? t.green : t.red,
              padding: "10px 12px",
              background: combined.hypoDirection === "decreasing" ? t.greenDim : t.redDim,
              borderRadius: 6, lineHeight: 1.6,
              border: `1px solid ${combined.hypoDirection === "decreasing" ? t.green : t.red}33`,
            }}>
              {combined.hypoDirection === "decreasing"
                ? `✓ This scenario would flip your debt from growing to shrinking each month.`
                : `⚠ This scenario would flip your debt from shrinking to growing each month.`}
            </div>
          )}

          {!combined.directionChanged && (
            <div style={{
              fontFamily: mono, fontSize: 11, color: t.subtle, lineHeight: 1.6,
            }}>
              Direction unchanged — debt would remain{" "}
              <span style={{ color: dirColor(combined.hypoDirection) }}>{fmtDir(combined.hypoDirection)}</span>.
              {" "}The monthly amount {combined.hypoAmount < combined.baseDirAmount ? "decreases" : "increases"} by{" "}
              <span style={{ color: t.bright }}>{fmtMoney(Math.abs(combined.hypoAmount - combined.baseDirAmount))}</span>.
            </div>
          )}
        </div>
      )}

      {/* Disclaimer */}
      <p style={{
        fontFamily: mono, fontSize: 10, color: t.muted,
        margin: "4px 0 0", lineHeight: 1.7,
        borderTop: `1px solid ${t.border}`, paddingTop: 12,
      }}>
        These are estimates based on simplified payoff formulas. Actual results depend on your exact payment timing, minimum payment changes, and any fees not tracked here. Nothing on this screen changes your saved data.
      </p>
    </div>
  );
}

// ─── BLANK STATE ──────────────────────────────────────────────────────────────

const BLANK = {
  cardId: "",
  purchaseAmount: 0,
  lumpSum: 0,
  extraMonthly: 0,
  assetSale: 0,
};

// ─── MAIN EXPORT ──────────────────────────────────────────────────────────────

export default function Scenarios({ state }) {
  const [inputs, setInputs] = useState(BLANK);

  const cards = state.creditCards ?? [];
  const hasCards = cards.length > 0;

  // Auto-select highest-balance card if none selected
  const effectiveInputs = useMemo(() => {
    if (inputs.cardId || cards.length === 0) return inputs;
    const topCard = [...cards].sort((a, b) => b.balance - a.balance)[0];
    return { ...inputs, cardId: topCard?.id ?? "" };
  }, [inputs, cards]);

  const results = useMemo(
    () => runScenario(effectiveInputs, state),
    [effectiveInputs, state]
  );

  return (
    <div style={{
      display: "flex", flexDirection: "column", gap: 16,
      maxWidth: 860, margin: "0 auto", padding: "0 0 48px",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;700&display=swap');
        @keyframes fadeSlide {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        input[type=number]::-webkit-inner-spin-button { opacity: 0.3; }
        select option { background: #0f1421; color: #e2e8f0; }
      `}</style>

      {/* Page intro */}
      <div style={{ marginBottom: 4 }}>
        <h2 style={{
          fontFamily: mono, fontSize: 13, fontWeight: 700,
          color: t.bright, margin: "0 0 4px",
          letterSpacing: "0.04em",
        }}>
          What-If Scenarios
        </h2>
        <p style={{ fontFamily: mono, fontSize: 11, color: t.muted, margin: 0, lineHeight: 1.7 }}>
          Model decisions before making them. None of this changes your saved data.
        </p>
      </div>

      {/* No cards warning (non-blocking) */}
      {!hasCards && (
        <div style={{
          padding: "11px 16px",
          background: t.amberFaint,
          border: `1px solid ${t.borderAmber}`,
          borderRadius: 8,
          fontFamily: mono, fontSize: 12, color: t.amber, lineHeight: 1.6,
        }}>
          Add at least one credit card in the Debts tab to unlock card-specific scenarios.
          Asset sale scenarios still work without cards.
        </div>
      )}

      {/* Two-column layout on wider screens */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr",
        gap: 16,
      }}>
        <style>{`
          @media (min-width: 720px) {
            .scenarios-grid { grid-template-columns: 1fr 1fr !important; align-items: start; }
          }
        `}</style>
        <div className="scenarios-grid" style={{
          display: "grid",
          gridTemplateColumns: "1fr",
          gap: 16,
          alignItems: "start",
        }}>
          <InputPanel inputs={inputs} setInputs={setInputs} cards={cards} />
          <ResultsPanel results={results} inputs={effectiveInputs} />
        </div>
      </div>
    </div>
  );
}
