"""Shares and ETFs: buy prices, gains, tax and corporate actions (plan §21.6, M21).

Inputs, all optional (a build without them is the M20 build):
- trades:      a member's broker tradebook trades (parsers/tradebook.py), every tradebook merged and deduplicated here;
- costs:       the member's manual average buy prices, {isin: {"avg_price", "since"?: "YYYY-MM"}};
- corp_actions: NSE corporate actions for the symbols involved, [{symbol, isin, ex_date, kind, num, den, amount}];
                kind split (num:den new shares per old share) | bonus (num new for every den held) | dividend (amount
                per share) | merger | demerger | other;
- symbols:     NSE's symbol list for them, [{symbol, isin, name}] (the current ISIN; a split often changes it);
- fmv_2018:    {isin: highest price on 31 Jan 2018, in today's (adjusted) terms} for grandfathering.

CDSL stays the truth for units: trades are replayed FIFO up to the statement date and reconciled with the
statement's units. Splits and bonuses after the statement date adjust the units; mergers and demergers don't (a
banner asks for a newer statement, D25). Bonus shares are a nil-cost lot acquired on the ex-date (s.55(2)(aa)(iiia)).
"""

from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta

from .analysis import GRANDFATHER_BUY_CUTOFF, GRANDFATHER_SELL_FROM, NEW_REGIME, fin_year

EPS = 1e-6
UNIT_TOLERANCE = 0.01
ADJUSTING = ("split", "bonus")
NOTICE_KINDS = ("merger", "demerger")
MF_STALE_DAYS = 10  # a held fund with no NAV for this long (while others have one) may have merged


def _d(s: str) -> date:
    return date.fromisoformat(s[:10])


def factor(a: dict) -> float:
    """Shares after the action per share before it."""
    num, den = float(a.get("num") or 0), float(a.get("den") or 0)
    if num <= 0 or den <= 0:
        return 1.0
    return num / den if a["kind"] == "split" else (num + den) / den


def _name_key(s: str | None) -> str:
    s = re.sub(r"[^a-z0-9 ]+", " ", (s or "").lower())
    s = re.sub(r"\b(limited|ltd|the|india|co|company|corporation|corp|inc)\b", " ", s)
    return " ".join(s.split())


@dataclass
class Market:
    """Corporate actions and symbols, indexed for one build."""
    actions: dict[str, list[dict]] = field(default_factory=dict)   # symbol → actions, oldest first
    sym_isin: dict[str, str] = field(default_factory=dict)          # symbol → current ISIN
    isin_sym: dict[str, str] = field(default_factory=dict)          # any ISIN seen (current or old) → symbol
    name_isin: dict[str, str] = field(default_factory=dict)
    fmv_2018: dict[str, float] = field(default_factory=dict)

    @classmethod
    def from_data(cls, corp_actions: list | None, symbols: list | None, fmv_2018: dict | None = None) -> "Market":
        m = cls(fmv_2018={str(k): float(v) for k, v in (fmv_2018 or {}).items() if v})
        for s in symbols or []:
            sym, isin = str(s.get("symbol") or "").upper(), str(s.get("isin") or "").upper()
            if sym and isin:
                m.sym_isin[sym] = isin
                m.isin_sym.setdefault(isin, sym)
                if s.get("name"):
                    m.name_isin.setdefault(_name_key(s["name"]), isin)
        for a in corp_actions or []:
            try:
                sym = str(a.get("symbol") or "").upper()
                row = {"symbol": sym, "isin": (a.get("isin") or "").upper() or None, "ex_date": str(a["ex_date"])[:10],
                       "kind": a["kind"], "num": a.get("num"), "den": a.get("den"), "amount": a.get("amount"),
                       "subject": a.get("subject")}
                _d(row["ex_date"])
            except (KeyError, TypeError, ValueError):
                continue
            if not sym:
                continue
            m.actions.setdefault(sym, []).append(row)
            if row["isin"]:
                m.isin_sym.setdefault(row["isin"], sym)
        for acts in m.actions.values():
            acts.sort(key=lambda a: a["ex_date"])
        return m

    def symbol_of(self, isin: str) -> str | None:
        return self.isin_sym.get(isin)

    def resolve(self, t: dict) -> str | None:
        """The current ISIN a trade is about: by NSE symbol, else its own ISIN (an old one mapped through its symbol),
        else by company name."""
        sym = (t.get("symbol") or "").upper()
        if sym and sym in self.sym_isin:
            return self.sym_isin[sym]
        isin = t.get("isin")
        if isin:
            old_sym = self.isin_sym.get(isin)
            return self.sym_isin.get(old_sym, isin) if old_sym else isin
        key = _name_key(t.get("name"))
        return self.name_isin.get(key) if key else None

    def acts(self, isin: str) -> list[dict]:
        sym = self.symbol_of(isin)
        return self.actions.get(sym, []) if sym else []

    def growth(self, isin: str, after: str, upto: str) -> float:
        """Product of the split/bonus factors with after < ex_date ≤ upto."""
        f = 1.0
        for a in self.acts(isin):
            if a["kind"] in ADJUSTING and after < a["ex_date"] <= upto:
                f *= factor(a)
        return f


@dataclass
class Lot:
    bought: date
    units: float
    cost: float | None  # None: bought before the tradebook covers, price unknown


def _long_term(bought: date, on: date, equity: bool) -> bool:
    """Listed shares and equity ETFs: over 12 months. Other listed ETFs (gold, debt, international): over 12 months
    from 23 Jul 2024, 36 months before."""
    if equity or on >= NEW_REGIME:
        return (on - bought).days > 365
    return (on.year - bought.year) * 12 + (on.month - bought.month) > 36 or (
        (on.year - bought.year) * 12 + (on.month - bought.month) == 36 and on.day > bought.day)


def is_equity_listed(isin: str, name: str | None) -> bool:
    """Shares (INE) are equity. ETFs (INF) are equity unless their name says gold, silver, debt, bond, liquid, gilt or
    an overseas index."""
    if not isin.startswith("INF"):
        return isin.startswith("INE")
    return not re.search(r"gold|silver|liquid|gilt|bond|debt|g-?sec|money market|nasdaq|s&p|hang seng|nyse|overnight|bharat bond",
                         name or "", re.I)


class Book:
    """FIFO lots of one share for one member, with corporate actions applied as they happen."""

    def __init__(self, isin: str, name: str, equity: bool, market: Market):
        self.isin, self.name, self.equity, self.market = isin, name, equity, market
        self.lots: list[Lot] = []
        self.gains: list[dict] = []
        self.unknown_sold = 0.0     # units sold that no known lot covers
        self.unknown_cost_gains = 0  # sales from lots of unknown cost (no gain computed)

    @property
    def units(self) -> float:
        return sum(l.units for l in self.lots)

    def action(self, a: dict) -> None:
        f = factor(a)
        if f == 1.0 or self.units < EPS:
            return
        if a["kind"] == "split":
            for l in self.lots:
                l.units *= f
        elif a["kind"] == "bonus":
            self.lots.append(Lot(_d(a["ex_date"]), self.units * (f - 1), 0.0))  # nil cost, acquired on the ex-date

    def buy(self, on: date, qty: float, price: float) -> None:
        self.lots.append(Lot(on, qty, qty * price))

    def drop(self, qty: float) -> None:
        """Units that left without a known sale (sold through another broker, transferred out): oldest first."""
        left = qty
        while left > EPS and self.lots:
            lot = self.lots[0]
            take = min(left, lot.units)
            if lot.cost is not None:
                lot.cost -= lot.cost * take / lot.units
            lot.units -= take
            left -= take
            if lot.units <= EPS:
                self.lots.pop(0)

    def sell(self, on: date, qty: float, price: float, today: str) -> None:
        left = qty
        while left > EPS:
            if not self.lots:
                self.unknown_sold += left
                return
            lot = self.lots[0]
            take = min(left, lot.units)
            sale = take * price
            if lot.cost is None:
                self.unknown_cost_gains += 1
            else:
                cost = lot.cost * take / lot.units
                coa = cost
                if self.equity and lot.bought <= GRANDFATHER_BUY_CUTOFF and on >= GRANDFATHER_SELL_FROM:
                    fmv = self._fmv(on)
                    if fmv:
                        coa = max(cost, min(fmv * take, sale))
                self.gains.append({
                    "fy": fin_year(on), "date": on.isoformat(), "isin": self.isin, "name": self.name, "equity": self.equity,
                    "long_term": _long_term(lot.bought, on, self.equity), "units": round(take, 4), "cost": round(cost, 2),
                    "sale": round(sale, 2), "gain": round(sale - coa, 2), "kind": "stock",
                })
                lot.cost -= cost
            lot.units -= take
            left -= take
            if lot.units <= EPS:
                self.lots.pop(0)

    def _fmv(self, on: date) -> float | None:
        """31 Jan 2018's highest price per share in the terms of `on` (the store has it in today's adjusted terms)."""
        adj = self.market.fmv_2018.get(self.isin)
        if not adj:
            return None
        return adj * self.market.growth(self.isin, on.isoformat(), "9999-12-31")


def dedupe(trades: list[dict]) -> list[dict]:
    """Several tradebooks of one member can overlap: a trade with a broker id once per (broker, id), others once per
    (date, time, symbol/isin/name, side, qty, price)."""
    seen: set = set()
    out = []
    for t in trades:
        key = (t.get("broker"), t["id"]) if t.get("id") else (
            t["date"], t.get("time"), t.get("symbol") or t.get("isin") or t.get("name"), t["side"], t["qty"], t["price"])
        if key in seen:
            continue
        seen.add(key)
        out.append(t)
    return out


def remove_intraday(trades: list[dict]) -> tuple[list[dict], float]:
    """Same share bought and sold on the same day is intraday (business income, not capital gains): the matched
    quantity is taken out of both sides. Returns (delivery trades, intraday quantity)."""
    by_day: dict[tuple, list[dict]] = defaultdict(list)
    for t in trades:
        by_day[(t["date"], t["_isin"])].append(t)
    out, intraday = [], 0.0
    for rows in by_day.values():
        b = sum(t["qty"] for t in rows if t["side"] == "buy")
        s = sum(t["qty"] for t in rows if t["side"] == "sell")
        m = min(b, s)
        if m <= EPS:
            out += rows
            continue
        intraday += m
        for t in rows:
            total = b if t["side"] == "buy" else s
            q = t["qty"] * (1 - m / total)
            if q > EPS:
                out.append({**t, "qty": q})
    out.sort(key=lambda t: (t["date"], t.get("time") or "", t["side"] != "buy"))
    return out, intraday


def _since(cost: dict, fallback: str) -> date:
    s = str(cost.get("since") or "")
    if re.fullmatch(r"\d{4}-\d{2}", s):
        return date(int(s[:4]), int(s[5:7]), 1)
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
        return _d(s)
    return _d(fallback)


def member_stocks(holdings: list[dict], trades: list[dict], costs: dict[str, dict], market: Market,
                  first_seen: dict[str, str], today: date, close: dict[str, tuple[str, float]]) -> dict:
    """Gains and lots for one member's shares and ETFs.

    holdings:   the merged statement rows (equity_or_bond, and demat mutual_fund rows for ETFs);
    first_seen: {isin: the first CDSL statement date that shows it} (the manual price's default "since");
    close:      {isin: (date, latest close)} for valuing open lots.
    Returns {"holdings": {isin: info}, "realised": [gains], "counts": {...}}.
    """
    t_iso = today.isoformat()
    counts = {"trades": 0, "unmatched": 0, "intraday_qty": 0.0, "sold_elsewhere": 0, "unknown_sold": 0}
    resolved = []
    for t in dedupe(trades):
        isin = market.resolve(t)
        if not isin:
            counts["unmatched"] += 1
            continue
        resolved.append({**t, "_isin": isin})
    counts["trades"] = len(resolved)
    delivery, counts["intraday_qty"] = remove_intraday(resolved)
    by_isin: dict[str, list[dict]] = defaultdict(list)
    for t in delivery:
        by_isin[t["_isin"]].append(t)

    held = {h["isin"]: h for h in holdings if h["asset_type"] == "equity_or_bond" or h["isin"] in by_isin or h["isin"] in costs}
    out: dict[str, dict] = {}
    realised: list[dict] = []
    for isin in sorted(set(held) | set(by_isin)):
        h = held.get(isin)
        name = (h or {}).get("raw_name") or next((t.get("name") or t.get("symbol") for t in by_isin.get(isin, []) if t.get("name") or t.get("symbol")), isin)
        book = Book(isin, name, is_equity_listed(isin, name), market)
        stmt = (h or {}).get("as_of", "")[:10] or t_iso
        events = [(a["ex_date"], 0, a) for a in market.acts(isin) if a["kind"] in ADJUSTING and a["ex_date"] <= t_iso]
        events += [(t["date"], 1 if t["side"] == "buy" else 2, t) for t in by_isin.get(isin, [])]
        events.sort(key=lambda e: (e[0], e[1], e[2].get("time") or "" if e[1] else ""))

        def run(evs):
            for day, k, e in evs:
                if k == 0:
                    book.action(e)
                elif k == 1:
                    book.buy(_d(day), e["qty"], e["price"])
                else:
                    book.sell(_d(day), e["qty"], e["price"], t_iso)

        before = [e for e in events if e[0] <= stmt]
        after = [e for e in events if e[0] > stmt]
        run(before)
        info: dict = {"cost_source": "none", "unknown_units": 0.0}
        cost = costs.get(isin)
        if h is not None:
            u = float(h.get("units") or 0)
            have = book.units
            traded = isin in by_isin
            if traded and have > u + UNIT_TOLERANCE:
                book.drop(have - u)
                counts["sold_elsewhere"] += 1
            elif u > have + UNIT_TOLERANCE:
                rest = u - have
                bought = _since(cost, first_seen.get(isin) or stmt) if cost else _d(first_seen.get(isin) or stmt)
                # bought before what the tradebook covers: older than its lots
                book.lots.insert(0, Lot(bought, rest, None))
            if cost and not traded:
                info["cost_source"] = "manual"
            elif traded:
                info["cost_source"] = "tradebook" if all(l.cost is not None for l in book.lots) else "partial"
        if info["cost_source"] == "manual":
            # a manual price is in today's terms (what the broker shows now): one lot, scaled by the splits and
            # bonuses since the statement, valued at avg × today's units
            for l in book.lots:
                l.units *= market.growth(isin, stmt, t_iso)
        else:
            run(after)
        # a manual price fills whatever has no known cost, in today's terms (what the broker shows now)
        if cost and float(cost.get("avg_price") or 0) > 0:
            for l in book.lots:
                if l.cost is None:
                    l.cost = l.units * float(cost["avg_price"])
            if info["cost_source"] == "partial" and all(l.cost is not None for l in book.lots):
                info["cost_source"] = "tradebook+manual"
        realised += book.gains
        counts["unknown_sold"] += 1 if book.unknown_sold > EPS else 0
        if h is None:
            continue
        units = book.units
        known = [l for l in book.lots if l.cost is not None]
        unknown = sum(l.units for l in book.lots if l.cost is None)
        info["unknown_units"] = round(unknown, 4)
        if unknown > UNIT_TOLERANCE and info["cost_source"] in ("manual", "tradebook"):
            info["cost_source"] = "partial"
        info["units"] = round(units, 4)
        info["unknown_cost_sales"] = book.unknown_cost_gains
        if known and unknown <= UNIT_TOLERANCE:
            invested = sum(l.cost for l in known)
            info["invested"] = round(invested, 2)
            info["avg_price"] = round(invested / units, 4) if units > EPS else None
            info["since"] = min(l.bought for l in known).isoformat()
            flows: dict[str, float] = defaultdict(float)
            for l in known:
                if l.cost:
                    flows[l.bought.isoformat()] -= l.cost
            info["cashflows"] = [[d, round(a, 2)] for d, a in sorted(flows.items()) if a]
            px = close.get(isin)
            if px:
                on = _d(px[0])
                lt = [l for l in known if _long_term(l.bought, on, book.equity)]
                st = [l for l in known if l not in lt]
                val = lambda ls: sum(l.units for l in ls) * px[1]
                cst = lambda ls: sum(l.cost for l in ls)
                info["tax"] = {"equity": book.equity, "since": info["since"],
                               "lt_value": round(val(lt), 2), "lt_gain": round(val(lt) - cst(lt), 2),
                               "st_value": round(val(st), 2), "st_gain": round(val(st) - cst(st), 2),
                               "lt_units": round(sum(l.units for l in lt), 3)}
        info["traded_after"] = round(sum((e[2]["qty"] if e[1] == 1 else -e[2]["qty"]) for e in after if e[1]), 4)
        out[isin] = info
    return {"holdings": out, "realised": realised, "counts": counts}


def today_terms(timeline: list[list] | None, isin: str, market: Market, today: str) -> list[list] | None:
    """Units over time, each point scaled by the splits and bonuses after it, so units × the adjusted close (Upstox's
    history is adjusted, §10.4.5) is right on every day."""
    if not timeline:
        return timeline
    acts = [a for a in market.acts(isin) if a["kind"] in ADJUSTING and a["ex_date"] <= today]
    if not acts:
        return timeline
    out: list[list] = []
    for d, u in timeline:
        out.append([d, round(u * market.growth(isin, d, today), 4)])
    return out


def dividends(isin: str, market: Market, timeline: list[list] | None, from_day: str, today: str) -> list[list]:
    """[[ex_date, amount]] for the dividends with an ex-date after `from_day` (the first date units are known): the
    per-share amount × the units held the day before (in that day's terms). Estimated, before TDS."""
    if not timeline:
        return []
    from .projection import units_on

    out = []
    for a in market.acts(isin):
        if a["kind"] != "dividend" or not a.get("amount") or not (from_day < a["ex_date"] <= today):
            continue
        prev = (_d(a["ex_date"]) - timedelta(days=1)).isoformat()
        units_today_terms = units_on(timeline, prev)
        units_then = units_today_terms / market.growth(isin, prev, today)
        amt = round(units_then * float(a["amount"]), 2)
        if amt > 0:
            out.append([a["ex_date"], amt])
    return out


def notice(isin: str, market: Market, statement_date: str, today: str) -> dict | None:
    """A merger or demerger after the statement date: units aren't changed, the user is asked for a newer statement."""
    for a in reversed(market.acts(isin)):
        if a["kind"] in NOTICE_KINDS and statement_date < a["ex_date"] <= today:
            what = "Merger" if a["kind"] == "merger" else "Demerger"
            return {"kind": a["kind"], "ex_date": a["ex_date"],
                    "text": f"{what} on {_d(a['ex_date']).strftime('%-d %b %Y')}. Upload a newer statement to update it."}
    return None


def fund_notice(nav_dates: list[str] | None, latest_market_day: str | None, statement_date: str) -> dict | None:
    """MF scheme mergers have no feed: a fund whose NAV stopped MF_STALE_DAYS before the latest market day (and after
    the statement date) may have merged or closed."""
    if not nav_dates or not latest_market_day:
        return None
    last = nav_dates[-1]
    if last <= statement_date[:10]:
        return None
    if (_d(latest_market_day) - _d(last)).days < MF_STALE_DAYS:
        return None
    return {"kind": "fund_merger", "ex_date": None,
            "text": "This fund may have merged or closed. Upload a newer statement to update it."}
