// GET /api/board-post            → yesterday's board (Chicago time) as an X post
// GET /api/board-post?date=YYYY-MM-DD
// GET /api/board-post?format=text → plain text only (easy to copy)
// Always returns a post — if no slips were submitted it returns the "no slips" version.
import { buildBoardPost, chicagoToday, addDays } from '../../lib/board'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'])
    return res.status(405).end(`Method ${req.method} Not Allowed`)
  }

  const requested = String(req.query.date || '')
  const date = /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : addDays(chicagoToday(), -1)

  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/entries?date=eq.${date}&order=payout.desc`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    })
    const data = await r.json()
    if (!r.ok) return res.status(500).json({ error: JSON.stringify(data) })

    const entries = Array.isArray(data) ? data : []
    const post = buildBoardPost(entries, date)

    res.setHeader('Cache-Control', 'no-store')
    if (req.query.format === 'text') {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      return res.status(200).send(post)
    }
    return res.status(200).json({
      date,
      count: entries.length,
      won: entries.filter(e => e.bet_status === 'won').length,
      post,
    })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
