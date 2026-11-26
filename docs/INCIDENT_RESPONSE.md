# PocketFolio: incident response

What to do when personal data may have been exposed, lost or changed without authorisation (a "personal data
breach"), or when the service is attacked. Written for the owner and anyone helping them. Plan §12 (DPDP Rule 7) and
§8 (encryption) are the background.

> ⚠️ **Placeholders.** The legal entity, grievance officer and contact numbers below are still to be filled in
> (plan §19). A lawyer reviews this document before launch (M17).

---

## 1. Deadlines at a glance

| Who | When | What | How |
|---|---|---|---|
| **CERT-In** | **within 6 hours** of noticing | the incident report (CERT-In Directions, 28 April 2022) | email `incident@cert-in.org.in`, form on cert-in.org.in |
| **Data Protection Board of India** | **without delay**, then a **detailed report within 72 hours** of becoming aware | intimation, then the full report (DPDP Rules, Rule 7(2)) | the Board's online portal (check the current address when filing) |
| **Affected users** | **without delay** | what happened and what they can do (Rule 7(1)) | email from `support@pocketfolio.in` (template §5) |
| **Cloudflare** | as soon as their side is involved | support ticket, priority "urgent" | dashboard → Support |

The 72 hours and the 6 hours run from when we **become aware**, not from when we're sure. Report early and update
later.

## 2. Contacts

| Role | Name | Reach |
|---|---|---|
| Owner / incident lead | [Owner name] | [phone], [email] |
| Grievance officer (DPDP) | [Grievance officer name] | [grievance@pocketfolio.in] |
| Legal counsel | [Law firm / lawyer] | [phone], [email] |
| Legal entity | [Legal entity name] | [registered address] |
| Cloudflare account | the owner's account | dashboard → Support |
| Google Cloud (OAuth client) | the owner's account | console.cloud.google.com |

## 3. Steps

### 3.1 Notice and record (first 30 minutes)
1. Write down the time you noticed, how, and what you saw. Keep a running log (time, action, who) in a private note
   **without personal data in it**: ids and counts only (plan §0.1).
2. Start the clock for §1.

### 3.2 Contain (first hours)
Pick what fits; most steps are reversible.

| Problem | Action |
|---|---|
| A secret leaked (`.dev.vars`, a token, a CI secret) | Rotate it at once (§4). Revoke Cloudflare API tokens in the dashboard. |
| Sessions stolen or a sign-in flaw | Rotate `BETTER_AUTH_SECRET` (signs everyone out). Or delete sessions: `DELETE FROM session` on the app D1. |
| A bug exposes one household's data to another | Deploy the previous version (Workers → Deployments → Rollback). Then fix. |
| Abuse or a flood | Tighten the rate limits / Turnstile; Cloudflare WAF rule on `/api/*`. |
| Data copied out of R2 or D1 | It's encrypted with per-household keys (§8). Check whether `DATA_KEK_V*` also leaked. If it did, rotate the KEK (§4) at once. |
| The engine container compromised | It holds no keys and no network access except `market.internal` (read-only). Redeploy the image; check the build. |

### 3.3 Assess (within 72 hours)
Answer, with counts and ids only:
- **What** data: account emails, member names and PANs, holdings and transactions, sessions (IP, user agent)?
- **Whose**: how many users and households. `audit_event` (by `household_id`, `event`, `at`) and Workers
  observability logs (they carry ids, counts and error classes only) show who was touched.
- **Readable?** Sealed blobs and `*_enc` columns are useless without the KEK. A D1 or R2 copy alone exposes
  only: emails, `pan_masked`, PAN HMACs, statement metadata (kind, dates, counts), session IPs and user agents.
- **When** it started and ended, and **where** (which system).

### 3.4 Notify
- Users: §5 template, to the affected accounts only, from `support@pocketfolio.in`. For a large number, send in
  batches through the `pf-email` queue path or a mail tool. Never put another user's data in an email.
- The Board: intimation without delay; the detailed report within 72 hours (§1).
- CERT-In: within 6 hours (§1).

### 3.5 Recover and review
- Fix the cause; add a test that would have caught it.
- Write a short review: timeline, cause, what worked, what to change. Ids and counts only.
- Keep the review, the notices sent and the log for at least a year (Rule 6/8(3)).

## 4. Rotating secrets

| Secret | How | Effect |
|---|---|---|
| `DATA_KEK_V1` (key-encryption key) | Add `DATA_KEK_V2` (`wrangler secret put`), deploy, call `rewrapDeks()` until it returns 0, then remove V1 | Data stays readable; only the wrapping changes (plan §8, tested in M6) |
| `BETTER_AUTH_SECRET` | `wrangler secret put` a new value | Every session and cookie is invalid; everyone signs in again. Rate-limit and UA hashes change too |
| `PAN_PEPPER` | Needs a migration: decrypt each `pan_enc`, recompute `pan_hmac` and `sip_key` | Not a quick switch. Rotate only if it leaked **together with** D1 |
| `ENGINE_SHARED_SECRET` | `wrangler secret put` | None for users |
| `GOOGLE_CLIENT_SECRET` | New secret in Google Cloud, then `wrangler secret put` | None for users |
| `TURNSTILE_SECRET` | Rotate in the Turnstile dashboard, then `wrangler secret put` | None for users |
| `BHARATSTOCK_API_KEY` | Provider dashboard, then `wrangler secret put` | None for users |
| Cloudflare API tokens (CI, local) | Dashboard → API Tokens → roll | CI needs the new value (`gh secret set`) |

## 5. Email templates

**To affected users** (Rule 7(1): what happened, its nature, extent, timing and location; the likely consequences;
what we did; what you can do; who to contact):

> Subject: Important: a security incident affecting your PocketFolio account
>
> On [date], we found that [plain description of what happened]. It affected [which data: e.g. "the email address of
> your account" / "the names and PANs of your family members"], between [start] and [end]. It happened in
> [system, e.g. "our hosting provider's storage"].
>
> What this could mean for you: [likely consequences, e.g. "phishing emails that use your name"].
>
> What we've done: [containment and fixes].
>
> What you can do: [e.g. "be careful with emails asking for your PAN or statement passwords; we never ask for them"].
> You can download or delete your data at any time in Settings.
>
> Questions: [Grievance officer name], [grievance@pocketfolio.in]. We're sorry this happened.

**Board intimation (first notice):** date and time noticed; a short description; the data and number of people
likely affected (estimate); containment so far; contact person. Then within 72 hours the detailed report: facts,
circumstances and reasons, mitigation, the findings about who caused it, measures to stop it happening again, and the
user notices sent.

**CERT-In:** their incident reporting form (the type of incident, systems, time noticed, a short description,
actions taken). Attach updates as they come.

## 6. To confirm with the lawyer (M17)

- The Board's filing portal and format once it's live, and whether the 72-hour report can be extended.
- CERT-In's 180-day log-retention direction and whether Workers observability plus `audit_event` (kept 400 days,
  stored in Cloudflare's APAC region) meets it.
- Whether the grievance officer must be in India, and the response times we promise (we say 90 days, plan §12).
