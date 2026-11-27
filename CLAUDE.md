# PocketFolio

A family mutual-fund portfolio app, moving from a single-user laptop app to a multi-user app on Cloudflare.

## Building the multi-user app
- The design is [docs/MULTI_USER_LAUNCH_PLAN.md](docs/MULTI_USER_LAUNCH_PLAN.md) (the "plan").
- The build order is [docs/MILESTONES.md](docs/MILESTONES.md).
- When asked to "do the next milestone" (or "do M<N>"), follow the **"How Claude runs a milestone"** section of
  `docs/MILESTONES.md` exactly:
  - one milestone per session;
  - stop when blocked on an owner input;
  - update the Status table;
  - don't start the next milestone.

## Hard rules
- **Never print, log or commit personal financial data.** That means statement contents, PANs, names, emails, folio
  numbers, amounts, holdings and passwords. Output from real PDFs is counts, timings and ok/fail only. PANs are shown
  masked (`AB••••••4F`).
- Real statements live only in git-ignored folders (`data/`, `engine/tests/private/`). Never copy them anywhere else,
  never commit them, and never upload them except to the user's own staging app when a milestone says so.
- Secrets come from git-ignored files (`.env`, `worker/.dev.vars`). Never echo them, never put them in code or tests,
  and never ask the owner to paste them into chat.
- Keep design system v2 (plan §13, `docs/design/M24_DESIGN_SPEC.md`): gold accent, glass cards, Geist. No new
  colours, fonts or component styles.
- Don't push, merge or deploy to production without the owner's OK.
