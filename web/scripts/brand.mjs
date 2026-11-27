// Brand assets (M24, plan §13): `npm run icons` writes the logo SVGs and every icon PNG from code. Output is committed.
//
// The letters are Geist SemiBold outlines (brand-glyphs.json, made once with fontTools from the variable font at
// wght 600; Geist is OFL), so no file here depends on a loaded font.
//   public/brand/wordmark-dark.svg   "Pocket" in light ink + gold glass "folio" block, for dark backgrounds
//   public/brand/wordmark-light.svg  the same with dark ink, for light backgrounds
//   public/brand/app-icon.svg        the stacked app icon (owner's design): "Pocket" over the gold block on an ink tile
//   public/favicon.svg               the small-size fallback: the gold block alone on the ink tile
//   public/icons/*.png, public/favicon.ico, public/brand/google-consent-120.png
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import sharp from "sharp"
import ico from "sharp-ico"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const pub = (p) => join(root, "public", p)
const G = JSON.parse(readFileSync(join(root, "scripts/brand-glyphs.json"), "utf8"))

const INK = "#12110E"
const GOLD_STOPS = `<stop offset="0" stop-color="#F4D78F"/><stop offset=".52" stop-color="#DDAE4E"/><stop offset="1" stop-color="#B8892E"/>`
const SHEEN_STOPS = `<stop offset="0" stop-color="#fff" stop-opacity=".42"/><stop offset="1" stop-color="#fff" stop-opacity=".06"/>`
const ON_GOLD = "#1C1406"

// Geometry in font units (1 em = 1000). Glyph baseline at y = 0; ink of "Pocket"/"folio" spans about y -760…0.
const PAD_X = 270, TOP = -930, BOTTOM = 200, RADIUS = 270, GAP = 80

/** The gold glass block with "folio" in it, its left edge at x. Returns [svg, width]. */
function block(x, id) {
  const w = G.words.folio.advance + 2 * PAD_X, h = BOTTOM - TOP
  const svg = `<defs><linearGradient id="g${id}" x1="0" y1="0" x2="0" y2="1">${GOLD_STOPS}</linearGradient>` +
    `<linearGradient id="s${id}" x1="0" y1="0" x2="0" y2="1">${SHEEN_STOPS}</linearGradient>` +
    `<clipPath id="c${id}"><rect x="${x}" y="${TOP}" width="${w}" height="${h}" rx="${RADIUS}"/></clipPath></defs>` +
    `<rect x="${x}" y="${TOP}" width="${w}" height="${h}" rx="${RADIUS}" fill="url(#g${id})"/>` +
    `<rect x="${x}" y="${TOP}" width="${w}" height="${h * 0.48}" fill="url(#s${id})" clip-path="url(#c${id})"/>` +
    `<path transform="translate(${x + PAD_X} 0)" fill="${ON_GOLD}" d="${G.words.folio.d}"/>`
  return [svg, w]
}

function wordmark(ink) {
  const pocket = G.words.Pocket.advance
  const [b, bw] = block(pocket + GAP, "w")
  const w = pocket + GAP + bw
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-20 ${TOP - 20} ${w + 40} ${BOTTOM - TOP + 40}" role="img" aria-label="PocketFolio">` +
    `<path fill="${ink}" d="${G.words.Pocket.d}"/>${b}</svg>\n`
}

/** The stacked icon on a 1024 canvas. scale: em size in px. shape: "tile" (rounded, transparent corners) or "bleed". */
function appIcon(scale, shape) {
  const k = scale / 1000
  const pocket = G.words.Pocket.advance
  const [b, bw] = block(0, shape)
  // stack: "Pocket" (ink -760…0), a 0.22 em gap, then the block (TOP…BOTTOM). Centre the whole group.
  const gap = 200, blockY = gap - TOP                // the block's top edge sits `gap` below Pocket's baseline
  const groupTop = -760, groupBottom = blockY + BOTTOM
  const cx = 512 / k, cy = 512 / k - (groupTop + groupBottom) / 2
  const bg = shape === "tile"
    ? `<rect x="8" y="8" width="1008" height="1008" rx="228" fill="${INK}"/><rect x="12" y="12" width="1000" height="1000" rx="224" fill="none" stroke="#E2B65E" stroke-opacity=".28" stroke-width="8"/>`
    : `<rect width="1024" height="1024" fill="${INK}"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" role="img" aria-label="PocketFolio">${bg}` +
    `<g transform="scale(${k}) translate(${cx} ${cy})">` +
    `<path transform="translate(${-pocket / 2} 0)" fill="#EEEAE1" d="${G.words.Pocket.d}"/>` +
    `<g transform="translate(${-bw / 2} ${blockY})">${b}</g></g></svg>\n`
}

const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" role="img" aria-label="PocketFolio">` +
  `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">${GOLD_STOPS}</linearGradient></defs>` +
  `<rect width="32" height="32" rx="8" fill="${INK}"/><rect x="5" y="9" width="22" height="14" rx="4" fill="url(#g)"/>` +
  `<rect x="5" y="9" width="22" height="6.5" rx="4" fill="#fff" fill-opacity=".22"/></svg>\n`

mkdirSync(pub("brand"), { recursive: true })
mkdirSync(pub("icons"), { recursive: true })
writeFileSync(pub("brand/wordmark-dark.svg"), wordmark("#EEEAE1"))
writeFileSync(pub("brand/wordmark-light.svg"), wordmark("#16150F"))
const tile = appIcon(215, "tile")
writeFileSync(pub("brand/app-icon.svg"), tile)
writeFileSync(pub("favicon.svg"), favicon)

const png = (svg, size, out) => sharp(Buffer.from(svg), { density: 300 }).resize(size, size).png().toFile(pub(out))
await png(tile, 192, "icons/icon-192.png")
await png(tile, 512, "icons/icon-512.png")
// maskable: full bleed, content inside the 80% safe circle; Apple rounds its own corners, so full bleed too
await png(appIcon(190, "bleed"), 512, "icons/icon-maskable-512.png")
await png(appIcon(205, "bleed"), 180, "icons/apple-touch-icon-180.png")
await png(tile, 120, "brand/google-consent-120.png")
const fav = await Promise.all([16, 32, 48].map((s) => sharp(Buffer.from(favicon), { density: 600 }).resize(s, s).png().toBuffer()))
await ico.sharpsToIco(fav.map((b) => sharp(b)), pub("favicon.ico"), { sizes: [16, 32, 48] })
console.log("brand assets written")
