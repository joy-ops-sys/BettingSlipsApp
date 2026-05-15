export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).end(`Method ${req.method} Not Allowed`)
  }

  const { imageBase64, mediaType } = req.body
  if (!imageBase64) return res.status(400).json({ error: 'No image provided' })

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
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
              text: 'This is a sports betting slip. Extract the following and respond ONLY with a valid JSON object, no markdown, no explanation:\n{\n  "odds": "American format odds e.g. +450 or -110",\n  "stake": "amount wagered as number only",\n  "payout": "amount won or total payout as number only",\n  "description": "brief bet description: teams, sport, bet type, max 70 chars"\n}\nIf a field is not visible, use empty string for text fields or 0 for numbers.'
            }
          ]
        }]
      })
    })

    const data = await response.json()
    const raw = data.content?.map(c => c.text || '').join('') || ''
    const clean = raw.replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(clean)
    return res.status(200).json(parsed)
  } catch (err) {
    return res.status(500).json({ error: 'Failed to read slip: ' + err.message })
  }
}
