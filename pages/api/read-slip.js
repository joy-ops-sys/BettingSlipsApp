export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).end(`Method ${req.method} Not Allowed`)
  }

  const { imageBase64, mediaType, clientDate } = req.body
  if (!imageBase64) return res.status(400).json({ error: 'No image provided' })

  // Current time in CST
  const nowCST = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }))
  const todayCST = nowCST.toLocaleDateString('en-CA')

  // Yesterday in CST
  const yesterdayCST = new Date(nowCST)
  yesterdayCST.setDate(yesterdayCST.getDate() - 1)
  const yesterdayStr = yesterdayCST.toLocaleDateString('en-CA')

  // Use client date as today reference
  let todayMonth, todayDay, todayYear
  if (clientDate) {
    const [y, m, d] = clientDate.split('-').map(Number)
    todayMonth = m; todayDay = d; todayYear = y
  } else {
    todayMonth = nowCST.getMonth() + 1
    todayDay = nowCST.getDate()
    todayYear = nowCST.getFullYear()
  }

  // Before 10am CST = yesterday's settled bets still allowed
  const isPre10amCST = nowCST.getHours() < 10

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
  "settled_month": "month the bet SETTLED/WON/FINISHED as integer 1-12 if visible, otherwise null",
  "settled_day": "day the bet SETTLED/WON/FINISHED as integer 1-31 if visible, otherwise null",
  "settled_year": "year the bet SETTLED/WON/FINISHED as integer e.g. 2026 if visible, otherwise null",
  "placed_month": "month the bet was PLACED as integer 1-12 if visible, otherwise null",
  "placed_day": "day the bet was PLACED as integer 1-31 if visible, otherwise null",
  "placed_year": "year the bet was PLACED as integer e.g. 2026 if visible, otherwise null",
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

For settled date: look for when the bet was marked WON/LOST/FINISHED/SETTLED — NOT when it was placed.
For a single straight bet, legs should have 1 entry. For a parlay, one entry per leg.
If leg details are not visible, return legs as [].
If a field is not visible use null for dates, empty string for text, 0 for numbers.`
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

    const sm = parseInt(parsed.settled_month)
    const sd = parseInt(parsed.settled_day)
    const sy = parseInt(parsed.settled_year)
    const hasSettledDate = sm && sd && sy

    if (hasSettledDate) {
      const settledToday = sm === todayMonth && sd === todayDay && sy === todayYear
      const settledDateStr = `${sy}-${String(sm).padStart(2,'0')}-${String(sd).padStart(2,'0')}`
      const settledYesterday = settledDateStr === yesterdayStr

      if (settledToday) {
        parsed.date_error = null
      } else if (settledYesterday && isPre10amCST) {
        parsed.date_error = null
      } else if (settledYesterday && !isPre10amCST) {
        parsed.date_error = `Bet settled on ${sm}/${sd}/${sy} — submission window closed at 10am CST.`
      } else {
        parsed.date_error = `Bet settled on ${sm}/${sd}/${sy} — only today's settled bets can be submitted.`
      }
    } else {
      // No settled date visible — allow through
      parsed.date_error = null
    }

    return res.status(200).json(parsed)
  } catch (err) {
    return res.status(500).json({ error: 'Failed to read slip: ' + err.message })
  }
}
