import crypto from 'crypto'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const API_KEY = process.env.X_API_KEY
const API_SECRET = process.env.X_API_SECRET
const ACCESS_TOKEN = process.env.X_ACCESS_TOKEN
const ACCESS_TOKEN_SECRET = process.env.X_ACCESS_TOKEN_SECRET

function formatMoney(n) {
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function oddsToDecimal(oddsStr) {
  const n = parseFloat(oddsStr)
  if (isNaN(n)) return 0
  if (n > 0) return (n / 100) + 1
  if (n < 0) return (100 / Math.abs(n)) + 1
  return 1
}

function oauthSign(method, url, params, consumerSecret, tokenSecret) {
  const sorted = Object.keys(params).sort().map(k =>
    `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`
  ).join('&')
  const base = `${method}&${encodeURIComponent(url)}&${encodeURIComponent(sorted)}`
  const key = `${encodeURIComponent(consumerSecret)}&${encodeURIComponent(tokenSecret)}`
  return crypto.createHmac('sha1', key).update(base).digest('base64')
}

async function postToX(text) {
  const url = 'https://api.twitter.com/2/tweets'
  const oauthParams = {
    oauth_consumer_key: API_KEY,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: ACCESS_TOKEN,
    oauth_version: '1.0',
  }
  const sig = oauthSign('POST', url, oauthParams, API_SECRET, ACCESS_TOKEN_SECRET)
  oauthParams.oauth_signature = sig

  const authHeader = 'OAuth ' + Object.keys(oauthParams).sort().map(k =>
    `${encodeURIComponent(k)}="${encodeURIComponent(oauthParams[k])}"`
  ).join(', ')

  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text })
  })
  return r.json()
}

export default async function handler(req, res) {
  // Verify this is called by Vercel cron
  const authHeader = req.headers['authorization']
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    // Get yesterday's date
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const dateStr = yesterday.toISOString().slice(0, 10)
    const displayDate = yesterday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

    // Fetch yesterday's entries from Supabase
    const headers = {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
    }
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/entries?date=eq.${dateStr}&bet_status=eq.won&order=payout.desc`,
      { headers }
    )
    const entries = await r.json()

    if (!entries || entries.length === 0) {
      return res.status(200).json({ message: 'No entries for yesterday, skipping post' })
    }

    // Build leaderboard post
    const dollarTop = [...entries].sort((a, b) => b.payout - a.payout).slice(0, 3)
    const oddsTop = [...entries].sort((a, b) => oddsToDecimal(b.odds) - oddsToDecimal(a.odds)).slice(0, 3)

    let post = `💰 DAILYSLIPS LEADERBOARD — ${displayDate}\n\n`
    post += `🏆 TOP $ WON\n`
    dollarTop.forEach((e, i) => {
      post += `${i + 1}. ${e.name} — ${formatMoney(e.payout)} (${e.odds})\n`
    })
    post += `\n🎲 LONGEST ODDS HIT\n`
    oddsTop.forEach((e, i) => {
      post += `${i + 1}. ${e.name} — ${e.odds} · ${formatMoney(e.payout)}\n`
    })
    post += `\nSubmit yours → dailyslips.app\n#SportsBetting #DailySlips`

    // Post to X
    const result = await postToX(post)

    if (result.data?.id) {
      return res.status(200).json({ success: true, tweet_id: result.data.id, post })
    } else {
      return res.status(500).json({ error: 'Failed to post', result })
    }
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
