# Big-app competitor scan: INDmoney, Kuvera, ET Money, Groww, Zerodha

Research date: 2026-11-27. Public pages only; no sign-ups or logins.

**How to read this**
- Every bullet ends with its source URL(s).
- "UNVERIFIED" marks a guess or a single weak or third-party source.
- **Fetch limits:**
  - reddit.com is blocked for this research agent, in both search and fetch, so there are **no Reddit links**. Complaints come from Trustpilot, App Store reviews, consumer-complaint sites, ValuePickr, TradingQnA, Grapevine and news.
  - etmoney.com is blocked for this agent (both fetch and search), so ET Money claims come from its App Store listing, Wikipedia and news.
  - kuvera.in is a JS-only app. Fetching it returns only the title "Kuvera by CRED", so the homepage content could not be read. Kuvera claims come from its Freshdesk help centre, blog, Wikipedia and news.
  - web.archive.org is also blocked for this agent.
  - App Store pages sometimes returned HTTP 429. The Google Play page for Kuvera returned 404.

---

## 1. INDmoney

### 1. Features
- **Family view:**
  - Net Worth → Family → "Add Member". You enter the member's name, relation and the phone number on their INDmoney account. The invite goes by OTP or WhatsApp.
  - Each member must accept. Each needs their own INDmoney account; the page contradicts itself on this, but the FAQ says yes.
  - No member cap is stated ("add multiple members").
  - Members see each other view-only, and a member can revoke access.
  - Free.
  - https://www.indmoney.com/networth/family-accounts
  - https://www.indmoney.com/blog/how-to-track-your-family-net-worth-on-indmoney (updated 14 Apr 2026)
- **What a family member can share:**
  - Indian and US stocks, MFs, ETFs, NPS, EPFO, bonds, PPF, FDs.
  - Bank balances, gold, silver, real estate, ESOPs and RSUs.
  - Liabilities: credit cards, bills, loans.
  - Only what the member tracks on INDmoney appears.
  - https://www.indmoney.com/networth/family-accounts
- **Mutual fund import:** "Track Other Funds" uses an MF Central OTP. You then choose the AMCs to sync. https://www.indmoney.com/features/track-mutual-funds
- **What the tracked-MF view shows:**
  - XIRR, active SIPs across platforms and fund-wise performance.
  - Category, sector and market-cap allocation, and overlap.
  - IDCW (dividend) income and capital gains.
  - https://www.indmoney.com/features/track-mutual-funds
- **Gmail parsing:** The privacy policy describes opt-in, read-only Gmail access to "financial emails", including credit card statements. https://www.indmoney.com/privacy-policy
- **External stocks:** Tracked "across every broker and Demat account", for free.
  - https://www.indmoney.com/stocks/track-brokers
  - Import via NSDL/CDSL statements is reported by a third party (UNVERIFIED as to exact steps): https://getbelong.com/blog/portfolio-tracker-apps-in-india/
- **EPF:** Balance by UAN, contributions, interest and claim status. https://www.indmoney.com/features/track-epfo-account
- **Investing products:**
  - US stocks via GIFT City, Indian stocks, F&O, IPO, ETFs, NPS, commodities and direct MFs.
  - "InstaCash" loans at 10–45% APR.
  - https://www.indmoney.com/
  - https://apps.apple.com/in/app/id1450178837
- **AI:** "mIND", an assistant that answers portfolio-level questions in natural language and does not execute trades.
  - https://www.indmoney.com/blog/updates/10-new-updates-on-indmoney
  - https://inc42.com/?p=546526
  - There is also an "AI Stocks" theme in the menus: https://www.indmoney.com/
- **Goals / FIRE:** Not found on the pages fetched. UNVERIFIED.

### 2. Pricing / business model
- **Accounts and funds:**
  - ₹0 account opening and no demat AMC.
  - Direct MFs at ₹0 commission.
  - MF tracking and rebalancing ₹0.
  - https://www.indmoney.com/pricing
- **Brokerage:**
  - Indian stocks: 0.1% or ₹20 per order, whichever is lower. F&O ₹20 per order. DP charge ₹18.5 + GST.
  - US stocks: Plan A 0.25%, or Plan B 0.10% (min $0.60).
  - https://www.indmoney.com/pricing
- **No premium subscription** is listed on the pricing page. https://www.indmoney.com/pricing
- **How it makes money:**
  - Broking (India and US), lending partners (InstaCash) and other partner products.
  - The privacy policy mentions "advertising on the Platform" by service providers, and anonymised aggregates shared with "advertisers, sponsors, investors, strategic partners".
  - https://www.indmoney.com/privacy-policy
  - https://apps.apple.com/in/app/id1450178837

### 3. Data and privacy
- **What it collects (with consent):**
  - Gmail: read-only access to financial emails. The policy says email data is "not used or shared for advertising".
  - SMS, contacts (for UPI), credit bureau data (Experian, CRIF), and device and location data.
  - Installed-app metadata, which "may be collected even when the app is closed".
  - https://www.indmoney.com/privacy-policy
- **Sharing:**
  - Says it does not "rent, sell, disclose or share" personal data without consent.
  - Shares with partner banks, NBFCs, insurers, affiliates and its US broker.
  - https://www.indmoney.com/privacy-policy
- **Security and storage:**
  - ISO 27001:2022 and PCI DSS.
  - SSL. NPS statement passwords are encrypted with AWS KMS.
  - Data is stored in India, except for US stocks.
  - https://www.indmoney.com/privacy-policy
  - https://www.indmoney.com/
- **Deletion:** Account deletion is in Settings. To unlink Gmail, you email the privacy team. https://www.indmoney.com/privacy-policy
- **Apple privacy label:**
  - Identifiers are used for tracking.
  - Linked to you: financial info, precise location, contact info, emails/texts, photos, audio and more.
  - https://apps.apple.com/in/app/id1450178837
- **Breaches:** None found in search. https://www.indmoney.com/privacy-policy (no incident section); the search returned no INDmoney incidents.

### 4. Sign-in
- **Phone number is the entry:** the homepage hero has a phone field with "Open Free Account". https://www.indmoney.com/
- Family invites are keyed on phone number. https://www.indmoney.com/networth/family-accounts
- **KYC and VKYC:** Needed to invest. One review complains VKYC account creation took 3–4 weeks. https://apps.apple.com/in/app/id1450178837
- **Google or email sign-in:** Not seen. UNVERIFIED.

### 5. Landing page
- **Sections, top to bottom** (https://www.indmoney.com/):
  1. **Nav:** US Stocks, Indian Stocks, ETFs, MFs, IPO, Features, Pricing, plus "Open Demat Account".
  2. **Hero:** "Trade & Invest in India, US and Global Markets from One App". Subline: "With INDmoney your money never sleeps". CTA: "Open Free Account", with a phone-number field. It also shows the India and US market hours.
  3. **Proof:** "Top Rated Trading & Investing App", iOS 4.7, Android 4.6, "2Cr+ downloads", "20L+ investors".
  4. **Product grid:** US stocks, Indian stocks, MFs, F&O, commodities, IPO, ETFs, UCITS ETFs, NPS.
  5. **"What's happening in the markets today"**.
  6. **"More than an Investing App – Your Money Operating System":** track investments, net worth and family accounts. App-store badges and a QR code.
  7. **Footer:** SEBI, NSE, BSE and MCX registrations, ISO and PCI.
- **Visual style:** Clean icon cards and an app-download focus. (Inferred from text and alt text only; colours not seen.)

### 6. Dashboard
- **Net worth comes first.** The family view gives "one clear number of your family's total net worth, broken down by each member". https://www.indmoney.com/blog/how-to-track-your-family-net-worth-on-indmoney
- **MF tracker:** total invested and current value, XIRR, SIPs, allocation and overlap. https://www.indmoney.com/features/track-mutual-funds

### 7. Top complaints
- **Support and money movement:**
  - Generic support replies and slow account activation after VKYC (App Store, Aug 2025): https://apps.apple.com/in/app/id1450178837
  - Accounts blocked, money stuck, refunds not processed, no phone or live chat (late 2025): https://www.pissedconsumer.com/indmoney/RT-F.html
  - Tickets closed as "resolved" while unresolved, US-stock withdrawals held for days, new withdrawal fees. TrustScore 2.9 from only 4 reviews: https://www.trustpilot.com/review/indmoney.com
- **Trading limits and orders:**
  - "Huge issues with limits and orders… customer service is pathetic" (ValuePickr): https://forum.valuepickr.com/t/indmoney-bad-experience-looking-for-other-app-for-us-investing/220354
  - Low exchange complaint counts (1–2 a year on BSE): https://www.chittorgarh.com/broker-complaints/indmoney/182/

---

## 2. Kuvera (by CRED)

### 1. Features
- **Family Account:**
  - Many accounts under one login. Individual and joint accounts are supported, joint in "anyone or survivor" mode with up to 3 holders.
  - Every applicant must be KYC-verified.
  - Minor and HUF accounts are not supported.
  - An existing Kuvera user cannot be linked; use a Managed Account instead.
  - https://kuvera.in/blog/joint-and-family-accounts-on-kuvera/amp/
  - https://kuvera.freshdesk.com/support/solutions/articles/82000760510-what-is-a-family-account-
- **Managed Accounts:**
  - Link separate Kuvera logins with access controls.
  - The manager cannot see KYC or bank details, unlike in a Family Account.
  - https://kuvera.in/blog/managed-accounts-link-and-invest-across-kuvera-accounts/amp
- **External import:**
  - "Import Portfolio" triggers a CAMS CAS to your email. You forward that email to Kuvera's import address.
  - Joint-account holdings can also be imported via CAS.
  - https://kuvera.freshdesk.com/support/solutions/articles/82000888525-how-to-invest-track-and-redeem-mutual-funds-
  - https://kuvera.freshdesk.com/support/solutions/articles/82000760586-can-i-import-my-existing-joint-account-holdings-into-kuvera-
- **Tax:**
  - Tax harvesting aims at the ₹1L (older figure) LTCG exemption, for equity only, and is enabled per taxpayer.
  - TradeSmart shows units outside the short-term capital gains window.
  - https://kuvera.freshdesk.com/support/solutions/folders/82000604770
  - https://kuvera.in/blog/save-up-to-%E2%82%B910000-in-ltcg-taxes-with-tax-harvesting/amp/
- **Products:**
  - Direct MFs, digital gold, FDs, US ETFs and stocks, insurance, and (historically) crypto.
  - https://en.wikipedia.org/wiki/Kuvera.in
  - https://yourstory.com/2020/02/personal-finance-startup-kuvera-paytm-mutual-funds-wealth-management
- **Goals:** Goal planning (tax-saving, home, retirement, education). https://yourstory.com/2020/02/personal-finance-startup-kuvera-paytm-mutual-funds-wealth-management
- **Calculators:** https://kuvera.in/calculators
- **Changes under CRED (Apr 2026):**
  - Advanced analytics, portfolio recommendations and an invite-only product for affluent users.
  - "Surplus" moves idle cash into liquid funds (minimum ₹1L).
  - About 2 lakh MAU.
  - https://www.whalesbook.com/news/English/bankingfinance/CRED-Overhauls-Kuvera-Wealth-for-Affluent-Users-Focus-on-Trust/69d535c831d4f2ab4813123a
- **EPF/PPF, external stocks, AI:** Not found. UNVERIFIED.

### 2. Pricing / business model
- **Free core:** Direct plans with "zero commissions" and "zero subscription fees". The App Store listing says "completely free", with no in-app purchases.
  - https://kuvera.in/mutual-funds
  - https://apps.apple.com/app/id1329701793
- **Paid features (older reports):**
  - A 2020 report says an annual fee unlocked premium features (family planning, tax harvesting), or users could pay with "Kuvera coins". Current status UNVERIFIED.
  - The FAQ still refers to a "tax harvesting subscription".
  - https://yourstory.com/2020/02/personal-finance-startup-kuvera-paytm-mutual-funds-wealth-management
  - https://kuvera.freshdesk.com/support/solutions/folders/82000604770
- **Revenue:**
  - Partner commissions (gold, lending): https://yourstory.com/2020/02/personal-finance-startup-kuvera-paytm-mutual-funds-wealth-management
  - Now part of CRED (acquired Feb 2024, cash and stock): https://techcrunch.com/2024/02/06/cred-acquires-mutual-fund-startup-kuvera-in-wealth-management-push/

### 3. Data and privacy
- **Privacy policy:** It renders only through JS and could not be read (https://kuvera.in/privacy-policy). Not verified.
- **Registration:** The operating company is a SEBI-registered investment adviser. https://en.wikipedia.org/wiki/Kuvera.in
- **Email-forwarding model:** Users email their CAS PDF to Kuvera, which implies Kuvera receives the full statement. Inferred from the import flow at https://kuvera.freshdesk.com/support/solutions/articles/82000888525-how-to-invest-track-and-redeem-mutual-funds-
- **Breaches:** No Kuvera-specific incident found. Community concern is about CRED's ownership, not data. https://technofino.in/community/threads/cred-acquires-kuvera.22739/latest

### 4. Sign-in
- **Google login** is supported, and a password can be set later. https://kuvera.freshdesk.com/support/solutions/articles/82000772406-i-had-used-google-log-in-while-setting-up-my-kuvera-account-can-i-log-in-with-a-password-now-
- **Email and password** login. Changing the login email needs a support email. https://kuvera.freshdesk.com/support/solutions/articles/82000772376-can-i-change-the-email-id-for-logging-in-to-kuvera-account
- **KYC** is needed for each investing applicant. https://kuvera.in/blog/joint-and-family-accounts-on-kuvera/amp/

### 5. Landing page
- **Could not fetch.** kuvera.in renders only via JS, and the page title is "Kuvera by CRED". https://kuvera.in/
- **Positioning copy from indexed pages:** "Kuvera makes it easy to discover and invest in direct mutual fund plans" (https://kuvera.in/mutual-funds). Section order and visual style UNVERIFIED.

### 6. Dashboard
- **Home:** Switch between family and joint accounts by tapping the user's name at the top left. https://kuvera.in/blog/joint-and-family-accounts-on-kuvera/amp/
- **Portfolio page:** "displays your holdings". Nothing more was documented in the pages read. https://kuvera.freshdesk.com/support/solutions/articles/82000888525-how-to-invest-track-and-redeem-mutual-funds-

### 7. Top complaints
- **App bugs:** a white screen, and an identity-verification loop. The developer pushed fixes. https://apps.apple.com/app/id1329701793
- **Distrust after the CRED acquisition:**
  - "stay away from Kuvera now": https://www.desidime.com/discussions/kuvera-is-now-cred
  - Fears about CRED-style UI: https://technofino.in/community/threads/cred-acquires-kuvera.22739/latest
  - What users should do now: https://arthgyaan.com/blog/cred-acquires-kuvera-what-should-kuvera-users-do-now.html
- **Clunky family linking:** An existing member's account can't be linked into a family. https://kuvera.in/blog/joint-and-family-accounts-on-kuvera/amp/

---

## 3. ET Money (360 ONE)

### 1. Features
- **Products:**
  - Direct MFs, SIFs, FDs, bonds, NPS, US stocks and ETFs.
  - Loans against MFs and personal loans.
  - https://apps.apple.com/in/app/et-money-mutual-fund-sip-app/id1212752482
- **Tools:**
  - Investor personality test, fund report cards and "verdicts", and the "ET Money Select" list.
  - Portfolio health check.
  - "Ultimate SIP", an equity, debt and gold allocation.
  - https://apps.apple.com/in/app/et-money-mutual-fund-sip-app/id1212752482
- **External MF tracking:**
  - A dashboard for funds held outside ET Money, with XIRR.
  - A developer reply mentions CAS upload, and listing copy mentions uploading PDFs of external MFs.
  - https://apps.apple.com/in/app/et-money-mutual-fund-sip-app/id1212752482
  - https://apple.co/2Cn7aZ7
- **Tax:** Downloadable capital-gains statements. https://apps.apple.com/in/app/et-money-mutual-fund-sip-app/id1212752482
- **Family:** No family portfolio feature found. "Family" appears only for health insurance. UNVERIFIED.
  - https://apps.apple.com/in/app/et-money-mutual-fund-sip-app/id1212752482
  - https://www.covaipost.com/?p=210076
- **SMS reading:** The app historically read SMS transaction alerts to categorise spending and build a risk profile. https://en.wikipedia.org/wiki/ET_Money
- **Genius ("AI"-like advisory):**
  - Paid membership, launched 2022.
  - Uses a "proprietary quant model" with dynamic asset allocation across equity, debt and gold.
  - https://www.aninews.in/news/business/business/etmoney-opens-complete-access-to-genius-a-premium-membership-service-that-delivers-personalized-investing-intelligence-for-winning-investment-outcomes20220209145048/
- **Retirement:** Via NPS. A dedicated FIRE calculator was not verified.

### 2. Pricing / business model
- **Free core:** "0% Commission, No transaction charges & No hidden fees" on direct MFs. https://apps.apple.com/in/app/et-money-mutual-fund-sip-app/id1212752482
- **Genius price:**
  - ₹249/month billed quarterly at launch (2022): https://www.lokmattimes.com/business/etmoney-opens-complete-access-to-genius-a-premium-membership-service-that-delivers-personalized/
  - One user reports ₹747/quarter: https://grapevine.in/post/ET-Money-genius-review-9d90424f-d0e2-4f0d-933c-0a094e2b6f0b
  - Current 2026 price UNVERIFIED.
- **Revenue:**
  - Subscriptions (Genius), loans, insurance and distribution of other products: https://en.wikipedia.org/wiki/ET_Money
  - Now owned by 360 ONE WAM (₹366 cr, June 2024): https://en.wikipedia.org/wiki/ET_Money

### 3. Data and privacy
- **Apple privacy label:**
  - Identifiers and usage data are used to track.
  - Linked to you: financial info, email and device ID, partly for advertising.
  - https://apps.apple.com/in/app/et-money-mutual-fund-sip-app/id1212752482
- **SMS:** Historically reads transaction SMS. https://en.wikipedia.org/wiki/ET_Money
- **Privacy policy:** Could not be fetched (domain blocked for this agent).
- **Breaches:** None found. https://en.wikipedia.org/wiki/ET_Money

### 4. Sign-in
- Could not be verified, because etmoney.com is blocked and no third-party page describes it. A mobile-number OTP flow is likely but UNVERIFIED.
- Paperless KYC with no demat account needed. https://apps.apple.com/in/app/et-money-mutual-fund-sip-app/id1212752482

### 5. Landing page
- **Could not fetch** (etmoney.com blocks this agent, and web.archive.org is blocked too).
- **App Store positioning:** "India's Mutual Funds & SIF expert". 4.3★ from about 22k iOS ratings.
  - https://apps.apple.com/in/app/et-money-mutual-fund-sip-app/id1212752482
  - https://chrome-stats.com/d/com.smartspends
- Section order and visual style UNVERIFIED.

### 6. Dashboard
- **One dashboard** for ET Money and external MFs: XIRR, portfolio health check and breakdowns. https://apps.apple.com/in/app/et-money-mutual-fund-sip-app/id1212752482
- **Reviews say:**
  - External tracking once overstated portfolio value by about 50% (2022).
  - Some charts used preset values rather than the user's data.
  - https://apps.apple.com/in/app/et-money-mutual-fund-sip-app/id1212752482

### 7. Top complaints
- **Dark patterns into the paid Genius plan:** a "free survey" led to a paid membership. https://www.consumercomplaints.in/bycompany/et-money-a502720.html
- **"A trap to force users into their paid plans"**, and poor support. https://fi.trustpilot.com/review/etmoney.com
- **Repeated SIP failures** despite sufficient balance. https://uk.trustpilot.com/review/etmoney.com
- **Genius returns** lagging self-managed portfolios (anecdotal). https://grapevine.in/post/ET-Money-genius-review-9d90424f-d0e2-4f0d-933c-0a094e2b6f0b
- **SIP debits missing** from holdings for months, and slow support (2021 review). https://apps.apple.com/in/app/et-money-mutual-fund-sip-app/id1212752482

---

## 4. Groww

### 1. Features
- **Family account** (announced 7 Sep 2026):
  - Profile → "Add family", using the member's mobile number with an OTP and their Groww PIN.
  - You switch between accounts on one device, and can **trade and invest for family members** and open accounts for them.
  - No cap stated.
  - https://groww.in/updates/family-account
- **Minor and HUF demat accounts** are offered: https://groww.in/
- **External MF import:**
  - Mutual Fund tab → Explore → "Import Funds", then an MF Central OTP. Takes 10–15 minutes.
  - Older flow: Gmail read permission to fetch CAMS/KFintech statements.
  - External SIPs are not auto-synced. External FDs are not importable.
  - https://groww.in/help/mutual-funds/mf-dashboard/how-do-i-import-my-external-mutual-fund-investments-1
  - https://groww.in/help/mutual-funds/mf-track-and-switch/what-if-i-disable-my-gmail-s-read-permission--71
  - https://groww.in/help/fds/dp-fd-about/can-i-import-my-external-fixed-deposits-into-groww
  - https://groww.in/blog/how-to-track-your-external-investments-on-groww
- **Products:**
  - Stocks, ETFs (gold, silver, international), IPOs, bonds, F&O, commodities and MFs.
  - FD calculator only.
  - https://groww.in/
- **Tax:**
  - "Capital Gains in Redeem" shows LTCG and STCG with estimated tax before a sale (May 2025): https://groww.in/updates/introducing-capital-gains-in-redeem-on-groww
  - Tax-loss harvesting: https://groww.in/updates/updates-from-groww-tax-loss-harvesting-intraday-oco-bonds-and-lots-more
- **AI:**
  - GR-1 assistant: opt-in, portfolio-aware, no auto-execution, in beta (Groww Next 2026).
  - Groww MCP server.
  - Groww Prime pilot for MF portfolio management (Jan 2026).
  - https://groww.in/updates/gr-1-ai-investing-assistant-groww
  - https://entrackr.com/news/groww-showcases-ai-powered-investing-tools-at-groww-next-2026-11168623
  - https://groww.in/updates/groww-mcp
  - https://yourstory.com/2026/01/groww-pilots-feature-that-helps-users-manage-mutual-fund-investments
- **EPF/PPF and physical gold tracking:** Not found.

### 2. Pricing / business model
- **Free core:**
  - "No account opening charges".
  - Direct MFs at zero charges.
  - https://groww.in/
- **Revenue:**
  - Broking and F&O (Pricing page linked, not fetched), MTF and pledge.
  - Personal loans at 13–36% APR via partners, Groww Credit.
  - https://groww.in/
  - https://apps.apple.com/in/app/groww-stocks-mutual-fund-ipo/id1404871703

### 3. Data and privacy
- **Security claims:**
  - Data encrypted at rest and in transit. ISO 27001:2022.
  - Penetration testing by CERT-In empanelled auditors. WAF and Zero Trust.
  - Login uses a PIN plus an OTP on new devices.
  - Bug bounty.
  - https://groww.in/p/security
- **Sharing:**
  - Does not share or sell personal info "for their marketing objectives" without consent. This wording covers marketing use only: https://groww.in/p/security
  - "We do not share our customers' details with third parties": https://groww.in/help/my-account/discoverable/how-does-groww-keep-my-data-safe
- **Gmail:** Read permission is used to fetch MF statements. https://groww.in/help/mutual-funds/mf-track-and-switch/what-if-i-disable-my-gmail-s-read-permission--71
- **Apple privacy label:** Usage data tracks you across other companies' apps and sites. Linked to you: email, phone, user ID and advertising data. https://apps.apple.com/in/app/groww-stocks-mutual-fund-ipo/id1404871703
- **Incidents:**
  - Paid ₹48 lakh to settle a SEBI case over **security lapses**: https://inc42.com/buzz/groww-pays-inr-48-lakh-to-settle-sebi-case-over-security-lapses/
  - Paid ₹34 lakh over a Jan 2024 tech glitch: https://www.business-standard.com/markets/news/groww-invest-pays-over-34-lakh-to-settle-sebi-case-linked-to-tech-glitch-125051301434_1.html
  - Cloudflare outage, 5 Dec 2025: https://www.businesstoday.in/markets/stocks/story/cloudflare-outage-briefly-hits-zerodha-groww-other-services-505322-2025-12-05
- **Full privacy policy text:** Not readable in the fetch (only the intro rendered). https://groww.in/privacy-policy, https://groww.in/p/general-privacy-policy

### 4. Sign-in
- **Methods:**
  - "Continue with Google" or email, plus a mobile OTP, then a 4-digit PIN.
  - https://credit.groww.in/loan-against-securities/journey
  - https://www.chittorgarh.com/faq_pg/how-to-login-in-groww-app/3671/
  - https://assets.nextleap.app/submissions/GrowwAppTeardown_SatyaNP-ce9b17fc-ca18-4541-9c42-d0afe1c017c3.pdf
- **Web sign-up:** Asks users to download the app. https://groww.in/help/my-account/ma-account-details/why-am-i-asked-to-download-app-when-i-signup-on-web--29
- **KYC** is needed to invest. https://groww.in/

### 5. Landing page
- **Sections, top to bottom** (https://groww.in/):
  1. **Hero:** "Groww your wealth". CTA "Get started", over an illustrated cityscape.
  2. **"India's stock market at your fingertips":** tiles for Stocks, ETFs, IPOs, Bonds.
  3. **"Build wealth, SIP by SIP":** "Invest now".
  4. **"Trade Futures & Options like a pro":** Terminal, option chain, scalper mode, commodities.
  5. **"Stock trading made simple":** intraday, MTF (up to 4x), pledge.
  6. **Testimonials:** cards with photos.
  7. **"More from the Groww family":** 915, W, Groww Credit.
  8. **"Finance simplified, in your language":** YouTube.
  9. **SEBI investor-awareness notices.**
  10. **Footer.**
- **Proof:** "Trusted by 2 Cr+ active investors", "India's #1 Investing Platform", and largest broker by NSE active users (June 2025). https://groww.in/
- **Visual style:** Illustration-led, bold short headlines, card tiles, many CTAs. (Inferred.)

### 6. Dashboard
- **MF dashboard:** Includes imported external funds alongside Groww holdings. There is a help page on why external funds go missing.
  - https://groww.in/help/mutual-funds/mf-track-and-switch/why-are-my-external-funds-missing-from-my-dashboard--11
  - https://groww.in/track ("Track Your Investments": Simple, Insights, Switch)
- **First screen layout:** Not verified.

### 7. Top complaints
- **Trustpilot** (1.5/5, 57 reviews; https://uk.trustpilot.com/review/groww.in):
  - Templated support replies.
  - Lag during trading.
  - Slow US-fund moves and withdrawals.
  - **Imported MF values shown wrongly.**
  - Marketing emails sent after unsubscribing.
- **App Store** (https://apps.apple.com/in/app/groww-stocks-mutual-fund-ipo/id1404871703):
  - Account frozen for over a week during re-KYC.
  - Exit orders not filled.
- **Outages and freezes:**
  - Chart freezes on expiry days: https://www.multibagg.ai/market-pulse/articles/groww-app-outage-expiry-freeze-cmt43vmwbmff90zql1u5ot6gk
  - Outage, users ask for compensation: https://moneylife.in/article/groww-app-faces-technical-issue-users-ask-for-compensation/73196.html

---

## 5. Zerodha (Console + Coin)

### 1. Features
- **Family portfolio (Console):**
  - Link **up to 10** Zerodha accounts using the Kite user ID, PAN and mobile number.
  - The member approves via an SMS link within 2 hours.
  - Shows combined holdings, allocation, stock and sector exposure, and P&L.
  - **View-only.** No Excel export of family holdings (2024 comment). XIRR was "being worked on". No NRI numbers at launch.
  - Free.
  - https://zerodha.com/z-connect/console/introducing-family-portfolio-view-on-console (14 Jun 2022)
  - https://support.zerodha.com/category/console/profile/account/articles/family-account
- **Console:**
  - Dashboard, analytics and heatmaps.
  - "True P&L", which accounts for corporate actions, splits and transfers.
  - **Tax-ready reports** (capital gains, grandfathering), tax P&L, and corporate actions.
  - Tags as a trading journal, and stock gifting.
  - https://zerodha.com/products/console
  - https://support.zerodha.com/category/console/portfolio/articles/what-is-console
- **No import of off-Zerodha holdings:**
  - Coin: importing old MFs is "Not possible".
  - The Console page has no mention of external import.
  - https://tradingqna.com/t/import-old-mfs-into-coin/98556
  - https://zerodha.com/products/console
  - A community user points to Kuvera's CAS import to track a family's MFs instead: https://tradingqna.com/t/import-old-mfs-into-coin/98556
- **Coin:** Direct MFs held in demat. https://support.zerodha.com/category/mutual-funds/understanding-mutual-funds/about-coin/articles/what-is-coin
- **Ecosystem:** Gold and EPF tracking, goals and AI are absent from Console and Coin; Zerodha points to its ecosystem instead (Sensibull, Ditto, smallcase, Tijori), plus Nudge and Kill Switch. https://zerodha.com/

### 2. Pricing / business model
- **Charges:**
  - ₹0 account opening.
  - ₹0 equity delivery and direct MFs.
  - ₹20 for intraday and F&O.
  - https://zerodha.com/
- **Coin:**
  - The ₹50 fee was removed, and there is "no plans to monetize mutual fund investing". Coin earns no AMC commission.
  - https://support.zerodha.com/category/mutual-funds/about-coin/articles/what-are-the-advantages-of-coin
  - https://zerodha.com/z-connect/business-updates/the-evolution-of-mutual-fund-platforms-in-india
- **Revenue:** Brokerage, chiefly F&O. Proof point: about 15% of daily retail volume. https://zerodha.com/

### 3. Data and privacy
- **No sale:** "Under no circumstances will we sell or rent your personal information". https://zerodha.com/privacy-policy
- **Aadhaar:** Not stored. Only limited DigiLocker fields are kept. https://zerodha.com/privacy-policy
- **Cookies:** Google Analytics. Cookies may hold "profiling information (age, gender, income etc)". https://zerodha.com/privacy-policy
- **Security:** HTTPS, plus "Perfect security does not exist… at your own risk". No fixed retention period. https://zerodha.com/privacy-policy
- **Brand stance:** "No spam or gimmicks", with no gamification or push notifications. https://zerodha.com/
- **Incidents:** No breach found. Repeated outages:
  - Oct 2025, Downdetector shows 88% of complaints about trading: https://ianslive.in/zerodha-faces-outage-users-report-losses-amid-glitches--20251006133931
  - Sept 2025 ("Nifty 0"): https://www.businesstoday.in/amp/markets/stocks/story/nifty-0-ho-gaya-zerodha-faces-technical-glitch-nithin-kamath-firm-says-issue-resolved-492223-2025-09-03
  - Cloudflare outage, Dec 2025: https://www.freepressjournal.in/tech/really-sorry-for-the-inconvenience-zerodha-ceo-apologizes-for-cloudflare-outage-points-to-whatsapp-backup-option

### 4. Sign-in
- **Kite user ID plus password, then mandatory 2FA:** an app code or an external TOTP (Authy, Google Authenticator and others). No Google sign-in found.
  - https://zerodha.com/z-connect/tradezerodha/kite/two-factor-authentication-2fa
  - https://support.zerodha.com/category/account-opening/nri-account-opening/oq-nri/articles/2fa-security-for-nri
- **Account:** A full KYC'd broking account is required.

### 5. Landing page
- **Sections, top to bottom** (https://zerodha.com/):
  1. **Hero:** "Invest in everything" (stocks, IPOs, derivatives, MFs, ETFs, bonds). CTA: "Sign up for free".
  2. **"Trust with confidence":** Customer-first always, No spam or gimmicks, The Zerodha universe, Do better with money (Nudge, Kill Switch).
  3. **Ecosystem graphic:** Console, Coin, partners.
  4. **Kite Connect API.**
  5. **"Unbeatable pricing":** ₹0 / ₹0 / ₹20.
  6. **"Free and open market education":** Varsity, TradingQ&A.
  7. **Closing CTA:** "Open a Zerodha account".
  8. **Footer.**
- **Proof:** 1.8 Cr+ customers, about ₹9 lakh crore of equity investments, about 15% of retail volume, largest broker by net worth. https://zerodha.com/
- **Visual style:** Minimal, lots of white space, flat illustrations, short sections. (Inferred.)

### 6. Dashboard
- **Console:**
  - The dashboard has an "account curve and donut chart".
  - Portfolio sections: holdings, positions, MFs.
  - P&L heatmap and reports.
  - https://support.zerodha.com/category/console/portfolio/articles/what-is-console
- **Family view:** Combined holdings with an account drop-down. https://zerodha.com/z-connect/console/introducing-family-portfolio-view-on-console

### 7. Top complaints
- **Feature requests:**
  - Family-level XIRR and downloads: https://zerodha.com/z-connect/console/introducing-family-portfolio-view-on-console
  - Custom columns in the family view: https://tradingqna.com/t/zerodha-console-family-portfolio-view-support-for-adding-custom-columns-to-the-view/149900
- **Outages:** Kite outages, including "third major outage in three months". Coin downtime was blamed on a payment aggregator.
  - https://www.benzinga.com/content/36818948/zerodha-users-face-a-third-major-outage-in-three-months-customers-rage-on-social-media
  - https://inc42.com/?p=463989
- **Trustpilot** (1.5/5, 49 reviews; https://www.trustpilot.com/review/zerodha.com):
  - NRI account-opening delays.
  - Fees not refunded.
  - Unresponsive support.

---

## Patterns across these apps

**Landing pages**
- **Hero:** Every hero is a broad "invest/trade in everything" promise, not a tracking promise:
  - "Trade & Invest in India, US and Global Markets from One App" (INDmoney)
  - "Groww your wealth" (Groww)
  - "Invest in everything" (Zerodha)
- **CTA:** The main CTA is always account opening: "Open Free Account", "Get started", "Sign up for free". INDmoney's CTA takes a phone number in the hero.
- **Proof points:** Scale is the proof: "2 Cr+ investors", "1.8 Cr+ customers", "20L+ investors", app ratings of 4.6–4.7, "#1"/"largest broker" claims.
- **Trust signals:** Regulatory badges in the footer: SEBI/NSE/BSE registration, ISO 27001, PCI. Privacy appears only as a footer link.
- **Price lines:** The big price lines are ₹0 account, ₹0 direct MF and ₹20 F&O.
- **Tracking placement:** Tracking and family features sit **below the fold**, e.g. INDmoney's "Money Operating System" section. Groww's tracker is a separate /track page.
- **Exception:** Zerodha leads trust with "No spam or gimmicks", an anti-dark-pattern stance. A privacy-first tracker can borrow that tone.

**Dashboards**
- **Headline number:** Total current value or net worth comes first.
- **Detail views:** XIRR, allocation and overlap, and capital gains are standard in the MF tracker views (INDmoney, ET Money).
- **Family view:** INDmoney shows one family net-worth number split per member. Zerodha shows a combined holdings view with an account drop-down.

**How import works**
- **MF Central OTP** is now the default (INDmoney, Groww).
- **Gmail read access** is still used or described (INDmoney, Groww older flow).
- **Email-forwarding of CAMS CAS** (Kuvera).
- **PDF/CAS upload** (ET Money, per its listing).
- **Not offered:** None of the apps documents uploading **CDSL/NSDL eCAS** together with CAMS/KFintech CAS and de-duplicating them across members. Zerodha and Coin import nothing external.

**Family models are all account-bound**
- **INDmoney:** Each member needs their own INDmoney account and must accept a phone invite.
- **Zerodha:** Up to 10 accounts, but only Zerodha accounts, view-only, no export, no family XIRR.
- **Groww:** As of Sep 2026, Groww-account holders only (PIN-switching; you can trade for members).
- **Kuvera:** Members need KYC under one login, and existing users can't be merged in.
- **Gap:** A household of PANs whose members never sign up anywhere, with no KYC and no broker account needed, is not served by any of the five.

**How they make money**
- Broking (F&O), loans (INDmoney and Groww at up to 36–45% APR), distribution and partner products, advertising and tracking SDKs (Apple labels show identifiers used for tracking in INDmoney, ET Money and Groww), and paid advice (ET Money Genius).
- "Free tracking" is a **lead funnel** for those products.

**Privacy posture**
- Broad consented collection: Gmail, SMS, contacts, location, installed apps (INDmoney), SMS (ET Money).
- "We don't sell" wording is often narrowed, e.g. "for marketing purposes" (Groww).
- Groww paid a SEBI settlement over security lapses.
- No app said it **does not keep the uploaded statement**, or that it encrypts data per household.

**Gaps a private family tracker could fill**
1. **No account per member:** One login for a whole household of PANs, members with no app account, de-duplicating funds across eCAS and CAS.
2. **Wider asset coverage in one place:** Stocks with true buy prices from tradebooks, plus FD/PPF/EPF and physical gold/silver/SGBs. INDmoney is the only one close, and it is tied to its own sign-up and trading upsell.
3. **Family-level numbers:** Family-level XIRR and export (asked for on Zerodha), and a per-fund or per-stock benchmark score. No big app shows the latter plainly.
4. **Privacy you can check:** No Gmail or SMS access, PDFs not kept, per-household encryption, full export and delete, no distribution or loans upsell. That directly answers the complaints about dark patterns (ET Money Genius) and pushy marketing emails (Groww).
5. **Accurate imports:** Users complain about wrongly imported MF values (Groww Trustpilot; ET Money review). Reconciling from the statements themselves is a selling point.
6. **Calm, Zerodha-like tone** with no trading CTA: "see your family's money, nothing to sell". This is open space in a market where every landing page is about opening a trading account.
