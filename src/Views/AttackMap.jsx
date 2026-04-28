import React, { useMemo, useState } from "react";
import { normalizeToMonthly, normalizeDebtsForRanking, rankDebtsCanonical } from "../calculations.js";

// ─── TOKENS ───────────────────────────────────────────────────────────────────
const t = {
    bg0:"#080b10",bg1:"#0f172a",bg2:"#111827",
    border:"#1e293b",bright:"#e2e8f0",body:"#cbd5e1",
    muted:"#94a3b8",subtle:"#64748b",
    amber:"#f59e0b",amberD:"#78350f",amberBg:"#1a1200",
    green:"#22c55e",greenD:"#166534",greenBg:"#052e16",
    red:"#ef4444",redD:"#7f1d1d",redBg:"#1c0707",
    blue:"#38bdf8",blueD:"#1e3a5f",blueBg:"#0c1a2e",
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const fmt = n=>`$${Math.abs(Number(n)||0).toLocaleString(undefined,{maximumFractionDigits:0})}`;
const fmtD = n=>`$${Math.abs(Number(n)||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const fmtPct = n=>`${(Number(n)||0).toFixed(1)}%`;

function monthsAway(dateStr) {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    if (isNaN(d)) return null;
    const now = new Date();
    return (d.getFullYear()-now.getFullYear())*12+(d.getMonth()-now.getMonth());
}
function addMonthsLabel(n) {
    const d = new Date();
    d.setMonth(d.getMonth()+n);
    return d.toLocaleDateString("en-US",{month:"short",year:"numeric"});
}
function ipm(bal,apr) { return (Number(bal)||0)*((Number(apr)||0)/100)/12; }
function getEffApr(d) { const p=Number(d.promoApr); return p>0?p:Number(d.apr)||0; }
function getFutApr(d) { return Number(d.apr)||0; }
// Returns the APR that applies at monthOffset months from now — switches from promo to regular when promo expires
function aprAt(d, monthOffset) {
    const regular = Number(d.apr) || 0;
    const promo = Number(d.promoApr);
    if (!(promo > 0)) return regular;
    const promoEnd = d.promoEnd ? new Date(d.promoEnd) : null;
    if (!promoEnd || isNaN(promoEnd)) return promo;
    const now = new Date();
    const monthsUntilExpiry = (promoEnd.getFullYear()-now.getFullYear())*12+(promoEnd.getMonth()-now.getMonth());
    return monthOffset < monthsUntilExpiry ? promo : regular;
}

// ─── DEBT NORMALIZATION ───────────────────────────────────────────────────────
function normalizeDebts(cards,loans) {
    // Delegate to shared canonical normalization
    return normalizeDebtsForRanking(cards,loans);
}

// ─── PRIORITY ENGINE ──────────────────────────────────────────────────────────
// Delegates to shared canonical ranking in calculations.js.
// scoreDebt kept as a local wrapper for use in monthly re-ranking inside simulate().
function scoreDebt(d, monthOffset=0) {
    // For monthly re-ranking within simulation, use aprAt for time-aware APR
    // but mirror the canonical logic from rankDebtsCanonical
    const effApr = aprAt(d, monthOffset);
    const futApr = getFutApr(d);
    const pm = d.promoEnd ? monthsAway(d.promoEnd) : null;
    const soon = pm !== null && pm <= 6 && pm >= 0;
    let score = effApr * 1000;
    if (soon) score += futApr * 1000 * ((6 - pm) / 6) * 0.8;
    if (effApr < 5 && !soon && (pm === null || pm > 6)) score = effApr * 10;
    const netChange = (Number(d.monthlySpend)||0) - (Number(d.minPayment)||0);
    if (netChange > 0 && effApr >= 15) score += netChange * 50;
    score += (1 / ((Number(d.balance)||0) + 1)) * 100;
    return score;
}
function prioritizeDebts(cards, loans) {
    // Initial ranking uses shared canonical function
    return rankDebtsCanonical(normalizeDebts(cards, loans).filter(d => d.balance > 0));
}

// ─── SURPLUS ──────────────────────────────────────────────────────────────────
function calcSurplus(state) {
    const income=(state.incomes??[]).reduce((s,i)=>s+normalizeToMonthly(i.amount,i.frequency),0);
    const essential=(state.expenses??[]).filter(e=>e.essential!==false).reduce((s,e)=>s+normalizeToMonthly(e.amount,e.frequency),0);
    const minimums=[...(state.creditCards??[]).map(c=>Number(c.minPayment)||0),...(state.loans??[]).map(l=>Number(l.monthlyPayment)||0)].reduce((a,b)=>a+b,0);
    return {income,essential,minimums,surplus:Math.max(0,income-essential-minimums)};
}

// ─── SAFE TO PAY ─────────────────────────────────────────────────────────────
// Auto-calculates from state. Only savings balance is user-entered.
// Estimates what falls before next paycheck based on income frequency.
function calcSafeToPay(state) {
    const cash = Number(state.savingsBalance) || 0;
    const buffer = Number(state.emergencyTarget) || 2500;

    // Determine primary income frequency
    const incomes = state.incomes ?? [];
    const primaryIncome = incomes.reduce((best, i) =>
        normalizeToMonthly(i.amount, i.frequency) > normalizeToMonthly(best.amount || 0, best.frequency || "monthly") ? i : best
    , incomes[0] || {});
    const freq = primaryIncome?.frequency || "monthly";
    const fraction = freq === "weekly" ? 0.25 : freq === "biweekly" ? 0.5 : 1.0;

    // Figure out next paycheck day-of-month for due date comparison
    // Biweekly: approximate next paycheck as 14 days from today
    // Weekly: 7 days. Monthly: end of month.
    const today = new Date();
    const todayDay = today.getDate();
    let nextPaycheckDay;
    if (freq === "weekly") nextPaycheckDay = todayDay + 7;
    else if (freq === "biweekly") nextPaycheckDay = todayDay + 14;
    else nextPaycheckDay = 31; // monthly: treat as full month

    // Essential expenses before next paycheck — blunt fraction (no due days on expenses)
    const monthlyEssential = (state.expenses ?? [])
        .filter(e => e.essential !== false)
        .reduce((s, e) => s + normalizeToMonthly(e.amount, e.frequency), 0);
    const essentialBeforePaycheck = monthlyEssential * fraction;

    // Minimum payments before next paycheck — use dueDay if available, else fraction
    const allDebts = [
        ...(state.creditCards ?? []).map(c => ({ min: Number(c.minPayment) || 0, dueDay: Number(c.dueDay) || 0 })),
        ...(state.loans ?? []).map(l => ({ min: Number(l.monthlyPayment) || 0, dueDay: Number(l.dueDay) || 0 })),
    ];
    const monthlyMins = allDebts.reduce((s, d) => s + d.min, 0);

    // If debts have due days, count only those falling before next paycheck
    const debtsWithDueDays = allDebts.filter(d => d.dueDay > 0);
    let minsBeforePaycheck;
    if (debtsWithDueDays.length > 0) {
        // Use dueDay for debts that have it, fraction for those that don't
        const minsWithDays = allDebts.filter(d => d.dueDay > 0)
            .filter(d => d.dueDay >= todayDay && d.dueDay <= nextPaycheckDay)
            .reduce((s, d) => s + d.min, 0);
        const minsWithoutDays = allDebts.filter(d => d.dueDay === 0)
            .reduce((s, d) => s + d.min * fraction, 0);
        minsBeforePaycheck = minsWithDays + minsWithoutDays;
    } else {
        minsBeforePaycheck = monthlyMins * fraction;
    }

    const reserveNeeded = buffer + essentialBeforePaycheck + minsBeforePaycheck;
    const safe = Math.max(0, cash - reserveNeeded);
    const keep = cash - safe;

    const usingDueDays = debtsWithDueDays.length > 0;

    return {
        safe, keep, cash, buffer,
        essentialBeforePaycheck, minsBeforePaycheck,
        monthlyEssential, monthlyMins,
        fraction, freq,
        reserveNeeded, usingDueDays,
        debtsWithDueDays: debtsWithDueDays.length,
        totalDebts: allDebts.length,
    };
}

// ─── PROMO DEADLINES ─────────────────────────────────────────────────────────
function calcPromos(cards) {
    return (cards??[]).filter(c=>{
        const pm=monthsAway(c.promoEnd);
        return Number(c.promoApr)>0&&pm!==null&&pm>=0;
    }).map(c=>{
        const pm=monthsAway(c.promoEnd);
        const bal=Number(c.balance)||0;
        return {...c,monthsRemaining:pm,required:bal/Math.max(1,pm),
            urgency:pm<=2?"critical":pm<=6?"urgent":"watch",
            futureApr:Number(c.apr)||0,promoApr:Number(c.promoApr)||0};
    }).sort((a,b)=>a.monthsRemaining-b.monthsRemaining);
}

// ─── MIN PAYMENT DANGER ───────────────────────────────────────────────────────
function calcDangers(debts) {
    return debts.filter(d=>d.balance>0).map(d=>{
        const interest=ipm(d.balance,getEffApr(d));
        const payment=d.monthlyPayment||d.minPayment||0;
        const share=payment>0?interest/payment:1;
        const level=payment<=interest?"critical":share>=0.75?"danger":share>=0.5?"warning":null;
        const msg=payment<=interest?"This payment doesn't cover interest. Balance is growing.":
            share>=0.75?"Most of this payment is interest. Balance moves very slowly.":
            share>=0.5?"Over half this payment is interest.":null;
        return {...d,interest,payment,share,level,msg};
    }).filter(d=>d.level);
}

// ─── RISK FLAGS ───────────────────────────────────────────────────────────────
function calcRisk(state,surplus,prioritized,promos) {
    const flags=[];
    const cash=Number(state.savingsBalance)||0;
    const buffer=Number(state.emergencyTarget)||2500;
    const cards=state.creditCards??[];
    const totalDebt=prioritized.reduce((s,d)=>s+d.balance,0);
    const totalLimit=cards.reduce((s,c)=>s+Number(c.limit||0),0);
    const util=totalLimit>0?totalDebt/totalLimit:0;
    const income=(state.incomes??[]).reduce((s,i)=>s+normalizeToMonthly(i.amount,i.frequency),0);
    const mins=prioritized.reduce((s,d)=>s+d.minPayment,0);

    if(cash<buffer) flags.push({level:"red",text:`Emergency buffer short — have ${fmt(cash)}, need ${fmt(buffer)}`});
    if(surplus<=0) flags.push({level:"red",text:"No monthly surplus — nothing to attack debt with"});
    if(util>0.8) flags.push({level:"red",text:`Credit utilization at ${fmtPct(util*100)} — above 80%`});
    if(promos.filter(p=>p.urgency==="critical").length) flags.push({level:"red",text:"Promo rate expiring within 2 months — act now"});
    if(promos.filter(p=>p.urgency==="urgent").length) flags.push({level:"amber",text:"Promo rate expiring within 6 months"});
    const spendCards=cards.filter(c=>Number(c.monthlySpend)>0&&Number(c.balance)>0);
    if(spendCards.length) flags.push({level:"amber",text:`New charges on ${spendCards.length} payoff card${spendCards.length>1?"s":""} — breaking the plan`});
    if(income>0&&mins/income>0.4) flags.push({level:"amber",text:`Minimums are ${fmtPct(mins/income*100)} of income`});

    // Cards with a balance but no minimum entered
    const zeroMinCards = (state.creditCards??[]).filter(c=>Number(c.balance)>0&&!(Number(c.minPayment)>0));
    if(zeroMinCards.length) flags.push({
        level:"amber",
        text:`${zeroMinCards.length} card${zeroMinCards.length>1?"s":""} (${zeroMinCards.map(c=>c.name||"unnamed").join(", ")}) ${zeroMinCards.length>1?"have":"has"} a balance but no minimum payment entered — add it in the Debts tab for accurate calculations`
    });
    // Cards approaching or over credit limit
    const nearLimitCards = (state.creditCards??[]).filter(c=>{
        const bal=Number(c.balance)||0;
        const lim=Number(c.limit)||0;
        return lim>0&&bal/lim>0.9;
    });
    if(nearLimitCards.length) flags.push({
        level:"amber",
        text:`${nearLimitCards.map(c=>`${c.name} (${Math.round((Number(c.balance)||0)/(Number(c.limit)||1)*100)}% utilized)`).join(", ")} — near or at credit limit. New charges will be declined.`
    });

    const redCount=flags.filter(f=>f.level==="red").length;
    return {flags,overall:redCount>=2?"red":redCount>=1?"red":flags.length>=2?"amber":"green"};
}

// ─── MILESTONES ───────────────────────────────────────────────────────────────
function calcMilestones(state,prioritized) {
    const cards=state.creditCards??[];
    const totalDebt=prioritized.reduce((s,d)=>s+d.balance,0);
    const totalLimit=cards.reduce((s,c)=>s+Number(c.limit||0),0);
    const util=totalLimit>0?totalDebt/totalLimit:0;
    const highApr=prioritized.filter(d=>getEffApr(d)>=20).reduce((s,d)=>s+d.balance,0);
    const completed=[],upcoming=[];

    if(prioritized.length>0) upcoming.push({label:`Pay off ${prioritized[0].name}`,detail:`${fmt(prioritized[0].balance)} remaining`,priority:true});
    if(util>=0.9) upcoming.push({label:`Get utilization below 90% — now ${fmtPct(util*100)}`});
    else if(util>=0.75) upcoming.push({label:`Get utilization below 75% — now ${fmtPct(util*100)}`});
    else if(util>=0.5) upcoming.push({label:`Get utilization below 50% — now ${fmtPct(util*100)}`});
    else completed.push({label:"Utilization below 50%"});

    if(highApr>0) upcoming.push({label:`Eliminate all 20%+ APR debt — ${fmt(highApr)} remaining`});
    else completed.push({label:"All 20%+ APR debt gone"});

    if(cards.filter(c=>Number(c.balance)>0).length>0) upcoming.push({label:"Clear all credit card balances"});
    else completed.push({label:"All credit cards cleared"});

    return {completed,upcoming:upcoming.slice(0,4)};
}

// ─── SPENDING LEAKS ───────────────────────────────────────────────────────────
function calcLeaks(state, surplus, prioritized, lumpSum) {
    const bycat={};
    (state.expenses??[]).forEach(e=>{
        const cat=e.category||"Other";
        const mo=normalizeToMonthly(e.amount,e.frequency);
        if(!bycat[cat]) bycat[cat]={total:0,optional:0};
        bycat[cat].total+=mo;
        if(e.essential===false) bycat[cat].optional+=mo;
    });

    // Run simulation at current surplus to get baseline payoff month
    const baseMonths = prioritized.length>0&&surplus>0
        ? simulate(prioritized, surplus, lumpSum, 120).length
        : 999;

    return Object.entries(bycat).filter(([,v])=>v.optional>=50).map(([cat,v])=>{
        // Simulate with optional spending redirected to attack pool
        const boostedSurplus = surplus + v.optional;
        const boostedMonths = prioritized.length>0&&boostedSurplus>0
            ? simulate(prioritized, boostedSurplus, lumpSum, 120).length
            : 999;
        const monthsSaved = Math.max(0, baseMonths - boostedMonths);
        return { category:cat, total:v.total, optional:v.optional, monthsSaved };
    }).filter(l=>l.monthsSaved>0||l.optional>=100)
      .sort((a,b)=>b.optional-a.optional).slice(0,4);
}

// ─── SIMULATION ───────────────────────────────────────────────────────────────
function simulate(prioritized,surplus,lumpSum,maxMonths=60) {
    if(!prioritized.length||surplus<=0) return [];
    let debts=prioritized.map(d=>({...d,balance:Number(d.balance)||0}));
    let pool=surplus;
    const months=[];

    for(let m=0;m<maxMonths;m++) {
        // Re-rank every month — promo expirations can change which debt is most urgent
        const active=debts.filter(d=>d.balance>0.01).sort((a,b)=>scoreDebt(b,m)-scoreDebt(a,m));
        if(!active.length) break;
        const focus=active[0],rest=active.slice(1);
        const lump=m===0?lumpSum:0;

        // Use time-aware APR — promo rate switches to regular when promo expires
        const focusApr=aprAt(focus,m);
        let bal=Math.max(0,focus.balance-lump);
        const interest=ipm(bal,focusApr);
        bal+=interest;
        // Total applied to focus = minPayment (from minimums budget) + pool (attack surplus)
        // Both are available this month — minimums budget covers the min, pool covers extra
        const focusMin=focus.minPayment||0;
        const totalFocusPay=Math.min(bal,focusMin+pool);
        const remaining=Math.max(0,bal-totalFocusPay);
        const cleared=remaining<=0.01;
        const leftover=cleared?Math.max(0,totalFocusPay-bal):0;
        const next=rest[0]||null;
        const overflow=cleared&&next?Math.min(leftover,next.balance):0;
        const totalInterest=interest+rest.reduce((s,d)=>s+ipm(d.balance,aprAt(d,m)),0);

        // Flag if promo expires this month on any debt — affects urgency re-ranking
        const promoExpiries=debts.filter(d=>{
            const pm=d.promoEnd?monthsAway(d.promoEnd):null;
            return pm===m;
        }).map(d=>d.name);

        const instructions=[];
        if(lump>0) instructions.push({type:"lump",text:`Deploy ${fmt(lump)} lump sum → ${focus.name}`,amt:lump,debt:focus.name});
        // Warn if promo just expired on focus debt
        const focusPromoExpiredThisMonth = aprAt(focus,m)>aprAt(focus,m-1||0) && m>0;
        instructions.push({type:"focus",
            text:`Pay ${fmt(totalFocusPay)}/mo → ${focus.name}${focusPromoExpiredThisMonth?" ⚠ rate reset this month":""}`,
            amt:totalFocusPay,debt:focus.name});
        rest.forEach(d=>{
            if(d.balance>0.01) {
                const rateReset=m>0&&aprAt(d,m)>aprAt(d,m-1);
                instructions.push({type:rateReset?"lump":"minimum",
                    text:rateReset?`⚠ ${d.name} promo expired — now ${fmtPct(aprAt(d,m))} APR. Min ${fmt(d.minPayment)}/mo`:`Minimum only — ${fmt(d.minPayment)}/mo`,
                    amt:d.minPayment,debt:d.name});
            }
        });
        if(overflow>0&&next) instructions.push({type:"overflow",text:`Leftover ${fmt(overflow)} → ${next.name}`,amt:overflow,debt:next.name});
        instructions.push({type:"rule",text:"No new credit card charges. Not one.",debt:null});

        months.push({month:m+1,label:addMonthsLabel(m),focusDebt:focus.name,focusId:focus.id,
            focusBalance:focus.balance,balAfter:remaining,cleared,lump,pool,
            nextTarget:next?.name||null,instructions,totalInterest,promoExpiries,
            limitBreaches:limitBreaches||[]});

        // Advance balances — all using time-aware APR for next month
        debts=debts.map(d=>{
            if(d.id===focus.id) return {...d,balance:remaining,_monthsElapsed:(d._monthsElapsed||0)+1};
            const nextApr=aprAt(d,m+1);
            const elapsed=(d._monthsElapsed||0)+1;
            // Enforce loan term: if term is set and elapsed >= term, loan is paid off
            if(d._type==="loan"&&d.termRemainingMonths>0&&elapsed>=d.termRemainingMonths){
                return {...d,balance:0,_monthsElapsed:elapsed};
            }
            if(d.id===next?.id) return {...d,balance:Math.max(0,d.balance-overflow+ipm(d.balance,nextApr)+d.monthlySpend),_monthsElapsed:elapsed};
            return {...d,balance:Math.max(0,d.balance+ipm(d.balance,nextApr)+d.monthlySpend-d.minPayment),_monthsElapsed:elapsed};
        });
        // Check for credit limit breaches on non-focus cards
        const limitBreaches=debts.filter(d=>d._type==="card"&&d.limit>0&&d.balance>d.limit&&d.id!==focus.id).map(d=>d.name);
        if(cleared) pool+=focus.minPayment||0;
    }
    return months;
}

// ─── IMPORT DELTA ─────────────────────────────────────────────────────────────
// Compares current state to previous snapshot to show what changed since last import
function calcImportDelta(state, prioritized) {
    const prev = state.prevSnapshot;
    if (!prev) return null;

    const currentTotal = prioritized.reduce((s,d)=>s+d.balance, 0);
    const prevTotal = prev.totalDebt || 0;
    const totalDelta = prevTotal - currentTotal; // positive = paid down

    const debtDeltas = prioritized.map(d => {
        const prevDebt = prev.debts?.find(p => p.id === d.id);
        if (!prevDebt) return null;
        const delta = prevDebt.balance - d.balance;
        return { name: d.name, delta, prevBalance: prevDebt.balance, currentBalance: d.balance };
    }).filter(Boolean).filter(d => Math.abs(d.delta) > 0.5);

    const newCharges = debtDeltas.filter(d => d.delta < 0); // balance went up
    const daysSince = prev.date
        ? Math.round((Date.now() - new Date(prev.date)) / 86400000)
        : null;

    return { totalDelta, prevTotal, currentTotal, debtDeltas, newCharges, daysSince };
}

// ─── PLAN MONTH NUMBER ────────────────────────────────────────────────────────
// Calculates which month of the plan we're actually in, based on planStartDate
function calcPlanMonth(state) {
    if (!state.planStartDate) return 1;
    const start = new Date(state.planStartDate);
    const now = new Date();
    const elapsed = (now.getFullYear()-start.getFullYear())*12+(now.getMonth()-start.getMonth());
    return Math.max(1, elapsed + 1);
}

// ─── INTEREST COST COMPARISON ─────────────────────────────────────────────────
// Compares total interest: attack plan vs minimums-only
function calcInterestComparison(prioritized, surplus, lumpSum) {
    if (!prioritized.length) return null;

    // Attack plan — run simulation and sum all interest
    const attackMonths = simulate(prioritized, surplus, lumpSum, 120);
    const attackInterest = attackMonths.reduce((s,m)=>s+m.totalInterest, 0);
    const attackPayoffMonths = attackMonths.length;

    // Minimums-only — simulate with zero surplus and zero lump sum
    // Capped at 120 months (10 years) — sufficient for any realistic comparison
    let miniDebts = prioritized.map(d=>({...d,balance:Number(d.balance)||0}));
    let miniInterest = 0;
    let miniMonths = 0;
    for (let m=0; m<120; m++) {
        const active = miniDebts.filter(d=>d.balance>0.01);
        if (!active.length) break;
        let monthInterest = 0;
        miniDebts = miniDebts.map(d=>{
            if (d.balance<=0.01) return d;
            const interest = ipm(d.balance, aprAt(d,m));
            // If payment doesn't cover interest (negative amortization), cap at 120mo
            const newBal = Math.max(0, d.balance + d.monthlySpend + interest - (d.minPayment||0));
            monthInterest += interest;
            return {...d, balance:newBal};
        });
        miniInterest += monthInterest;
        miniMonths++;
    }

    const interestSaved = Math.max(0, miniInterest - attackInterest);
    const monthsSaved = Math.max(0, miniMonths - attackPayoffMonths);

    return {
        attackInterest,
        miniInterest,
        interestSaved,
        attackPayoffMonths,
        miniPayoffMonths: miniMonths,
        monthsSaved,
    };
}

// ─── COMMITMENT ENGINE ───────────────────────────────────────────────────────

// Build a commitment from the current month 1 simulation
function buildCommitment(months, prioritized, planMonth) {
    if (!months.length || !prioritized.length) return null;
    const month1 = months[0];

    // Project end balances for each debt after following month 1 plan
    // We run one month of simulation and record where each debt ends up
    const projectedBalances = prioritized.map(d => ({
        id: d.id,
        name: d.name,
        startBalance: d.balance,
        projectedBalance: d.id === month1.focusId ? month1.balAfter :
            // Non-focus debts: apply one month of interest + spend - minimum
            Math.max(0, d.balance + ipm(d.balance, getEffApr(d)) + (d.monthlySpend||0) - (d.minPayment||0)),
    }));

    return {
        date: new Date().toISOString(),
        planMonth,
        focusDebt: month1.focusDebt,
        focusId: month1.focusId,
        projectedBalances,
        totalProjected: projectedBalances.reduce((s,d) => s + d.projectedBalance, 0),
        totalAtCommit: prioritized.reduce((s,d) => s + d.balance, 0),
    };
}

// Compare a commitment against actual balances after import
function calcCommitmentVerification(commitment, prioritized) {
    if (!commitment) return null;

    const actualTotal = prioritized.reduce((s,d) => s + d.balance, 0);
    const projectedTotal = commitment.totalProjected;
    const totalDelta = projectedTotal - actualTotal; // positive = ahead of plan

    const debtResults = commitment.projectedBalances.map(proj => {
        const actual = prioritized.find(d => d.id === proj.id);
        if (!actual) return null;
        const diff = proj.projectedBalance - actual.balance; // positive = better than projected
        const pct = proj.startBalance > 0 ? diff / proj.startBalance : 0;
        return {
            id: proj.id,
            name: proj.name,
            projected: proj.projectedBalance,
            actual: actual.balance,
            diff,
            pct,
            status: Math.abs(diff) < 10 ? 'on-track' : diff > 0 ? 'ahead' : 'behind',
        };
    }).filter(Boolean);

    const anyBehind = debtResults.some(d => d.status === 'behind');
    const anyAhead = debtResults.some(d => d.status === 'ahead');
    const allOnTrack = debtResults.every(d => d.status === 'on-track');
    const overall = allOnTrack ? 'on-track' : anyBehind ? 'behind' : 'ahead';

    const daysSinceCommit = commitment.date
        ? Math.round((Date.now() - new Date(commitment.date)) / 86400000)
        : null;

    return {
        overall, debtResults, totalDelta,
        projectedTotal, actualTotal,
        daysSinceCommit, focusDebt: commitment.focusDebt,
    };
}

// ─── INCOME SANITY CHECK ─────────────────────────────────────────────────────
function checkIncomeSanity(incomes) {
    const flags = [];
    (incomes ?? []).forEach(inc => {
        const monthly = normalizeToMonthly(inc.amount, inc.frequency);
        const annual = monthly * 12;
        // Flag if annual implied income is suspiciously high (>$600k) or low (<$6k)
        if (inc.amount > 0 && annual > 600000) {
            flags.push({
                id: inc.id,
                name: inc.name || "Income entry",
                msg: `${inc.frequency} amount of ${fmt(inc.amount)} implies ${fmt(annual)}/year — did you enter an annual salary in the wrong frequency?`,
                implied: annual,
            });
        }
        if (inc.amount > 0 && annual < 6000 && monthly > 0) {
            flags.push({
                id: inc.id,
                name: inc.name || "Income entry",
                msg: `${inc.frequency} amount of ${fmt(inc.amount)} implies only ${fmt(annual)}/year — seems low. Check the frequency setting.`,
                implied: annual,
            });
        }
    });
    return flags;
}

// ─── SELLABLE ASSETS ─────────────────────────────────────────────────────────
function calcSellableAssets(state, prioritized, surplus, lumpSum) {
    const assets = (state.assets ?? []);
    const sellable = assets.filter(a => a.priority === "sell" || a.priority === "maybe");
    if (!sellable.length) return null;

    const sellTotal = sellable.filter(a => a.priority === "sell")
        .reduce((s, a) => s + (Number(a.quickSaleValue) || 0), 0);
    const maybeTotal = sellable.filter(a => a.priority === "maybe")
        .reduce((s, a) => s + (Number(a.quickSaleValue) || 0), 0);

    // Simulate how selling everything marked "sell" would accelerate the plan
    const totalDebt = prioritized.reduce((s, d) => s + d.balance, 0);
    const pctOfDebt = totalDebt > 0 ? sellTotal / totalDebt : 0;

    return {
        sellItems: sellable.filter(a => a.priority === "sell"),
        maybeItems: sellable.filter(a => a.priority === "maybe"),
        sellTotal,
        maybeTotal,
        combinedTotal: sellTotal + maybeTotal,
        pctOfDebt,
    };
}

// ─── COMMIT HISTORY ──────────────────────────────────────────────────────────
function calcCommitStatus(state) {
    const history = state.commitHistory ?? [];
    const commitment = state.commitment;
    const planStart = state.planStartDate ? new Date(state.planStartDate) : null;
    const daysSincePlanStart = planStart
        ? Math.round((Date.now() - planStart.getTime()) / 86400000)
        : null;

    // Days since last commit or verify
    const lastEntry = history[0];
    const lastActivityDate = lastEntry?.verifyDate
        ? new Date(lastEntry.verifyDate)
        : planStart;
    const daysSinceLastActivity = lastActivityDate
        ? Math.round((Date.now() - lastActivityDate.getTime()) / 86400000)
        : null;

    const needsCommit = !commitment && daysSinceLastActivity !== null && daysSinceLastActivity > 30;
    const streak = calcStreak(history);

    return { history, needsCommit, daysSinceLastActivity, daysSincePlanStart, streak };
}

function calcStreak(history) {
    // Count consecutive "on-track" or "ahead" entries from most recent
    let streak = 0;
    for (const entry of history) {
        if (entry.overall === "on-track" || entry.overall === "ahead") streak++;
        else break;
    }
    return streak;
}

// ─── UI PRIMITIVES ────────────────────────────────────────────────────────────
function Card({children,border=t.border,bg=t.bg1,padding=16}) {
    return <div style={{border:`1px solid ${border}`,background:bg,borderRadius:12,padding}}>{children}</div>;
}
function Label({text,sub}) {
    return <div style={{marginBottom:10}}>
        <div style={{fontSize:11,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:t.muted,marginBottom:sub?3:0}}>{text}</div>
        {sub&&<div style={{fontSize:12,color:t.subtle,lineHeight:1.5}}>{sub}</div>}
    </div>;
}
function Grid({children,cols=2,gap=10}) {
    return <div style={{display:"grid",gridTemplateColumns:`repeat(${cols},minmax(0,1fr))`,gap}}>{children}</div>;
}
function Stat({label,value,sub,color=t.bright}) {
    return <div style={{border:`1px solid ${t.border}`,background:t.bg2,borderRadius:10,padding:"12px 14px"}}>
        <div style={{fontSize:10,color:t.subtle,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:5}}>{label}</div>
        <div style={{fontSize:18,fontWeight:700,color,lineHeight:1.1}}>{value}</div>
        {sub&&<div style={{fontSize:11,color:t.subtle,marginTop:3,lineHeight:1.4}}>{sub}</div>}
    </div>;
}
function Inp({label,value,onChange,help}) {
    return <label style={{display:"flex",flexDirection:"column",gap:5}}>
        <span style={{fontSize:12,color:t.body}}>{label}</span>
        <input type="number" value={value||""} onChange={e=>onChange(parseFloat(e.target.value)||0)}
            style={{minHeight:42,borderRadius:8,border:`1px solid ${t.border}`,background:t.bg2,
                color:t.bright,padding:"8px 12px",fontSize:14,outline:"none"}} />
        {help&&<span style={{fontSize:11,color:t.subtle,marginTop:2}}>{help}</span>}
    </label>;
}
function Pill({text,color=t.muted,bg="transparent",border=t.border}) {
    return <span style={{fontSize:10,fontWeight:700,padding:"2px 7px",borderRadius:4,color,
        background:bg,border:`1px solid ${border}`,letterSpacing:"0.06em",whiteSpace:"nowrap"}}>{text}</span>;
}
function ILine({item}) {
    const cfg={lump:{icon:"💥",color:t.amber,bg:t.amberBg,border:t.amberD},
        focus:{icon:"🎯",color:t.green,bg:t.greenBg,border:t.greenD},
        minimum:{icon:"→",color:t.muted,bg:"transparent",border:t.border},
        overflow:{icon:"↩",color:t.blue,bg:t.blueBg,border:t.blueD},
        rule:{icon:"⚡",color:t.subtle,bg:"transparent",border:t.border}};
    const c=cfg[item.type]||cfg.rule;
    return <div style={{display:"flex",alignItems:"flex-start",gap:10,padding:"9px 13px",borderRadius:9,
        border:`1px solid ${c.border}`,background:c.bg,marginBottom:5}}>
        <span style={{fontSize:15,lineHeight:1,marginTop:1,flexShrink:0}}>{c.icon}</span>
        <div style={{flex:1}}>
            {item.debt&&<div style={{fontSize:10,color:t.subtle,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:1}}>{item.debt}</div>}
            <div style={{fontSize:13,color:c.color,fontWeight:item.type==="focus"||item.type==="lump"?600:400,lineHeight:1.4}}>{item.text}</div>
        </div>
        {item.amt&&<div style={{fontSize:14,fontWeight:700,color:c.color,flexShrink:0}}>{fmt(item.amt)}</div>}
    </div>;
}

// ─── SECTIONS ─────────────────────────────────────────────────────────────────

function TodayCard({month,lumpSum,focus,emergencyTarget,surplus}) {
    if(!focus||!month) return null;
    const pm=focus.promoEnd?monthsAway(focus.promoEnd):null;
    const why=(pm!==null&&pm<=6)?"Promo expires soon — will reset to high APR":
        getEffApr(focus)>=20?`Costs ${fmtD(ipm(focus.balance,getEffApr(focus)))}/month in interest`:
        "Smallest high-priority balance — fastest win";
    return (
        <Card border={t.amberD} bg={t.amberBg} padding={20}>
            <div style={{fontSize:11,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:t.amber,marginBottom:12}}>
                What To Do Today
            </div>
            {[
                {icon:"🛡",label:"Keep in savings",value:fmt(emergencyTarget),color:t.muted},
                {icon:"💥",label:`Pay now → ${focus.name}`,value:fmt(lumpSum>0?lumpSum:surplus),color:t.green,bold:true},
                {icon:"📌",label:"Why this debt first",value:why,color:t.amber,small:true},
                {icon:"⚡",label:"Non-negotiable rule",value:"No new credit card charges. Not one.",color:t.red,small:true},
            ].map((r,i)=>(
                <div key={i} style={{display:"flex",alignItems:"flex-start",gap:12,padding:"10px 14px",
                    borderRadius:9,background:t.bg1,border:`1px solid ${t.border}`,marginBottom:6}}>
                    <span style={{fontSize:18,lineHeight:1,flexShrink:0,marginTop:2}}>{r.icon}</span>
                    <div style={{flex:1}}>
                        <div style={{fontSize:10,color:t.subtle,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:2}}>{r.label}</div>
                        <div style={{fontSize:r.small?13:r.bold?20:16,fontWeight:r.bold?700:r.small?400:600,color:r.color,lineHeight:1.3}}>{r.value}</div>
                    </div>
                </div>
            ))}
        </Card>
    );
}

function SafePay({safeData,state,onUpdate}) {
    const [showHow,setShowHow]=useState(false);
    const freqLabel = {weekly:"weekly",biweekly:"biweekly",monthly:"monthly"}[safeData.freq]||"monthly";
    const fractionLabel = safeData.freq==="weekly"?"¼ of monthly":safeData.freq==="biweekly"?"½ of monthly":"full monthly";

    return (
        <Card border={t.border}>
            <Label text="Safe to Pay Today" sub="Calculated from your expenses, debts, and income schedule — only your savings balance needs to be set." />

            {/* The two numbers that matter */}
            <Grid cols={2} gap={10}>
                <div style={{background:safeData.safe>0?t.greenBg:t.redBg,border:`1px solid ${safeData.safe>0?t.greenD:t.redD}`,borderRadius:10,padding:"14px 16px"}}>
                    <div style={{fontSize:10,color:t.muted,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:4}}>Safe to send today</div>
                    <div style={{fontSize:26,fontWeight:700,color:safeData.safe>0?t.green:t.muted}}>{fmt(safeData.safe)}</div>
                    <div style={{fontSize:12,color:safeData.safe>0?"#86efac":"#f87171",marginTop:4,lineHeight:1.5}}>
                        {safeData.safe>0?"Send this to your focus debt now.":"Build your buffer before sending anything."}
                    </div>
                </div>
                <div style={{background:t.bg2,border:`1px solid ${t.border}`,borderRadius:10,padding:"14px 16px"}}>
                    <div style={{fontSize:10,color:t.muted,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:4}}>Keep in account</div>
                    <div style={{fontSize:26,fontWeight:700,color:t.amber}}>{fmt(safeData.keep)}</div>
                    <div style={{fontSize:12,color:t.subtle,marginTop:4,lineHeight:1.5}}>
                        Do not send more. You need this to avoid reusing the cards.
                    </div>
                </div>
            </Grid>

            {/* Savings input — the only thing user needs to enter */}
            <div style={{marginTop:14,display:"flex",gap:12,flexWrap:"wrap",alignItems:"flex-end"}}>
                <div style={{flex:"1 1 180px"}}>
                    <Inp label="Current savings balance ($)"
                        value={state.savingsBalance}
                        onChange={v=>onUpdate({...state,savingsBalance:v})}
                        help={`Emergency buffer: ${fmt(Number(state.emergencyTarget)||2500)} · Lump sum available: ${fmt(Math.max(0,(state.savingsBalance||0)-(state.emergencyTarget||2500)))}`} />
                </div>
                <div style={{flex:"1 1 180px"}}>
                    <Inp label="Emergency buffer to keep ($)"
                        value={state.emergencyTarget}
                        onChange={v=>onUpdate({...state,emergencyTarget:v})} />
                </div>
            </div>

            {/* How it's calculated — collapsible transparency */}
            <div style={{marginTop:12}}>
                <button onClick={()=>setShowHow(h=>!h)}
                    style={{fontSize:12,color:t.subtle,background:"transparent",border:"none",cursor:"pointer",padding:0,textDecoration:"underline"}}>
                    {showHow?"▲ hide calculation":"▼ how is this calculated?"}
                </button>
                {showHow&&(
                    <div style={{marginTop:10,padding:"12px 14px",borderRadius:9,background:t.bg2,border:`1px solid ${t.border}`}}>
                {showHow&&(
                    <div style={{marginTop:10,padding:"12px 14px",borderRadius:9,background:t.bg2,border:`1px solid ${t.border}`}}>
                        <div style={{fontSize:12,color:t.muted,marginBottom:8,lineHeight:1.6}}>
                            You are paid <strong style={{color:t.bright}}>{freqLabel}</strong>.{" "}
                            {safeData.usingDueDays
                                ? <>Minimum payments use due dates from your Debts tab ({safeData.debtsWithDueDays} of {safeData.totalDebts} debts have a due day set).</>
                                : <>The app reserves <strong style={{color:t.bright}}>{fractionLabel}</strong> of monthly obligations. Add due days in the Debts tab for a more precise answer.</>
                            }
                        </div>
                        {[
                            {label:"Savings on hand",value:fmt(safeData.cash),color:t.bright},
                            {label:"Emergency buffer",value:`− ${fmt(safeData.buffer)}`,color:t.red},
                            {label:`Essential expenses (${fractionLabel})`,value:`− ${fmt(safeData.essentialBeforePaycheck)}`,color:t.red,
                                sub:`From your ${fmt(safeData.monthlyEssential)}/mo in essential expenses`},
                            {label:safeData.usingDueDays?"Minimums due before next paycheck":`Minimum payments (${fractionLabel})`,
                                value:`− ${fmt(safeData.minsBeforePaycheck)}`,color:t.red,
                                sub:safeData.usingDueDays?`Using due dates · total minimums ${fmt(safeData.monthlyMins)}/mo`:`From your ${fmt(safeData.monthlyMins)}/mo in minimums`},
                        ].map((r,i)=>(
                            <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",
                                padding:"7px 0",borderBottom:i<3?`1px solid ${t.border}`:"none"}}>
                                <div>
                                    <div style={{fontSize:13,color:t.body}}>{r.label}</div>
                                    {r.sub&&<div style={{fontSize:11,color:t.subtle,marginTop:1}}>{r.sub}</div>}
                                </div>
                                <span style={{fontSize:13,fontWeight:600,color:r.color,flexShrink:0,marginLeft:16}}>{r.value}</span>
                            </div>
                        ))}
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",paddingTop:8}}>
                            <span style={{fontSize:13,fontWeight:700,color:t.bright}}>Safe to send today</span>
                            <span style={{fontSize:15,fontWeight:700,color:safeData.safe>0?t.green:t.muted}}>{fmt(safeData.safe)}</span>
                        </div>
                    </div>
                )}
        </Card>
    );
}

function PaycheckPlan({state,onUpdate,prioritized,lumpSum}) {
    const [open,setOpen]=useState(false);
    const focus=prioritized[0];

    // Auto-derive paycheck share from income frequency
    const incomes = state.incomes??[];
    const primary = incomes.reduce((best,i)=>
        normalizeToMonthly(i.amount,i.frequency)>normalizeToMonthly(best.amount||0,best.frequency||"monthly")?i:best
    , incomes[0]||{});
    const freq = primary?.frequency||"monthly";
    const fraction = freq==="weekly"?0.25:freq==="biweekly"?0.5:1.0;
    const freqLabel = {weekly:"weekly",biweekly:"biweekly",monthly:"monthly"}[freq]||"monthly";

    // Paycheck amount — still user-entered (net varies, paystub needed)
    const amt = Number(state.paycheckAmount)||0;

    // Auto-calculate reserves from state
    const monthlyEss = (state.expenses??[]).filter(e=>e.essential!==false)
        .reduce((s,e)=>s+normalizeToMonthly(e.amount,e.frequency),0);
    const monthlyMins = [...(state.creditCards??[]).map(c=>Number(c.minPayment)||0),
        ...(state.loans??[]).map(l=>Number(l.monthlyPayment)||0)].reduce((a,b)=>a+b,0);

    const essShare = monthlyEss * fraction;

    // Use dueDay for minimums if available — same logic as calcSafeToPay
    const today = new Date();
    const todayDay = today.getDate();
    const nextPayDay = freq === "weekly" ? todayDay + 7 : freq === "biweekly" ? todayDay + 14 : 31;
    const allDebtDues = [
        ...(state.creditCards??[]).map(c=>({min:Number(c.minPayment)||0, dueDay:Number(c.dueDay)||0})),
        ...(state.loans??[]).map(l=>({min:Number(l.monthlyPayment)||0, dueDay:Number(l.dueDay)||0})),
    ];
    const hasDueDays = allDebtDues.some(d=>d.dueDay>0);
    let minsShare;
    if (hasDueDays) {
        const withDays = allDebtDues.filter(d=>d.dueDay>0&&d.dueDay>=todayDay&&d.dueDay<=nextPayDay).reduce((s,d)=>s+d.min,0);
        const withoutDays = allDebtDues.filter(d=>d.dueDay===0).reduce((s,d)=>s+d.min*fraction,0);
        minsShare = withDays + withoutDays;
    } else {
        minsShare = monthlyMins * fraction;
    }

    // Bills: non-essential expenses that fall in this pay period
    const monthlyBills = (state.expenses??[]).filter(e=>e.essential===false)
        .reduce((s,e)=>s+normalizeToMonthly(e.amount,e.frequency),0);
    const billsShare = monthlyBills * fraction;

    const reserved = essShare + minsShare + billsShare;
    const attack = Math.max(0, amt - reserved);
    const hasAmt = amt > 0;
    const hasAmt = amt > 0;

    return (
        <Card border={t.border}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer",marginBottom:hasAmt?12:6}}
                onClick={()=>setOpen(o=>!o)}>
                <Label text="Next Paycheck Plan" sub={`Auto-calculated for ${freqLabel} pay — only enter your paycheck amount`} />
                <span style={{fontSize:12,color:t.subtle,flexShrink:0}}>{open?"▲ hide":"▼ open"}</span>
            </div>

            {/* Paycheck amount input — always visible, it's the one thing we need */}
            <div style={{marginBottom:hasAmt?12:0}}>
                <Inp label="Your next paycheck (net, after tax) ($)"
                    value={state.paycheckAmount}
                    onChange={v=>onUpdate({...state,paycheckAmount:v})}
                    help="Enter your take-home amount. Everything else is calculated automatically." />
            </div>

            {hasAmt&&(
                <div style={{display:"flex",flexDirection:"column",gap:5}}>
                    {[
                        {label:"Paycheck received",value:fmt(amt),color:t.green},
                        {label:`Essential expenses (${freqLabel} share)`,value:`− ${fmt(essShare)}`,color:t.red,
                            sub:`${fmt(monthlyEss)}/mo × ${fraction}`},
                        {label:hasDueDays?`Minimums due before next paycheck`:`Minimum debt payments (${freqLabel} share)`,value:`− ${fmt(minsShare)}`,color:t.red,
                            sub:hasDueDays?`Based on due dates · ${fmt(monthlyMins)}/mo total minimums`:`${fmt(monthlyMins)}/mo × ${fraction}`},
                        {label:`Non-essential bills (${freqLabel} share)`,value:`− ${fmt(billsShare)}`,color:t.red,
                            sub:`${fmt(monthlyBills)}/mo × ${fraction}`},
                        {label:`Send to ${focus?.name||"focus debt"}`,value:fmt(attack),color:t.amber,bold:true,
                            sub:lumpSum>0?"Plus deploy your lump sum separately":undefined},
                    ].map((r,i)=>(
                        <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",
                            padding:"9px 14px",borderRadius:8,
                            background:r.bold?t.amberBg:"transparent",border:`1px solid ${r.bold?t.amberD:t.border}`}}>
                            <div>
                                <div style={{fontSize:13,color:r.bold?t.amber:t.body,fontWeight:r.bold?700:400}}>{r.label}</div>
                                {r.sub&&<div style={{fontSize:11,color:t.subtle,marginTop:1}}>{r.sub}</div>}
                            </div>
                            <span style={{fontSize:14,fontWeight:700,color:r.color,flexShrink:0,marginLeft:12}}>{r.value}</span>
                        </div>
                    ))}
                    {lumpSum>0&&(
                        <div style={{padding:"9px 14px",borderRadius:8,background:t.greenBg,border:`1px solid ${t.greenD}`,marginTop:2}}>
                            <div style={{fontSize:13,fontWeight:600,color:t.green}}>
                                💥 Also deploy {fmt(lumpSum)} lump sum from savings → {focus?.name||"focus debt"}
                            </div>
                            <div style={{fontSize:11,color:"#86efac",marginTop:2}}>Do this once — separate from your regular paycheck split.</div>
                        </div>
                    )}
                </div>
            )}

            {open&&(
                <div style={{marginTop:12,paddingTop:12,borderTop:`1px solid ${t.border}`}}>
                    <div style={{fontSize:12,color:t.subtle,lineHeight:1.6}}>
                        Reserves are calculated from your Expenses and Debts tabs using your {freqLabel} pay schedule.
                        Essential expenses: {fmt(monthlyEss)}/mo · Minimums: {fmt(monthlyMins)}/mo · Non-essential bills: {fmt(monthlyBills)}/mo.
                        Update those tabs to change these numbers.
                    </div>
                </div>
            )}
        </Card>
    );
}

function RiskSection({risk}) {
    const oc={green:{color:t.green,bg:t.greenBg,border:t.greenD,label:"Stable"},
        amber:{color:t.amber,bg:t.amberBg,border:t.amberD,label:"Watch"},
        red:{color:t.red,bg:t.redBg,border:t.redD,label:"Urgent"}}[risk.overall];
    return (
        <Card border={oc.border} bg={oc.bg}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:risk.flags.length?12:0}}>
                <Label text="Risk Status" />
                <span style={{fontSize:12,fontWeight:700,color:oc.color,background:t.bg1,border:`1px solid ${oc.border}`,borderRadius:8,padding:"4px 12px"}}>{oc.label}</span>
            </div>
            {risk.flags.map((f,i)=>(
                <div key={i} style={{display:"flex",gap:10,alignItems:"flex-start",padding:"8px 12px",
                    borderRadius:8,background:t.bg1,border:`1px solid ${t.border}`,marginBottom:5}}>
                    <span style={{color:f.level==="red"?t.red:t.amber,fontSize:13,flexShrink:0,marginTop:1}}>⚠</span>
                    <span style={{fontSize:13,color:f.level==="red"?"#fca5a5":"#fcd34d",lineHeight:1.5}}>{f.text}</span>
                </div>
            ))}
            {!risk.flags.length&&<div style={{fontSize:13,color:t.green}}>No active risk flags. Keep executing the plan.</div>}
        </Card>
    );
}

function Promos({promos}) {
    if(!promos.length) return null;
    const uc={critical:{b:t.redD,bg:t.redBg,pill:t.red},urgent:{b:t.amberD,bg:t.amberBg,pill:t.amber},watch:{b:t.border,bg:t.bg1,pill:t.muted}};
    return (
        <Card border={t.border}>
            <Label text="Promo Deadlines" sub="These rates will reset. Time-sensitive." />
            {promos.map((p,i)=>{
                const c=uc[p.urgency];
                return (
                    <div key={p.id||i} style={{border:`1px solid ${c.b}`,background:c.bg,borderRadius:10,padding:"12px 16px",marginBottom:6}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:6,marginBottom:5}}>
                            <div style={{display:"flex",alignItems:"center",gap:8}}>
                                <span style={{fontSize:13,fontWeight:600,color:t.bright}}>{p.name}</span>
                                <Pill text={p.urgency.toUpperCase()} color={c.pill} bg={c.bg} border={c.b} />
                            </div>
                            <span style={{fontSize:12,color:t.muted}}>{p.monthsRemaining}mo remaining</span>
                        </div>
                        <div style={{fontSize:13,color:t.body,marginBottom:5}}>
                            {fmt(p.balance)} at <strong style={{color:t.green}}>{fmtPct(p.promoApr)}</strong> → resets to <strong style={{color:t.red}}>{fmtPct(p.futureApr)}</strong>
                        </div>
                        <div style={{fontSize:13,fontWeight:600,color:c.pill}}>
                            Pay at least {fmtD(p.required)}/month to clear before reset.
                        </div>
                    </div>
                );
            })}
        </Card>
    );
}

function AttackOrder({prioritized}) {
    const active=prioritized.filter(d=>d.balance>0);
    return (
        <Card border={t.border}>
            <Label text="Attack Order" sub="Pay in this exact order. Do not skip to another debt." />
            {active.map((d,i)=>{
                const isFirst=i===0;
                const pm=d.promoEnd?monthsAway(d.promoEnd):null;
                const soon=pm!==null&&pm<=6&&pm>=0;
                return (
                    <div key={d.id} style={{display:"flex",alignItems:"center",gap:12,padding:"11px 14px",
                        borderRadius:10,border:`1px solid ${isFirst?t.amberD:t.border}`,
                        background:isFirst?t.amberBg:t.bg2,marginBottom:6}}>
                        <div style={{width:24,height:24,borderRadius:"50%",background:isFirst?t.amber:t.border,
                            color:isFirst?"#111":t.subtle,fontSize:12,fontWeight:700,
                            display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{i+1}</div>
                        <div style={{flex:1,minWidth:0}}>
                            <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",marginBottom:2}}>
                                <span style={{fontSize:14,fontWeight:isFirst?700:500,color:isFirst?t.amber:t.bright}}>{d.name}</span>
                                {isFirst&&<Pill text="FOCUS NOW" color="#111" bg={t.amber} border={t.amber} />}
                                {soon&&<Pill text={pm<=2?"CRITICAL":"PROMO ENDING"} color={pm<=2?t.red:t.amber} bg={pm<=2?t.redBg:t.amberBg} border={pm<=2?t.redD:t.amberD} />}
                            </div>
                            <div style={{fontSize:12,color:t.muted}}>
                                {fmt(d.balance)} · {fmtPct(getEffApr(d))} APR{soon&&getFutApr(d)>getEffApr(d)&&<span style={{color:t.red}}> → {fmtPct(getFutApr(d))}</span>} · min {fmt(d.minPayment)}/mo
                            </div>
                        </div>
                        <div style={{textAlign:"right",flexShrink:0}}>
                            <div style={{fontSize:13,fontWeight:600,color:t.red}}>{fmtD(ipm(d.balance,getEffApr(d)))}/mo</div>
                            <div style={{fontSize:10,color:t.subtle}}>interest</div>
                        </div>
                    </div>
                );
            })}
        </Card>
    );
}

function ThisMonth({month,lumpSum,planMonth=1}) {
    if(!month) return null;
    return (
        <Card border={t.amberD} bg={t.amberBg} padding={20}>
            <div style={{display:"flex",justifyContent:"space-between",flexWrap:"wrap",gap:8,marginBottom:14}}>
                <div>
                    <div style={{fontSize:11,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:t.amber,marginBottom:3}}>Month {planMonth} — {month.label}</div>
                    <div style={{fontSize:19,fontWeight:700,color:t.bright}}>Payment Instructions</div>
                </div>
                <div style={{textAlign:"right"}}>
                    <div style={{fontSize:10,color:t.subtle,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:2}}>Focus</div>
                    <div style={{fontSize:16,fontWeight:700,color:t.amber}}>{month.focusDebt}</div>
                    {month.cleared&&<div style={{fontSize:12,color:t.green}}>✓ Cleared this month</div>}
                </div>
            </div>
            <div style={{marginBottom:14}}>{month.instructions.map((item,i)=><ILine key={i} item={item} />)}</div>
            <Grid cols={3} gap={8}>
                {[
                    {label:"Balance drop",value:fmt(month.focusBalance-month.balAfter),color:t.green},
                    {label:"Remaining",value:month.cleared?"CLEARED":fmt(month.balAfter),color:month.cleared?t.green:t.bright},
                    {label:"Next target",value:month.nextTarget||"—",color:t.blue},
                ].map((s,i)=>(
                    <div key={i} style={{background:"#110e00",border:`1px solid ${t.amberD}`,borderRadius:9,padding:"10px 12px"}}>
                        <div style={{fontSize:10,color:t.subtle,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:3}}>{s.label}</div>
                        <div style={{fontSize:15,fontWeight:700,color:s.color,lineHeight:1.2}}>{s.value}</div>
                    </div>
                ))}
            </Grid>
        </Card>
    );
}

function MinWarnings({dangers}) {
    if(!dangers.length) return null;
    const lc={critical:{c:t.red,bg:t.redBg,b:t.redD},danger:{c:t.red,bg:t.redBg,b:t.redD},warning:{c:t.amber,bg:t.amberBg,b:t.amberD}};
    return (
        <Card border={t.border}>
            <Label text="Minimum Payment Warnings" sub="These debts are barely moving. Paying minimums here doesn't work." />
            {dangers.map((d,i)=>{
                const lv=lc[d.level];
                return (
                    <div key={d.id||i} style={{border:`1px solid ${lv.b}`,background:lv.bg,borderRadius:9,padding:"10px 14px",marginBottom:6}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                            <span style={{fontSize:13,fontWeight:600,color:t.bright}}>{d.name}</span>
                            <Pill text={d.level.toUpperCase()} color={lv.c} bg={lv.bg} border={lv.b} />
                        </div>
                        <div style={{fontSize:13,color:lv.c,marginBottom:4,fontWeight:500}}>{d.msg}</div>
                        <div style={{fontSize:12,color:t.muted}}>Payment {fmtD(d.payment)}/mo · Interest {fmtD(d.interest)}/mo · {fmtPct(d.share*100)} of payment is interest</div>
                    </div>
                );
            })}
        </Card>
    );
}

function Lockout({state,onUpdate,prioritized}) {
    const cards=(state.creditCards??[]).filter(c=>Number(c.balance)>0||Number(c.monthlySpend)>0);
    if(!cards.length) return null;
    const focusId=prioritized[0]?.id;
    const lockouts=state.cardLockouts||{};
    const fields=[{key:"noSpend",label:"No spending"},{key:"autopayOff",label:"Autopay off"},{key:"frozen",label:"Frozen"},{key:"stored",label:"Card stored"}];
    function toggle(id,field) {
        const cur=lockouts[id]||{};
        onUpdate({...state,cardLockouts:{...lockouts,[id]:{...cur,[field]:!cur[field]}}});
    }
    return (
        <Card border={t.border}>
            <Label text="Card Lockout Tracker" sub="Recovery mode. Check off each step for every payoff card." />
            {cards.map(card=>{
                const lock=lockouts[card.id]||{};
                const isFocus=card.id===focusId;
                const hasSpend=Number(card.monthlySpend)>0;
                const done=fields.filter(f=>lock[f.key]).length;
                return (
                    <div key={card.id} style={{border:`1px solid ${hasSpend?t.redD:isFocus?t.amberD:t.border}`,
                        background:hasSpend?t.redBg:isFocus?t.amberBg:t.bg2,borderRadius:10,padding:"12px 14px",marginBottom:6}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:6,marginBottom:6}}>
                            <div style={{display:"flex",alignItems:"center",gap:8}}>
                                <span style={{fontSize:13,fontWeight:600,color:isFocus?t.amber:t.bright}}>{card.name}</span>
                                {isFocus&&<Pill text="FOCUS DEBT" color="#111" bg={t.amber} border={t.amber} />}
                                {hasSpend&&<Pill text="⚠ NEW CHARGES" color={t.red} bg={t.redBg} border={t.redD} />}
                            </div>
                            <span style={{fontSize:11,color:t.subtle}}>{done}/{fields.length} done</span>
                        </div>
                        {hasSpend&&<div style={{fontSize:13,color:t.red,marginBottom:8,fontWeight:600}}>New charges detected ({fmt(card.monthlySpend)}/mo). This card is in recovery mode — do not use it.</div>}
                        {isFocus&&!hasSpend&&<div style={{fontSize:13,color:t.amber,marginBottom:8}}>This card is in recovery mode. Do not use it for new purchases.</div>}
                        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                            {fields.map(f=>(
                                <button key={f.key} onClick={()=>toggle(card.id,f.key)}
                                    style={{padding:"6px 11px",borderRadius:7,fontSize:12,cursor:"pointer",fontWeight:lock[f.key]?700:400,
                                        border:`1px solid ${lock[f.key]?t.greenD:t.border}`,
                                        background:lock[f.key]?t.greenBg:t.bg1,color:lock[f.key]?t.green:t.muted}}>
                                    {lock[f.key]?"✓ ":""}{f.label}
                                </button>
                            ))}
                        </div>
                    </div>
                );
            })}
        </Card>
    );
}

function MilestoneSection({milestones}) {
    return (
        <Card border={t.border}>
            <Label text="Milestones" />
            {milestones.completed.length>0&&(
                <div style={{marginBottom:12}}>
                    <div style={{fontSize:10,color:t.subtle,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:6}}>Achieved</div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                        {milestones.completed.map((m,i)=>(
                            <span key={i} style={{background:t.greenBg,border:`1px solid ${t.greenD}`,borderRadius:6,
                                padding:"4px 10px",fontSize:12,color:"#86efac",fontWeight:500}}>✓ {m.label}</span>
                        ))}
                    </div>
                </div>
            )}
            <div style={{fontSize:10,color:t.subtle,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:6}}>Next wins</div>
            {milestones.upcoming.map((m,i)=>(
                <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",borderRadius:8,
                    background:i===0?t.amberBg:t.bg2,border:`1px solid ${i===0?t.amberD:t.border}`,marginBottom:5}}>
                    <span style={{color:i===0?t.amber:t.subtle,fontSize:15}}>{i===0?"🎯":"○"}</span>
                    <span style={{fontSize:13,color:i===0?t.amber:t.muted}}>{m.label}</span>
                </div>
            ))}
        </Card>
    );
}

function Leaks({leaks}) {
    if(!leaks.length) return null;
    return (
        <Card border={t.border}>
            <Label text="Spending Leaks" sub="Optional spending that's slowing your payoff date." />
            {leaks.map((l,i)=>(
                <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                    padding:"10px 14px",borderRadius:8,background:t.bg2,border:`1px solid ${t.border}`,marginBottom:5}}>
                    <div>
                        <div style={{fontSize:13,fontWeight:500,color:t.bright,marginBottom:2}}>{l.category}</div>
                        <div style={{fontSize:12,color:t.muted}}>{fmt(l.optional)}/mo optional · {fmt(l.total)}/mo total</div>
                    </div>
                    <div style={{textAlign:"right"}}>
                        <div style={{fontSize:13,fontWeight:600,color:t.amber}}>+{l.monthsSaved}mo sooner</div>
                        <div style={{fontSize:11,color:t.subtle}}>if cut</div>
                    </div>
                </div>
            ))}
        </Card>
    );
}

function Roadmap({months}) {
    const [expanded,setExpanded]=useState(null);
    const clearances=months.filter(m=>m.cleared);
    return (
        <Card border={t.border}>
            <Label text="Payoff Roadmap" sub="Roll-forward sequence. Each cleared debt accelerates the next." />
            {clearances.length>0&&(
                <div style={{marginBottom:16}}>
                    {clearances.map((m,i)=>{
                        const isLast=i===clearances.length-1;
                        return (
                            <div key={m.month} style={{display:"flex",gap:0}}>
                                <div style={{display:"flex",flexDirection:"column",alignItems:"center",width:28,flexShrink:0}}>
                                    <div style={{width:12,height:12,borderRadius:"50%",background:t.green,border:`2px solid ${t.greenD}`,marginTop:14,flexShrink:0}} />
                                    {!isLast&&<div style={{width:2,flex:1,background:t.border,marginTop:2}} />}
                                </div>
                                <div style={{paddingBottom:isLast?0:16,paddingLeft:10,paddingTop:10}}>
                                    <div style={{fontSize:13,fontWeight:600,color:t.green}}>✓ {m.focusDebt} cleared</div>
                                    <div style={{fontSize:12,color:t.muted}}>~{m.label} · Month {m.month}</div>
                                    {m.nextTarget&&<div style={{fontSize:12,color:t.subtle,marginTop:2}}>→ {m.nextTarget} next · attack pool grows</div>}
                                </div>
                            </div>
                        );
                    })}
                    <div style={{display:"flex",gap:0,alignItems:"center",marginTop:4}}>
                        <div style={{width:28,display:"flex",justifyContent:"center",flexShrink:0}}>
                            <div style={{width:16,height:16,borderRadius:"50%",background:t.amber}} />
                        </div>
                        <div style={{paddingLeft:10}}>
                            <div style={{fontSize:14,fontWeight:700,color:t.amber}}>Debt-free</div>
                            <div style={{fontSize:12,color:t.muted}}>~{clearances[clearances.length-1]?.label}</div>
                        </div>
                    </div>
                </div>
            )}
            <div style={{fontSize:10,color:t.subtle,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:8}}>Month detail</div>
            {months.slice(0,24).map((m,idx)=>(
                <div key={m.month}>
                    <button onClick={()=>setExpanded(expanded===m.month?null:m.month)}
                        style={{width:"100%",textAlign:"left",display:"flex",justifyContent:"space-between",alignItems:"center",
                            padding:"9px 12px",borderRadius:8,marginBottom:4,cursor:"pointer",
                            border:`1px solid ${idx===0?t.amberD:m.cleared?t.greenD:t.border}`,
                            background:idx===0?t.amberBg:m.cleared?t.greenBg:expanded===m.month?t.bg2:"transparent"}}>
                        <div style={{display:"flex",alignItems:"center",gap:10}}>
                            <span style={{fontSize:11,color:idx===0?t.amber:t.subtle,width:48,flexShrink:0}}>
                                {idx===0?"→ NOW":m.cleared?"✓ Mo "+m.month:"Mo "+m.month}
                            </span>
                            <span style={{fontSize:13,color:m.cleared?t.green:idx===0?t.amber:t.body,fontWeight:m.cleared||idx===0?600:400}}>
                                {m.cleared?`✓ ${m.focusDebt} cleared`:`→ ${m.focusDebt}`}
                            </span>
                            {m.cleared&&m.nextTarget&&<span style={{fontSize:12,color:t.subtle}}>→ {m.nextTarget}</span>}
                        </div>
                        <div style={{display:"flex",alignItems:"center",gap:10,flexShrink:0}}>
                            <span style={{fontSize:12,color:t.muted}}>{fmt(m.balAfter)} left</span>
                            <span style={{fontSize:11,color:t.subtle}}>{expanded===m.month?"▲":"▼"}</span>
                        </div>
                    </button>
                    {expanded===m.month&&(
                        <div style={{padding:"6px 12px 4px",borderLeft:`2px solid ${t.border}`,marginLeft:6,marginBottom:4}}>
                            {m.instructions.map((item,j)=><ILine key={j} item={item} />)}
                            <div style={{fontSize:11,color:t.subtle,marginTop:6,display:"flex",gap:16,paddingBottom:4}}>
                                <span>Interest: {fmtD(m.totalInterest)}</span>
                                <span>Attack pool: {fmt(m.pool)}/mo</span>
                            </div>
                        </div>
                    )}
                </div>
            ))}
        </Card>
    );
}

function Budget({income,essential,minimums,surplus}) {
    return (
        <Card border={t.border}>
            <Label text="How the Surplus Is Calculated" />
            {[{l:"Monthly net income",v:fmt(income),c:t.green,s:"+"},{l:"Essential expenses",v:fmt(essential),c:t.red,s:"−"},{l:"Minimum payments",v:fmt(minimums),c:t.red,s:"−"}].map((r,i)=>(
                <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"9px 0",borderBottom:`1px solid ${t.border}`}}>
                    <span style={{fontSize:13,color:t.body}}>{r.l}</span>
                    <span style={{fontSize:14,fontWeight:600,color:r.c}}>{r.s} {r.v}</span>
                </div>
            ))}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 0"}}>
                <span style={{fontSize:14,fontWeight:700,color:t.bright}}>Monthly attack surplus</span>
                <span style={{fontSize:20,fontWeight:700,color:surplus>0?t.green:t.red}}>{fmt(surplus)}/mo</span>
            </div>
        </Card>
    );
}

// ─── COMMITMENT UI ───────────────────────────────────────────────────────────

function CommitButton({months, prioritized, planMonth, state, onUpdate}) {
    const commitment = state.commitment;
    const hasCommitment = !!commitment;

    function commit() {
        const c = buildCommitment(months, prioritized, planMonth);
        if (c) onUpdate({...state, commitment: c});
    }
    function clear() {
        onUpdate({...state, commitment: null});
    }

    if (!months.length || !prioritized.length) return null;

    if (!hasCommitment) {
        return (
            <div style={{border:`1px solid ${t.border}`,background:t.bg1,borderRadius:12,padding:16}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
                    <div>
                        <div style={{fontSize:13,fontWeight:600,color:t.bright,marginBottom:3}}>
                            Commit to this month's plan
                        </div>
                        <div style={{fontSize:12,color:t.muted,lineHeight:1.6}}>
                            Lock in these instructions. On your next import, the app will show
                            whether you followed through and what it means for your payoff date.
                        </div>
                    </div>
                    <button
                        onClick={commit}
                        style={{
                            padding:"10px 20px",borderRadius:9,cursor:"pointer",flexShrink:0,
                            border:`1px solid ${t.amberD}`,background:t.amberBg,
                            color:t.amber,fontSize:14,fontWeight:700,
                        }}
                    >
                        ✓ Commit to Plan
                    </button>
                </div>
            </div>
        );
    }

    const committed = new Date(commitment.date);
    const dateStr = committed.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});
    const daysSince = Math.round((Date.now() - committed.getTime()) / 86400000);
    const isStale = daysSince > 45;

    return (
        <div style={{border:`1px solid ${isStale?t.amberD:t.greenD}`,background:isStale?t.amberBg:t.greenBg,borderRadius:12,padding:16}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:10}}>
                <div>
                    <div style={{fontSize:11,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:isStale?t.amber:t.green,marginBottom:4}}>
                        {isStale?"Plan Committed — May Be Stale":"Plan Committed"}
                    </div>
                    <div style={{fontSize:13,color:isStale?"#fcd34d":"#86efac",lineHeight:1.7}}>
                        Committed {dateStr} · {daysSince} day{daysSince!==1?"s":""} ago · Focus: <strong>{commitment.focusDebt}</strong>
                    </div>
                    {isStale ? (
                        <div style={{fontSize:12,color:t.amber,marginTop:4,lineHeight:1.6}}>
                            This commitment is {daysSince} days old. Consider clearing it and committing to the current month's plan.
                        </div>
                    ) : (
                        <div style={{fontSize:12,color:"#4ade80",marginTop:2}}>
                            Update your balances and import to see how you did.
                        </div>
                    )}
                </div>
                <button
                    onClick={clear}
                    style={{
                        padding:"6px 12px",borderRadius:7,cursor:"pointer",flexShrink:0,
                        border:`1px solid ${t.border}`,background:"transparent",
                        color:t.subtle,fontSize:12,
                    }}
                >
                    Clear
                </button>
            </div>
        </div>
    );
}

function CommitmentVerification({verification}) {
    if (!verification) return null;

    const oc = {
        "on-track": {color:t.green, bg:t.greenBg, border:t.greenD, label:"On Track"},
        "ahead":    {color:t.green, bg:t.greenBg, border:t.greenD, label:"Ahead of Plan"},
        "behind":   {color:t.red,   bg:t.redBg,   border:t.redD,   label:"Behind Plan"},
    }[verification.overall];

    return (
        <Card border={oc.border} bg={oc.bg} padding={18}>
            {/* Header */}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:8,marginBottom:14}}>
                <div>
                    <div style={{fontSize:11,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:oc.color,marginBottom:4}}>
                        Plan Check-In{verification.daysSinceCommit!==null ? ` · ${verification.daysSinceCommit} day${verification.daysSinceCommit!==1?"s":""} after commit` : ""}
                    </div>
                    <div style={{fontSize:22,fontWeight:700,color:oc.color}}>
                        {oc.label}
                    </div>
                </div>
                <div style={{textAlign:"right"}}>
                    <div style={{fontSize:11,color:t.subtle,marginBottom:2}}>vs. projected</div>
                    <div style={{fontSize:20,fontWeight:700,color:verification.totalDelta>=0?t.green:t.red}}>
                        {verification.totalDelta>=0?"↓ ":"↑ "}{fmt(Math.abs(verification.totalDelta))}
                    </div>
                    <div style={{fontSize:11,color:t.subtle}}>
                        {verification.totalDelta>=0?"better than projected":"worse than projected"}
                    </div>
                </div>
            </div>

            {/* Per-debt breakdown */}
            <div style={{display:"flex",flexDirection:"column",gap:5,marginBottom:12}}>
                {verification.debtResults.map((d,i) => {
                    const sc = d.status==="behind"
                        ? {c:t.red, bg:t.redBg, b:t.redD}
                        : {c:t.green, bg:t.greenBg, b:t.greenD};
                    return (
                        <div key={d.id||i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                            padding:"8px 12px",borderRadius:9,background:t.bg1,border:`1px solid ${t.border}`}}>
                            <div>
                                <div style={{fontSize:13,fontWeight:500,color:t.bright,marginBottom:1}}>{d.name}</div>
                                <div style={{fontSize:11,color:t.muted}}>
                                    Projected {fmt(d.projected)} · Actual {fmt(d.actual)}
                                </div>
                            </div>
                            <div style={{textAlign:"right",flexShrink:0}}>
                                <div style={{fontSize:13,fontWeight:700,color:sc.c}}>
                                    {d.status==="on-track"?"✓ On track":
                                     d.diff>0?`↓ ${fmt(d.diff)} ahead`:`↑ ${fmt(Math.abs(d.diff))} behind`}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Plain English verdict */}
            <div style={{fontSize:13,color:t.body,lineHeight:1.8,padding:"10px 14px",borderRadius:9,background:t.bg1,border:`1px solid ${t.border}`}}>
                {verification.overall==="on-track" && (
                    <>You followed the plan. <strong style={{color:t.green}}>Total debt is where it was projected to be.</strong> Keep going — the next month's instructions are below.</>
                )}
                {verification.overall==="ahead" && (
                    <>You paid more than the plan required. <strong style={{color:t.green}}>Total debt is {fmt(Math.abs(verification.totalDelta))} lower than projected.</strong> That accelerates the schedule. The roadmap below reflects the updated position.</>
                )}
                {verification.overall==="behind" && (
                    <>Total debt is <strong style={{color:t.red}}>{fmt(Math.abs(verification.totalDelta))} higher than projected.</strong>{" "}
                    {verification.debtResults.filter(d=>d.status==="behind").map(d=>d.name).join(" and ")} came in above the projected balance.
                    The plan below adjusts from where you actually are now.</>
                )}
            </div>
        </Card>
    );
}

// ─── IMPORT DELTA COMPONENT ──────────────────────────────────────────────────
function ImportDelta({delta}) {
    if (!delta) return null;
    const isGood = delta.totalDelta > 0;
    const isBad = delta.totalDelta < 0;
    return (
        <Card border={isGood?t.greenD:isBad?t.redD:t.border} bg={isGood?t.greenBg:isBad?t.redBg:t.bg1}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:8,marginBottom:delta.debtDeltas.length?12:0}}>
                <div>
                    <div style={{fontSize:11,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",
                        color:isGood?t.green:isBad?t.red:t.muted,marginBottom:3}}>
                        Since Last Update{delta.daysSince!==null?` · ${delta.daysSince} day${delta.daysSince!==1?"s":""} ago`:""}
                    </div>
                    <div style={{fontSize:22,fontWeight:700,color:isGood?t.green:isBad?t.red:t.muted}}>
                        {isGood?"↓ ":isBad?"↑ ":""}{fmt(Math.abs(delta.totalDelta))} total debt {isGood?"paid down":isBad?"added":"unchanged"}
                    </div>
                </div>
                <div style={{textAlign:"right"}}>
                    <div style={{fontSize:11,color:t.subtle,marginBottom:2}}>Previous total</div>
                    <div style={{fontSize:16,fontWeight:600,color:t.muted}}>{fmt(delta.prevTotal)}</div>
                </div>
            </div>
            {delta.debtDeltas.length>0&&(
                <div style={{display:"flex",flexDirection:"column",gap:4}}>
                    {delta.debtDeltas.map((d,i)=>(
                        <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                            padding:"7px 12px",borderRadius:8,
                            background:d.delta>0?t.greenBg:t.redBg,
                            border:`1px solid ${d.delta>0?t.greenD:t.redD}`}}>
                            <span style={{fontSize:13,color:t.body}}>{d.name}</span>
                            <div style={{display:"flex",gap:14,alignItems:"center"}}>
                                <span style={{fontSize:12,color:t.subtle}}>{fmt(d.prevBalance)} → {fmt(d.currentBalance)}</span>
                                <span style={{fontSize:13,fontWeight:700,color:d.delta>0?t.green:t.red}}>
                                    {d.delta>0?`↓ ${fmt(d.delta)}`:`↑ ${fmt(Math.abs(d.delta))}`}
                                </span>
                            </div>
                        </div>
                    ))}
                </div>
            )}
            {delta.newCharges.length>0&&(
                <div style={{marginTop:10,padding:"8px 12px",borderRadius:8,background:t.redBg,border:`1px solid ${t.redD}`}}>
                    <span style={{fontSize:13,color:t.red,fontWeight:600}}>
                        ⚠ New charges detected on: {delta.newCharges.map(d=>d.name).join(", ")}. These cards are in recovery mode.
                    </span>
                </div>
            )}
        </Card>
    );
}

// ─── INTEREST COMPARISON COMPONENT ───────────────────────────────────────────
function InterestComparison({comparison}) {
    if (!comparison) return null;
    return (
        <Card border={t.border}>
            <Label text="The Cost of Minimum-Only Payments" sub="What following this plan saves you vs. paying minimums only." />
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:10,marginBottom:14}}>
                {[
                    {label:"Attack plan — total interest",value:fmt(comparison.attackInterest),color:t.green,
                        sub:`Debt-free in ~${comparison.attackPayoffMonths} months`},
                    {label:"Minimums only — total interest",value:fmt(comparison.miniInterest),color:t.red,
                        sub:`Debt-free in ~${comparison.miniPayoffMonths} months`},
                    {label:"Interest you save",value:fmt(comparison.interestSaved),color:t.amber,
                        sub:`${comparison.monthsSaved} months sooner`},
                ].map((s,i)=>(
                    <div key={i} style={{border:`1px solid ${t.border}`,background:t.bg2,borderRadius:10,padding:"12px 14px"}}>
                        <div style={{fontSize:10,color:t.subtle,letterSpacing:"0.07em",textTransform:"uppercase",marginBottom:5}}>{s.label}</div>
                        <div style={{fontSize:20,fontWeight:700,color:s.color}}>{s.value}</div>
                        {s.sub&&<div style={{fontSize:11,color:t.subtle,marginTop:3}}>{s.sub}</div>}
                    </div>
                ))}
            </div>
            <div style={{fontSize:13,color:t.body,lineHeight:1.7,padding:"10px 14px",borderRadius:9,background:t.bg2,border:`1px solid ${t.border}`}}>
                Following this plan instead of paying minimums saves approximately{" "}
                <strong style={{color:t.amber}}>{fmt(comparison.interestSaved)}</strong> in interest and gets you debt-free{" "}
                <strong style={{color:t.green}}>{comparison.monthsSaved} months sooner</strong>.
                Every month you delay costs roughly{" "}
                <strong style={{color:t.red}}>{fmt(comparison.attackInterest/Math.max(1,comparison.attackPayoffMonths))}/month</strong> in interest.
            </div>
        </Card>
    );
}

// ─── INCOME EDIT COMPONENT ────────────────────────────────────────────────────
function IncomeEdit({state,onUpdate}) {
    const [editing,setEditing]=useState(null);
    const incomes=state.incomes??[];
    const [draft,setDraft]=useState({name:"",amount:0,frequency:"monthly"});

    function add() {
        if(!draft.name.trim()) return;
        onUpdate({...state,incomes:[...incomes,{...draft,id:crypto.randomUUID?.()??Math.random().toString(36).slice(2)}]});
        setDraft({name:"",amount:0,frequency:"monthly"});
    }
    function remove(id) { onUpdate({...state,incomes:incomes.filter(i=>i.id!==id)}); }
    function save(id,updated) {
        onUpdate({...state,incomes:incomes.map(i=>i.id===id?{...i,...updated}:i)});
        setEditing(null);
    }

    const total=incomes.reduce((s,i)=>s+normalizeToMonthly(i.amount,i.frequency),0);
    const is={minHeight:40,borderRadius:8,border:`1px solid ${t.border}`,background:t.bg2,color:t.bright,padding:"8px 10px",fontSize:13,outline:"none"};

    return (
        <Card border={t.border}>
            <Label text="Income" sub={`Combined monthly: ${fmt(total)}`} />
            <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:12}}>
                {incomes.map(inc=>(
                    <div key={inc.id} style={{border:`1px solid ${t.border}`,borderRadius:9,padding:"10px 12px",background:t.bg2}}>
                        {editing===inc.id ? (
                            <IncomeEditRow inc={inc} onSave={u=>save(inc.id,u)} onCancel={()=>setEditing(null)} />
                        ) : (
                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}>
                                <div>
                                    <div style={{fontSize:13,fontWeight:500,color:t.bright}}>{inc.name}</div>
                                    <div style={{fontSize:12,color:t.muted}}>{inc.frequency} · {fmt(inc.amount)} ({fmt(normalizeToMonthly(inc.amount,inc.frequency))}/mo)</div>
                                </div>
                                <div style={{display:"flex",gap:6}}>
                                    <button onClick={()=>setEditing(inc.id)} style={{padding:"4px 10px",borderRadius:6,border:`1px solid ${t.border}`,background:"transparent",color:t.muted,fontSize:12,cursor:"pointer"}}>Edit</button>
                                    <button onClick={()=>remove(inc.id)} style={{padding:"4px 10px",borderRadius:6,border:`1px solid ${t.redD}`,background:"transparent",color:t.red,fontSize:12,cursor:"pointer"}}>Remove</button>
                                </div>
                            </div>
                        )}
                    </div>
                ))}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1fr auto",gap:8,alignItems:"end"}}>
                <input placeholder="Income source" value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})} style={{...is}} />

                <input type="number" placeholder="Amount" value={draft.amount||""} onChange={e=>setDraft({...draft,amount:parseFloat(e.target.value)||0})} style={{...is}} />
                <select value={draft.frequency} onChange={e=>setDraft({...draft,frequency:e.target.value})} style={{...is}}>
                    {["weekly","biweekly","monthly","annual"].map(f=><option key={f}>{f}</option>)}
                </select>
                <button onClick={add} style={{minHeight:40,padding:"0 14px",borderRadius:8,border:`1px solid ${t.border}`,background:t.bg1,color:t.bright,fontSize:13,cursor:"pointer",whiteSpace:"nowrap"}}>Add</button>
            </div>
        </Card>
    );
}

function IncomeEditRow({inc,onSave,onCancel}) {
    const [v,setV]=useState({name:inc.name,amount:inc.amount,frequency:inc.frequency});
    const is={minHeight:36,borderRadius:7,border:`1px solid ${t.border}`,background:t.bg1,color:t.bright,padding:"6px 10px",fontSize:13,outline:"none"};
    return (
        <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1fr auto auto",gap:8,alignItems:"center"}}>
            <input value={v.name} onChange={e=>setV({...v,name:e.target.value})} style={{...is}} />

            <input type="number" value={v.amount||""} onChange={e=>setV({...v,amount:parseFloat(e.target.value)||0})} style={{...is}} />
            <select value={v.frequency} onChange={e=>setV({...v,frequency:e.target.value})} style={{...is}}>
                {["weekly","biweekly","monthly","annual"].map(f=><option key={f}>{f}</option>)}
            </select>
            <button onClick={()=>onSave(v)} style={{padding:"6px 12px",borderRadius:7,border:`1px solid ${t.greenD}`,background:t.greenBg,color:t.green,fontSize:12,cursor:"pointer"}}>Save</button>
            <button onClick={onCancel} style={{padding:"6px 10px",borderRadius:7,border:`1px solid ${t.border}`,background:"transparent",color:t.muted,fontSize:12,cursor:"pointer"}}>✕</button>
        </div>
    );
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
// ─── INCOME SANITY WARNING ───────────────────────────────────────────────────
function IncomeSanityWarning({flags}) {
    if (!flags.length) return null;
    return (
        <Card border={t.amberD} bg={t.amberBg}>
            <div style={{fontSize:11,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:t.amber,marginBottom:8}}>
                ⚠ Income Entry May Be Incorrect
            </div>
            {flags.map((f,i)=>(
                <div key={f.id||i} style={{fontSize:13,color:"#fcd34d",lineHeight:1.7,marginBottom:i<flags.length-1?8:0}}>
                    <strong style={{color:t.amber}}>{f.name}:</strong> {f.msg}
                </div>
            ))}
            <div style={{fontSize:12,color:t.amberD,marginTop:8,color:"#92400e"}}>
                Fix this in the Income section above — incorrect income makes the entire plan unreliable.
            </div>
        </Card>
    );
}

// ─── SELLABLE ASSETS ─────────────────────────────────────────────────────────
function SellableAssetsCard({sellableData, lumpSum}) {
    if (!sellableData) return null;
    const {sellItems, maybeItems, sellTotal, maybeTotal, pctOfDebt} = sellableData;

    return (
        <Card border={t.border}>
            <Label text="Sellable Assets" sub="Assets you've marked 'sell' or 'maybe' in the Assets tab — potential lump sums for debt." />
            <Grid cols={2} gap={10}>
                <div style={{border:`1px solid ${t.greenD}`,background:t.greenBg,borderRadius:10,padding:"12px 14px"}}>
                    <div style={{fontSize:10,color:t.muted,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:4}}>Ready to sell</div>
                    <div style={{fontSize:22,fontWeight:700,color:t.green}}>{fmt(sellTotal)}</div>
                    <div style={{fontSize:11,color:"#86efac",marginTop:3}}>{sellItems.length} asset{sellItems.length!==1?"s":""} marked sell</div>
                </div>
                <div style={{border:`1px solid ${t.border}`,background:t.bg2,borderRadius:10,padding:"12px 14px"}}>
                    <div style={{fontSize:10,color:t.muted,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:4}}>Considering</div>
                    <div style={{fontSize:22,fontWeight:700,color:t.amber}}>{fmt(maybeTotal)}</div>
                    <div style={{fontSize:11,color:t.subtle,marginTop:3}}>{maybeItems.length} asset{maybeItems.length!==1?"s":""} marked maybe</div>
                </div>
            </Grid>
            {sellTotal > 0 && (
                <div style={{marginTop:12,padding:"10px 14px",borderRadius:9,background:t.bg2,border:`1px solid ${t.border}`,fontSize:13,color:t.body,lineHeight:1.7}}>
                    Applying your <strong style={{color:t.green}}>{fmt(sellTotal)}</strong> in sellable assets as a lump sum
                    {pctOfDebt > 0.15
                        ? <> would eliminate <strong style={{color:t.green}}>{(pctOfDebt*100).toFixed(0)}% of total debt</strong> immediately — potentially skipping one or more phases.</>
                        : <> would reduce total debt by <strong style={{color:t.green}}>{(pctOfDebt*100).toFixed(0)}%</strong>.</>
                    }
                    {" "}Model this in the Scenarios tab → Lump Sum.
                </div>
            )}
            {[...sellItems, ...maybeItems].length > 0 && (
                <div style={{display:"flex",flexWrap:"wrap",gap:6,marginTop:10}}>
                    {[...sellItems.map(a=>({...a,type:"sell"})),...maybeItems.map(a=>({...a,type:"maybe"}))].map((a,i)=>(
                        <span key={a.id||i} style={{
                            fontSize:11,padding:"3px 9px",borderRadius:4,
                            background:a.type==="sell"?t.greenBg:t.amberBg,
                            color:a.type==="sell"?t.green:t.amber,
                            border:`1px solid ${a.type==="sell"?t.greenD:t.amberD}`,
                        }}>
                            {a.name} · {fmt(Number(a.quickSaleValue)||0)}
                        </span>
                    ))}
                </div>
            )}
        </Card>
    );
}

// ─── COMMIT HISTORY TABLE ─────────────────────────────────────────────────────
function CommitHistoryTable({commitStatus, state, onUpdate, months, prioritized, planMonth}) {
    const {history, needsCommit, daysSinceLastActivity, streak} = commitStatus;

    function commit() {
        const c = buildCommitment(months, prioritized, planMonth);
        if (c) onUpdate({...state, commitment: c});
    }

    const overallStyle = {
        "on-track": {color:t.green,   bg:t.greenBg,  border:t.greenD,  label:"On Track"},
        "ahead":    {color:t.green,   bg:t.greenBg,  border:t.greenD,  label:"Ahead"},
        "behind":   {color:t.red,     bg:t.redBg,    border:t.redD,    label:"Behind"},
        "pending":  {color:t.amber,   bg:t.amberBg,  border:t.amberD,  label:"Pending"},
        "missed":   {color:t.muted,   bg:t.bg2,      border:t.border,  label:"No commit"},
    };

    return (
        <Card border={t.border}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:8,marginBottom:14}}>
                <div>
                    <Label text="Check-In History" sub="Every commitment and verification, oldest to newest." />
                    {streak > 1 && (
                        <div style={{fontSize:12,color:t.green,marginTop:4}}>
                            🔥 {streak} consecutive month{streak!==1?"s":""} on track or ahead
                        </div>
                    )}
                </div>
                <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                    {daysSinceLastActivity !== null && (
                        <div style={{fontSize:12,color:t.muted}}>
                            Last activity {daysSinceLastActivity}d ago
                        </div>
                    )}
                </div>
            </div>

            {/* Nudge to commit if overdue */}
            {needsCommit && months.length > 0 && (
                <div style={{border:`1px solid ${t.amberD}`,background:t.amberBg,borderRadius:9,padding:"12px 14px",marginBottom:12}}>
                    <div style={{fontSize:13,color:t.amber,fontWeight:600,marginBottom:6}}>
                        It's been {daysSinceLastActivity} days since your last check-in.
                    </div>
                    <div style={{fontSize:12,color:"#fcd34d",marginBottom:10,lineHeight:1.6}}>
                        Commit to this month's plan now so you can verify progress on your next import.
                    </div>
                    <button onClick={commit} style={{padding:"7px 16px",borderRadius:8,border:`1px solid ${t.amberD}`,
                        background:"#78350f",color:t.amber,fontSize:13,fontWeight:700,cursor:"pointer"}}>
                        ✓ Commit to this month
                    </button>
                </div>
            )}

            {/* History table */}
            {history.length === 0 ? (
                <div style={{fontSize:13,color:t.subtle,lineHeight:1.7,padding:"8px 0"}}>
                    No history yet. Commit to a plan and import updated balances to start tracking.
                </div>
            ) : (
                <div style={{display:"flex",flexDirection:"column",gap:5}}>
                    {/* Header */}
                    <div style={{display:"grid",gridTemplateColumns:"90px 1fr 90px 90px",gap:8,
                        padding:"6px 10px",fontSize:10,color:t.subtle,
                        textTransform:"uppercase",letterSpacing:"0.07em"}}>
                        <span>Date</span>
                        <span>Focus Debt</span>
                        <span>Result</span>
                        <span>Delta</span>
                    </div>
                    {history.map((entry, i) => {
                        const s = overallStyle[entry.overall] || overallStyle["on-track"];
                        const vDate = new Date(entry.verifyDate).toLocaleDateString("en-US",{month:"short",day:"numeric"});
                        return (
                            <div key={i} style={{display:"grid",gridTemplateColumns:"90px 1fr 90px 90px",gap:8,
                                padding:"8px 10px",borderRadius:8,
                                background:i===0?t.bg2:"transparent",
                                border:`1px solid ${i===0?t.border:"transparent"}`}}>
                                <span style={{fontSize:12,color:t.muted}}>{vDate}</span>
                                <span style={{fontSize:12,color:t.body,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                                    {entry.focusDebt || "—"}
                                </span>
                                <span style={{fontSize:11,fontWeight:600,color:s.color,
                                    background:s.bg,border:`1px solid ${s.border}`,
                                    borderRadius:4,padding:"2px 7px",textAlign:"center",whiteSpace:"nowrap"}}>
                                    {s.label}
                                </span>
                                <span style={{fontSize:12,fontWeight:600,
                                    color:entry.totalDelta>=0?t.green:t.red,textAlign:"right"}}>
                                    {entry.totalDelta>=0?"↓ ":"↑ "}{fmt(Math.abs(entry.totalDelta||0))}
                                </span>
                            </div>
                        );
                    })}
                </div>
            )}
        </Card>
    );
}

// ─── ONBOARDING ──────────────────────────────────────────────────────────────
function Onboarding({state, tab, setTab}) {
    const hasIncome = (state.incomes??[]).length > 0;
    const hasDebts = (state.creditCards??[]).length > 0 || (state.loans??[]).length > 0;
    const hasExpenses = (state.expenses??[]).length > 0;
    const done = hasIncome && hasDebts;

    if (done) return null;

    const steps = [
        {
            num: "1",
            title: "Add your income",
            detail: "Enter your take-home pay in the Income section below. Use your actual net (after tax) amount.",
            done: hasIncome,
            action: null, // Income is on this page
        },
        {
            num: "2",
            title: "Add your debts",
            detail: "Enter every credit card and loan in the Debts tab — balance, APR, minimum payment, and what you spend each month on active cards.",
            done: hasDebts,
            action: () => setTab("Debts"),
            actionLabel: "→ Go to Debts",
        },
        {
            num: "3",
            title: "Add your expenses",
            detail: "Enter your regular monthly expenses in the Expenses tab. Mark each as essential or discretionary.",
            done: hasExpenses,
            action: () => setTab("Expenses"),
            actionLabel: "→ Go to Expenses",
        },
    ];

    return (
        <Card border={t.amberD} bg={t.amberBg} padding={20}>
            <div style={{fontSize:11,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:t.amber,marginBottom:8}}>
                Getting Started
            </div>
            <div style={{fontSize:13,color:"#fcd34d",lineHeight:1.7,marginBottom:14}}>
                Complete these three steps and the Attack Map will build your plan automatically.
            </div>
            {steps.map((s,i)=>(
                <div key={i} style={{display:"flex",gap:12,padding:"10px 0",borderBottom:i<2?`1px solid ${t.amberD}`:"none",alignItems:"flex-start"}}>
                    <div style={{
                        width:24,height:24,borderRadius:"50%",flexShrink:0,marginTop:2,
                        background:s.done?t.green:t.amberD,
                        color:s.done?"#fff":t.amber,
                        fontSize:12,fontWeight:700,
                        display:"flex",alignItems:"center",justifyContent:"center",
                    }}>
                        {s.done?"✓":s.num}
                    </div>
                    <div style={{flex:1}}>
                        <div style={{fontSize:13,fontWeight:600,color:s.done?"#86efac":t.amber,marginBottom:3}}>
                            {s.title}
                        </div>
                        <div style={{fontSize:12,color:s.done?"#4ade80":"#fcd34d",lineHeight:1.6}}>
                            {s.detail}
                        </div>
                    </div>
                    {s.action && !s.done && (
                        <button onClick={s.action} style={{
                            fontFamily:"inherit",fontSize:12,fontWeight:600,
                            color:t.amber,background:"transparent",
                            border:`1px solid ${t.amberD}`,borderRadius:6,
                            padding:"5px 12px",cursor:"pointer",flexShrink:0,marginTop:2,
                        }}>
                            {s.actionLabel}
                        </button>
                    )}
                </div>
            ))}
        </Card>
    );
}

// ─── DEBT-FREE DATE ───────────────────────────────────────────────────────────
function DebtFreeDate({debtFreeLabel, debtFreeMonth, planMonth}) {
    if (!debtFreeLabel) return null;
    const monthsLeft = debtFreeMonth - planMonth;
    return (
        <div style={{
            border:`2px solid ${t.greenD}`,background:t.greenBg,
            borderRadius:12,padding:"16px 20px",
            display:"flex",justifyContent:"space-between",alignItems:"center",
            flexWrap:"wrap",gap:10,
        }}>
            <div>
                <div style={{fontSize:11,fontWeight:700,letterSpacing:"0.1em",
                    textTransform:"uppercase",color:t.green,marginBottom:4}}>
                    Projected Debt-Free Date
                </div>
                <div style={{fontSize:28,fontWeight:700,color:t.green,lineHeight:1.1}}>
                    {debtFreeLabel}
                </div>
                <div style={{fontSize:13,color:"#86efac",marginTop:4}}>
                    {monthsLeft > 0
                        ? `${monthsLeft} month${monthsLeft!==1?"s":""} from now if you follow the plan`
                        : "This month — you're almost there"}
                </div>
            </div>
            <div style={{fontSize:40,lineHeight:1}}>🏁</div>
        </div>
    );
}

export default function AttackMap({state,onUpdate,setTab}) {
    // Financial data key — only recompute heavy simulations when debts/income/expenses change
    // UI-only state (locks, paycheck inputs, savings balance) does not trigger simulation
    const financialKey = useMemo(()=>JSON.stringify({
        cards: state.creditCards,
        loans: state.loans,
        incomes: state.incomes,
        expenses: state.expenses,
        assets: state.assets,
        savingsBalance: state.savingsBalance,
        emergencyTarget: state.emergencyTarget,
        planStartDate: state.planStartDate,
        lastSnapshot: state.lastSnapshot,
        prevSnapshot: state.prevSnapshot,
        commitment: state.commitment,
        commitHistory: state.commitHistory,
    }),[
        state.creditCards, state.loans, state.incomes, state.expenses, state.assets,
        state.savingsBalance, state.emergencyTarget,
        state.planStartDate, state.lastSnapshot, state.prevSnapshot,
        state.commitment, state.commitHistory,
    ]);

    // Heavy simulation memo — only recalculates when financial data changes
    const sim = useMemo(()=>{
        const {income,essential,minimums,surplus}=calcSurplus(state);
        const savingsBalance=Number(state.savingsBalance)||0;
        const emergencyTarget=Number(state.emergencyTarget)||2500;
        const lumpSum=Math.max(0,savingsBalance-emergencyTarget);
        // Apply card lockout — zero monthlySpend on cards marked "no spending"
        const lockouts = state.cardLockouts || {};
        const lockedCards = (state.creditCards ?? []).map(c => {
            const lock = lockouts[c.id] || {};
            return lock.noSpend ? { ...c, monthlySpend: 0 } : c;
        });
        const prioritized = prioritizeDebts(lockedCards, state.loans);
        const promos=calcPromos(state.creditCards);
        const allDebts=normalizeDebts(lockedCards,state.loans);
        const dangers=calcDangers(allDebts);
        const risk=calcRisk(state,surplus,prioritized,promos);
        const milestones=calcMilestones(state,prioritized);
        const leaks=calcLeaks(state,surplus,prioritized,lumpSum);
        const months=prioritized.length>0&&surplus>0?simulate(prioritized,surplus,lumpSum):[];
        const monthlyInterest=prioritized.reduce((s,d)=>s+ipm(d.balance,getEffApr(d)),0);
        const importDelta=calcImportDelta(state,prioritized);
        const planMonth=calcPlanMonth(state);
        const interestComparison=prioritized.length>0&&surplus>0
            ?calcInterestComparison(prioritized,surplus,lumpSum):null;
        const hasSnapshotToVerify = importDelta || state.lastSnapshot;
        const commitmentVerification = state.commitment && hasSnapshotToVerify
            ? calcCommitmentVerification(state.commitment, prioritized)
            : null;
        const incomeSanityFlags = checkIncomeSanity(state.incomes);
        const sellableAssets = calcSellableAssets(state, prioritized, surplus, lumpSum);
        const commitStatus = calcCommitStatus(state);
        // Debt-free date from simulation
        const debtFreeMonth = months.find(m => m.cleared && !months.find(m2 => m2.month > m.month && m2.balAfter > 0.01))?.month || null;
        const debtFreeLabel = debtFreeMonth ? addMonthsLabel(debtFreeMonth - 1) : null;

        return {income,essential,minimums,surplus,savingsBalance,emergencyTarget,lumpSum,
            prioritized,promos,dangers,risk,milestones,leaks,months,monthlyInterest,
            importDelta,planMonth,interestComparison,commitmentVerification,
            incomeSanityFlags,sellableAssets,commitStatus,
            debtFreeMonth, debtFreeLabel};
    },[financialKey]); // eslint-disable-line react-hooks/exhaustive-deps

    // Light memo — UI inputs that update frequently without triggering full simulation
    const model = useMemo(()=>({
        ...sim,
        safeData: calcSafeToPay(state),
    }),[sim, state.savingsBalance, state.emergencyTarget, state.upcomingBills,
        state.upcomingMins, state.essentialCash, state.incomes]);

    const hasDebts=model.prioritized.length>0;
    const hasIncome=model.income>0;
    const focus=model.prioritized[0]||null;

    return (
        <div style={{display:"flex",flexDirection:"column",gap:14,maxWidth:980,margin:"0 auto",padding:"0 0 48px"}}>
            <div>
                <h2 style={{fontSize:13,fontWeight:700,color:t.bright,margin:"0 0 3px",letterSpacing:"0.04em",textTransform:"uppercase"}}>Debt Attack Map</h2>
                <p style={{fontSize:13,color:t.muted,margin:0,lineHeight:1.7}}>You don't need to decide what to pay. This tells you what to pay first, how much, and why.</p>
            </div>

            {/* Onboarding — only shows when data is missing */}
            <Onboarding state={state} setTab={setTab||(() => {})} />

            {/* Import delta — what changed since last update */}
            {model.importDelta&&<ImportDelta delta={model.importDelta} />}

            {/* Commitment verification — show right after import if plan was committed */}
            {model.commitmentVerification&&(
                <CommitmentVerification verification={model.commitmentVerification} />
            )}

            {hasIncome&&hasDebts&&model.surplus>0&&<TodayCard month={model.months[0]} lumpSum={model.lumpSum} focus={focus} emergencyTarget={model.emergencyTarget} surplus={model.surplus} />}
            {model.debtFreeLabel&&<DebtFreeDate debtFreeLabel={model.debtFreeLabel} debtFreeMonth={model.debtFreeMonth} planMonth={model.planMonth} />}
            <SafePay safeData={model.safeData} state={state} onUpdate={onUpdate} />

            {/* Income management — inline so it doesn't require a tab switch */}
            <IncomeEdit state={state} onUpdate={onUpdate} />
            {model.incomeSanityFlags.length>0&&<IncomeSanityWarning flags={model.incomeSanityFlags} />}

            {!hasIncome&&<div style={{border:`1px solid ${t.border}`,background:t.bg1,borderRadius:12,padding:20,textAlign:"center"}}>
                <div style={{fontSize:15,fontWeight:600,color:t.bright,marginBottom:6}}>Add your income above</div>
                <div style={{fontSize:13,color:t.muted}}>Enter your take-home pay in the Income section above.</div>
            </div>}

            {hasIncome&&!hasDebts&&<div style={{border:`1px solid ${t.border}`,background:t.bg1,borderRadius:12,padding:20,textAlign:"center"}}>
                <div style={{fontSize:15,fontWeight:600,color:t.bright,marginBottom:6}}>Add your debts</div>
                <div style={{fontSize:13,color:t.muted}}>Go to the Debts tab and enter your cards and loans.</div>
            </div>}

            {hasIncome&&hasDebts&&model.surplus<=0&&(
                <div style={{border:`1px solid ${t.redD}`,background:t.redBg,borderRadius:12,padding:18}}>
                    <div style={{fontSize:13,fontWeight:700,color:t.red,marginBottom:8,textTransform:"uppercase",letterSpacing:"0.06em"}}>
                        ⚠ No Attack Surplus — Here's What To Do
                    </div>
                    <div style={{fontSize:13,color:"#fca5a5",lineHeight:1.8,marginBottom:14}}>
                        Income ({fmt(model.income)}) minus expenses ({fmt(model.essential)}) minus minimums ({fmt(model.minimums)}) leaves nothing extra to attack debt.
                        The plan can't accelerate until this changes. Here's what to do:
                    </div>
                    {[
                        {step:"1", title:"Pay every minimum on time", detail:"Missing minimums triggers fees and rate increases — making the hole deeper. Minimums are non-negotiable."},
                        {step:"2", title:"Cut one expense category now", detail:`Your non-essential expenses total ${fmt((model.essential||0))} but review every subscription, dining, and shopping line in the Expenses tab. Cutting ${fmt(200)}/mo unlocks the plan.`},
                        {step:"3", title:"Find any extra income this month", detail:"One extra paycheck, a sold item, or overtime shifts directly into the focus debt. Even $300 applied once breaks the standstill."},
                        {step:"4", title:"Call your highest-APR card", detail:"Ask for a temporary hardship rate reduction. Many issuers offer 6–12 months at lower APR for customers who ask. This is free to try."},
                        {step:"5", title:"Do not add new charges", detail:"Every new purchase extends the timeline. The cards are closed for spending until the surplus is positive."},
                    ].map((s,i)=>(
                        <div key={i} style={{display:"flex",gap:12,padding:"10px 0",borderBottom:i<4?`1px solid ${t.redD}`:"none"}}>
                            <div style={{width:24,height:24,borderRadius:"50%",background:t.redD,color:t.red,fontSize:12,fontWeight:700,
                                display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:1}}>{s.step}</div>
                            <div>
                                <div style={{fontSize:13,fontWeight:600,color:"#fca5a5",marginBottom:2}}>{s.title}</div>
                                <div style={{fontSize:12,color:"#f87171",lineHeight:1.6}}>{s.detail}</div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {hasIncome&&hasDebts&&model.surplus>0&&(<>
                <PaycheckPlan state={state} onUpdate={onUpdate} prioritized={model.prioritized} lumpSum={model.lumpSum} />
                <RiskSection risk={model.risk} />
                {model.promos.length>0&&<Promos promos={model.promos} />}
                <AttackOrder prioritized={model.prioritized} />
                {model.months[0]&&<ThisMonth month={model.months[0]} lumpSum={model.lumpSum} planMonth={model.planMonth} />}
                <CommitButton
                    months={model.months}
                    prioritized={model.prioritized}
                    planMonth={model.planMonth}
                    state={state}
                    onUpdate={onUpdate}
                />
                {model.dangers.length>0&&<MinWarnings dangers={model.dangers} />}
                <Lockout state={state} onUpdate={onUpdate} prioritized={model.prioritized} />
                <MilestoneSection milestones={model.milestones} />
                {model.sellableAssets&&<SellableAssetsCard sellableData={model.sellableAssets} lumpSum={model.lumpSum} />}
                {model.leaks.length>0&&<Leaks leaks={model.leaks} />}
                {model.months.length>1&&<Roadmap months={model.months} />}
                {model.interestComparison&&<InterestComparison comparison={model.interestComparison} />}
                <Budget income={model.income} essential={model.essential} minimums={model.minimums} surplus={model.surplus} />
                <CommitHistoryTable
                    commitStatus={model.commitStatus}
                    state={state}
                    onUpdate={onUpdate}
                    months={model.months}
                    prioritized={model.prioritized}
                    planMonth={model.planMonth}
                />
            </>)}
        </div>
    );
}
