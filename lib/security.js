// Server-only helpers: admin PIN check and signed "scan tokens".
// A scan token records exactly what the AI read off a slip, so the numbers
// can't be changed between scanning and submitting.
import crypto from 'crypto'

const SECRET = process.env.SCAN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || ''

function safeEqual(a, b) {
  const x = Buffer.from(String(a))
  const y = Buffer.from(String(b))
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

// ── Admin ────────────────────────────────────────────────
export function adminConfigured() {
  return !!process.env.ADMIN_PIN
}

export function isAdmin(req) {
  const pin = process.env.ADMIN_PIN
  const given = req.headers['x-admin-pin']
  return !!pin && !!given && safeEqual(given, pin)
}

// ── Normalising slip values ──────────────────────────────
export function normOdds(v) {
  if (v === null || v === undefined) return null
  const s = String(v).trim().toUpperCase()
  if (s === 'EVEN' || s === 'EVENS' || s === 'EV') return 100
  const n = parseFloat(s.replace(/[^\d.+-]/g, ''))
  return isNaN(n) || n === 0 ? null : n
}

export function normMoney(v) {
  if (v === null || v === undefined || v === '') return null
  const n = parseFloat(String(v).replace(/[$,\s]/g, ''))
  return isNaN(n) ? null : Math.round(n * 100) / 100
}

export function normName(name) {
  return String(name || '').trim().replace(/^@+/, '').toLowerCase()
}

// ── Scan tokens ──────────────────────────────────────────
function hmac(data) {
  return crypto.createHmac('sha256', SECRET).update(data).digest('base64url')
}

export function signScan(payload, minutes = 30) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + minutes * 60000 })).toString('base64url')
  return `${body}.${hmac(body)}`
}

export function verifyScan(token) {
  if (!token || typeof token !== 'string' || !SECRET) return null
  const [body, sig] = token.split('.')
  if (!body || !sig || !safeEqual(sig, hmac(body))) return null
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString())
    if (!payload.exp || payload.exp < Date.now()) return null
    return payload
  } catch {
    return null
  }
}
