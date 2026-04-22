import { useMemo } from "react";
import { calcAll } from "../calculations.js";

// ─── STYLE TOKENS ─────────────────────────────────────────────────────────────
const mono = "'IBM Plex Mono', 'Courier New', monospace";
const display = "'Georgia', 'Times New Roman', serif";

const t = {
  bg0: "#080b10", bg1: "#0f1421", bg2: "#141926",
  border: "#1e293b",
  muted: "#475569", subtle: "#64748b", body: "#94a3b8", bright: "#e2e8f0",
  amber: "#f59e0b",
  red: "#ef4444",   redDim: "#450a0a",   redFaint: "#ef444411",
  green: "#22c55e", greenDim: "#052e16", greenFaint: "#22c55e11",
  flatDim: "#78350f", flatFaint: "#f59e0b11",
};

function fmtMoney(n) {
  if (!isFinite(n ?? Infinity)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(Math.abs(n ?? 0));
}

// ─── BIG NUMBER CARD ──────────────────────────────────────────────────────────

function BigStat({ label, value, valueColor, sub, icon }) {
  return (
    <div style={{
      background: t.bg1,
      border: `1px solid ${t.border}`,
      borderRadius: 12,
      padding: "24px 28px",
      display: "flex",
      flexDirection: "column",
      gap: 8,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {icon && <span style={{ fontSize: 20 }}>{icon}</span>}
        <span style={{
          fontFamily: mono, fontSize: 11, color: t.subtle,
          letterSpacing: "0.14em", textTransform: "uppercase",
        }}>{label}</span>
      </div>
      <div style={{
        fontFamily: display,
        fontSize: "clamp(28px, 7vw, 44px)",
        fontWeight: 700,
        color: valueColor ?? t.bright,
        lineHeight: 1.1,
        letterSpacing: "-0.01em",
      }}>{value}</div>
      {sub && (
        <div style={{
          fontFamily: mono, fontSize: 12, color: t.muted, lineHeight: 1.6,
        }}>{sub}</div>
      )}
    </div>
  );
}

// ─── DIRECTION BANNER ─────────────────────────────────────────────────────────

const BANNER = {
  increasing: {
    bg: "linear-gradient(135deg, #450a0a 0%, #7f1d1d 60%, #450a0a 100%)",
    border: "#ef4444",
    glow: "#ef444433",
    color: "#fef2f2",
    subColor: "#fca5a5",
    pulse: "#ef444466",
  },
  flat: {
    bg: "linear-gradient(135deg, #422006 0%, #78350f 60%, #422006 100%)",
    border: "#f59e0b",
    glow: "#f59e0b33",
    color: "#fefce8",
    subColor: "#fcd34d",
    pulse: "#f59e0b66",
  },
  decreasing: {
    bg: "linear-gradient(135deg, #052e16 0%, #14532d 60%, #052e16 100%)",
    border: "#22c55e",
    glow: "#22c55e33",
    color: "#f0fdf4",
    subColor: "#86efac",
    pulse: "#22c55e66",
  },
};

function DirectionBanner({ direction, amount, cardSpend, cardPayments }) {
  const theme = BANNER[direction] ?? BANNER.flat;

  const headline = {
    increasing: `You're adding ${fmtMoney(amount)} to debt each month`,
    flat: `Your debt is holding roughly steady`,
    decreasing: `You're reducing debt by ${fmtMoney(Math.abs(amount))} each month`,
  }[direction];

  const spendVsPay = (cardSpend > 0 || cardPayments > 0)
    ? `Putting ${fmtMoney(cardSpend)} on cards, paying back ${fmtMoney(cardPayments)}`
    : null;

  return (
    <div style={{
      position: "relative",
      overflow: "hidden",
      background: theme.bg,
      border: `1px solid ${theme.border}`,
      borderRadius: 16,
      padding: "clamp(24px, 5vw, 40px) clamp(20px, 5vw, 36px)",
      boxShadow: `0 0 60px ${theme.glow}`,
    }}>
      {/* Corner glow */}
      <div style={{
        position: "absolute", top: 0, right: 0, width: 160, height: 160,
        background: `radial-gradient(circle at top right, ${theme.pulse} 0%, transparent 70%)`,
        pointerEvents: "none",
      }} />
      {/* Scan lines */}
      <div style={{
        position: "absolute", inset: 0,
        backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.06) 3px, rgba(0,0,0,0.06) 4px)",
        pointerEvents: "none",
      }} />

      <div style={{ position: "relative" }}>
        {/* Live indicator */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <div style={{
            width: 7, height: 7, borderRadius: "50%",
            background: theme.border,
            boxShadow: `0 0 8px ${theme.border}`,
            animation: "pvPulse 2s ease-in-out infinite",
          }} />
          <span style={{
            fontFamily: mono, fontSize: 11, color: theme.subColor,
            letterSpacing: "0.18em", textTransform: "uppercase",
          }}>RIGHT NOW</span>
        </div>

        {/* Main message */}
        <div style={{
          fontFamily: display,
          fontSize: "clamp(22px, 5vw, 38px)",
          fontWeight: 700,
          color: theme.color,
          lineHeight: 1.25,
          marginBottom: spendVsPay ? 16 : 0,
        }}>
          {headline}
        </div>

        {/* Secondary callout - spend vs pay */}
        {spendVsPay && (
          <div style={{
            fontFamily: mono,
            fontSize: "clamp(14px, 3vw, 18px)",
            color: theme.subColor,
            marginTop: 8,
            fontWeight: 700,
            letterSpacing: "0.01em",
          }}>
            {spendVsPay}
          </div>
        )}
      </div>

      <style>{`
        @keyframes pvPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.75); }
        }
      `}</style>
    </div>
  );
}

// ─── IMPROVEMENT TIP ──────────────────────────────────────────────────────────

function ImprovementTip({ direction, netAmount, cardSpend }) {
  const isIncreasing = direction === "increasing";
  const halfAmount = Math.round(Math.abs(netAmount) / 2 / 50) * 50; // round to nearest $50

  const tipText = isIncreasing
    ? `Reducing card spending by ${fmtMoney(Math.max(halfAmount, 50))}/month would cut the increase roughly in half.`
    : `You're on the right track. Staying consistent matters more than any single big move.`;

  const icon  = isIncreasing ? "💡" : "✓";
  const color = isIncreasing ? t.amber : t.green;
  const bg    = isIncreasing ? "#f59e0b0d" : "#22c55e0d";
  const brd   = isIncreasing ? "#92400e" : "#166534";

  return (
    <div style={{
      background: bg,
      border: `1px solid ${brd}`,
      borderRadius: 12,
      padding: "20px 24px",
      display: "flex",
      alignItems: "flex-start",
      gap: 14,
    }}>
      <span style={{ fontSize: 22, flexShrink: 0, marginTop: 2 }}>{icon}</span>
      <div>
        <div style={{
          fontFamily: mono, fontSize: 10, color,
          letterSpacing: "0.15em", textTransform: "uppercase",
          marginBottom: 6,
        }}>
          {isIncreasing ? "ONE THING THAT WOULD HELP" : "KEEP GOING"}
        </div>
        <div style={{
          fontFamily: display,
          fontSize: "clamp(15px, 3vw, 19px)",
          color: t.bright,
          lineHeight: 1.5,
        }}>
          {tipText}
        </div>
      </div>
    </div>
  );
}

// ─── BREATHING ROOM VISUAL ────────────────────────────────────────────────────

function BreathingRoomGauge({ cashFlow, monthlyIncome }) {
  const pct = monthlyIncome > 0 ? Math.max(0, Math.min(100, (cashFlow / monthlyIncome) * 100)) : 0;
  const isNegative = cashFlow < 0;
  const color = isNegative ? t.red : cashFlow < 300 ? t.amber : t.green;
  const label = isNegative
    ? "Things are tight — spending exceeds income"
    : cashFlow < 300
    ? "Not much buffer — watch discretionary spending"
    : "Good breathing room";

  return (
    <div style={{
      background: t.bg1, border: `1px solid ${t.border}`,
      borderRadius: 12, padding: "24px 28px",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 18 }}>🌬️</span>
        <span style={{
          fontFamily: mono, fontSize: 11, color: t.subtle,
          letterSpacing: "0.14em", textTransform: "uppercase",
        }}>Monthly Breathing Room</span>
      </div>

      <div style={{
        fontFamily: display,
        fontSize: "clamp(28px, 7vw, 44px)",
        fontWeight: 700, color,
        lineHeight: 1.1, marginBottom: 12,
      }}>
        {isNegative ? `−${fmtMoney(Math.abs(cashFlow))}` : fmtMoney(cashFlow)}
      </div>

      {/* Gauge bar */}
      {monthlyIncome > 0 && !isNegative && (
        <div style={{ marginBottom: 10 }}>
          <div style={{
            height: 8, borderRadius: 4,
            background: t.bg2, overflow: "hidden",
          }}>
            <div style={{
              height: "100%", width: `${pct}%`,
              background: color,
              borderRadius: 4,
              transition: "width 0.6s cubic-bezier(0.4,0,0.2,1)",
              boxShadow: `0 0 8px ${color}66`,
            }} />
          </div>
          <div style={{
            fontFamily: mono, fontSize: 10, color: t.muted,
            marginTop: 4,
          }}>
            {pct.toFixed(0)}% of monthly income left over
          </div>
        </div>
      )}

      <div style={{ fontFamily: mono, fontSize: 12, color: t.muted, lineHeight: 1.6 }}>
        {label}
      </div>
    </div>
  );
}

// ─── EMPTY STATE ──────────────────────────────────────────────────────────────

function EmptyPartnerView() {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", minHeight: 400, gap: 20, textAlign: "center",
      padding: "48px 24px",
    }}>
      <span style={{ fontSize: 48 }}>🏠</span>
      <div>
        <p style={{
          fontFamily: display, fontSize: 22, color: t.bright,
          margin: "0 0 8px", fontWeight: 700,
        }}>Nothing to show yet</p>
        <p style={{
          fontFamily: mono, fontSize: 12, color: t.muted,
          maxWidth: 320, lineHeight: 1.8, margin: 0,
        }}>
          Add your income and debts using the other tabs,
          then come back here for a plain-English summary you can both look at together.
        </p>
      </div>
    </div>
  );
}

// ─── MAIN EXPORT ──────────────────────────────────────────────────────────────

export default function PartnerView({ state }) {
  const calc = useMemo(() => calcAll(state), [state]);

  const hasData =
    (state.incomes?.length ?? 0) > 0 ||
    (state.creditCards?.length ?? 0) > 0 ||
    (state.loans?.length ?? 0) > 0;

  if (!hasData) return <EmptyPartnerView />;

  const {
    monthlyIncome,
    totalDebt,
    cashFlow,
    netDebtChange,
    totalCardSpend,
    totalCardPayments,
  } = calc;

  const { direction, amount } = netDebtChange;

  return (
    <div style={{
      display: "flex", flexDirection: "column",
      gap: 16,
      maxWidth: 720, margin: "0 auto",
      padding: "0 0 60px",
      animation: "pvFadeIn 0.3s ease",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;700&display=swap');
        @keyframes pvFadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        /* Responsive two-column stat grid */
        .pv-stats {
          display: grid;
          grid-template-columns: 1fr;
          gap: 12px;
        }
        @media (min-width: 540px) {
          .pv-stats { grid-template-columns: 1fr 1fr; }
        }
      `}</style>

      {/* Context label */}
      <div style={{
        fontFamily: mono, fontSize: 10, color: t.muted,
        letterSpacing: "0.16em", textTransform: "uppercase",
        marginBottom: 4,
      }}>
        Household Summary · Partner View
      </div>

      {/* ── PRIMARY BANNER ──────────────────────────────── */}
      <DirectionBanner
        direction={direction}
        amount={amount}
        cardSpend={totalCardSpend}
        cardPayments={totalCardPayments}
      />

      {/* ── KEY NUMBERS ─────────────────────────────────── */}
      <div className="pv-stats">
        <BigStat
          label="Money coming in"
          value={fmtMoney(monthlyIncome)}
          valueColor={t.green}
          sub="Combined household income each month"
          icon="💵"
        />
        <BigStat
          label="Total debt owed"
          value={fmtMoney(totalDebt)}
          valueColor={t.red}
          sub="All cards and loans combined"
          icon="📋"
        />
      </div>

      {/* ── BREATHING ROOM ──────────────────────────────── */}
      <BreathingRoomGauge cashFlow={cashFlow} monthlyIncome={monthlyIncome} />

      {/* ── IMPROVEMENT TIP ─────────────────────────────── */}
      <ImprovementTip
        direction={direction}
        netAmount={amount}
        cardSpend={totalCardSpend}
      />

      {/* ── FOOTER NOTE ─────────────────────────────────── */}
      <div style={{
        fontFamily: mono, fontSize: 10, color: t.muted,
        textAlign: "center", lineHeight: 1.7,
        borderTop: `1px solid ${t.border}`, paddingTop: 16, marginTop: 4,
      }}>
        Numbers update automatically as your data changes.
        This view shows the big picture — no jargon, no tables.
      </div>
    </div>
  );
}
