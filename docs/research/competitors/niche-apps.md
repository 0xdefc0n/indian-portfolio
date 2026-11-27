# Niche and specialist Indian portfolio trackers: competitor scan (2026-11-27)

Scope: Value Research, MProfit, Wealthy, Tickertape, Portfolio360, Velthian, plus six others (MF Central, Zerodha Console family view, PowerUp Money, NaviPlan, MFPA, Dezerv).

**Research limits (read first)**
- **Reddit could not be reached.** The search tool refuses reddit.com ("domain not accessible to our user agent"), so this file has no Reddit threads. The complaints below come from App Store listings, vendor help forums, TradingQnA and review sites. Someone with a browser should do a manual pass of r/IndiaInvestments, r/mutualfunds, r/personalfinanceindia and r/FIREIndia.
- **Some pages could not be fetched:**
  - valueresearchonline.com returned 403 on every page, so Value Research facts come from search snippets of its pages and its App Store listing.
  - mprofit.in/pricing is a "request pricing" form, and the MProfit legacy-pricing help article redirects to a login page.
  - wealthy.in redirected to a distributor sign-up thank-you page.
  - The Google Play pages (MProfit, Dezerv) came back empty.
  - velthian.com/pricing, /privacy and /security return 404 (the real pages are `*.php`).
  - Fintoo's homepage fetch returned only generic headings, so Fintoo is dropped as unreliable.
  - Moneycontrol is dropped because I found no public documentation of its portfolio, CAS or family features.
- "Unverified" marks a guess or a single-source claim.

---

## 1. Value Research Online (My Investments / VR app)

### Features
- The **family view is a core pitch.** The App Store listing offers "one dashboard" for a family's mutual funds, stocks, NPS, fixed income and SGBs, and calls itself the "most comprehensive family portfolio tracker in India" (marketing). Source: https://apps.apple.com/app/id1634777012 and https://apps.apple.com/in/app/id1634777012
- **How family members are linked:**
  - A third-party summary describes a "My Family's Portfolio" tab where you add family members' PANs. Source: https://www.inkl.com/news/here-s-how-to-track-all-your-stocks-and-mfs-in-one-place (403 to the fetch tool, seen only as a search snippet, unverified).
  - VR's own "Labels" article says investments under the same email show together even across different PANs, and you filter by ticking or unticking PANs. Source: https://valueresearchonline.com/stories/50952/sort-your-investments-using-labels (snippet)
  - VR's advertorial story shows one user combining a mother's PPF, a father's FDs and their own mutual funds. Source: https://www.valueresearchonline.com/stories/224969/family-finances-value-research-portfolio-tool/
- **Import:**
  - Mutual funds come in through **MF Central**: you log in with the email or mobile tied to your funds, get an OTP, download a QR code, upload it to VR, and the import takes 1–2 minutes. You must pick "Regular + Direct" and "All AMCs". Source: https://www.valueresearchonline.com/fund-advisor/pricing-policy/ (snippet), https://www.valueresearchonline.com/my-investments
  - For stocks, VR recommends importing CAMS/KFintech or NSDL/CDSL files. Source: https://valueresearchonline.com/stories/52589/upload-your-investments-with-ease (snippet)
- **Asset classes:** mutual funds, stocks, bonds, NPS, PPF, FDs and SGBs. I found no evidence of physical gold. Source: https://www.valueresearchonline.com/stories/52549/introducing-my-investments-helping-you-make-smart-money-decisions/ (snippet), App Store listing above
- **Goals and tax:** a Portfolio Planner (premium), tax liability for past, present and future years, and alerts. Source: https://apps.apple.com/app/id1634777012
- **AI:** none found.

### Pricing
- The base tracker is free. **Premium** adds the Analysis tab, liquidity analysis, "automagic" statement import and the Portfolio Planner. Source: https://www.valueresearchonline.com/stories/52557/using-the-analysis-feature-for-smart-investment-decisions/ (snippet)
- Premium cost ₹5,841/yr in a July 2022 article, possibly out of date. Source: https://ticker.finology.in/discover/solutions/value-research-review
- The Fund Advisor service is ₹4,999/yr or ₹1,495/quarter. Source: https://www.valueresearchonline.com/fund-advisor/pricing-policy/
- **Business model:** research and publishing subscriptions, plus advertising (the app is marked "contains ads"). Source: https://apps.apple.com/app/id1634777012

### Data and privacy
- **App Store privacy label, data linked to you:** name, email, phone, physical address, purchases, user content, IDs and diagnostics. Listed uses include "advertising or marketing". Source: https://apps.apple.com/app/id1634777012
- I found no security claims or incidents (the privacy page was not fetchable, 403).

### Sign-in
- Unverified: the email/mobile login is implied by the MF Central flow. I found no public page listing the sign-in methods.

### Landing page and design
- Not fetchable (403). The portfolio product sits inside a large research and news site, not on a dedicated landing page (inferred from the URL structure /my-investments, unverified).

### Dashboard
- The Dashboard is the landing page. It shows an asset-allocation pie against your target mix plus a "suitability" infographic, and the "how much you are worth" figure appears at a glance. Source: https://www.valueresearchonline.com/stories/52549/introducing-my-investments-helping-you-make-smart-money-decisions/, https://www.valueresearchonline.com/stories/50266/an-awesome-investment-tracker-for-awesome-investors/ (snippets)

### Top complaints
- No Reddit access. VR's own help text points at common failures: only Regular or only Direct funds imported, and missing AMCs. Source: https://www.valueresearchonline.com/fund-advisor/pricing-policy/ (snippet)
- The App Store shows 4.7 from 132 ratings, with no negative reviews visible. Source: https://apps.apple.com/app/id1634777012

---

## 2. MProfit

### Features
- **Family:** "Consolidates holdings across every PAN in a family", across advisors and demat accounts. It has a separate Family Office product. Source: https://www.mprofit.in/investors, https://www.mprofit.in/family-offices
- **Import:**
  - Mutual fund sync through an API.
  - Broker and wealth-manager statement uploads from 1,500+ brokers, registrars and PMS/AIF managers.
  - Daily contract notes imported automatically when you forward emails.
  - PMS/AIF files in PDF or Excel.
  - Source: https://www.mprofit.in/investors, https://www.mprofit.in/
- **CAS:** a historical blog post covers importing the CAMS CAS. A third-party summary says you can auto-forward your CAS from Gmail or Outlook. Source: https://mprofit.in/2018/01/mprofit-supports-import-cams-consolidated-account-statement-mutual-fund-schemes, https://getbelong.com/blog/portfolio-tracker-apps-in-india/ (unverified)
- **Assets:** equities, mutual funds, F&O, bonds, PMS, AIF, ETFs and FDs. Source: https://www.mprofit.in/investors, https://apps.apple.com/in/app/mprofit/id1418536415
- **Tax and accounting:** ITR-ready capital-gains reports with LTCG grandfathering, exportable to Winman, ClearTax and Genius, plus Tally voucher export. Source: https://www.mprofit.in/investors
- **Analytics:** XIRR, benchmark comparisons, MoM/QoQ/YoY comparisons and concentration. Source: https://www.mprofit.in/
- **Goals, FIRE and AI:** not mentioned. Source: https://www.mprofit.in/investors

### Pricing
- **HNI plan:** "starts at ₹18,000/year" for portfolios under ₹25 Cr. Family Office pricing is on request. No free plan is advertised. Source: https://www.mprofit.in/investors
- **Discontinued plans:** the legacy Investor, Investor+, Pro and Advisor plans were dropped on 10 Jan 2023 (for example, Investor+ was ₹3,000/yr). Source: https://help.mprofit.in/support/solutions/articles/82000895297-update-on-mprofit-legacy-plans-pricing (snippet; the page redirects to login)
- **Free tier:** an older review mentions free use for small portfolios of up to 500 transactions. Unverified and likely outdated. Source: https://www.mprofit.in/reviews/2/
- **API sync:** a Play Store reviewer says API sync is sold as a separate paid tier above the top subscription. Source: https://play.google.com/store/apps/details?id=com.mprmobile (snippet)
- **Business model:** pure software subscription, ad-free. Source: https://www.mprofit.in/investors

### Data and privacy
- Data is "encrypted on Microsoft Azure infrastructure located in India" and the product is ad-free. Source: https://www.mprofit.in/investors
- **App Store privacy label:** name, email and usage data, for app functionality only. Source: https://apps.apple.com/in/app/mprofit/id1418536415
- The privacy policy was not found, and I found no incidents.

### Sign-in
- "Log in" goes to the cloud.mprofit.in portal. The mobile app adds a passcode or Touch ID/Face ID lock. I found no public page on Google login. Source: https://mprofit.in/pricing/investors, https://apps.apple.com/in/app/mprofit/id1418536415

### Landing page and design
1. Hero headline "The clarity your wealth deserves," for "serious investors, HNIs and family offices"; "Pioneering wealth reporting since 2009"; CTA "Begin your journey"
2. Proof: 400+ cities, 1,300+ family offices and UHNI families, 1,500+ brokers integrated; press strip (ET, Mint, Inc42, YourStory)
3. Four feature blocks: family view, insights, tax, data import
4. Solution cards for four audiences (investors, family offices, wealth managers, CAs)
5. Client logos (large business groups)
6. Testimonials (for example, "family office consolidation from 7 days to under 1")
7. "1,000+ verified reviews", 4.8 Google rating
8. Closing CTA "Wealth clarity awaits", 5,000+ Indian families
9. Footer with app badges

- **Style:** premium B2B/HNI feel, wave and gradient backgrounds, card layouts, laptop and phone mockups.
- Source: https://www.mprofit.in/

### Dashboard
- XIRR across periods, benchmark comparison, asset allocation drill-downs, concentration and real-time valuations. Source: https://www.mprofit.in/features, https://apps.apple.com/in/app/mprofit/id1418536415

### Top complaints
- **Price:** "prohibitively expensive" for someone moving off a free Excel sheet. Source: https://tradingqna.com/t/mprofit-tool-reviews-alternative/162430
- **Broken imports:** a reviewer (Oct 2026) says NSDL import and reconciliation don't work, PF calculations are wrong, and API sync costs extra. Source: https://play.google.com/store/apps/details?id=com.mprmobile (snippet)
- **App Store:**
  - Support feels "reactive", and the learning curve is steep.
  - The mobile app has limited functions, and the mobile web is hard to use.
  - Prices are delayed 10–15 minutes.
  - The dashboard is limited.
  - Source: https://apps.apple.com/in/app/mprofit/id1418536415
- **Positives:** users praise handling multiple family portfolios. Source: same, and https://www.mprofit.in/reviews/2/

---

## 3. Wealthy (wealthy.in)

### Features
- **Family:** add up to **10 family members** to "track and invest on their behalf"; the tracker covers mutual funds bought on Wealthy and elsewhere, including family members' holdings. Source: https://apps.apple.com/in/app/wealthy-stocks-mutual-funds/id1222950243
- **Import:**
  - Its terms let users forward statements to a support email or **consent to Wealthy reading statements from their Gmail** (under the Google API user-data policy). Source: https://www.wealthy.in/terms-of-use
  - Automatic syncing of several mutual fund portfolios. Source: https://alternativeto.net/software/wealthy/about
- **Assets:** stocks, ETFs, mutual funds, pre-IPO, FDs, bonds, debentures, SGBs, F&O. Source: https://apps.apple.com/in/app/wealthy-stocks-mutual-funds/id1222950243
- **Goals and tax:** calculators and "10+ reports"; no tax-filing pack found. Source: https://www.wealthy.in/ (fetched content)
- **AI:** "AI-powered app" and AI-assisted KYC in under 2 minutes. Source: https://www.wealthy.in/

### Pricing
- Free to investors. Wealthy is a **distribution business**: an AMFI-registered mutual fund distributor with an insurance corporate agency, ₹9,000 Cr+ AUM and 14,000+ "Wealth Partners" (mutual fund distributors). Unverified: revenue is assumed to be distribution commission on regular plans; the terms don't use the word "commission". Source: https://www.wealthy.in/terms-of-use, https://www.wealthy.in/

### Data and privacy
- **Sharing:** the terms allow sharing "personal, transactional and behavioural" information with WealthyIN, associates, vendors and **business partners to promote or offer products** and for analytics. Source: https://www.wealthy.in/terms-of-use
- **Gmail access:** statement reading through Gmail is offered (see above). Source: same
- **App Store privacy label:** financial info, contacts and device IDs, all listed as "Data Not Linked to You". Source: https://apps.apple.com/in/app/wealthy-stocks-mutual-funds/id1222950243
- I found no incidents.

### Sign-in
- The terms only say "account" plus credentials. Unverified: mobile or OTP login is likely.

### Landing page and design
- The fetched page was a **distributor-first** page.

1. Nav with a "For Mutual Fund Distributors / For Investors" toggle
2. Hero "Grow And Manage Wealth, the Smarter Way"; CTAs "Talk To Us" and "View Demo"
3. Proof: ₹9,000 Cr+ AUM, 40+ offices, 400+ staff, 14,000+ partners
4. "Invest, Track and Grow – All in One Place" (AI app, 100k+ downloads)
5. Platform pillars
6. IIT/IIM team credibility, AMC logos, testimonials
7. MFD sign-up CTA ("empanelment in 60 seconds")
8. Newsletter

- **Style:** app screenshots, purple brand (from the logo filename, unverified).
- Source: https://www.wealthy.in/

### Dashboard
- Not found publicly. The App Store says the Mutual Fund Tracker shows in-house and external holdings with the family's included. Source: https://apps.apple.com/in/app/wealthy-stocks-mutual-funds/id1222950243

### Top complaints
- Mutual fund orders stuck at "NAV allocation in progress" for days, dropped support calls, evasive tickets, and thin detail on unlisted holdings. The rating is 4.3 from 145. Source: https://apps.apple.com/in/app/wealthy-stocks-mutual-funds/id1222950243

---

## 4. Tickertape

### Features
- **Family:** the current App Store copy says you can "link several family accounts", switch portfolios with one tap, and see a combined mutual fund summary. Source: https://apps.apple.com/app/id1583214057
  - But the help forum shows users who **paid for Pro expecting multi-PAN family tracking and found it missing**, plus other requests. Treat the family feature as new or partial (unverified). Source: https://help.tickertape.in/support/discussions/topics/82000725085, https://help.tickertape.in/support/discussions/topics/82000717913, https://help.tickertape.in/support/discussions/topics/82000723257
- **Import:**
  - Link a broker through smallcase Gateway (Zerodha, Groww, Angel and others), or upload a holdings statement (per the App Store). Source: https://apps.apple.com/app/id1583214057, https://scbrokergateway.readme.io/docs/holdings-import
  - Older support replies say broker linking was the *only* route, one broker at a time, and CAS/eCAS import was only a request. Source: https://help.tickertape.in/support/discussions/topics/82000675554
- **Assets:** Indian and US stocks, ETFs, mutual funds, digital gold, FDs, loans against securities. Source: https://www.tickertape.in/, https://apps.apple.com/app/id1583214057
- **Analytics and AI:** diversification score, red flags, "forecast" tiers (Pro); no tax pack, no FIRE tool, no AI found. Source: https://www.tickertape.in/pricing

### Pricing
- **Pro:** ₹399 for 1 month, ₹899 for 3 months, ₹2,999 for 12 months (20% annual discount running). Source: https://www.tickertape.in/pricing
- **Pro-only:** "Link multiple demat accounts", diversification score and red flags, forecasts, Pro alerts, data export. Source: same
- **Business model:** Pro subscriptions, US-stock brokerage (0.20% free / 0.15% Pro), smallcase portfolios, loans and gold (it is a smallcase group company). Source: same, https://www.tickertape.in/

### Data and privacy
- **App Store label:** identifiers are "used to track you"; contact info, search history, IDs and usage are linked to you, used for advertising and marketing. Source: https://apps.apple.com/app/id1583214057
- I found no incidents.

### Sign-in
- **Mandatory mobile-number OTP** (introduced recently, and users disliked it). Source: https://apps.apple.com/app/id1583214057

### Landing page and design
- The homepage is a **market-data portal**, not a tracker pitch.

1. Search bar plus a greeting ("Good evening :)")
2. Asset tabs
3. NIFTY/SENSEX ticker
4. Market Mood Index ("Greed zone")
5. Index and sector tiles
6. Gainers and losers
7. Mutual fund and ETF lists
8. smallcase portfolios
9. News and corporate actions
10. Screens
11. Proof ("60L+ investors", ₹60,500 Cr tracked, 6.2M+ downloads, 4.4 Play rating)
12. App-download CTA

- **Style:** dense tiles, tabs, red and green numbers, blue accent.
- Source: https://www.tickertape.in/

### Dashboard
- Holdings across brokers, consolidated or broker by broker, with a diversification score, red-flag alerts and forecasts. Source: https://apps.apple.com/app/id1583214057

### Top complaints
- **Family:** paid Pro users missing multi-PAN family tracking. Source: https://help.tickertape.in/support/discussions/topics/82000725085
- **Imports:** no eCAS or Excel import, and only one broker at a time. Source: https://help.tickertape.in/support/discussions/topics/82000675554
- **Broker linking:** login loops after linking Zerodha, a forced OTP login, no iPad app. Source: https://apps.apple.com/app/id1583214057
- **Data:** stale data complaints. Source: https://www.strike.money/reviews/tickertape

---

## 5. Portfolio360 (portfolio360.co.in)

### Features
- **Positioning:** "Your family's wealth, in one number." It tracks shares, funds, EPF, PPF, NPS, gold, property and loans, priced nightly. Source: https://www.portfolio360.co.in/
- **Family:** a "Household view for spouse and parents" is **Pro only**; the member count isn't stated. Source: https://www.portfolio360.co.in/pricing
- **Import:**
  - Unlimited CAS and broker imports (including Zerodha) on Free; the uploaded file is "not kept after parsing". Source: https://www.portfolio360.co.in/pricing, http://portfolio360.co.in/privacy/
  - "Concierge Import": staff read your statements on request. Source: http://portfolio360.co.in/privacy/
- **SIP and accruals:** declare a SIP once and it posts instalments at AMFI NAV; EPF, PPF and SSY accrue automatically; NPS is repriced nightly. Source: https://www.portfolio360.co.in/
- **Tax:** a Pro "tax pack" with capital gains by lot, matched FIFO, "ready for your CA". Source: https://www.portfolio360.co.in/pricing
- **Goals and FIRE:** goals and a "FIRE path" or freedom date (Pro), income and expense tracking, savings rate, balance sheet. Source: same
- **AI:** none in the product. The footer has "Ask an AI" links that open ChatGPT, Claude or Perplexity about Portfolio360. Source: https://www.portfolio360.co.in/

### Pricing
| Plan | Price | What it gives |
|---|---|---|
| Free | ₹0 forever | All assets, unlimited holdings and imports, XIRR, net worth dashboard, 90 days of history |
| Pro | ₹1,499/yr | One-time payment, no auto-renew, 7-day refund |
| Founding Member | ₹9,999 one-time | 500 seats, closes 31 Mar 2027 |

- New accounts start in a Pro trial with no card and drop to Free with data intact. Source: https://www.portfolio360.co.in/pricing
- **Business model:** subscriptions only; "earns nothing from the funds users hold". Source: https://www.portfolio360.co.in/

### Data and privacy
- "We do not sell, rent, share or trade your data." Google sign-in asks for no Gmail, Contacts or Drive access. Source: http://portfolio360.co.in/privacy/
- **Data collected:** PAN is optional and shown masked. Analytics are hashed daily. A **Meta pixel runs on the sign-in page** (it can be turned off with "Ad choices"). Source: same
- **Security:**
  - bcrypt passwords, TLS/HSTS, account lockout.
  - A PostgreSQL database in Asia that isn't reachable from the internet.
  - It openly lists its gaps: no independent audit, no SOC 2 or ISO certification, backups on a single provider.
  - Source: same
- **Deletion:** instant in-app deletion. A deletion record is kept (name, email, plan, holdings count and value). Login logs are kept 12 months. Source: same
- **Other:** no PAN, bank login or broker password needed; biometric app lock; export. Source: https://www.portfolio360.co.in/

### Sign-in
- Email and password, Continue with Google, Continue with Apple. Source: http://portfolio360.co.in/privacy/

### Landing page and design
- **This is the closest twin to PocketFolio's positioning.**

1. Hero "Your family's wealth, in one number." with CTA "Create Free Account" and app badges
2. Problem: money scattered across apps, passbooks and spreadsheets
3. "Instead of" (Excel, many apps) versus Portfolio360
4. How it works in 3 steps, repeated as 6 steps
5. Four phone mockups (Net worth, Holdings, Cashflow, Balance sheet), labelled sample figures
6. "Set it once" SIP and accruals
7. **"What it is not"**: not a broker, bank, distributor, PMS, tax filer or robo-advisor
8. Tagline "Money should feel simpler"
9. Pricing
10. Trust section ("no financial product pushing")
11. FAQ (founders' story, broker passwords, SEBI status, data retention, trial)
12. Final CTA plus "Sign in"
13. Footer with "Not investment advice"

- **Style:** copy-heavy, phone-first mockups, check-and-cross comparisons, ₹ formatting.
- Source: https://www.portfolio360.co.in/

### Dashboard
- A net worth headline number first, then Holdings, Cashflow and Balance sheet tabs (phone mockups, bottom nav). Source: https://www.portfolio360.co.in/

### Top complaints
- I found no reviews, Reddit or press coverage; it appears to be a very new product. Source: search with no results, https://apps.apple.com/app/id6742973362 (listing found, not read)

---

## 6. Velthian (velthian.com)

### Features
- **Positioning:** "Your wealth, tracked. Your taxes, optimized." It covers six asset classes: mutual funds, Indian equity, US stocks, real estate, fixed income and alternatives. Source: https://www.velthian.com/
- **Family:** no family or multi-PAN feature is mentioned anywhere. Source: https://www.velthian.com/how-it-works.php, https://www.velthian.com/import-cas-statement-india.php
- **Import:**
  - CAS PDF from CAMS, KFintech, MF Central, NSDL or CDSL, with auto-detected format.
  - It shows a diff of what will be added, updated or closed, which you approve. Re-importing updates holdings rather than duplicating them.
  - The password is used once and not stored, but it doesn't say whether the PDF is kept.
  - Source: https://www.velthian.com/import-cas-statement-india.php
- **Other entry:** manual entry for corporate actions, and US stocks entered one by one with USD-to-INR conversion. Source: https://www.velthian.com/how-it-works.php
- **Tax and AI:**
  - **"Tax Copilot":** loss harvesting, STCG vs LTCG, a ₹1.25L LTCG exemption tracker, FIFO capital-gains report.
  - **"Artha" AI advisor:** a chat about concentration and real-estate exposure, plus insights.
  - **"Opportunity Radar":** LTCG countdowns and holdings below their 52-week high.
  - Source: https://www.velthian.com/
- **Free tools:** a FIRE/retirement calculator (fire.php) and a public CAS reader (cas-upload.php). Source: https://www.velthian.com/

### Pricing
- **Free (₹0):** portfolio tracking for mutual funds, equity and FDs, a capital-gains overview, a basic tax view, news. Source: https://www.velthian.com/
- **Pro (₹499/yr, "Free during Early Access"):** AI insights, tax intelligence, unlimited assets, analytics. Source: same
- **Business model:** not a SEBI-registered advisor; it states it earns no commissions. Source: same

### Data and privacy
- "We do not sell, rent, or trade your personal data." It shares with hosting and email providers. Source: https://www.velthian.com/privacy.php
- **No AI provider is named**, even though Artha and Tax Copilot exist. Source: same
- It says it doesn't collect PAN or Aadhaar unless needed. Data sits on servers "in India or jurisdictions with adequate protection". Deletion happens within 30 days of request. Source: same
- **Homepage security claims:** AES-256 plus TLS 1.3, read-only, no broker access, OTP login, export and delete. Source: https://www.velthian.com/

### Sign-in
- Email and password plus OTP verification; no Google login found. Source: https://www.velthian.com/, https://www.velthian.com/privacy.php

### Landing page and design
1. Nav (Free Tools, How It Works, Guides, Pricing, Security, Markets)
2. Hero with CTA "Get Started Free", secondary links to the retirement calculator and CAS reader
3. Trust chips (read-only, bank-level encryption, no trading permissions)
4. "Illustrative" dashboard mockup
5. Tax Copilot
6. Artha AI chat demo
7. Asset-class cards
8. Artha Insights
9. Opportunity Radar
10. Security & Trust
11. Disclaimer
12. Data sources (BSE/NSE, AMFI, NSDL/CDSL, RBI, TradingView)
13. Pricing
14. SEO guides
15. Footer with company CIN

- **Style:** cards, italic emphasis words in headlines, illustrative mockups.
- Source: https://www.velthian.com/

### Dashboard
1. Net Worth
2. Today's Gain
3. XIRR
4. Allocation
5. Equity Exposure risk meter
6. One card per asset class (click through to holdings)
7. Plus a tax-saving callout

- Source: https://www.velthian.com/how-it-works.php, https://www.velthian.com/

### Top complaints
- I found no reviews or coverage (search engines don't index it yet). It is an early-access product.

---

## 7. MF Central (CAMS + KFintech)

### Features
- **Coverage:** an RTA-run hub covering all mutual fund folios sharing the same **PAN and registered mobile**, organised by fund house and asset class across statement-of-account and demat units. Source: https://apps.apple.com/app/id1600859014
- **Services:** CAS download, plus service requests (bank, nominee, IDCW, contact changes) applied across folios. Source: https://www.mfcentral.com/
- **Scope:** mutual funds only; no stocks, gold or EPF. Source: https://aliceblueonline.com/blog/track-all-mutual-funds-in-one-place
- **Family:** a guide mentions "link family PANs", but I found no official documentation of a family view (unverified). Source: same
- **Third-party role:** it is the upstream source for third-party imports (Value Research, INDmoney) through OTP or QR; one import per email per 24 hours. Source: https://assetplus.freshdesk.com/support/solutions/articles/44002783633-how-to-track-client-investments-under-other-arn-

### Pricing
- Free, as an industry utility. Source: https://aliceblueonline.com/blog/track-all-mutual-funds-in-one-place

### Data and privacy
- **App Store label:** "Data Not Collected". Claims "multiple protection layers and data encryption". Source: https://apps.apple.com/app/id1600859014, https://www.mfcentral.com/

### Sign-in
- Registration with login and password, plus OTP verification. Source: https://www.amfiindia.com/investor-corner/investor-center/cas.html (snippet)

### Landing page and design
1. Headline "A new world of possibilities to manage your Mutual Fund portfolio" ("brought to you by KFintech and CAMS") with a video
2. Four pillars: Zero Hassles, ONE to All, All Mutual Funds, Highly Secure
3. "View your Mutual Fund portfolio like a PRO!"
4. Service requests
5. Quick links
6. What's New
7. Contact

- There are no proof numbers; it is a utilitarian, institutional site.
- Source: https://www.mfcentral.com/

### Dashboard
- Holdings by asset class and fund house, with returns and performance. Source: https://www.mfcentral.com/

### Top complaints
- **2.4 from 9 ratings.** Forced logouts, "active session" lockouts, a missed redemption cutoff, broken eMandate, a UI full of abbreviations. Source: https://apps.apple.com/app/id1600859014

---

## 8. Zerodha Console family view (Kite)

### Features
- **Family:** link up to **10 Zerodha accounts**. You enter the member's Kite ID, PAN and mobile; they approve through an SMS link (valid 2 h) by logging into Console. The view is read-only and no orders can be placed. Source: https://support.zerodha.com/category/console/profile/account/articles/family-account, https://zerodha.com/z-connect/console/introducing-family-portfolio-view-on-console
- **What it shows:** combined allocation and stock/sector exposure, with a per-account dropdown. Only holdings, and only Zerodha accounts. Family tagging and goals were "planned" (2022). Source: same
- No CAS import; no gold, EPF or FD; no family-level tax report.

### Pricing
- Free for Zerodha customers. Source: https://zerodha.com/z-connect/console/introducing-family-portfolio-view-on-console (staff comment)

### Data and privacy
- Consent from each member is required. Source: same

### Sign-in
- Kite login. Source: same

### Landing page and design
- None; this is an in-app feature of the broker.

### Dashboard
- Family holdings, allocation and exposure. Source: same

### Top complaints
- No Excel export of family holdings (staff reply, Aug 2024), and mutual fund values lag NAV (user comment, unverified). Source: https://zerodha.com/z-connect/console/introducing-family-portfolio-view-on-console

---

## 9. PowerUp Money

### Features
- **Positioning:** a SEBI RIA, "India's trusted Mutual Fund Advisory App". Source: https://www.powerup.money/
- **Family:**
  - Add up to **8 family members**, and join up to 8 family accounts.
  - Linking: OTP on the member's phone, then name, email and relationship, then their PAN, then a second OTP to pull their mutual funds.
  - You see each member's mutual funds, allocation and performance against indices.
  - Published Jan 2026.
  - Source: https://www.powerup.money/blog/bond/new-on-powerup-track-and-view-your-familys-mutual-funds-in-one-place
- **Import:** PAN plus consent fetch (mutual funds only). Source: https://apps.apple.com/in/app/powerup-money-mutual-funds/id6470202376
- **Analytics:** monthly fund "form" ratings (in-form, on-track, off-track, out-of-form), rolling returns, benchmark comparison, tax-efficient rebalancing (Elite). Source: https://www.powerup.money/
- No stocks, gold, EPF or FIRE; AI is not mentioned.

### Pricing
- The core service is free. **Elite costs ₹999/yr + GST**, or **₹749/yr + GST per added family member**. Source: https://www.powerup.money/, https://www.powerup.money/blog/bond/new-on-powerup-track-and-view-your-familys-mutual-funds-in-one-place
- **Business model:** RIA advisory fee; direct funds only, no commissions. Source: https://www.powerup.money/

### Data and privacy
- Data is "encrypted"; not shared "without consent". Source: https://www.powerup.money/
- **App Store label:** contact info is **used to track you** across other companies' apps. Source: https://apps.apple.com/in/app/powerup-money-mutual-funds/id6470202376
- The **homepage CTA collects a phone number with a required marketing-consent checkbox**. Source: https://www.powerup.money/

### Sign-in
- Mobile number and OTP. Source: https://apps.apple.com/in/app/powerup-money-mutual-funds/id6470202376

### Landing page and design
1. Hero "Review, select, and rebalance your mutual funds effortlessly", CTA "Analyse my portfolio" (phone field), "Trusted by 9L+ investors"
2. Proof: 20+ years of data, SEBI RIA number
3. Features
4. Team
5. FAQ
6. Pricing
7. Disclosures

- Source: https://www.powerup.money/

### Dashboard
- Portfolio performance against Nifty, with each fund's form status. Source: https://www.powerup.money/

### Top complaints
- No total-investment view, no dark mode, account deletion by email only (about 7 days), the Elite promo not honoured. The rating is 4.4 from 456. Source: https://apps.apple.com/in/app/powerup-money-mutual-funds/id6470202376

---

## 10. NaviPlan (fin.naviran.in, with freefincal)

### Features
- **Family:**
  - Imports CAMS/KFintech CAS (password-protected PDFs) and **multiple CAS statements**; each fund can be labelled and assigned to goals.
  - Explicit multi-PAN "family" wording is not confirmed by the FAQ, though a third-party summary says family portfolios are supported (unverified).
  - Source: https://freefincal.com/faq-naviplan-privacy-first-portfolio-tracker/, https://freefincal.com/naviplan-a-privacy-focused-multi-asset-tracker-and-goal-planner/
- **Import:** tradebook uploads from 8 brokers (v1.5.8). Source: https://freefincal.com/?p=365794
- **Assets:** mutual funds, stocks, FDs, RDs, EPF, PPF, NPS, SSY, SIFs, insurance; gold not mentioned. Source: https://freefincal.com/naviplan-a-privacy-focused-multi-asset-tracker-and-goal-planner/
- **Goals and tax:** strong goal planner (corpus, inflation, step-up SIP, glide paths); a Tax Center with capital gains and harvesting. Source: same

### Pricing
- **₹2,500/yr**, non-refundable. Source: same

### Data and privacy
- **Local-first:** all portfolio data lives in the browser's database. The server (Supabase) stores only the mobile number and payment record. Source: same, https://freefincal.com/faq-naviplan-privacy-first-portfolio-tracker/

### Sign-in
- No account; a mobile number unlocks the purchase. Source: same

### Landing page and design
- Distributed through freefincal blog posts, not a marketing landing page. Source: same

### Dashboard
1. Cards for invested, current value, gain and XIRR
2. Charts
3. Holdings table
4. Plus a net worth card

- Source: https://freefincal.com/naviplan-a-privacy-focused-multi-asset-tracker-and-goal-planner/

### Top complaints
- **No sync across devices;** clearing the browser cache wipes data without a JSON backup. **Re-uploading a CAS overwrites transactions.** Source: https://freefincal.com/faq-naviplan-privacy-first-portfolio-tracker/

---

## 11. MFPA (mfpa.in): new "upload your CAS" analyser

### Features
- Upload a CAS and get XIRR per scheme, latest-NAV value and a category breakdown; multi-PAN not mentioned. Source: https://www.producthunt.com/products/mfpa/launches/mfpa-mutual-fund-portfolio-analyzer

### Pricing
- Free. Source: same

### Data and privacy
- "Zero-storage policy". Source: same

### Sign-in
- No signup. Source: same

### Landing page and design
- Not fetched.

### Dashboard
- XIRR plus breakdown. Source: same

### Top complaints
- None found. Launched 27 Jan 2026. Source: same

---

## 12. Dezerv (Wealth Monitor / Wealth Checkup app)

### Features
- **Coverage:** a "single wealth dashboard" for mutual funds, stocks, NPS, FDs and other assets; a "360° Portfolio Tracker" and portfolio health check. Source: https://apps.apple.com/in/app/wealth-monitor-mf-stocks/id1669925824 (snippet)
- **Family:** add family members, per a user review and a third-party summary. Source: same, https://getbelong.com/blog/portfolio-tracker-apps-in-india/ (unverified)
- **Import method:** not confirmed (unverified).

### Pricing
- The tracker appears free. Unverified: it is a funnel into Dezerv's wealth-management and PMS products.

### Data and privacy
- Not checked (the Play page returned no content). Source: https://play.google.com/store/apps/details?id=com.dezerv

### Sign-in
- Not confirmed.

### Landing page and design
- Not fetched.

### Dashboard
- Net worth plus a health check (snippet).

### Top complaints
- None found.

---

## Patterns

**What's common**
- **Import paths:**
  - Mutual funds come through **MF Central** (an OTP or QR flow, as at Value Research), or a **PAN plus OTP consent fetch** (PowerUp, Wealthy).
  - Stocks come through **broker linking** (Tickertape via smallcase Gateway, Zerodha Console) or **contract-note email forwarding** (MProfit).
  - Raw **CAS PDF upload** is the indie path: Portfolio360, Velthian, NaviPlan, MFPA.
- **Gmail reading** appears only at Wealthy (opt-in, through the Google API). The indie trackers loudly say "no broker password, no Gmail access".
- **Hero numbers:**
  - Almost every dashboard leads with **net worth / current value, today's or total gain, and XIRR**, then allocation.
  - The indie tools (Portfolio360, Velthian) lead with "one number".
  - The research-led apps (Value Research, Tickertape) lead with allocation, diversification and "red flag" scores.
- **Trust pages:**
  - Every indie tracker has a "Security & Trust" block plus a "what we are not" or "no commissions" disclaimer.
  - The paid and distributor apps (Wealthy, Tickertape, PowerUp) carry ad and tracking identifiers in their App Store labels; the indie ones don't.
- **Sign-in:** mobile OTP dominates the app-first players (Tickertape, PowerUp, Wealthy, MF Central). Google and Apple login appears only at Portfolio360, and Velthian uses email, password and OTP. **Magic link: none found.**

**Family-tracking gaps (PocketFolio's opening)**
- **Family is usually scoped to one source:**
  - Zerodha's family view covers only Zerodha accounts and only holdings.
  - PowerUp covers only mutual funds (up to 8 members).
  - Wealthy covers only mutual funds (up to 10).
  - MF Central works per PAN and mobile.
  - Tickertape's family linking is new and inconsistent; paid Pro users complained it was missing.
- **Multi-asset family plus multi-PAN CAS de-duplication** is rare:
  - **MProfit** does it, but costs ₹18k+/yr.
  - **Value Research** does it, but with an email-shared or PAN-filter workaround.
  - **Portfolio360** charges for it (₹1,499 Pro).
  - **Velthian** and **MFPA** have no family support.
  - **NaviPlan** takes multiple CAS but is local-only with no sync, so nothing is shared across devices or family members.
- **Hard to find in combination:** no competitor found does all of these together:
  - NSDL/CDSL eCAS plus CAMS/KFintech CAS de-duplication across members
  - Stocks with tradebook buy prices and corporate actions
  - Physical gold, silver and SGBs
  - A per-holding benchmark score
  - Look-through to the stocks inside funds
  - All of the above on a **free** tier
- **Not found anywhere:** look-through and benchmark-per-holding were not seen (Velthian has "benchmark gaps vs NIFTY 100" insights; PowerUp has fund "form" ratings).
- **Privacy is a differentiator only among the indies.** Portfolio360 is the most transparent (lists its own security gaps, but runs a Meta pixel on sign-in). Velthian has AI features but names no AI provider in its privacy policy.

**How the paid trackers justify their price**
- **Tax:** a tax pack, FIFO capital gains "ready for your CA", ITR exports (MProfit, Portfolio360 Pro, Velthian Pro, NaviPlan, VR Premium).
- **Family:** the household or family view as an upsell (Portfolio360 Pro gates it; PowerUp sells ₹749 per member).
- **Advice:** advice or analysis layers such as diversification scores, red flags, forecasts, fund-form ratings and rebalancing (Tickertape Pro, PowerUp Elite, VR Premium).
- **Goals and AI:** goals, FIRE paths, cashflow and balance sheet (Portfolio360 Pro, NaviPlan); AI insights (Velthian Pro, Wealthy's marketing).
- **Breadth and support:** breadth of import and "white-glove" support for HNIs and family offices (MProfit: 1,500+ sources, Tally export, account managers).
- **Price anchors (₹/yr):**

| Product | Price |
|---|---|
| Velthian Pro | 499 |
| PowerUp Elite | 999 |
| Portfolio360 Pro | 1,499 |
| NaviPlan | 2,500 |
| Tickertape Pro | 2,999 |
| VR Premium (2022 figure) | ~5,841 |
| MProfit HNI | 18,000+ |
