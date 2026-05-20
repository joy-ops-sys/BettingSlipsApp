export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).end(`Method ${req.method} Not Allowed`)
  }

  const { imageBase64, mediaType } = req.body
  if (!imageBase64) return res.status(400).json({ error: 'No image provided' })

  const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
  const todayFormatted = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

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
              text: `This is a sports betting slip. Today's date is ${todayFormatted} (${today}).

Extract the following and respond ONLY with a valid JSON object, no markdown, no explanation:
{
  "date_error": null,
  "placed_date": "date the bet was placed as shown on slip, or null if not visible",
  "odds": "American format odds e.g. +450 or -110. For parlays use the combined odds.",
  "stake": "amount wagered as number only e.g. 10.00",
  "payout": "amount won or total payout as number only e.g. 19.62",
  "description": "brief bet description: teams, sport, bet type max 70 chars",
  "bet_status": "won, lost, or pending based on what the slip shows",
  "sportsbook": "name of sportsbook e.g. FanDuel, DraftKings"
}

IMPORTANT date validation rule:
- Find the date the bet was PLACED on the slip (look for "PLACED:", timestamp, or date shown)
- Today is ${today}
- If the placed date is TODAY or NOT VISIBLE: set date_error to null
- ONLY if the placed date is clearly a DIFFERENT calendar day than today: set date_error to "Bet was placed on [date] — only today's bets can be submitted."
- When in doubt, set date_error to null

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

    // Normalize date_error
    if (!parsed.date_error || parsed.date_error === 'null' || parsed.date_error === '') {
      parsed.date_error = null
    }

    return res.status(200).json(parsed)
  } catch (err) {
    return res.status(500).json({ error: 'Failed to read slip: ' + err.message })
  }
}
