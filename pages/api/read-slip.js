export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).end(`Method ${req.method} Not Allowed`)
  }

  const { imageBase64, mediaType } = req.body
  if (!imageBase64) return res.status(400).json({ error: 'No image provided' })

  const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD e.g. "2026-05-19"

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
  "placed_date": "date the bet was placed in YYYY-MM-DD format if visible, otherwise null",
  "odds": "American format odds e.g. +450 or -110. For parlays use the combined odds.",
  "stake": "amount wagered as number only e.g. 10.00",
  "payout": "amount won or total payout as number only e.g. 19.62",
  "description": "brief bet description: teams, sport, bet type max 70 chars",
  "bet_status": "won, lost, or pending based on what the slip shows",
  "sportsbook": "name of sportsbook e.g. FanDuel, DraftKings"
}

If a field is not visible use empty string for text or 0 for numbers.`
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

    // Server-side date validation — more reliable than asking the AI
    if (parsed.placed_date && parsed.placed_date !== 'null') {
      // Normalize to YYYY-MM-DD for comparison
      const placedDate = parsed.placed_date.slice(0, 10)
      if (placedDate !== today) {
        parsed.date_error = `Bet was placed on ${parsed.placed_date} — only today's bets can be submitted.`
      } else {
        parsed.date_error = null
      }
    } else {
      // Date not visible — allow it through
      parsed.date_error = null
    }

    return res.status(200).json(parsed)
  } catch (err) {
    return res.status(500).json({ error: 'Failed to read slip: ' + err.message })
  }
}
