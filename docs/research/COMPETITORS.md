# PocketFolio: competitor and market research (M23)

Read on **2026-11-27**, from public pages only: no sign-ups, no logins, no user data. This file holds the findings
and recommendations. The detailed notes behind them, with a source URL on every bullet, are in
[`competitors/`](competitors/):

| Appendix | What it covers |
|---|---|
| [A. Big apps](competitors/big-apps.md) | INDmoney, Kuvera, ET Money, Groww, Zerodha Console/Coin |
| [B. Specialist and family trackers](competitors/niche-apps.md) | Value Research, MProfit, Wealthy, Tickertape, Portfolio360, Velthian, MF Central, Zerodha family view, PowerUp Money, NaviPlan, MFPA, Dezerv |
| [C. FIRE calculators](competitors/fire-calculators.md) | 11 calculators compared, Indian assumptions, the M27 recommendation |
| [D. Keywords and communities](competitors/keywords-communities.md) | search terms, AI search, subreddits and forums, user needs, landing-page examples |

In this file, a claim links its source or names the appendix section that cites it, for example
"(A §1)" for appendix A, section 1. Anything marked *unverified* there is still unverified here.

**Limits of this research:**
- **Reddit was not readable.** The research tools were refused by reddit.com, so complaints come from app-store
  reviews, Trustpilot, TradingQnA, ValuePickr, TechEnclave and Reddit mirror pages. Subreddit sizes and rules come
  from third-party directories (D §3). **Before M30, someone with a browser checks each subreddit's sidebar.**
- **Some sites wouldn't load:** etmoney.com (blocked), valueresearchonline.com (403), and kuvera.in (renders only
  with JavaScript). Those sections rely on app-store listings, help centres and news.
- **No search volumes.** Keyword demand comes from Google autocomplete (India locale), from which pages rank, and
  from forum thread titles (D §1).
- **Prices change.** Each one is as published on the date read.

---

## 1. Summary

1. **Every big app needs each family member to sign up.** That covers INDmoney, Groww, Zerodha, Kuvera and
   PowerUp. INDmoney's member must accept a phone invite. Groww needs an OTP plus the member's PIN. Zerodha only
   links Zerodha accounts. Kuvera needs KYC for each member. PowerUp sends an OTP to each member's phone (A §1,
   §2, §4, §5; B §9). None of them serves a household whose parents never install an app.
2. **Nobody documents combining depository and RTA statements.** No competitor found merges the CDSL/NSDL eCAS
   with the CAMS/KFintech CAS and removes the duplicates across family members (A "Patterns"; B "Patterns").
   Mutual-fund import now mostly goes through MF Central's OTP, or Gmail read access. Only the small trackers
   take a CAS PDF upload.
3. **The big apps' tracking is a funnel.** Their revenue is broking (mainly F&O), loans at up to 36–45% APR,
   distribution and ads. Their landing pages sell account opening, and tracking sits below the fold (A "Patterns").
4. **Portfolio360 is the closest twin.** Its headline is "Your family's wealth, in one number." It imports CAS
   files and doesn't keep them after reading. But its household view is **paid** (Pro, ₹1,499/yr), and it runs a
   Meta pixel on its sign-in page (B §5). MProfit does real family tracking across many PANs, but from ₹18,000/yr
   (B §2).
5. **The paid tools sell on five things:** tax packs, a gated family view, scores and advice, goals or FIRE, and
   AI (B "Patterns"). PocketFolio has none of the paid gates. It still lacks a tax pack, FIRE and AI, which are
   M27, M32 and the later tax-P&L import.
6. **No Indian FIRE calculator models tax on withdrawals or the risk of running out of money** (C §1, §4.1).
7. **Users' unmet needs** (D §4):
   - one household view without every relative joining an app;
   - funds and stocks together, de-duplicated;
   - XIRR and benchmark comparison for the whole family;
   - short- vs long-term gains, and export;
   - no upselling, and no inbox or SMS reading;
   - free;
   - a record the family can find if someone dies.

**Positioning, one line:**
> **PocketFolio: your whole family's investments in one private dashboard, built from the statements you already
> have. Free, and nothing to sell you.**

---

## 2. Competitors at a glance

Detail and sources are in the appendix section given in the first column.

| Product (appendix) | What it is | Family model | How holdings get in | Price (₹/yr) | How it earns | Sign-in |
|---|---|---|---|---|---|---|
| INDmoney (A §1) | Broker + net-worth app | Each member has an INDmoney account and accepts a phone invite. View-only | MF Central OTP; opt-in Gmail reading | Free | Broking (IN + US), loans 10–45% APR, partners | Phone, KYC to invest |
| Kuvera (A §2) | Direct-MF platform, owned by CRED | One login; every member KYC'd; existing users can't be merged | Email the CAMS CAS to Kuvera | Free core | Partner commissions | Google, email + password |
| ET Money (A §3) | MF platform, owned by 360 ONE | None found (*unverified*) | CAS / PDF upload (listing) | Free; "Genius" paid | Genius subscription, loans, distribution | *Unverified* |
| Groww (A §4) | Broker | Family account since Sep 2026: member's OTP + PIN; can trade for them | MF Central OTP (older flow: Gmail) | Free | Broking, F&O, loans up to 36% APR | Google or email + mobile OTP + PIN |
| Zerodha Console/Coin (A §5) | Broker back office | Up to 10 Zerodha accounts, view-only, no export, no family XIRR | Nothing from outside Zerodha | Free | Brokerage (F&O) | Kite ID + password + 2FA |
| Value Research (B §1) | Research publisher | Shared email + PAN filter | MF Central QR; CAS/eCAS for stocks | Free; premium ~₹5,841 (2022) | Subscriptions, ads | *Unverified* |
| MProfit (B §2) | Pro / HNI tracker | Every PAN in a family, plus a family-office product | 1,500+ sources, contract notes by email, CAMS CAS | 18,000+ | Software | Portal login |
| Wealthy (B §3) | MF distributor | Up to 10 members (MFs) | Forwarded statements or Gmail reading | Free | Distribution (regular plans, *unverified*) | *Unverified* |
| Tickertape (B §4) | Market-data portal | New and partial; paid users found multi-PAN family tracking missing | Broker link (smallcase), holdings upload | Pro 2,999 | Pro, US broking, smallcase | Mobile OTP (mandatory) |
| **Portfolio360** (B §5) | Indie family tracker | Household view on **Pro only** | CAS + broker files, file not kept | Free; Pro 1,499; founder ₹9,999 once | Subscriptions only | Email + password, Google, Apple |
| Velthian (B §6) | Indie tax + AI tracker | None | CAS from all 5 sources, with a diff you approve | Free; Pro 499 (free in early access) | Subscriptions | Email + password + OTP |
| MF Central (B §7) | RTA utility (CAMS + KFintech) | Per PAN + mobile | It *is* the source | Free | Industry utility | Login + OTP |
| PowerUp Money (B §9) | SEBI RIA, advice | Up to 8 members, OTP and PAN for each | PAN + OTP consent fetch (MFs only) | Free; Elite 999 + 749 per member | Advisory fee | Mobile OTP |
| NaviPlan (B §10) | Local-first tracker (freefincal) | Several CAS files; family *unverified* | CAS + tradebooks (8 brokers) | 2,500 | Software | None (mobile number to buy) |
| MFPA, Dezerv (B §11, §12) | CAS analyser; wealth-manager funnel | None; members (*unverified*) | CAS upload; *unverified* | Free | –; PMS funnel (*unverified*) | None; *unverified* |

---

## 3. Feature matrix: where PocketFolio adds value

Key: ✔ yes · ◐ partly or with a catch · ✘ no · ? not found on public pages. "Family without member accounts"
means one login can hold relatives who never sign up anywhere.

| | PocketFolio | INDmoney | Kuvera | Groww | Zerodha | Value Research | MProfit | Tickertape | Portfolio360 | Velthian | PowerUp |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Family without member accounts | ✔ | ✘ invite | ◐ KYC each | ✘ OTP + PIN | ✘ Zerodha only | ◐ email/PAN filter | ✔ | ◐ new | ◐ Pro only | ✘ | ✘ OTP each |
| CAS PDF import | ✔ all four | ✘ (MF Central) | ◐ email it | ✘ (MF Central) | ✘ | ✔ | ✔ | ✘ | ✔ | ✔ | ✘ |
| eCAS + CAS de-duplicated | ✔ | ? | ? | ? | ✘ | ? | ? | ✘ | ? | ◐ re-import only | ✘ |
| Stocks with real buy prices | ✔ tradebooks, 7 brokers | ◐ | ? | ◐ own | ◐ own | ✔ | ✔ | ◐ linked broker | ✔ | ✔ | ✘ |
| Corporate actions | ✔ | ? | ? | ? | ✔ own | ? | ? | ? | ? | ◐ manual | ✘ |
| FD / PPF / EPF | ✔ | ✔ | ◐ FD product | ✘ | ✘ | ✔ | ◐ FD | ◐ FD | ✔ | ✔ | ✘ |
| Gold / silver / SGB | ✔ incl. physical | ✔ | ◐ digital | ◐ ETFs | ✘ | ◐ SGB | ? | ◐ digital | ✔ | ◐ alternatives | ✘ |
| Daily change + XIRR | ✔ | ✔ | ? | ? | ◐ no family XIRR | ✔ | ✔ | ? | ✔ | ✔ | ◐ |
| Benchmark score per holding | ✔ | ✘ | ✘ | ✘ | ✘ | ? | ◐ comparisons | ◐ scores | ✘ | ◐ insights | ◐ "form" |
| Stocks-inside-funds look-through | ✔ | ◐ overlap | ✘ | ✘ | ◐ own holdings | ? | ? | ✘ | ✘ | ✘ | ✘ |
| FIRE / goals | ✘ (M27) | ? | ◐ goals | ◐ public calc | ✘ | ◐ premium | ✘ | ✘ | ✔ Pro | ✔ public calc | ✘ |
| Tax report | ✘ (later) | ✔ | ✔ harvesting | ✔ | ✔ | ✔ | ✔ ITR | ✘ | ✔ Pro | ✔ | ◐ Elite |
| AI | ✘ (M32) | ✔ | ✘ | ◐ beta | ✘ | ✘ | ✘ | ✘ | ✘ | ✔ | ✘ |
| No email/SMS reading, no upsell | ✔ | ✘ | ◐ | ✘ | ◐ broker | ◐ ads | ✔ | ✘ | ◐ Meta pixel | ✔ | ◐ tracking SDK |
| Statement not kept | ✔ | ? | ? | ? | n/a | ? | ? | n/a | ✔ | ? | n/a |
| Free family view | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✘ ₹18k+ | ◐ Pro | ✘ ₹1,499 | ✘ none | ✘ ₹749/member |

Where the sources are:
- Rows 1–3: A "Patterns" and B "Patterns".
- Benchmark score and look-through rows: B "Patterns", "Not found anywhere".
- Privacy row: A §1–§4, B §4, §5, §9 (Apple privacy labels and policies).
- Prices: §2 above.
- PocketFolio's own column is what M7–M21 built (see [MILESTONES.md](../MILESTONES.md)).

### What only PocketFolio does (as far as public pages show)
1. **One login for the whole household, with no account, OTP or KYC for each member.** It's built from each
   member's statements. This is the main pitch: it fits elderly parents who don't use apps (D §4).
2. **The four statement types de-duplicated across members:** CDSL/NSDL eCAS and CAMS/KFintech CAS.
3. **All asset types in one free view:** funds, stocks with tradebook buy prices and corporate actions, ETFs,
   FD/PPF/EPF, and physical gold, silver and SGBs.
4. **A benchmark score for every fund and stock, and the stocks inside your funds.** Neither was seen elsewhere in
   this form (B "Patterns").
5. **Privacy you can check:**
   - the PDF is not kept;
   - data is encrypted per household;
   - export and delete;
   - no Gmail, SMS or contacts access;
   - no products to sell.

   The big apps' privacy labels show tracking, and their policies allow wide collection (A "Privacy posture").
6. **Magic-link and QR sign-in.** No competitor found offers a magic link (B "Patterns").

### Where PocketFolio is behind (honest list for the owner)
- **Getting the statement is friction.** Rivals pull funds with one MF Central OTP. PocketFolio needs each
  member's CAS downloaded and uploaded, and re-uploaded to refresh. The CAS password rules confuse people, and even
  published guides disagree (D §1, cluster A). So the guidance in the upload flow, and blog post 1 (§7), matter a
  lot.
- **No tax pack.** It's the most common reason people pay (B "Patterns"). The tax-P&L import is already "later"
  in M21.
- **No FIRE or goals yet** (M27), **and no AI** (M32).
- **No app-store presence or ratings.** The rivals' main proof is scale, such as "2 Cr+ investors" (A "Patterns").
  PocketFolio has to win on honesty instead (§5).
- **Portfolio360 says much the same thing.** PocketFolio's wording must not echo "Your family's wealth, in one
  number." It should lead on what Portfolio360 charges for (the household view) and what it lacks
  (de-duplication, look-through, benchmark score, no ad pixel).

**Later (not in any milestone yet; for the owner to decide):**
- A guided "get your statements" helper. It would pick the right CAS for each member and explain the password.
  The KFintech request helper (D9) is a start.
- A "last statement date" for each member, so a stale portfolio is obvious.
- A "family record" angle (§7, post 7): one place the family can find if someone dies. Kubera sells this as a
  "Dead Man's Switch" (D §5).

---

## 4. Landing page (input for M25)

**What the market does** (A "Patterns", B §5–§6, D §5):
- Indian brokers lead with "invest in everything", a phone-number CTA and proof of scale.
- The indie trackers (Portfolio360, Velthian) lead with "one number", a dashboard mockup, a security block and a
  "what we are not" list.
- The global privacy-first examples:
  - Kubera and Plausible list their privacy promises as **things they don't do**.
  - Sharesight and Snowball use **low-friction CTAs** and a demo.
  - Plausible adds a **founder's letter** in place of testimonials.
- Zerodha's "No spam or gimmicks" is the Indian model for a calm tone.

**Recommended sections, in order:**
1. **Hero:** headline, one-line sub, primary CTA "Sign in with Google: it's free", secondary "Email me a link",
   and a "See a demo family" link (demo data only).
2. **How it works, 3 steps:** download each member's CAS → upload → see the family. Link the "how to get your
   CAS" post. INDmoney's "how to add a member" block is the model (D §5).
3. **What you see:** screenshots with demo data. The family total and daily change, XIRR, the benchmark score,
   stocks inside your funds, and every asset type.
4. **Why not a spreadsheet, or an app everyone must join?** A short comparison that names no competitors.
   Snowball's "pain points" section is the model (D §5).
5. **Privacy, as checkable facts:**
   - PDF not kept;
   - encrypted per household;
   - export or delete any time;
   - no commissions, ads, or inbox or SMS reading;
   - not a broker, distributor or adviser.

   This merges Kubera's negatives with Portfolio360's "what it is not" (B §5).
6. **A note from the maker:** why it was built for one family. Honest proof until there are users (D §5).
7. **FAQ:** visible questions and answers. That is also the form AI answers quote (§7).
8. **Final CTA and footer:** privacy, terms, security, blog, FIRE calculator, and "Not investment advice".

**Headline options** (the owner picks in M25):
- A. "Your whole family's investments, in one private dashboard." (outcome + scope, D §5)
- B. "Every family member's mutual funds, stocks, FD/PPF/EPF and gold, from the statements you already have."
- C. "One login for the whole family's money. No app for your parents to install."

  C leads with the biggest gap: per-member accounts (§1.1).

Sub for any of them: "Upload each member's CAS from CAMS, KFintech, NSDL or CDSL. Funds held twice are counted
once. Free, and we never sell you a fund."

**Proof points without users** (never invent any, D §5):
- the four statement types supported;
- "your PDF is deleted after reading";
- the encryption and deletion facts;
- the open privacy policy;
- the founder's note;
- a live demo family;
- "runs on Cloudflare".

Later, a real count of families, and quotes from beta families with their OK.

**FAQ, 11 items** (D §5, from competitor FAQs and search questions):
1. Which statement do I upload (CAMS, KFintech, NSDL, CDSL)? Do I need all of them?
2. What's the password for my CAS PDF?
3. Does each family member need an account or an OTP?
4. Will funds be counted twice if I upload a CAMS CAS and an NSDL/CDSL eCAS?
5. Do you keep my PDF? Who can see my data? Can I delete everything?
6. Is it really free, and how do you make money?
7. Do you read my email or SMS, or link my bank?
8. Can I add stocks from more than one broker, and FD/PPF/EPF and gold?
9. How is XIRR calculated, and why does it differ from my app?
10. Do you give investment advice? (No: education only, not SEBI-registered.)
11. Do minors' folios show up? (A CAS leaves minors' folios out of consolidation: AMFI FAQ, D §1.)

Question 6 needs the owner's answer before launch: "free with fair-use limits" (D7), and pricing is studied in M31.

---

## 5. Dashboard (input for M24)

**What the best dashboards show first** (A §1, §5, "Patterns"; B §6, §10, "Patterns"):
1. **One headline number:** net worth or current value. Everyone leads with it. INDmoney's family view also
   splits that number by member.
2. **Today's change, total gain and XIRR**, next to it. Velthian, NaviPlan and the MF trackers do this.
3. **Allocation.** Velthian adds an equity-exposure risk meter.
4. **One card per asset class**, each opening its holdings (Velthian).
5. **Insights:** scores, red flags and tax callouts (Tickertape, Velthian, PowerUp).

**Current PocketFolio Overview** (`web/src/components/overview.tsx`):
- a large total value, then invested, total returns and XIRR boxes;
- the allocation strip;
- the value chart, daily returns and SIPs.

So the hierarchy already matches the market. What M24 can add, with the same data:
- **The family split under the headline:** chips or a bar for each member, so a family sees "who holds what" at
  once. This is the family app's signature and is missing from most rivals.
- **Today's change next to the total**, as the rivals do. It comes from M12's daily returns.
- **Asset-class cards** for every type built by then (funds, stocks, ETFs, FD/PPF/EPF, gold/silver), each with
  value, gain and XIRR. They replace a funds-first layout.
- **Insights in one place:** benchmark-score outliers (M28), stocks-inside-funds concentration (M11), and gains
  shown separately from contributions (asked for in D §4).
- **Statement freshness:** "last statement: <date>" for each member. This is Claude's suggestion, not seen
  elsewhere. It answers the main weakness in §3.
- **Calm, not a trading app.** No red/green walls like Tickertape's portal (B §4). Gain/loss colours stay distinct
  from the new gold accent (plan §21.1).

---

## 6. FIRE calculator (input for M27)

The full comparison, assumptions table and recommendation are in [appendix C](competitors/fire-calculators.md).
In short:
- **The owner's references:**
  - Velthian asks the right Indian life-event questions: children's education, support for parents, healthcare.
    But it gives no FI date or required SIP (C §2).
  - Portfolio360 has sound maths: the present value of rising expenses up to a "plan until" age, plus the gap,
    the SIP needed and a "freedom year". It has no step-up, goals or tax (C §2).
- **Best other Indian tool:** Finnovate. Its defaults are 7% inflation, 12% return before FI, 8% after, and
  life expectancy 85. It compares a flat SIP with a 10% step-up (C §2).
- **Indian assumptions:**
  - The withdrawal rate is 3–3.5%, not the US 4% (Saraogi & Raju 2024; freefincal).
  - Inflation at least 7%.
  - Real return after FI no more than 2%.
  - EPF 8.25% (FY26); PPF 7.1% (Oct–Dec 2026).
  - Equity LTCG 12.5% above ₹1.25 L. Debt funds bought after April 2023 are taxed at the slab rate (C §3).
- **Recommended inputs** (18 in all, 7 in basic mode): age, FI age, plan-until age, monthly expenses, corpus, SIP
  and step-up. Advanced mode adds:
  - inflation, healthcare share and its inflation;
  - returns per asset before FI, and the portfolio return after FI;
  - the corpus split and EPF contribution;
  - one-off goals and other income after FI;
  - tax slab, withdrawal-rate check and lifestyle toggle.

  Each comes with an Indian default and its source (C §4.2).
- **Recommended outputs** (C §4.3):
  - the FIRE number in today's and future ₹;
  - gap and progress;
  - required SIP, flat and with step-up;
  - FI date and how long the money lasts;
  - the withdrawal rate in bands;
  - coast and barista FIRE;
  - a chart and a year-by-year table;
  - three stress scenarios;
  - a share link that keeps the inputs in the URL hash, never on the server;
  - "what this assumes" and "what this doesn't cover".
- **Method** (C §4.4):
  - a fixed-return yearly model with a simple Indian tax layer on withdrawals, which no Indian tool has;
  - Monte Carlo only as an optional "stress test" tab labelled illustrative;
  - no FIRECalc-style historical mode, because Indian data is too short.
- **Signed in** (C §4.5):
  - pre-filled from the real snapshot, with corpus by asset, detected SIPs and real unrealised gains;
  - the family view, using **each member's ₹1.25 L LTCG exemption**;
  - allocation-gap notes and a live "FI in 20XX" card;
  - saved scenarios, sealed with the household key (plan §21.3).
- **Open points** (C §4.6):
  - defaults with no source: healthcare and education inflation at 10%, gold return 8%, and the Monte Carlo
    volatilities;
  - the EPF withdrawal tax rules, to verify before modelling;
  - data for a bootstrap. M28 already stores Nifty TRI history from niftyindices.com (plan §21.4), so the data
    exists, but the same terms-of-use question that M28 raised applies.

---

## 7. Keywords, blog, AI search and communities (input for M25, M26, M30)

**Keyword clusters** (D §1). Demand comes from autocomplete, not volumes:

| Cluster | Example searches | Intent | Use |
|---|---|---|---|
| A. Get my statement | cas statement download, nsdl/cdsl cas login with pan, cas password format, kfintech cas password, passwords by fund house | Informational, very high fit | One FAQ item + blog posts 1 and 3 |
| B. All in one place | how to track all mutual funds in one place (india), portfolio tracker india free, net worth tracker india, portfolio tracker without linking accounts | Commercial | Landing H2s, meta description, FAQ; post 2 |
| C. Family | family mutual fund portfolio tracker, family portfolio tracker india; how to find mutual funds of deceased parent | Commercial (a small niche with little competition) | **Landing H1 and title**; posts 2 and 7 |
| D. Analytics | xirr calculator sip/excel, mutual fund overlap tool, compare mutual fund returns with benchmark, ltcg harvesting | Informational, attracts links | Feature section; posts 4–6 |
| E. FIRE | fire calculator india with inflation, fire number calculator india, coast/fat fire | Informational | `/fire` (M27); post 8 |
| F. Comparisons | kuvera vs groww/indmoney, indmoney vs zerodha, mf central login | Commercial | Not now; later, and only if fair |

**Blog posts for M26** (titles from D §1; each one cites official sources and says "not investment advice"):
1. How to download your CAS (CAMS, KFintech, NSDL, CDSL) and open it: the password rules, 2026
2. How to track your whole family's mutual funds and stocks in one place (parents, spouse, kids)
3. CAMS vs KFintech CAS vs NSDL/CDSL eCAS: which statement do you need, and why your funds show up twice
4. XIRR explained for Indian SIPs, and how to get one XIRR for the whole family
5. Mutual fund overlap: are your five funds really one fund? See the stocks inside your funds
6. Is your mutual fund beating its benchmark? A simple scorecard for every fund and stock
7. Finding a parent's mutual funds and shares: a step-by-step checklist (MITRA, CAS, NSDL/CDSL)
8. Your FIRE number in India: why 25× may not be enough (calculator inside)

**AI search** (D §2):
- Google says AI Overviews need no special markup: normal indexable pages with snippets are enough.
- FAQ rich results are limited to government and health sites since Aug 2023.
- llms.txt showed no measurable effect (Ahrefs: 97% of these files are never requested). Add a small one, since
  plan §21.2 lists it, but don't count on it.
- What helps:
  - a one-sentence answer under each question heading, then steps;
  - figures and quotes, with links to official sources (AMFI, NSDL, CDSL, CAMS);
  - a dated "last checked" line.

  The GEO paper measured up to about 40% more visibility in AI answers.
- **robots.txt and Cloudflare bot settings:** allow `OAI-SearchBot` and `PerplexityBot`, which serve search. Decide
  separately on `GPTBot` and `Google-Extended`, which are for training.

**Communities for M30** (D §3; sizes are third-party snapshots):

| Where | Size | Promotion |
|---|---|---|
| r/IndiaInvestments | ~0.9M | Banned, except the monthly "Show II" promotional thread |
| r/personalfinanceindia | ~0.6M | Needs mod permission; link-free answers welcome |
| r/IndianStockMarket | ~1.4M | Not verified; stock-focused |
| r/StockMarketIndia, r/mutualfunds | ~0.25M / ? | Need mod permission or a designated thread |
| r/IndianStreetBets | ~0.58M | Ad-style posts get punished; trading audience, low fit |
| r/FIREIndia → r/FI_India / r/FIRE_Ind | ? | Status unclear; self-promotion discouraged; fits M27 |
| Asan Ideas for Wealth (Facebook), freefincal | ~1 lakh | Education-first and against commissions. Good fit; check rules |
| ValuePickr | – | Deletes self-promotion; take part only |
| TradingQnA | – | Bans spam only; live threads on the gaps in Zerodha's family view |
| LinkedIn / X | – | Under SEBI's 2025 rules, education only; never recommend a fund or stock; disclose any collaboration |

Approach (D §3):
- Comment first, without links.
- Post a launch only where it's allowed.
- Never cross-post the same text.
- First-person "how I built a tracker for my family" posts fit r/personalfinanceindia. **Never use real family
  numbers.**

---

## 8. For the owner

Done when: "the owner has read the recommendations". Decisions this research feeds, none needed now:
1. **Positioning line** (§1). Is it OK as the basis for M25?
2. **Headline A, B or C** (§4). It's chosen in M25, with the landing copy OK.
3. **FAQ 6 ("how do you make money?")** needs an answer before launch (M31).
4. **FIRE defaults with no source** (§6), decided in M27: healthcare and education inflation, gold return, Monte
   Carlo volatility.
5. **"Later" ideas** (§3): a statement helper, statement freshness for each member, the family-record angle. Add
   them to a milestone if wanted.
6. **A manual Reddit pass before M30.** The research tools couldn't read Reddit (top of this file).
