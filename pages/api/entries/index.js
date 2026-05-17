// v2 api
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

export default async function handler(req, res) {
  const today = new Date().toISOString().slice(0, 10)
  const headers = {
    'Content-Type': 'application/json',
    'apikey': SERVICE_KEY,
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'Prefer': 'return=representation'
  }

  if (req.method === 'GET') {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/entries?date=eq.${today}&order=payout.desc`, { headers })
    const data = await r.json()
    if (!r.ok) return res.status(500).json({ error: JSON.stringify(data) })
    return res.status(200).json({ entries: data })
  }

  if (req.method === 'POST') {
    const { name, odds, stake, payout, description, image_url, bet_status } = req.body
    if (!name || !odds || !stake || !description) {
      return res.status(400).json({ error: 'Missing required fields' })
    }
    const r = await fetch(`${SUPABASE_URL}/rest/v1/entries`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name, odds, stake: Number(stake), payout: Number(payout || 0), description, image_url, bet_status: bet_status || 'won', date: today })
    })
    const data = await r.json()
    if (!r.ok) return res.status(500).json({ error: JSON.stringify(data) })
    return res.status(201).json({ entry: Array.isArray(data) ? data[0] : data })
  }

  res.setHeader('Allow', ['GET', 'POST'])
  res.status(405).end(`Method ${req.method} Not Allowed`)
}