// Reads a bet slip screenshot with Claude and returns the extracted fields.
// On failure it returns { error, code } so the app can tell the user what to try next.
// Codes: no_image, bad_format, not_a_slip, missing_details, unreadable,
//        old_slip, window_closed, ai_busy, ai_timeout, ai_unavailable

export const config = {
  api: { bodyParser: { sizeLimit: '10mb' } },
  maxDuration: 60,
}

const SUPPORTED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

function fail(res, status, code, error, extra = {}) {
  return res.status(status).json({ error, code, ...extra })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).end(`Method ${req.method} Not Allowed`)
  }

  const { imageBase64, mediaType, clientDate } = req.body || {}
  if (!imageBase64) return fail(res, 400, 'no_image', 'No image was received.')

  const type = (mediaType || 'image/jpeg').toLowerCase()
  if (!SUPPORTED_TYPES.includes(type)) {
    return fail(res, 415, 'bad_format', `This image format (${type}) can't be read.`)
  }

  // Current time in CST
  const nowCST = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }))

  // Yesterday in CST
  const yesterdayCST = new Date(nowCST)
  yesterdayCST.setDate(yesterdayCST.getDate() - 1)
  const yesterdayStr = yesterdayCST.toLocaleDateString('en-CA')

  // Use client date as today reference
  let todayMonth, todayDay, todayYear
  if (clientDate && /^\d{4}-\d{2}-\d{2}$/.test(clientDate)) {
    const [y, m, d] = clientDate.split('-').map(Number)
    todayMonth = m; todayDay = d; todayYear = y
  } else {
    todayMonth = nowCST.getMonth() + 1
    todayDay = nowCST.getDate()
    todayYear = nowCST.getFullYear()
  }

  // Before 10am CST = yesterday's settled bets still allowed
  const isPre10amCST = nowCST.getHours() < 10

  // Call Claude (with a timeout so the user isn't left waiting forever)
  let response, data
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 45000)
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: type, data: imageBase64 }
            },
            {
              type: 'text',
              text: `This image should be a screenshot of a sports betting slip. Extract the data and respond ONLY with a valid JSON object, no markdown, no explanation:
{
  "is_betslip": "true if this image shows a sportsbook bet slip / bet ticket (single bet or parlay) with odds or a wager amount, false if it is something else (a scoreboard, a chat, a random photo, a blank screen, etc.)",
  "settled_month": "month the bet SETTLED/WON/LOST/FINISHED as integer 1-12. ONLY fill this if the slip explicitly shows a settlement, completion, or result date — NOT the placed/bet date. If not clearly visible, use null.",
  "settled_day": "day the bet SETTLED as integer 1-31. Same rule — only if explicitly shown as a result/finish date, otherwise null.",
  "settled_year": "year the bet SETTLED as integer e.g. 2026. Same rule, otherwise null.",
  "placed_month": "month the bet was PLACED/BET as integer 1-12 if visible, otherwise null",
  "placed_day": "day the bet was PLACED/BET as integer 1-31 if visible, otherwise null",
  "placed_year": "year the bet was PLACED/BET as integer e.g. 2026 if visible, otherwise null",
  "odds": "overall American format odds e.g. +450 or -110. For parlays use the combined/total odds.",
  "stake": "amount wagered as number only e.g. 10.00",
  "payout": "amount won or total payout as number only e.g. 19.62",
  "description": "brief overall bet description: teams, sport, bet type max 70 chars",
  "bet_status": "won, lost, or pending based on what the slip shows",
  "sportsbook": "name of sportsbook e.g. FanDuel, DraftKings",
  "legs": [
    {
      "selection": "team or player selected",
      "market": "bet type e.g. Moneyline, Spread, Over/Under, Player Prop",
      "odds": "odds for this leg e.g. -110",
      "status": "won, lost, pending, or void"
    }
  ]
}

IMPORTANT: settled_month/day/year should only be filled if the slip shows a date for when the bet RESULTED/FINISHED — many slips only show a placed date, in which case settled fields must be null.
For a single straight bet, legs should have 1 entry. For a parlay, one entry per leg.
If leg details are not visible, return legs as [].
If a field is not visible use null for dates, empty string for text, 0 for numbers.`
            }
          ]
        }]
      })
    })
    data = await response.json()
  } catch (err) {
    clearTimeout(timer)
    if (err.name === 'AbortError') {
      return fail(res, 504, 'ai_timeout', 'Reading the slip took too long.')
    }
    return fail(res, 502, 'ai_unavailable', 'Could not reach the slip reader: ' + err.message)
  }
  clearTimeout(timer)

  if (!response.ok || data?.error) {
    const status = response.status
    const msg = data?.error?.message || `Slip reader error (${status})`
    if (status === 429 || status === 529 || data?.error?.type === 'overloaded_error') {
      return fail(res, 503, 'ai_busy', msg)
    }
    if (status === 400 && /image/i.test(msg)) {
      return fail(res, 422, 'unreadable', msg)
    }
    return fail(res, 502, 'ai_unavailable', msg)
  }

  let parsed
  try {
    const raw = data.content?.map(c => c.text || '').join('') || ''
    const clean = raw.replace(/```json|```/g, '').trim()
    const start = clean.indexOf('{')
    const end = clean.lastIndexOf('}')
    parsed = JSON.parse(start >= 0 && end > start ? clean.slice(start, end + 1) : clean)
  } catch (err) {
    return fail(res, 422, 'unreadable', 'The slip could not be read clearly.')
  }

  // Not a bet slip at all
  const isSlip = parsed.is_betslip
  if (isSlip === false || isSlip === 'false') {
    return fail(res, 422, 'not_a_slip', "This image doesn't look like a bet slip.")
  }

  // A slip, but the key numbers aren't visible
  const hasOdds = parsed.odds && String(parsed.odds).trim() !== '' && String(parsed.odds).trim() !== '0'
  const hasStake = parseFloat(parsed.stake) > 0
  if (!hasOdds && !hasStake) {
    return fail(res, 422, 'missing_details', "Couldn't find the odds or wager amount on this slip.")
  }

  // Settled-date check
  const sm = parseInt(parsed.settled_month)
  const sd = parseInt(parsed.settled_day)
  const sy = parseInt(parsed.settled_year)
  const hasSettledDate = sm && sd && sy

  if (hasSettledDate) {
    const settledToday = sm === todayMonth && sd === todayDay && sy === todayYear
    const settledDateStr = `${sy}-${String(sm).padStart(2, '0')}-${String(sd).padStart(2, '0')}`
    const settledYesterday = settledDateStr === yesterdayStr
    const settledLabel = `${sm}/${sd}/${sy}`

    if (settledToday) {
      // OK
    } else if (settledYesterday && !isPre10amCST) {
      return fail(res, 422, 'window_closed',
        `This bet settled on ${settledLabel} — the window for yesterday's slips closed at 10am CT.`,
        { settled_date: settledLabel })
    } else if (!settledYesterday) {
      return fail(res, 422, 'old_slip',
        `This bet settled on ${settledLabel} — only bets that settled today can be submitted.`,
        { settled_date: settledLabel })
    }
  }

  parsed.date_error = null
  return res.status(200).json(parsed)
}
