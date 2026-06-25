// Sends an APNs push notification to all iOS devices registered by a user.
// Called when the user clicks "Open on your phone" from the web app.
//
// Required Vercel env vars:
//   APNS_KEY         — full contents of the .p8 private key file (including headers)
//   APNS_KEY_ID      — 10-char key ID shown on Apple Developer → Keys
//   APNS_TEAM_ID     — 10-char team ID shown on Apple Developer → Membership
//   APNS_BUNDLE_ID   — com.wintrail.app
//   APNS_SANDBOX     — "true" for development builds, "false" (or unset) for production
//   SUPABASE_URL     — same as VITE_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY — service role key (bypasses RLS to read device tokens)

import http2 from 'http2'
import { createSign } from 'crypto'
import { createClient } from '@supabase/supabase-js'

// Cache the JWT for up to 55 minutes (APNs tokens expire after 60 min)
let _cachedJwt = null
let _cachedAt  = 0

function makeApnsJwt() {
  const now = Math.floor(Date.now() / 1000)
  if (_cachedJwt && now - _cachedAt < 55 * 60) return _cachedJwt

  const header  = Buffer.from(JSON.stringify({ alg: 'ES256', kid: process.env.APNS_KEY_ID })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ iss: process.env.APNS_TEAM_ID, iat: now })).toString('base64url')

  const sign = createSign('SHA256')
  sign.update(`${header}.${payload}`)
  sign.end()
  const sig = sign.sign(
    { key: process.env.APNS_KEY.replace(/\\n/g, '\n'), format: 'pem' },
    'base64url'
  )

  _cachedJwt = `${header}.${payload}.${sig}`
  _cachedAt  = now
  return _cachedJwt
}

function sendApns(deviceToken, jwt, bundleId, sandbox) {
  const host = sandbox ? 'api.sandbox.push.apple.com' : 'api.push.apple.com'

  return new Promise((resolve, reject) => {
    const client = http2.connect(`https://${host}`)
    client.on('error', (err) => { client.destroy(); reject(err) })

    const body = JSON.stringify({
      aps: {
        alert: { title: 'WinTrail AI', body: 'Tap to continue on your phone.' },
        sound: 'default',
      },
    })

    const req = client.request({
      ':method':        'POST',
      ':path':          `/3/device/${deviceToken}`,
      ':scheme':        'https',
      ':authority':     host,
      'authorization':  `bearer ${jwt}`,
      'apns-push-type': 'alert',
      'apns-topic':     bundleId,
      'apns-expiration':'0',
      'apns-priority':  '10',
      'content-type':   'application/json',
      'content-length': `${Buffer.byteLength(body)}`,
    })

    let status = 0
    let data   = ''

    req.on('response', (h) => { status = h[':status'] })
    req.on('data',     (c) => { data += c })
    req.on('end',      () => { client.close(); resolve({ status, data }) })
    req.on('error',    (e) => { client.destroy(); reject(e) })

    req.write(body)
    req.end()
  })
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { user_id } = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
  if (!user_id) return res.status(400).json({ error: 'user_id required' })

  if (!process.env.APNS_KEY || !process.env.APNS_KEY_ID || !process.env.APNS_TEAM_ID) {
    return res.status(501).json({ error: 'APNs credentials not configured on server.' })
  }

  const supabase = createClient(
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  const { data: tokens, error } = await supabase
    .from('device_tokens')
    .select('token, platform, sandbox')
    .eq('user_id', user_id)

  if (error) return res.status(500).json({ error: error.message })
  if (!tokens?.length) return res.json({ sent: 0, message: 'No registered devices found.' })

  const jwt      = makeApnsJwt()
  const bundleId = process.env.APNS_BUNDLE_ID || 'com.wintrail.app'
  const results  = []

  for (const { token, platform, sandbox } of tokens) {
    if (platform !== 'ios') continue
    try {
      const useSandbox = sandbox ?? (process.env.APNS_SANDBOX === 'true')
      const r = await sendApns(token, jwt, bundleId, useSandbox)
      results.push({ ok: r.status === 200, status: r.status, token: `…${token.slice(-8)}` })
    } catch (err) {
      results.push({ ok: false, error: err.message, token: `…${token.slice(-8)}` })
    }
  }

  res.json({ sent: results.filter((r) => r.ok).length, total: results.length, results })
}
