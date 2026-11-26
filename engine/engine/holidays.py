"""Business days for SIP instalments (M12, owner request 2026-11-26).

A SIP due on a weekend or an exchange holiday runs on the next business day, at that day's NAV, as every broker and
RTA does. For past dates the NAV store shows it directly: a weekday with no NAV for the fund, while later NAVs exist,
was a holiday. For upcoming dates we need the exchange's calendar ahead of time, so the confirmed weekday trading
holidays still ahead are listed here.

⚠️ Keep this list current: NSE publishes the next year's calendar in December (circular "Trading holidays for the
calendar year"). Add only weekday dates confirmed from the circular. Until a year is listed, its upcoming dates move
for weekends only, and holidays are picked up from the NAVs once they've passed.
"""

from __future__ import annotations

# Weekday NSE/BSE equity-segment trading holidays from today on (past ones come from the NAVs).
# 2026-11-24 Guru Nanak Jayanti: confirmed by the NAV store (M9, only daily-NAV funds published).
# 2026-12-25 Christmas: the last 2026 closure per NSE's 2026 calendar as reported by several brokers (NSE's own
# circular didn't load on 2026-11-26; see the M12 notes).
UPCOMING_HOLIDAYS: frozenset[str] = frozenset({"2026-11-24", "2026-12-25"})
