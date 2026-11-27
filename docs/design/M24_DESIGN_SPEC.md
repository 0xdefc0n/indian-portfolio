# M24: design system v2 (approved)

The owner approved this on 2026-11-27, after two rounds on a private design canvas. The canvas has since been deleted
at the owner's request. A local backup of the approved boards (and the rejected first-round options) is in `temp/design/`,
which is git-ignored and never committed. All names and figures on those boards were made-up demo data.

Plan §13 is the working reference; this file records the decisions and the contrast table behind it.

## 1. Owner's decisions (2026-11-27)

- **Logo:** the "Glass tile" wordmark: "Pocket" in plain Geist, "folio" on a soft-cornered gold block with a glass
  sheen on its top half.
- **App icon:** the owner's stacked design: "Pocket" over the gold "folio" block on a dark tile with a faint gold
  border. It stays legible down to about 48 px. At 32/16 px (favicon) it falls back to the gold block alone.
- **Dashboard:** direction "A": dark warm ink, gold glass, Geist. The layout follows the approved v2 boards:
  - the hero, whose chart drives the big number;
  - Family (Everyone first, then each member, tap to focus) and Upcoming SIPs beside it;
  - one card per asset class;
  - then the rest of the overview.
- **On first sight:** smooth and simple, inviting to explore. Slow, smooth motion.
- **Member split:** yes, "Everyone" first.
- **Statement dates per member:** no.
- **Asset-class cards first:** yes (mutual funds, stocks & ETFs, FD/PPF/EPF, gold & silver).
- **Other pages** take the same system in code and are checked on staging.

## 2. What stayed

- The layout rules of plan §13: 360 px first, `BottomNav`, 44 px touch targets, loading/empty/error states, labels,
  focus rings, dark-first with the theme toggle.
- The data. No new API fields. Member and asset-class totals are sums of the snapshot and the manual assets.
- Geist, self-hosted. No second typeface.

## 3. Tokens v2 (WCAG contrast measured)

| Token | Dark | Light | Text contrast on the card surface |
|---|---|---|---|
| background | `#0B0D12` | `#F5F3EE` | n/a |
| surface (card) | `#13161D` (glass: white 3.5 % over background) | `#FFFFFF` | n/a |
| foreground | `#EEEAE1` | `#16150F` | 15.1 / 18.3 |
| muted-foreground | `#A29D92` | `#5F5A4F` | 6.7 / 6.9 |
| primary (gold text, focus) | `#E2B65E` | `#86600F` | 9.6 / 5.7 |
| gold (fill: buttons, logo) | `#D9A847` → `#EBC679` | same | ink `#1C1406` on it 8.4 |
| gain | `#4FD69C` | `#0A7656` | 9.9 / 5.6 |
| loss | `#FF8A8F` | `#B0344F` | 8.0 / 6.1 |

The lowest text pair across both themes is light-mode gain on the page background, 5.07:1. Every pair passes AA.

- **Gold is the brand and the one action colour.** It's never used for gains.
- **The gold asset** (`--cat-gold`) is champagne (`#E9D8A6` dark, `#D6C69A` light), so it differs from the brand gold
  in lightness. **FD, PPF and EPF** get their own lightness steps of one teal (`--cat-fd/ppf/epf`), which also fixes
  M19's "colours too close" item. Silver has `--cat-silver`.
- **Asset-class colours:** funds `chart-1` (gold), stocks & ETFs `cat-stocks` (blue), FD/PPF/EPF `cat-fd` (teal), gold &
  silver `cat-gold` (champagne).

## 4. Surfaces, type, motion

- `.glass` cards (24 px radius), `.glass-hero` with a gold hairline, `.lift` hover (0.5 s), `.btn-gold`.
- Hero figure 44/64 px; section titles 16 px; card figures 18–24 px; labels in sentence case, 13 px, muted.
- Motion: `.rise` 0.9 s staggered, rolling numbers, the chart draws in over 1.8 s, the allocation bar and share rings
  ease over 0.7–1 s. All of it is off under reduced motion.

## 5. Brand files (`npm run icons` → `web/scripts/brand.mjs`)

The letters are Geist SemiBold outlines (`web/scripts/brand-glyphs.json`, made once with fontTools from the OFL
variable font at weight 600). No file depends on a loaded font.

- `public/brand/wordmark-dark.svg`, `wordmark-light.svg`
- `public/brand/app-icon.svg` (the stacked icon)
- `public/favicon.svg` + `favicon.ico` (16/32/48)
- `public/icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png` (content inside the 80 % safe circle),
  `apple-touch-icon-180.png`
- `public/brand/google-consent-120.png`, for the Google OAuth consent screen. The owner uploads it in Google Cloud
  Console.
