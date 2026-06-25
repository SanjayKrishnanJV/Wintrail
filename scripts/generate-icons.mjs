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

// Prefer user-provided PNG over SVG recreation for all sources
const logoPngPath  = join(root, 'public/logo.png')
const iconSvgPath  = join(root, 'resources/icon.svg')
const splashSvgPath = join(root, 'resources/splash.svg')

const iconSvg   = readFileSync(iconSvgPath)
const splashSvg = readFileSync(splashSvgPath)

// App icon: crop just the tree mark (left ~37% of logo) then centre on white square.
// The logo is: [tree mark | divider | text]. Tree occupies the left third.
async function makeIconBuf() {
  if (existsSync(logoPngPath)) {
    console.log('  Cropping tree mark from public/logo.png for app icon')
    const { width: logoW, height: logoH } = await sharp(logoPngPath).metadata()
    // Crop left 37% of the logo to isolate the tree mark
    const cropW = Math.round(logoW * 0.37)
    const treeCrop = await sharp(logoPngPath)
      .extract({ left: 0, top: 0, width: cropW, height: logoH })
      .png().toBuffer()
    // Scale the crop to fit inside a 1024×1024 square with padding
    const padding = 100
    const inner   = 1024 - padding * 2
    const resized = await sharp(treeCrop)
      .resize(inner, inner, { fit: 'inside', background: { r: 255, g: 255, b: 255, alpha: 1 } })
      .png().toBuffer()
    const { width: rw, height: rh } = await sharp(resized).metadata()
    return sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } })
      .composite([{ input: resized, top: Math.round((1024 - rh) / 2), left: Math.round((1024 - rw) / 2) }])
      .png().toBuffer()
  }
  return sharp(iconSvg).resize(1024, 1024).png().toBuffer()
}

// Splash: logo centred on white canvas, small enough to stay inside the safe zone
// on all devices (scaleAspectFill crops outer edges — keep logo within centre ~800px).
async function makeSplashBuf(w, h) {
  if (existsSync(logoPngPath)) {
    // Max 800px wide regardless of canvas size — stays within safe zone on all iPhones
    const maxW = Math.min(800, Math.round(w * 0.29))
    const maxH = Math.round(h * 0.15)
    const resized = await sharp(logoPngPath)
      .resize(maxW, maxH, { fit: 'inside', background: { r: 255, g: 255, b: 255, alpha: 1 } })
      .png().toBuffer()
    const { width: rw, height: rh } = await sharp(resized).metadata()
    const top  = Math.round((h - rh) / 2)
    const left = Math.round((w - rw) / 2)
    return sharp({ create: { width: w, height: h, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } })
      .composite([{ input: resized, top, left }])
      .png().toBuffer()
  }
  return sharp(splashSvg).resize(w, h).png().toBuffer()
}

function ensureDir(p) { if (!existsSync(p)) mkdirSync(p, { recursive: true }) }

async function png(buf, outPath, size) {
  ensureDir(dirname(outPath))
  await sharp(buf).resize(size, size).png().toFile(outPath)
  console.log(`  ✓ ${outPath} (${size}×${size})`)
}

async function splash(buf, outPath, w, h) {
  ensureDir(dirname(outPath))
  await sharp(buf).png().toFile(outPath)
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
  console.log('\n🎨 Generating Wintrail app icons & splash screens…\n')

  // Build buffers — prefers user-provided logo.png over SVG recreation
  const iconBuf  = await makeIconBuf()
  const splash2732 = await makeSplashBuf(2732, 2732)

  // Always write base resource PNGs
  console.log('Base resource PNGs:')
  const resourcesOut = join(root, 'resources')
  ensureDir(resourcesOut)
  await sharp(iconBuf).resize(1024, 1024).png().toFile(join(resourcesOut, 'icon.png'))
  console.log(`  ✓ resources/icon.png (1024×1024)`)
  await sharp(iconBuf).resize(432, 432).png().toFile(join(resourcesOut, 'icon-foreground.png'))
  console.log(`  ✓ resources/icon-foreground.png (432×432)`)
  await sharp(splash2732).png().toFile(join(resourcesOut, 'splash.png'))
  console.log(`  ✓ resources/splash.png (2732×2732)`)
  await sharp(splash2732).png().toFile(join(resourcesOut, 'splash-dark.png'))
  console.log(`  ✓ resources/splash-dark.png (2732×2732)`)

  const iosExists     = existsSync(iosIconDir)
  const androidExists = existsSync(androidResDir)

  if (!iosExists && !androidExists) {
    console.log('\n⚠️  No native platforms found yet.')
    console.log('   Run: npm run cap:add:ios && npm run cap:add:android')
    console.log('   Then run this script again to populate native assets.\n')
    return
  }

  if (iosExists) {
    // Modern Xcode (14+) uses a single 1024×1024 icon — filename must match Contents.json
    console.log('\niOS icon:')
    await png(iconBuf, join(iosIconDir, 'AppIcon-512@2x.png'), 1024)

    // Splash filenames must match Contents.json exactly
    console.log('\niOS splash:')
    const splashBuf = splash2732
    await sharp(splashBuf).png().toFile(join(iosSplashDir, 'splash-2732x2732.png'))
    await sharp(splashBuf).png().toFile(join(iosSplashDir, 'splash-2732x2732-1.png'))
    await sharp(splashBuf).png().toFile(join(iosSplashDir, 'splash-2732x2732-2.png'))
    console.log(`  ✓ iOS splash images (2732×2732)`)
  }

  if (androidExists) {
    console.log('\nAndroid icons:')
    for (const { dir, size } of androidDensities) {
      await png(iconBuf, join(androidResDir, dir, 'ic_launcher.png'), size)
      await png(iconBuf, join(androidResDir, dir, 'ic_launcher_round.png'), size)
      await png(iconBuf, join(androidResDir, dir, 'ic_launcher_foreground.png'), size)
    }
    console.log('\nAndroid splash:')
    for (const { dir, w, h } of androidSplash) {
      const sb = await makeSplashBuf(w, h)
      await splash(sb, join(androidResDir, dir, 'splash.png'), w, h)
    }
  }

  console.log('\n✅ Done! All icon and splash assets generated.\n')
}

main().catch((err) => { console.error(err); process.exit(1) })
