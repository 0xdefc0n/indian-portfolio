# M24: design direction (first session, for the owner's OK)

Written 2026-11-27. The rendered options are on the design canvas "PocketFolio M24 design directions" (private to
the owner; link in the M24 session report). All names and figures there are made-up demo data.

This is a proposal. Nothing in `web/` changes until the owner picks a direction. After that, the build session turns
the chosen direction into plan §13 (design system v2) and applies it to every screen.

## 1. What stays

- The layout rules of plan §13: 360 px first, `BottomNav` on mobile, 44 px touch targets, loading/empty/error states,
  labels, focus rings and dark-first theming with the existing toggle.
- The data. The redesign shows what the snapshot already has, with no new API fields. A member's "last statement"
  date comes from the members list, which already returns statement as-of dates.
- Geist, in directions A and C (it's already self-hosted through `@fontsource-variable`). Direction B adds Instrument
  Serif for figures and headings.

## 2. Three dashboard directions

All three use the M23 order (COMPETITORS.md §5): family total → today's change → per-member split → one card per
asset class → insights.

| | A · Vault (recommended) | B · Ledger | C · Bento gold |
|---|---|---|---|
| Feel | Premium app: dark ink, gold glass, soft depth | Private-bank statement: warm black, serif figures, ruled lines | Today's app with gold swapped in |
| Surfaces | Translucent cards (white at 3.5–6 %), 1 px inner ring, gold hairline on the hero | No cards; hairlines and tables | Today's opaque `bg-surface` cards |
| Type | Geist; 64 px hero figure | Instrument Serif figures (104 px hero), Geist text | Geist + Geist Mono uppercase labels (as today) |
| Members | A split bar plus a card per member, with value, share and last statement | A "By member" table with the last statement date | Today's segmented member filter |
| Assets | 4 cards, each opening its holdings | A "By asset" table | 4 cards plus today's allocation donut |
| Change size | Large | Largest (new typeface, new layout) | Small |
| Risk | Glass needs care in light mode (white cards there) | Serif numerals are harder to scan in long holdings tables | May still read "vibe coded", the owner's complaint |

**Why A:** it gives the gold-glass brief its most direct form and keeps Geist and the component kit. It also fixes
what the research says is missing: the member split and statement freshness sit above the fold.

## 3. Logo

Four candidates on the canvas:
1. **Glass tile** (recommended for the wordmark): Geist "Pocket" with "folio" on a soft-cornered gold block, with a
   glass sheen on its top half. Square mark: a gold block with "f" on an ink tile.
2. **Pocket**: the block shaped like a pocket (deeper bottom corners, a stitch line). Square mark: the pocket alone.
3. **Serif seal**: "folio" in italic Instrument Serif on a gold pill. Pairs with B.
4. **Owner's idea, the stacked app icon**: "Pocket" over the gold "folio" block on a dark tile with a faint gold
   border. **Recommended as the app icon** with wordmark 1: it carries the full name, and it fits the maskable safe
   zone. It stays legible down to about 48 px. At 32 and 16 px (favicon) it falls back to the gold block alone.

All four avoid Portfolio360's "Your family's wealth, in one number" (COMPETITORS.md §3): there's no tagline in the
mark.

Deliverables after the OK (milestone list): wordmark SVG light/dark, square mark, `favicon.svg` + `.ico`, PWA 192/512,
maskable 512, Apple touch 180, and a 120 px Google consent-screen logo. Wordmark text becomes outlined paths, so it
never depends on a loaded font.

## 4. Tokens v2 (direction A; ratios measured with the WCAG formula)

| Token | Dark | Light | Text contrast on the card surface |
|---|---|---|---|
| background | `#0B0D12` | `#F5F3EE` | n/a |
| surface (card) | `#13161D` (or white 3.5 % over background) | `#FFFFFF` | n/a |
| surface-2 | `#1A1E27` | `#FAF8F4` | n/a |
| foreground | `#EEEAE1` | `#16150F` | 15.1 / 18.3 |
| muted-foreground | `#A29D92` | `#5F5A4F` | 6.7 / 6.9 |
| gold (text, icons, focus ring) | `#E2B65E` | `#86600F` | 9.6 / 5.7 |
| gold fill (primary button, logo block) | `#D9A847` | `#D9A847` | ink `#1C1406` on it 8.4 |
| gain | `#4FD69C` | `#0A7656` | 9.9 / 5.6 |
| loss | `#FF8A8F` | `#B0344F` | 8.0 / 6.1 |

Lowest text pair across both themes is light-mode gain on the page background, 5.07:1. All pairs pass AA.

- **Gold is the brand and the one action colour** (primary button, active tab, focus ring, links). It's never used
  for gains, so gain and loss stay green and rose and never look like brand colour.
- **Member colours** are three steps of gold (100 % / 70 % / 45 % in dark; deep to pale in light), so the split
  reads as one family, not as categories. Above three members, the steps continue and the bar shows the top five plus
  "others".
- **Chart and category colours:** the existing `--cat-*` set stays for fund categories. One conflict: `--cat-gold`
  (the gold *asset*) now matches the brand gold. Proposal: the gold asset uses a paler champagne `#E9D8A6` / `#9C7A2E`
  with a diagonal hatch in the allocation bar, so it differs in lightness as well as hue. This also fixes M19's Later
  item (FD/PPF/EPF tones too close): they get distinct lightness steps of one teal.
- **Radius:** cards 22–28 px (hero 28), buttons 12, chips full. **Elevation:** a 1 px inner ring plus a 1 px top
  highlight; one soft drop shadow, only on the hero and dialogs. `backdrop-filter` only on the sticky header and
  dialogs (it costs on low-end Android).
- **Type scale (Geist):** hero 64/40 px (desktop/mobile), section 16/600, card figure 24/600, body 14.5, small 12.5.
  Tabular figures everywhere (as today). The uppercase mono eyebrow labels go in A (sentence case reads calmer).
- **Motion:** keep `rise`, `draw-in` and the rolling numbers; durations unchanged; reduced-motion rule unchanged.

## 5. Questions for the owner (from M23)

1. **Per-member split under the family total?** A shows it as a bar plus member cards; C keeps the filter instead.
   Recommended: yes, and keep the member filter in Holdings.
2. **"Last statement: <date>" per member** (Claude's idea, not seen at rivals)? A and B show it, with a gold note
   once a statement is older than 60 days. Recommended: yes. The 60-day threshold is the owner's call.
3. **Asset-class cards for every type instead of the funds-first layout?** All three show four cards (funds,
   stocks & ETFs, FD/PPF/EPF, gold & silver). The funds-only panels (daily returns, SIPs, look-through) move below
   them or into their tabs. Recommended: yes.
4. **Direction:** A, B or C, or a mix (for example A's layout with B's serif hero figure)?
5. **Logo:** wordmark 1, 2 or 3, and the stacked app icon (4) for the icon?

## 6. Build session, after the OK

The M24 milestone list, in this order: tokens in `web/src/index.css` → logo files and icons → `Panel`/`Cell`/button
variants → dashboard → every other screen (login, consent, members, settings, legal, dialogs, toasts, install sheets,
link device, FD/PPF/EPF, gold/silver, stocks, score, stock gains) → store screenshots from demo data → plan §13
rewrite and the `CLAUDE.md` rule → headless checks at 360/1280 px in both themes. It probably needs two sessions.
