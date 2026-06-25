/**
 * Generates iOS and Android icon + splash PNG assets from SVG sources.
 * Run: node scripts/generate-icons.mjs
 * Requires: npm install --save-dev sharp  (already in devDependencies)
 */

import { readFileSync, mkdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import sharp from 'sharp'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')

const iconSvg   = readFileSync(join(root, 'resources/icon.svg'))
const splashSvg = readFileSync(join(root, 'resources/splash.svg'))

function ensureDir(p) { if (!existsSync(p)) mkdirSync(p, { recursive: true }) }

async function png(svgBuf, outPath, size) {
  ensureDir(dirname(outPath))
  await sharp(svgBuf).resize(size, size).png().toFile(outPath)
  console.log(`  ✓ ${outPath} (${size}×${size})`)
}

async function splash(svgBuf, outPath, w, h) {
  ensureDir(dirname(outPath))
  await sharp(svgBuf).resize(w, h).png().toFile(outPath)
  console.log(`  ✓ ${outPath} (${w}×${h})`)
}

// ─── iOS icons (required by App Store) ────────────────────────────────────────
const iosIconDir = join(root, 'ios/App/App/Assets.xcassets/AppIcon.appiconset')
const iosSplashDir = join(root, 'ios/App/App/Assets.xcassets/Splash.imageset')

const iosIcons = [
  [20, 1], [20, 2], [20, 3],
  [29, 1], [29, 2], [29, 3],
  [40, 1], [40, 2], [40, 3],
  [60, 2], [60, 3],
  [76, 1], [76, 2],
  [83.5, 2],
  [1024, 1],
]

// ─── Android icons ─────────────────────────────────────────────────────────────
const androidResDir = join(root, 'android/app/src/main/res')
const androidDensities = [
  { dir: 'mipmap-mdpi',    size: 48  },
  { dir: 'mipmap-hdpi',    size: 72  },
  { dir: 'mipmap-xhdpi',   size: 96  },
  { dir: 'mipmap-xxhdpi',  size: 144 },
  { dir: 'mipmap-xxxhdpi', size: 192 },
]
const androidSplash = [
  { dir: 'drawable',       w: 480,  h: 800  },
  { dir: 'drawable-land',  w: 800,  h: 480  },
  { dir: 'drawable-port',  w: 480,  h: 800  },
]

// ─── Standalone PNGs for @capacitor/assets ────────────────────────────────────
// These are used when running: npx capacitor-assets generate
const resourcesOut = join(root, 'resources')

async function main() {
  console.log('\n🎨 Generating LearnFlow AI app icons & splash screens…\n')

  // Always generate the base resource PNGs (used by @capacitor/assets)
  console.log('Base resource PNGs:')
  await png(iconSvg,   join(resourcesOut, 'icon.png'),   1024)
  await png(iconSvg,   join(resourcesOut, 'icon-foreground.png'), 432)
  await png(splashSvg, join(resourcesOut, 'splash.png'), 2732)
  await png(splashSvg, join(resourcesOut, 'splash-dark.png'), 2732)

  const iosExists = existsSync(iosIconDir)
  const androidExists = existsSync(androidResDir)

  if (!iosExists && !androidExists) {
    console.log('\n⚠️  No native platforms found yet.')
    console.log('   Run: npm run cap:add:ios && npm run cap:add:android')
    console.log('   Then run this script again to populate native assets.\n')
    return
  }

  if (iosExists) {
    console.log('\niOS icons:')
    for (const [base, scale] of iosIcons) {
      const size = Math.round(base * scale)
      const name = `icon-${base}@${scale}x.png`
      await png(iconSvg, join(iosIconDir, name), size)
    }
    console.log('\niOS splash:')
    await splash(splashSvg, join(iosSplashDir, 'splash.png'), 2732, 2732)
    await splash(splashSvg, join(iosSplashDir, 'splash@2x.png'), 2732, 2732)
    await splash(splashSvg, join(iosSplashDir, 'splash@3x.png'), 2732, 2732)
  }

  if (androidExists) {
    console.log('\nAndroid icons:')
    for (const { dir, size } of androidDensities) {
      await png(iconSvg, join(androidResDir, dir, 'ic_launcher.png'), size)
      await png(iconSvg, join(androidResDir, dir, 'ic_launcher_round.png'), size)
      await png(iconSvg, join(androidResDir, dir, 'ic_launcher_foreground.png'), size)
    }
    console.log('\nAndroid splash:')
    for (const { dir, w, h } of androidSplash) {
      await splash(splashSvg, join(androidResDir, dir, 'splash.png'), w, h)
    }
  }

  console.log('\n✅ Done! All icon and splash assets generated.\n')
}

main().catch((err) => { console.error(err); process.exit(1) })
