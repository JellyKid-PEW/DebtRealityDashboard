import React from "react";
import { calcAll } from "../calculations";

export default function Dashboard({ state }) {
  const calc = calcAll(state);

  const isMobile = window.innerWidth <= 768;

  const cardStyle = {
    border: "1px solid #334155",
    borderRadius: 12,
    padding: isMobile ? 14 : 18,
    background: "#0f172a"
  };

  const labelStyle = {
    fontSize: 13,
    color: "#94a3b8",
    marginBottom: 4
  };

  const valueStyle = {
    fontSize: isMobile ? 20 : 24,
    fontWeight: 600
  };

  const sectionTitle = {
    fontSize: isMobile ? 16 : 18,
    marginBottom: 10,
    marginTop: 16,
    fontWeight: 600
  };

  // Empty state
  if (
    calc.monthlyIncome === 0 &&
    calc.totalDebt === 0 &&
    calc.monthlyExpenses === 0
  ) {
    return (
      <div style={{ marginTop: 20 }}>
        <div
          style={{
            ...cardStyle,
            textAlign: "center",
            padding: isMobile ? 20 : 30
          }}
        >
          <div style={{ fontSize: 32, marginBottom: 10 }}>💰</div>

          <div style={{ fontSize: 18, marginBottom: 6 }}>
            No Data Yet
          </div>

          <div style={{ color: "#94a3b8", fontSize: 14 }}>
            Add income, debts, and expenses to see your full financial picture.
          </div>

          <div
            style={{
              marginTop: 16,
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 8
            }}
          >
            <div style={{ fontSize: 14 }}>→ Income</div>
            <div style={{ fontSize: 14 }}>→ Debts</div>
            <div style={{ fontSize: 14 }}>→ Expenses</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 10 }}>
      {/* SUMMARY CARDS */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr",
          gap: 12
        }}
      >
        <div style={cardStyle}>
          <div style={labelStyle}>Monthly Income</div>
          <div style={valueStyle}>
            ${calc.monthlyIncome.toFixed(2)}
          </div>
        </div>

        <div style={cardStyle}>
          <div style={labelStyle}>Monthly Expenses</div>
          <div style={valueStyle}>
            ${calc.monthlyExpenses.toFixed(2)}
          </div>
        </div>

        <div style={cardStyle}>
          <div style={labelStyle}>Total Debt</div>
          <div style={valueStyle}>
            ${calc.totalDebt.toFixed(2)}
          </div>
        </div>
      </div>

      {/* CASH FLOW */}
      <div style={sectionTitle}>Cash Flow</div>
      <div style={cardStyle}>
        <div style={labelStyle}>Remaining After Expenses</div>
        <div
          style={{
            ...valueStyle,
            color: calc.netMonthly >= 0 ? "#22c55e" : "#ef4444"
          }}
        >
          ${calc.netMonthly.toFixed(2)}
        </div>
      </div>

      {/* DEBT RATIO */}
      <div style={sectionTitle}>Debt Load</div>
      <div style={cardStyle}>
        <div style={labelStyle}>Debt to Income Ratio</div>
        <div style={valueStyle}>
          {calc.monthlyIncome > 0
            ? ((calc.totalDebt / (calc.monthlyIncome * 12)) * 100).toFixed(1)
            : "0"}
          %
        </div>
      </div>

      {/* SIMPLE WARNING */}
      {calc.netMonthly < 0 && (
        <div
          style={{
            marginTop: 14,
            padding: 14,
            borderRadius: 10,
            background: "#7f1d1d",
            color: "#fecaca",
            fontSize: 14
          }}
        >
          You are spending more than you bring in each month. This will
          continue increasing debt unless adjusted.
        </div>
      )}
    </div>
  );
}
