"""Exchange trading holidays, for SIP run days (M12, owner request 2026-11-26).

A SIP due on a weekend or an exchange holiday runs on the next business day, at that day's NAV, as every broker and
RTA does. The Worker keeps the calendar current: a weekly job reads Upstox's public market-holidays API (NSE and BSE
closures; worker/src/market/holidays.ts) into the market DB, and each build sends the dates (`market.holidays`).

This list is only the fallback when a build carries none (local runs, tests, the job never having run): the 2026
NSE trading holidays as Upstox lists them on 2026-11-26. It matches the NAV store: every past date on it has no NAV
for an equity fund, except 31 Mar (financial-year end: NAVs are published, but the exchange and SIPs are closed).
"""

from __future__ import annotations

FALLBACK_HOLIDAYS: frozenset[str] = frozenset({
    "2026-01-15", "2026-01-26", "2026-03-03", "2026-03-26", "2026-03-31", "2026-04-03", "2026-04-14", "2026-05-01",
    "2026-05-28", "2026-06-26", "2026-09-14", "2026-10-02", "2026-10-20", "2026-11-10", "2026-11-24", "2026-12-25",
})


def calendar(sent: list | None) -> frozenset[str]:
    """The holidays a build uses: the Worker's list when it sent one, else the fallback."""
    dates = frozenset(str(d)[:10] for d in sent or [])
    return dates or FALLBACK_HOLIDAYS
