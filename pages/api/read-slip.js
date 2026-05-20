export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).end(`Method ${req.method} Not Allowed`)
  }

  const { imageBase64, mediaType, clientDate } = req.body
  if (!imageBase64) return res.status(400).json({ error: 'No image provided' })

  // Use date sent from client (their local timezone) — fallback to UTC
  let todayMonth, todayDay, todayYear
  if (clientDate) {
    const [y, m, d] = clientDate.split('-').map(Number)
    todayMonth = m; todayDay = d; todayYear = y
  } else {
    const now = new Date()
    todayMonth = now.getUTCMonth() + 1
    todayDay = now.getUTCDate()
    todayYear = now.getUTCFullYear()
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
        max_tokens: 1000,
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
  "odds": "American format odds e.g. +450 or -110. For parlays use the combined odds.",
  "stake": "amount wagered as number only e.g. 10.00",
  "payout": "amount won or total payout as number only e.g. 19.62",
  "description": "brief bet description: teams, sport, bet type max 70 chars",
  "bet_status": "won, lost, or pending based on what the slip shows",
  "sportsbook": "name of sportsbook e.g. FanDuel, DraftKings"
}

If a date field is not visible use null. If a text field is not visible use empty string. If a number is not visible use 0.`
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
