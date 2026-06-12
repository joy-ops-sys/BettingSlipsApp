export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).end(`Method ${req.method} Not Allowed`)
  }

  const { imageBase64, mediaType, clientDate } = req.body
  if (!imageBase64) return res.status(400).json({ error: 'No image provided' })

  // Use date sent from client (their local timezone) — fallback to CST
  let todayMonth, todayDay, todayYear
  if (clientDate) {
    const [y, m, d] = clientDate.split('-').map(Number)
    todayMonth = m; todayDay = d; todayYear = y
  } else {
    const nowCST = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }))
    todayMonth = nowCST.getMonth() + 1
    todayDay = nowCST.getDate()
    todayYear = nowCST.getFullYear()
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
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
              source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: imageBase64 }
            },
            {
              type: 'text',
              text: `This is a sports betting slip. Extract the data and respond ONLY with a valid JSON object, no markdown, no explanation:
{
  "placed_month": "month as integer 1-12 if visible on the slip, otherwise null",
  "placed_day": "day as integer 1-31 if visible on the slip, otherwise null",
  "placed_year": "year as integer e.g. 2026 if visible on the slip, otherwise null",
  "odds": "overall American format odds e.g. +450 or -110. For parlays use the combined/total odds.",
  "stake": "amount wagered as number only e.g. 10.00",
  "payout": "amount won or total payout as number only e.g. 19.62",
  "description": "brief overall bet description: teams, sport, bet type max 70 chars",
  "bet_status": "won, lost, or pending based on what the slip shows",
  "sportsbook": "name of sportsbook e.g. FanDuel, DraftKings",
  "legs": [
    {
      "selection": "team or player selected e.g. Chiefs ML or Patrick Mahomes Over 2.5 TDs",
      "market": "bet type e.g. Moneyline, Spread, Over/Under, Player Prop",
      "odds": "odds for this leg e.g. -110",
      "status": "won, lost, pending, or void"
    }
  ]
}

For a single straight bet, "legs" should have exactly 1 entry.
For a parlay or same game parlay, "legs" should have one entry per leg.
If leg details are not visible, return "legs" as an empty array [].
If a field is not visible use null for date fields, empty string for text, or 0 for numbers.`
            }
          ]
        }]
      })
    })

    const data = await response.json()
    if (data.error) return res.status(500).json({ error: data.error.message })

    const raw = data.content?.map(c => c.text || '').join('') || ''
    const clean = raw.replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(clean)

    const m = parseInt(parsed.placed_month)
    const d = parseInt(parsed.placed_day)
    const y = parseInt(parsed.placed_year)

    if (m && d && y) {
      if (m !== todayMonth || d !== todayDay || y !== todayYear) {
        parsed.date_error = `Bet was placed on ${m}/${d}/${y} — only today's bets can be submitted.`
      } else {
        parsed.date_error = null
      }
    } else {
      parsed.date_error = null
    }

    return res.status(200).json(parsed)
  } catch (err) {
    return res.status(500).json({ error: 'Failed to read slip: ' + err.message })
  }
}
