import { useMemo } from "react";
import {
  calcAll,
  calcTotalCardSpend,
  calcTotalCardPayments,
} from "../calculations.js";

// ─── FORMATTING HELPERS ───────────────────────────────────────────────────────

function fmtMoney(n) {
  const abs = Math.abs(n ?? 0);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(abs);
}

function fmtPct(ratio) {
  return `${((ratio ?? 0) * 100).toFixed(1)}%`;
}

// ─── EMPTY STATE ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: 400,
        gap: 20,
        padding: "48px 24px",
        textAlign: "center",
      }}
    >
      {/* Animated pulse ring */}
      <div style={{ position: "relative", width: 80, height: 80 }}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            border: "2px solid #f59e0b",
            opacity: 0.3,
            animation: "ping 2s cubic-bezier(0,0,0.2,1) infinite",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 8,
            borderRadius: "50%",
            border: "2px solid #f59e0b",
            opacity: 0.5,
            animation: "ping 2s cubic-bezier(0,0,0.2,1) infinite 0.3s",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 20,
            borderRadius: "50%",
            background: "#f59e0b22",
            border: "1px solid #f59e0b",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span style={{ fontSize: 20 }}>$</span>
        </div>
      </div>

      <div>
        <p
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 16,
            fontWeight: 700,
            color: "#e2e8f0",
            marginBottom: 8,
            letterSpacing: "0.04em",
          }}
        >
          NO DATA YET
        </p>
        <p
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 12,
            color: "#64748b",
            maxWidth: 320,
            lineHeight: 1.7,
          }}
        >
          Add your income, credit cards, and expenses using the tabs above.
          Your full financial picture will appear here the moment you do.
        </p>
      </div>

      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          justifyContent: "center",
        }}
      >
        {["Income", "Debts", "Expenses"].map((tab) => (
          <span
            key={tab}
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11,
              color: "#f59e0b",
              border: "1px solid #f59e0b44",
              padding: "4px 12px",
              borderRadius: 4,
              letterSpacing: "0.1em",
            }}
          >
            → {tab.toUpperCase()}
          </span>
        ))}
      </div>

      <style>{`
        @keyframes ping {
          75%, 100% { transform: scale(1.8); opacity: 0; }
        }
      `}</style>
    </div>
  );
}

// ─── PRIMARY INDICATOR BANNER ─────────────────────────────────────────────────

const BANNER_THEMES = {
  increasing: {
    bg: "linear-gradient(135deg, #450a0a 0%, #7f1d1d 50%, #450a0a 100%)",
    border: "#ef4444",
    glow: "#ef444433",
    label: "#fca5a5",
    amount: "#fef2f2",
    icon: "▲",
    iconColor: "#f87171",
    prefix: "Adding",
    suffix: "to debt each month",
    pulse: "#ef444466",
  },
  flat: {
    bg: "linear-gradient(135deg, #422006 0%, #78350f 50%, #422006 100%)",
    border: "#f59e0b",
    glow: "#f59e0b33",
    label: "#fcd34d",
    amount: "#fefce8",
    icon: "●",
    iconColor: "#fbbf24",
    prefix: "Debt is roughly flat —",
    suffix: "change this month",
    pulse: "#f59e0b66",
  },
  decreasing: {
    bg: "linear-gradient(135deg, #052e16 0%, #14532d 50%, #052e16 100%)",
    border: "#22c55e",
    glow: "#22c55e33",
    label: "#86efac",
    amount: "#f0fdf4",
    icon: "▼",
    iconColor: "#4ade80",
    prefix: "Reducing debt by",
    suffix: "each month",
    pulse: "#22c55e66",
  },
};

function PrimaryIndicator({ netDebtChange }) {
  const { amount, direction } = netDebtChange;
  const theme = BANNER_THEMES[direction];

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`Debt status: ${direction}`}
      style={{
        position: "relative",
        overflow: "hidden",
        background: theme.bg,
        border: `1px solid ${theme.border}`,
        borderRadius: 12,
        padding: "32px 28px",
        boxShadow: `0 0 40px ${theme.glow}, inset 0 1px 0 ${theme.border}22`,
      }}
    >
      {/* Animated corner accent */}
      <div
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          width: 120,
          height: 120,
          background: `radial-gradient(circle at top right, ${theme.pulse} 0%, transparent 70%)`,
          pointerEvents: "none",
        }}
      />

      {/* Scan-line texture */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.08) 3px, rgba(0,0,0,0.08) 4px)",
          pointerEvents: "none",
        }}
      />

      <div style={{ position: "relative" }}>
        {/* Status label */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 12,
          }}
        >
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11,
              fontWeight: 700,
              color: theme.label,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
            }}
          >
            THIS MONTH'S DEBT STATUS
          </span>
          <span
            style={{
              display: "inline-block",
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: theme.border,
              boxShadow: `0 0 8px ${theme.border}`,
              animation: "statusPulse 2s ease-in-out infinite",
            }}
          />
        </div>

        {/* Main message */}
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            flexWrap: "wrap",
            gap: "10px 14px",
          }}
        >
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: "clamp(18px, 4vw, 26px)",
              fontWeight: 400,
              color: theme.label,
              lineHeight: 1.2,
            }}
          >
            {theme.prefix}
          </span>

          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: "clamp(32px, 8vw, 56px)",
              fontWeight: 700,
              color: theme.amount,
              lineHeight: 1,
              letterSpacing: "-0.02em",
              textShadow: `0 0 30px ${theme.glow}`,
            }}
          >
            {fmtMoney(amount)}
          </span>

          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: "clamp(18px, 4vw, 26px)",
              fontWeight: 400,
              color: theme.label,
              lineHeight: 1.2,
            }}
          >
            {theme.suffix}
          </span>
        </div>
      </div>

      <style>{`
        @keyframes statusPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.8); }
        }
      `}</style>
    </div>
  );
}

// ─── SECONDARY CALLOUT ────────────────────────────────────────────────────────

function SecondaryCallout({ totalCardSpend, totalCardPayments }) {
  const net = totalCardSpend - totalCardPayments;
  const isOver = net > 0;

  return (
    <div
      style={{
        background: "#0f1117",
        border: "1px solid #1e2130",
        borderRadius: 10,
        padding: "18px 24px",
        display: "flex",
        alignItems: "center",
        gap: 16,
        flexWrap: "wrap",
      }}
    >
      {/* Icon */}
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 8,
          background: "#1e2130",
          border: "1px solid #334155",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          fontSize: 18,
        }}
      >
        💳
      </div>

      {/* Text */}
      <div style={{ flex: 1, minWidth: 220 }}>
        <p
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 13,
            color: "#94a3b8",
            margin: 0,
            lineHeight: 1.6,
          }}
        >
          Putting{" "}
          <strong style={{ color: "#fbbf24", fontWeight: 700 }}>
            {fmtMoney(totalCardSpend)}
          </strong>{" "}
          on cards each month, paying off{" "}
          <strong style={{ color: "#34d399", fontWeight: 700 }}>
            {fmtMoney(totalCardPayments)}
          </strong>
        </p>
      </div>

      {/* Net pill */}
      <div
        style={{
          padding: "6px 14px",
          borderRadius: 20,
          background: isOver ? "#450a0a" : "#052e16",
          border: `1px solid ${isOver ? "#ef4444" : "#22c55e"}44`,
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 12,
          fontWeight: 700,
          color: isOver ? "#fca5a5" : "#86efac",
          whiteSpace: "nowrap",
          flexShrink: 0,
        }}
      >
        {isOver ? "+" : "−"}{fmtMoney(Math.abs(net))} net
      </div>
    </div>
  );
}

// ─── ALERTS BAR ───────────────────────────────────────────────────────────────

const ALERT_STYLES = {
  danger: {
    bg: "#450a0a",
    border: "#ef444444",
    color: "#fca5a5",
    dot: "#ef4444",
  },
  warning: {
    bg: "#422006",
    border: "#f59e0b44",
    color: "#fcd34d",
    dot: "#f59e0b",
  },
};

function AlertsBar({ alerts }) {
  if (!alerts || alerts.length === 0) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 16px",
          background: "#052e16",
          border: "1px solid #22c55e44",
          borderRadius: 8,
        }}
      >
        <span style={{ fontSize: 14 }}>✓</span>
        <span
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 12,
            color: "#86efac",
            letterSpacing: "0.05em",
          }}
        >
          No active alerts — things look okay right now
        </span>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 8,
        alignItems: "center",
      }}
    >
      <span
        style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 10,
          color: "#475569",
          letterSpacing: "0.15em",
          textTransform: "uppercase",
          whiteSpace: "nowrap",
          flexShrink: 0,
        }}
      >
        ALERTS
      </span>
      {alerts.map((alert) => {
        const s = ALERT_STYLES[alert.severity] ?? ALERT_STYLES.warning;
        return (
          <span
            key={alert.id}
            role="alert"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "5px 12px",
              borderRadius: 20,
              background: s.bg,
              border: `1px solid ${s.border}`,
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11,
              fontWeight: 700,
              color: s.color,
              letterSpacing: "0.05em",
              whiteSpace: "nowrap",
            }}
          >
            <span
              style={{
                width: 5,
                height: 5,
                borderRadius: "50%",
                background: s.dot,
                flexShrink: 0,
              }}
            />
            {alert.label}
          </span>
        );
      })}
    </div>
  );
}

// ─── METRIC CARD ──────────────────────────────────────────────────────────────

function MetricCard({ label, value, subtext, accentColor, size = "normal" }) {
  const accent = accentColor ?? "#f59e0b";
  return (
    <div
      style={{
        background: "#0f1421",
        border: "1px solid #1e2130",
        borderRadius: 10,
        padding: size === "large" ? "20px 20px" : "16px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        position: "relative",
        overflow: "hidden",
        transition: "border-color 0.15s",
      }}
      onMouseEnter={(e) =>
        (e.currentTarget.style.borderColor = accent + "55")
      }
      onMouseLeave={(e) =>
        (e.currentTarget.style.borderColor = "#1e2130")
      }
    >
      {/* Subtle left accent bar */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 16,
          bottom: 16,
          width: 3,
          borderRadius: "0 2px 2px 0",
          background: accent + "55",
        }}
      />

      <span
        style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 10,
          color: "#475569",
          letterSpacing: "0.14em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>

      <span
        style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: size === "large" ? 28 : 22,
          fontWeight: 700,
          color: accent,
          lineHeight: 1,
          letterSpacing: "-0.01em",
        }}
      >
        {value}
      </span>

      {subtext && (
        <span
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 10,
            color: "#475569",
            lineHeight: 1.4,
          }}
        >
          {subtext}
        </span>
      )}
    </div>
  );
}

// ─── SECTION LABEL ────────────────────────────────────────────────────────────

function SectionLabel({ children }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        marginBottom: 12,
      }}
    >
      <div
        style={{
          width: 3,
          height: 14,
          borderRadius: 2,
          background: "#f59e0b",
          flexShrink: 0,
        }}
      />
      <span
        style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 10,
          fontWeight: 700,
          color: "#64748b",
          letterSpacing: "0.18em",
          textTransform: "uppercase",
        }}
      >
        {children}
      </span>
    </div>
  );
}

// ─── MAIN DASHBOARD ───────────────────────────────────────────────────────────

export default function Dashboard({ state }) {
  const calc = useMemo(() => calcAll(state), [state]);
  const totalCardSpend = useMemo(
    () => calcTotalCardSpend(state.creditCards ?? []),
    [state.creditCards]
  );
  const totalCardPayments = useMemo(
    () => calcTotalCardPayments(state.creditCards ?? []),
    [state.creditCards]
  );

  // Determine if there's enough data to show the dashboard
  const hasData =
    (state.incomes?.length ?? 0) > 0 ||
    (state.creditCards?.length ?? 0) > 0 ||
    (state.loans?.length ?? 0) > 0 ||
    (state.expenses?.length ?? 0) > 0;

  const {
    monthlyIncome,
    totalDebt,
    totalDebtObligation,
    monthlyExpenses,
    netDebtChange,
    cashFlow,
    dti,
    utilization,
    alerts,
  } = calc;

  // Color logic helpers
  const cashFlowColor =
    cashFlow < 0 ? "#ef4444" : cashFlow < 300 ? "#f59e0b" : "#22c55e";
  const dtiColor =
    dti > 0.4 ? "#ef4444" : dti > 0.3 ? "#f59e0b" : "#22c55e";
  const utilizationColor =
    utilization > 0.7 ? "#ef4444" : utilization > 0.5 ? "#f59e0b" : "#22c55e";
  const netDebtColor =
    netDebtChange.direction === "increasing"
      ? "#ef4444"
      : netDebtChange.direction === "flat"
      ? "#f59e0b"
      : "#22c55e";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 20,
        maxWidth: 900,
        margin: "0 auto",
        padding: "0 0 40px",
        animation: "fadeIn 0.3s ease",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;700&display=swap');
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes stagger {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        /* Responsive metric grid */
        .metric-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 10px;
        }
        @media (min-width: 540px) {
          .metric-grid { grid-template-columns: repeat(3, 1fr); }
        }
        @media (min-width: 800px) {
          .metric-grid { grid-template-columns: repeat(5, 1fr); }
        }

        .metric-grid-flow {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 10px;
        }
        @media (min-width: 540px) {
          .metric-grid-flow { grid-template-columns: repeat(2, 1fr); }
        }
        @media (min-width: 800px) {
          .metric-grid-flow { grid-template-columns: repeat(4, 1fr); }
        }
      `}</style>

      {/* ── EMPTY STATE ─────────────────────────────────── */}
      {!hasData ? (
        <EmptyState />
      ) : (
        <>
          {/* ── PRIMARY INDICATOR ───────────────────────── */}
          <PrimaryIndicator netDebtChange={netDebtChange} />

          {/* ── SECONDARY CALLOUT ───────────────────────── */}
          {(state.creditCards?.length ?? 0) > 0 && (
            <SecondaryCallout
              totalCardSpend={totalCardSpend}
              totalCardPayments={totalCardPayments}
            />
          )}

          {/* ── ALERTS BAR ──────────────────────────────── */}
          <AlertsBar alerts={alerts} />

          {/* ── MONEY IN / MONEY OUT ────────────────────── */}
          <div>
            <SectionLabel>Money In &amp; Out (Monthly)</SectionLabel>
            <div className="metric-grid-flow">
              <MetricCard
                label="Monthly Income"
                value={fmtMoney(monthlyIncome)}
                accentColor="#22c55e"
                subtext="Net take-home across all sources"
              />
              <MetricCard
                label="Monthly Expenses"
                value={fmtMoney(monthlyExpenses)}
                accentColor="#f59e0b"
                subtext="Housing, food, transport & more"
              />
              <MetricCard
                label="Debt Payments"
                value={fmtMoney(totalDebtObligation)}
                accentColor="#f87171"
                subtext="Minimum obligations this month"
              />
              <MetricCard
                label="Cash Flow"
                value={
                  (cashFlow < 0 ? "−" : "+") + fmtMoney(Math.abs(cashFlow))
                }
                accentColor={cashFlowColor}
                subtext={
                  cashFlow < 0
                    ? "Spending more than coming in"
                    : cashFlow < 300
                    ? "Very little breathing room"
                    : "Available after all obligations"
                }
              />
            </div>
          </div>

          {/* ── DEBT PICTURE ────────────────────────────── */}
          <div>
            <SectionLabel>Your Debt Picture</SectionLabel>
            <div className="metric-grid">
              <MetricCard
                label="Total Debt"
                value={fmtMoney(totalDebt)}
                accentColor="#f87171"
                subtext="Cards + loans combined"
              />
              <MetricCard
                label="Net Debt Change"
                value={
                  netDebtChange.direction === "flat"
                    ? "~$0"
                    : (netDebtChange.amount > 0 ? "+" : "−") +
                      fmtMoney(Math.abs(netDebtChange.amount))
                }
                accentColor={netDebtColor}
                subtext={
                  netDebtChange.direction === "increasing"
                    ? "Debt growing this month"
                    : netDebtChange.direction === "flat"
                    ? "Roughly holding steady"
                    : "Debt shrinking this month"
                }
              />
              <MetricCard
                label="Card Spend"
                value={fmtMoney(totalCardSpend)}
                accentColor="#fbbf24"
                subtext="New charges on cards per month"
              />
              <MetricCard
                label="Card Payments"
                value={fmtMoney(totalCardPayments)}
                accentColor="#34d399"
                subtext="Amount paid toward cards"
              />
              <MetricCard
                label="Debt-to-Income"
                value={fmtPct(dti)}
                accentColor={dtiColor}
                subtext={
                  dti > 0.4
                    ? "Above 40% — high risk threshold"
                    : dti > 0.3
                    ? "Getting high — keep an eye on this"
                    : "Below 30% — healthy range"
                }
              />
            </div>
          </div>

          {/* ── CREDIT HEALTH ───────────────────────────── */}
          {(state.creditCards?.length ?? 0) > 0 && (
            <div>
              <SectionLabel>Credit Health</SectionLabel>
              <div style={{ maxWidth: 320 }}>
                <MetricCard
                  label="Card Utilization"
                  value={fmtPct(utilization)}
                  accentColor={utilizationColor}
                  subtext={
                    utilization > 0.7
                      ? "Above 70% — impacts credit score"
                      : utilization > 0.5
                      ? "Above 50% — aim to get below 30%"
                      : "Below 30% — great for your credit"
                  }
                />
              </div>

              {/* Utilization bar */}
              <div
                style={{
                  marginTop: 10,
                  maxWidth: 320,
                  padding: "14px 18px",
                  background: "#0f1421",
                  border: "1px solid #1e2130",
                  borderRadius: 10,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginBottom: 8,
                  }}
                >
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 10,
                      color: "#475569",
                      letterSpacing: "0.1em",
                    }}
                  >
                    0%
                  </span>
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 10,
                      color: "#475569",
                    }}
                  >
                    30% ideal
                  </span>
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 10,
                      color: "#475569",
                    }}
                  >
                    100%
                  </span>
                </div>
                <div
                  style={{
                    position: "relative",
                    height: 10,
                    background: "#1e2130",
                    borderRadius: 5,
                    overflow: "hidden",
                  }}
                >
                  {/* 30% marker */}
                  <div
                    style={{
                      position: "absolute",
                      left: "30%",
                      top: 0,
                      bottom: 0,
                      width: 1,
                      background: "#22c55e44",
                      zIndex: 2,
                    }}
                  />
                  {/* Fill */}
                  <div
                    style={{
                      height: "100%",
                      width: `${Math.min(utilization * 100, 100)}%`,
                      background: utilizationColor,
                      borderRadius: 5,
                      transition: "width 0.6s cubic-bezier(0.4, 0, 0.2, 1)",
                      boxShadow: `0 0 8px ${utilizationColor}88`,
                    }}
                  />
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
