// PWA icons (plan §13A.1): `npm run icons` regenerates public/icons/ from public/favicon.svg. Output is committed.
import { defineConfig } from '@vite-pwa/assets-generator/config'

// The favicon's own fill: on maskable and Apple icons the mark sits on a full-bleed square of the same colour, so
// launcher masks (circle, squircle) never show a second shape.
const background = '#3D4DB7'

export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    transparent: { sizes: [192, 512], favicons: [[48, 'favicon.ico']] },
    // 80% safe zone: the mark fills 80% of the canvas, so every launcher mask keeps it whole
    maskable: { sizes: [512], padding: 0.2, resizeOptions: { background } },
    apple: { sizes: [180], padding: 0.15, resizeOptions: { background } },
    assetName: (type, size) =>
      type === 'transparent'
        ? `icons/icon-${size.width}.png`
        : type === 'maskable'
          ? `icons/icon-maskable-${size.width}.png`
          : `icons/apple-touch-icon-${size.width}.png`,
  },
  images: ['public/favicon.svg'],
})
