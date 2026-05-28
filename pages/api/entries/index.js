const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

export default async function handler(req, res) {
  // All dates in CST
  const nowCST = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }))
  const todayCST = nowCST.toLocaleDateString('en-CA') // YYYY-MM-DD
  const yesterdayCST = new Date(nowCST)
  yesterdayCST.setDate(yesterdayCST.getDate() - 1)
  const yesterdayStr = yesterdayCST.toLocaleDateString('en-CA')

  const headers = {
    'Content-Type': 'application/json',
    'apikey': SERVICE_KEY,
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'Prefer': 'return=representation'
  }

  if (req.method === 'GET') {
    // If a specific date is requested, just fetch that date's entries
    const requestedDate = req.query.date
    if (requestedDate) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/entries?date=eq.${requestedDate}&order=payout.desc`, { headers })
      const data = await r.json()
      if (!r.ok) return res.status(500).json({ error: JSON.stringify(data) })
      return res.status(200).json({ entries: Array.isArray(data) ? data : [] })
    }

    // Default: today's entries + yesterday's still-pending bets
    const [todayRes, pendingRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/entries?date=eq.${todayCST}&order=payout.desc`, { headers }),
      fetch(`${SUPABASE_URL}/rest/v1/entries?date=eq.${yesterdayStr}&bet_status=eq.pending&order=payout.desc`, { headers })
    ])

    const todayData = await todayRes.json()
    const pendingData = await pendingRes.json()

    if (!todayRes.ok) return res.status(500).json({ error: JSON.stringify(todayData) })

    const entries = [
      ...(Array.isArray(todayData) ? todayData : []),
      ...(Array.isArray(pendingData) ? pendingData : [])
    ]

    return res.status(200).json({ entries })
  }

  if (req.method === 'POST') {
    const { name, odds, stake, payout, potential_payout, description, image_url, bet_status } = req.body
    if (!name || !odds || !stake || !description) {
      return res.status(400).json({ error: 'Missing required fields' })
    }
    const r = await fetch(`${SUPABASE_URL}/rest/v1/entries`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name,
        odds,
        stake: Number(stake),
        payout: Number(payout || 0),
        potential_payout: Number(potential_payout || 0),
        description,
        image_url,
        bet_status: bet_status || 'won',
        date: todayCST
      })
    })
    const data = await r.json()
    if (!r.ok) return res.status(500).json({ error: JSON.stringify(data) })
    return res.status(201).json({ entry: Array.isArray(data) ? data[0] : data })
  }

  res.setHeader('Allow', ['GET', 'POST'])
  res.status(405).end(`Method ${req.method} Not Allowed`)
}
