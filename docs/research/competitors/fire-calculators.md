# FIRE calculators: comparison and recommendation for M27

Researched 2026-11-27. Public pages only, no sign-ups. The pages were read with a text fetcher, so anything drawn by JavaScript after load (charts, live results) may be missing. Each section says what could and could not be seen.

**Could not be fetched or found:**
- ET Money: the fetcher was refused by etmoney.com. A third-party guide claims it does "tax-adjusted withdrawals" ([investingpro.in](https://www.investingpro.in/articles/fire-retirement-calculator-india)); not verified.
- Kuvera, Zerodha/Varsity, Value Research: no FIRE calculator turned up in search; not checked further.
- Policybazaar: timed out.
- Richify: returned HTTP 410.
- Reddit (old.reddit.com and mirrors): refused or 403. Community views below come from the FIRE India wiki, freefincal and press reports instead.

## 1. Comparison table

Key: ✔ = present, ✘ = absent, ? = not visible in the fetched text (probably drawn by JavaScript).

| | Velthian | Portfolio360 | Finnovate | Groww FIRE | Scripbox | 5paisa | INDmoney (retirement) | Networthify | FIRECalc | cFIREsim | ProjectionLab |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Age / retire age | ✔ / slider "years to retire" | ✔ / ✔ | ✔ 45 / 55 | age only | ✔ / ✔ | ✔ / ✔ | ✔ / ✔ | ✘ | years only | years | ✔ |
| Life expectancy ("plan until") | ✘ | ✔ | ✔ 85 | ✘ | ✘ | ✘ | ✔ | ✘ (perpetual) | ✔ years | ✔ end year | ✔ |
| Expenses | monthly household | monthly | monthly, ₹1 L | monthly | monthly | monthly | post-retirement monthly | annual | annual | annual | detailed |
| Inflation input | fixed 6% | ✔ | ✔ 7% | ✔ | ✘ | ✔ | ✔ | real returns | historical CPI | historical CPI or flat | ✔ |
| Pre / post-FI return split | single 10% | ✔ / ✔ | 12% / 8% | single | single | SIP at 12% | single | single (real) | historical | historical | ✔ |
| Per-asset returns | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | stock/bond mix | equity/bond/gold/cash | ✔ |
| Current corpus | ✔ (lumped) | ✔ | ✔ | ✔ | ✔ | ✘ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Monthly SIP | ✘ (income instead) | ✔ | ✔ | ✔ | ? | ✘ | ✘ | savings rate | savings till retire | ✘ | ✔ |
| SIP step-up | ✘ | ✘ | 10% compared as an output | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✔ |
| One-time goals | ✔ (kids' education, wedding, home) | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✔ lump sums | ✔ adjustments | ✔ |
| EPF/PPF/NPS | lumped into corpus | ✘ | told to add to corpus | ✘ | ✘ | ✘ | EPF in example | ✘ | pension income | pension/SS | ✔ (US/other) |
| Other income | ✘ | ✘ | ✘ | ✔ | ✘ | ✘ | ✘ | ✘ | ✔ | ✔ | ✔ |
| Dependents / healthcare | ✔ / ✔ toggle | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✔ |
| Tax on withdrawals | ✘ | ✘ (said openly) | ✘ | ✘ | ✘ | ✘ | ✘ | post-tax return | ✘ | ✘ | ✔ (not India) |
| Withdrawal-rate input | fixed 3% (×33.3) | none (present value) | none (present value) | ✔ | fixed 4% (×25) | fixed 4% (×25) | ✘ | ✔ 4% | spending models | 7+ spending rules | ✔ |
| Lean/Fat/Coast/Barista | L/R/F toggle, coast explained | ✘ | lean 60% / fat 150% | ✘ | text only | lean/fat | ✘ | ✘ | ✘ | ✘ | coast not stated |
| FIRE number | ✔ today's ₹ and future ₹ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | n/a | n/a | ✔ |
| Gap / required SIP | ✘ | ✔ / ✔ | ✔ / ✔ (flat and 10% step-up) | gap ✔ | ? | SIP ✔ | SIP ✔ | ✘ | search for max spend | search for max spend | ✔ |
| Years / FI date | ✘ | "Freedom year" | ✔ + "money lasts until" | ✔ years and age | ✔ timeline | ✘ | ✘ | ✔ | n/a | n/a | ✔ |
| Progress % | ✔ | ✔ | ✘ | ✔ | ✘ | ✘ | ✘ | ✔ | ✘ | ✘ | ✔ |
| Chart / year table | ? ("Breakdown") | ✘ | ✔ wealth trajectory chart | ? | ? | ✘ | ✘ | ✔ chart + table | ✔ chart | ✔ (49 sim tabs) | ✔ |
| Success probability | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✔ historical | ✔ historical | ✔ Monte Carlo + backtest |
| No login / share link | ✔ / ✔ | ✔ / ✘ | ✔ / ✘ | ✔ / ? | ✔ / ? | ✔ / ? | ? / ? | ✔ / ✔ | ✔ (stores nothing) / ✘ | ✔ / ? | account needed / – |

## 2. Calculator notes

### Velthian: velthian.com/fire.php (owner's reference)
Source: https://velthian.com/fire.php

- **Inputs:** A four-step wizard: Basics, Money, Family, Commitments.
  - Age, country (India or US), monthly household expenses.
  - "When do you want to retire?" slider, 0–40 years.
  - Annual household income.
  - Current savings, one total ("Mutual funds, equities, FDs, EPF, PPF").
  - Return slider, 5–15%, default 10%.
  - Per-child graduation and post-graduation paths (India or US).
  - Parent support: monthly amount and number of years.
  - Healthcare buffer toggle ("medical costs rise faster than general inflation").
  - "Big one-off goals".
- **Outputs:**
  - FIRE number in today's ₹ and in inflated ₹.
  - "% of your goal".
  - Lean (~75%), Regular and Fat (~150%) toggle.
  - Assumptions line: "India: 6% inflation · 3% SWR · 10% return".
  - "Breakdown" (contents not visible).
  - "Share my result" (a shared link opens with the answers filled in).
- **Method:** Expenses × 33.3 (a 3% withdrawal rate) and fixed returns. No Monte Carlo or tax. Coast FIRE is explained but not calculated.
- **Good:**
  - It asks the life-event questions Indian families actually face: children's education, supporting parents, healthcare.
  - The 3% rate is adjusted for India.
  - Shareable answers, no login, runs in the browser.
  - "See my full plan" offers a signed-in upgrade, the same idea as M27.
- **Missing or wrong:**
  - No years-to-FI, FI date or required SIP. It answers "how much", not "when".
  - Corpus is a single lump, so EPF, PPF and equity are treated alike.
  - Inflation is fixed at 6%. No post-retirement return, no tax, no sequence risk.
  - The education and healthcare inflation rates are not shown.

### Portfolio360: portfolio360.co.in/fire (owner's reference)
`/fire` is the landing page. The calculator is at https://portfolio360.co.in/tools/fire-calculator-india/

- **Inputs:** "Your age today", "Retire at", "Plan until age", "Monthly expenses today ₹", "Invested corpus today ₹", "Investing each month ₹", "Inflation %", "Return before retiring %", "Return after retiring %".
- **Outputs:**
  - "Corpus you need at 50" (the example shows ₹7.46 Cr funding ₹28.76 L a year, inflating to 85).
  - "On current plan", "Shortfall".
  - "SIP needed" against what you invest now.
  - "Freedom year", "Progress to your number today".
- **Method:** The corpus is the present value of the inflating expense stream, paid at the start of each year and discounted at the post-retirement return. There is no withdrawal-rate multiple.
- **Stated limits:** It says plainly that it does not model sequence-of-returns risk, tax on withdrawals, or lumpy costs such as children's education, and calls the result "a floor to plan against, not a promise". A Hindi version exists.
- **Good:**
  - Mathematically sound.
  - Gap, required SIP and freedom year are exactly the outputs that matter.
  - States its limits honestly.
- **Missing:** Step-up, goals, EPF/PPF, tax, charts or table (none seen), scenarios, variants, share link.

### Finnovate: finnovate.in/fire-calculator
Source: https://www.finnovate.in/fire-calculator. Results are drawn by JavaScript; inputs and defaults were visible.

- **Inputs and defaults:**
  - Expenses ₹1,00,000 a month; age 45; FIRE age 55; life expectancy 85.
  - Inflation 7%.
  - Return 12% before FIRE and 8% after (the after-FIRE input is capped at 10%).
  - Portfolio ₹50 L; SIP ₹50 k.
- **Outputs:**
  - FIRE number in future ₹ and "≈ in today's money".
  - Corpus by lifestyle: Lean 13.6×, FIRE 22.7×, Fat 34×.
  - Gap to fill, "Monthly SIP Required".
  - Plan comparison: current plan, flat SIP, and a 10% yearly step-up SIP.
  - "FIRE Corpus Lasts Until", "Years of Financial Freedom".
  - "Wealth Trajectory" chart.
- **Method:** Present value until life expectancy, like Portfolio360. The article recommends a 3–3.5% withdrawal rate for long retirements and says the 25× rule is built on US data.
- **EPF/PPF/NPS:** Told to add them to "Current Portfolio". The page gives PPF at 7.1% and says the NPS 60% lump sum is tax-free.
- **Good:** The most complete Indian free tool seen. The step-up comparison is the right India-specific touch, and the defaults are sensible.
- **Missing:** Tax, EPF as its own stream, goals, Monte Carlo. The output snapshot does not match the default inputs (shows age 30), which is a small bug.

### Groww: groww.in/calculators/fire-calculator
Source: https://groww.in/calculators/fire-calculator. Defaults were not visible.

- **Inputs:** Current Age, Current Investments, Monthly Investment, Monthly Expenses, "Other Retirement Income (p.a.)", Expected Return, Inflation Rate, Withdrawal Rate.
- **Outputs:** FIRE Corpus, Current Corpus, FIRE Gap, Years to FIRE, Estimated FIRE Age, FIRE Progress (sample: ₹2.25 Cr, 17.9 years, 22%).
- **Good:**
  - Lets you edit the withdrawal rate.
  - Counts other income (rent, pension).
  - Shows years to FI.
- **Missing:** Retirement age, life expectancy, pre/post return split, step-up, tax, EPF/PPF.
- Groww's separate retirement calculator is weaker: its example uses 3% inflation and life expectancy 70 (https://groww.in/calculators/retirement-calculator).

### Scripbox: scripbox.com/plan/fire-calculator
Source: https://scripbox.com/plan/fire-calculator

- **Inputs:** Current age, retirement age, existing savings, growth rate, monthly expense.
- **Method:** The FAQ says 25× expenses ("4% rule"). The article example uses 5% inflation and 8% return.
- **Variants:** Lean, Coast, Fat and Barista are explained in text only.
- **Weak for India:** The 4% rate and 5% inflation are both optimistic. No SIP or tax.

### 5paisa: 5paisa.com/calculators/fire-calculator
Source: https://www.5paisa.com/calculators/fire-calculator

- **Inputs:** Expenses, age, retirement age, inflation.
- **Outputs:** FIRE number, Fat/Lean amounts, expenses at retirement, "Required SIP".
- **Method:** 25× expenses (4%). The SIP assumes a fixed 12% return that cannot be changed.
- **Missing:** Existing corpus, tax, chart. A thin lead-generation tool.

### INDmoney: indmoney.com/calculators/retirement-calculator (no FIRE-specific page found)
Source: https://indmoney.com/calculators/retirement-calculator

- **Inputs:** Age, retirement age, life expectancy, post-retirement monthly spend, corpus available, return, inflation.
- **Outputs:** Corpus required, monthly investment.
- **Method is flawed:** It takes monthly spend × 12 × years in retirement and then inflates the total. That ignores both inflation after retirement and returns after retirement. Its own figures could not be reproduced from its published formula.

### Networthify: networthify.com/calculator/earlyretirement (global)
Source: https://networthify.com/calculator/earlyretirement

- **Inputs:** Income, savings and expenses (or savings rate), portfolio, real return, withdrawal rate (4%).
- **Outputs:**
  - Years to retirement.
  - Chart: click to try another savings rate.
  - Year-by-year table.
  - "Share your results".
- **Method:** Savings-rate based and perpetual (the principal is never drawn down). Returns are real and after tax.
- **Worth copying:** The savings-rate framing, the clickable what-if chart, and the share link.
- **Not suitable as a base:** Not India-specific.

### FIRECalc: firecalc.com (global, historical)
Source: https://www.firecalc.com/

- **Method:** Tests your plan against every historical starting year since 1871 and reports a success rate. The default portfolio is 75% stocks / 25% bonds.
- **Inputs:**
  - Pensions and Social Security, with start years.
  - One-off lump sums.
  - Spending models: constant, Bernicke's declining spending, percent of portfolio.
  - "Investigate" searches for the spending level or portfolio size that hits a target success rate.
- **Privacy:** Stores nothing.
- **Limits:** US data only; dated UI.
- **Worth copying:** The success-rate idea, and "what spending gives 95% success".

### cFIREsim: cfiresim.com (global, historical)
Source: https://www.cfiresim.com/

- **Inputs:**
  - Allocation across equities, bonds, gold and cash, with a glide path.
  - Inflation: historical CPI or a flat rate.
  - Spending floor and ceiling.
  - Spending rules: inflation-adjusted, percent of portfolio, variable, VPW, Hebeler, Guyton-Klinger, Variable CAPE.
- **Data methods:** Historical (all years or chosen years), constant growth, single cycle. No Monte Carlo.
- **Outputs:** Not visible in the fetched text (drawn by JavaScript).
- **Worth copying:** Gold as an asset class and a spending floor. US data only.

### ProjectionLab: projectionlab.com (global, paid)
Source: https://projectionlab.com/

- **Features:**
  - Monte Carlo "chance of success" and historical backtesting.
  - Milestones (FI and others).
  - Tax, cash-flow and drawdown analysis.
  - Sankey cash-flow chart.
  - "No link to your accounts".
- **Pricing:** Premium for the advanced features.
- **Countries:** Tax presets for Canada, the UK, Australia, Germany and the Netherlands; India is not listed.
- **Takeaway:** The global best practice for the signed-in experience (milestones, Monte Carlo bands, drawdown order). PocketFolio's edge is that it already holds the real Indian holdings, which ProjectionLab deliberately avoids.

### freefincal (Pattu): spreadsheets, not web calculators
Sources: https://freefincal.com/a-checklist-and-calculator-for-early-retirement-in-india/, https://freefincal.com/early-retirement-101-faq-on-the-fire-movement/

- **Format:** Downloadable Excel files.
- **Early-retirement sheet:** Splits a 45-year retirement into three 15-year segments (C1 + C2 + C3), with C2 and C3 growing at 10%. This is a bucket-style approach.
- **Robo-advisory tool:** Uses a "3.2 to 3.5% SWR".
- **Reputation:** The most trusted Indian source on assumptions (section 3). No online tool to compare UX against.

## 3. Realistic Indian assumptions (community and research)

| Assumption | What sources say | Source |
|---|---|---|
| **Withdrawal rate** | Saraogi and Raju, "Balancing Acts" (2024): recommends a 3–3.5% rate at 95% confidence. 40% equity gave the best rate, 3%. At 4%, about a third of simulated 30-year paths run out; at 3%, about 1 in 12. | Business Standard / Business Today coverage via search; [Business Today 2025-07-21](https://www.businesstoday.in/personal-finance/retirement-planning/story/senior-savings-at-risk-advisor-says-indian-retirees-must-ditch-the-4-withdrawal-rule-485445-2025-07-21) |
| | Summary of the same paper: 2.8% for a 35-year horizon; an earlier study found 2.6% (1979–2022 data). 10% gold "reduces the chance of going broke". Uses bootstrapped Indian returns. | https://kartick.substack.com/p/summary-of-balancing-acts-safe-withdrawal |
| | freefincal: drop "safe" and call it the *initial* withdrawal rate. Below 3.5% the corpus is "likely adequate"; 3.5–4.5% is a grey area; above 4.5% is "likely inadequate". Its robo tool uses 3.2–3.5%. | https://freefincal.com/how-to-use-safe-withdrawal-rates-to-gauge-retirement-corpus-health, https://freefincal.com/early-retirement-101-faq-on-the-fire-movement/ |
| | FIRE India wiki (linked to r/FIREIndia): its worked example uses 3% (33×). It cites r/FIREIndia "SWR for India" posts claiming 4% held historically; note the short data history. | https://fiindia.gitbook.io/wiki/how-much-do-i-need/fire-portfolio/the-safe-withdrawal-rate-swr-strategy |
| | Finnovate recommends 3–3.5%; Velthian hard-codes 3%. | pages above |
| **Corpus multiple** | freefincal: "at least 30 times your current annual expenses"; plan for 40 years in retirement. | https://freefincal.com/how-much-do-i-need-to-retire-early-in-india/ |
| **Inflation** | freefincal: "Work with min 7-8% inflation (I work with 9%)", and 8% is "the minimum I would plan with". | https://freefincal.com/how-much-do-i-need-to-retire-early-in-india/, https://freefincal.com/early-retirement-incorrect-assumptions/ |
| | Calculators: Velthian 6%, Finnovate 7%, Scripbox example 5%, Groww retirement example 3% (too low). | pages above |
| **Real return** | freefincal: assume "no more than 2% real return"; he plans with 0% real. A 5% real return implies a 13–14% post-tax portfolio return, "a touch on the higher side". | freefincal links above |
| | Saraogi summary: real Indian equity return 6.54% a year (Dec 1999 – Aug 2023). | kartick.substack link |
| **Equity in retirement** | freefincal: early-retirement portfolios have "never exceeded 50%" equity. The robo tool rarely goes above about 40% for early retirees. Saraogi: 40% equity is best. | freefincal links |
| **Sequence risk** | freefincal: "Worry about the sequence of returns risk!"; smooth 10% returns are unrealistic. | https://freefincal.com/early-retirement-incorrect-assumptions/ |
| **EPF / PPF rates** | EPF 8.25% for FY2025-26 (ratified June 2026). PPF 7.1% for Oct–Dec 2026 (unchanged). | [Angel One](https://www.angelone.in/news/personal-finance/epfo-interest-rate-set-at-8-25-for-fy26-government-confirms-final-approval), [Business Today 2026-09-30](https://www.businesstoday.in/personal-finance/story/small-savings-scheme-interest-rates-unchanged-for-q3-fy27-check-ppf-scss-ssy-rates-558892-2026-09-30) |
| **Tax (FY2026-27)** | Equity and equity funds: STCG 20% if held ≤12 months; LTCG 12.5% above ₹1.25 L a year, unchanged by Budget 2026. | [Business Standard](https://www.business-standard.com/budget/news/budget-2026-ltcg-tax-rates-unchanged-for-fy27-fm-sitharaman-126020100424_1.html), [Business Today 2026-09-02](https://www.businesstoday.in/personal-finance/story/how-different-assets-are-taxed-a-look-at-capital-gains-rules-across-investments-552385-2026-09-02) |
| | Debt funds bought on or after 1 Apr 2023: slab rate whatever the holding period. Bought before: 12.5% LTCG after 24 months. | same |
| | Gold ETFs: LTCG 12.5% after 12 months. Gold funds and physical gold: after 24 months. Short-term gains at slab rate. | same |
| | PPF maturity is tax-free; the NPS 60% lump sum is tax-free. | Finnovate page |
| | EPF taxability on withdrawal (5-year service rule; interest on employee contributions above ₹2.5 L a year is taxable) is **not sourced here**. Verify before building. | – |
| | Surcharge and cess apply on top of these rates. | Business Today 2026-09-02 |

## 4. Recommendation for M27

### 4.1 Gaps PocketFolio can fill
No Indian tool seen combines all of the following:
1. Present-value corpus to life expectancy, which is sound maths (Portfolio360, Finnovate), rather than a crude multiple.
2. An India-adjusted withdrawal-rate check (3–3.5%).
3. Step-up SIPs.
4. Separate EPF/PPF streams.
5. Lumpy goals (Velthian).
6. Tax on withdrawals (none model it).
7. Any risk view (none in India).

Point 6 plus the real-holdings gap analysis is PocketFolio's distinctive edge.

### 4.2 Inputs for the public `/fire` page (all in the browser, nothing sent)
Basic mode shows the first 7 inputs; "More assumptions" reveals the rest. Every default shows a small "why" tooltip with its source.

| # | Input | Default | Why |
|---|---|---|---|
| 1 | Current age | 35 | neutral |
| 2 | Target FI age | 50 | typical Indian FIRE target |
| 3 | Plan until age | 90 | Early retirees need 40+ years (freefincal plans for 40). Finnovate uses 85; 90 is safer. |
| 4 | Monthly household expenses today (₹) | ₹75,000 | Excludes EMIs that end before FI (hint text says so). |
| 5 | Current invested corpus (₹) | ₹25 L | One field in basic mode; split by asset in advanced mode (row 12). |
| 6 | Monthly SIP (₹) | ₹40,000 | |
| 7 | Annual SIP step-up % | 10% | Finnovate's comparison uses 10%; matches salary growth. |
| 8 | Inflation % (general) | 7% | Middle of 6% (Velthian) and freefincal's "min 7-8%". |
| 9 | Healthcare share of expenses and its inflation | 10% of spend at 10% inflation | Velthian flags faster healthcare inflation. **The 10% rate is not sourced; needs owner OK.** |
| 10 | Return before FI (per asset in advanced mode) | Equity 11%, debt/FD 7%, EPF 8.25%, PPF 7.1%, gold 8% | EPF/PPF from current notified rates. Equity 11% sits below the 12% used by Finnovate and 5paisa (freefincal says 12%+ is optimistic). **Gold 8% is not sourced; needs owner OK.** |
| 11 | Portfolio return after FI | 8% | Finnovate default. With 7% inflation this is about 1% real, inside freefincal's "no more than 2% real". |
| 12 | Corpus split (advanced) | equity / debt / EPF / PPF / gold | Lets EPF and PPF grow at their own rates and be taxed correctly. Locked until they mature: EPF at retirement, PPF at its 15-year term. |
| 13 | EPF monthly contribution (advanced) | ₹0 | Separate from SIP, with its own rate. |
| 14 | One-off goals (advanced, repeatable) | none | Name, year, today's ₹, own inflation (education default 10%, **unsourced**). Copies Velthian's children/home/wedding rows. |
| 15 | Other income after FI (advanced) | ₹0 | Rent, pension or part-time work. Also gives **Barista FIRE**. Groww and FIRECalc have this. |
| 16 | Tax slab for debt / FD income | 30% | Post-Apr-2023 debt funds and FD interest are taxed at slab. |
| 17 | Withdrawal-rate check | 3.5% | Shown as a check, not used for the main number (see 4.4). Sources: freefincal under 3.5% "likely adequate", Saraogi 3–3.5%. |
| 18 | Lifestyle toggle | Lean 0.7× / Regular / Fat 1.5× | Velthian (0.75 / 1.5) and Finnovate (0.6 / 1.5) are similar. |

### 4.3 Outputs
1. **FIRE number** at the FI age, in future ₹ and today's ₹, with the multiple of current annual spend (e.g. "31×").
2. **On current plan** (projected corpus at FI age) → **gap** or surplus → **progress %**.
3. **Required SIP**, both flat and with your step-up (like Finnovate's comparison).
4. **Projected FI date**: the earliest age the corpus covers the need, given your SIP and step-up. **"Money lasts until"** age.
5. **Initial withdrawal rate**, colour-banded by freefincal's thresholds: under 3.5%, 3.5–4.5%, over 4.5%. Uses existing design-system colours only.
6. **Coast FIRE age**: the age after which no more SIP is needed. **Barista**: how much side income closes the gap.
7. **Chart**: corpus through accumulation and drawdown against the target line, with goals marked as dips. Collapsible **year-by-year table**: age, contributions, withdrawals, tax, closing balance.
8. **Scenarios**, three chips: inflation +1%, returns −2%, and a "bad first years" sequence (−25% in year 1 of FI, then normal). Each shows its FI date and how long the money lasts.
9. **Share link**: the inputs encoded in the URL hash, so nothing reaches the server (Velthian and Networthify both share). A "Copy link" button.
10. Plain-English "What this assumes" and "What this doesn't cover" boxes, as Portfolio360 does.

### 4.4 Method
- **Core, deterministic and annual:**
  - Accumulation: per-asset fixed returns, monthly SIP with yearly step-up, EPF/PPF growth, goal withdrawals in their years.
  - FIRE number: present value, at the post-FI return, of the inflating expense stream (with healthcare inflating faster) from FI age to plan-until age, paid at the start of each year (Portfolio360/Finnovate maths), plus post-FI goals. Not a fixed multiple; the withdrawal-rate check (output 5) is the sanity line instead.
  - Required SIP: solve by bisection with step-up, which has no closed form.
- **Tax on withdrawals, simplified:**
  - Assume each year's withdrawal comes from equity and debt in proportion to the holdings.
  - Equity: taxable fraction = the unrealised-gain share of value, tracked in the year loop. Tax at 12.5% after the ₹1.25 L exemption. Treat everything as long-term.
  - Debt and FD: tax at the slab rate on the gain share.
  - PPF: tax-free.
  - EPF: tax-free, pending verification.
  - Gold: 12.5%.
  - Gross the withdrawal up so that net withdrawal equals spend.
  - Put tax constants in one dated config ("Rules as of FY2026-27"), shown on the page.
- **Monte Carlo:** Yes, but as an optional "Stress test" tab, not the headline.
  - About 1,000 paths in a Web Worker.
  - Annual equity and debt returns, either:
    - drawn from a normal distribution: equity mean as input, standard deviation about 18%; debt about 2%, **both unsourced, need owner OK**; or
    - better: block-bootstrapped from Nifty 50 TRI history if PocketFolio already holds index data (Saraogi's method).
  - Report the probability that money lasts to plan-until age, plus a 10th/50th/90th percentile fan chart.
  - Reason to include it: no Indian tool does it, and the main Indian research (Saraogi) is framed as success probability. Reason to keep it secondary: freefincal warns that smooth returns mislead, but random returns built on assumed parameters are also guesses. Label it "illustrative".
- No historical-cycle mode like FIRECalc: Indian data is too short (the wiki and Saraogi both say so).

### 4.5 What the signed-in version adds
1. **Pre-filled from real data:**
   - Corpus by asset class: mutual funds split into equity / debt / hybrid by category; stocks; FD/PPF/EPF; gold.
   - Current SIPs, detected from transactions.
   - Unrealised gains per lot, so withdrawal tax uses the real cost basis rather than an estimate.
   - Each pre-filled number is shown with its source, can be overridden, and is not saved unless the user saves the plan.
2. **Family view:** Combined, or per member. Uses **each member's ₹1.25 L LTCG exemption** separately, a real tax saving no public tool models.
3. **Gap analysis against today's allocation:**
   - "You need ₹X more SIP."
   - "Your equity share is 78%; post-FI glide path suggests ≤50%" (freefincal / Saraogi).
   - Debt held after Apr 2023 is taxed at slab, shown as a drag.
4. **Live progress:** The FI date and progress % refresh as prices update. A small dashboard card: "FI in 2041 · 34%". Trend of the projected FI date over time, from saved snapshots.
5. **Saved scenarios** (stored server-side under the user's account, private), compared side by side.
6. **Real SIP step-up history** used to suggest a realistic step-up default.
7. Same engine as the public page, run in the browser on fetched numbers, so the maths is identical and tested once.

### 4.6 Open points for the owner
- Defaults that have no source in this research and need an owner decision:
  - healthcare inflation 10%;
  - education inflation 10%;
  - gold return 8%;
  - Monte Carlo standard deviations.
- EPF withdrawal tax rules: verify before modelling.
- Whether Nifty TRI history is available for the bootstrap.
