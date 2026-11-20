import { verifyScan, normOdds, normMoney, normName } from '../../../lib/security'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

export default async function handler(req, res) {
  const nowCST = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }))
  const todayCST = nowCST.toLocaleDateString('en-CA')
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
    const requestedDate = req.query.date
    if (requestedDate) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/entries?date=eq.${requestedDate}&order=payout.desc`, { headers })
      const data = await r.json()
      if (!r.ok) return res.status(500).json({ error: JSON.stringify(data) })
      return res.status(200).json({ entries: Array.isArray(data) ? data : [] })
    }

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
    const { name, odds, stake, payout, potential_payout, description, image_url, bet_status, legs, scan_token } = req.body || {}
    if (!name || !odds || !stake || !description) {
      return res.status(400).json({ error: 'Missing required fields', code: 'missing_fields' })
    }
    const status = ['won', 'lost', 'pending'].includes(bet_status) ? bet_status : 'won'

    // 1. The slip must have been scanned, and the AI-read numbers must not have been changed
    const scan = verifyScan(scan_token)
    if (!scan) {
      return res.status(400).json({ code: 'scan_required', error: 'Your scan expired — upload the slip again.' })
    }
    const sentOdds = normOdds(odds)
    const sentStake = normMoney(stake)
    const sentPayout = normMoney(status === 'pending' ? potential_payout : payout)
    const changed = []
    if (scan.odds !== null && sentOdds !== scan.odds) changed.push('odds')
    if (scan.stake !== null && sentStake !== scan.stake) changed.push('stake')
    if (scan.payout !== null && status !== 'lost' && sentPayout !== scan.payout) changed.push('payout')
    if (scan.bet_status && status !== scan.bet_status) changed.push('status')
    if (changed.length) {
      return res.status(400).json({ code: 'numbers_changed', error: `The ${changed.join(', ')} must match your slip.` })
    }
    const manualFields = ['odds', 'stake', 'payout'].filter(f => scan[f] === null)
    if (!scan.bet_status) manualFields.push('status')

    // Slips that settled yesterday go on yesterday's board — only before 10am CT
    const boardDate = scan.board_date === yesterdayStr && nowCST.getHours() < 10 ? yesterdayStr : todayCST

    // 2. Look at this player's recent entries
    const who = normName(name)
    const recentRes = await fetch(
      `${SUPABASE_URL}/rest/v1/entries?date=in.(${yesterdayStr},${todayCST})&select=id,name,odds,stake,payout,potential_payout,bet_status,date`,
      { headers }
    )
    const recentData = await recentRes.json()
    const mine = (Array.isArray(recentData) ? recentData : []).filter(e => normName(e.name) === who)
    const sameBet = e => normOdds(e.odds) === sentOdds && normMoney(e.stake) === sentStake

    // 3. Same player, same slip, same board → duplicate
    const dup = mine.find(e =>
      e.date === boardDate && e.bet_status === status && sameBet(e) &&
      normMoney(status === 'pending' ? e.potential_payout : e.payout) === sentPayout
    )
    if (dup) {
      return res.status(409).json({ code: 'duplicate', error: "You've already submitted this slip." })
    }

    const record = {
      name: String(name).trim().replace(/^@+/, ''),
      odds,
      stake: Number(stake),
      payout: status === 'pending' ? 0 : Number(payout || 0),
      potential_payout: Number(potential_payout || 0),
      description,
      image_url,
      bet_status: status,
      date: boardDate,
      legs: legs || null,
      manual_fields: manualFields.length ? manualFields.join(',') : null,
    }

    // 4. Settled slip for a bet this player already has pending → update that entry
    if (status !== 'pending') {
      const open = mine.find(e => e.bet_status === 'pending' && sameBet(e))
      if (open) {
        const saved = await save(`${SUPABASE_URL}/rest/v1/entries?id=eq.${open.id}`, 'PATCH', record, headers)
        if (!saved.ok) return res.status(500).json({ error: saved.error })
        return res.status(200).json({ entry: saved.entry, settled: true, replaced_id: open.id })
      }
    }

    // 5. New entry
    const saved = await save(`${SUPABASE_URL}/rest/v1/entries`, 'POST', record, headers)
    if (!saved.ok) return res.status(500).json({ error: saved.error })
    return res.status(201).json({ entry: saved.entry })
  }

  res.setHeader('Allow', ['GET', 'POST'])
  res.status(405).end(`Method ${req.method} Not Allowed`)
}

// Writes a row; if the optional manual_fields column hasn't been added in Supabase yet, retries without it.
async function save(url, method, record, headers) {
  let r = await fetch(url, { method, headers, body: JSON.stringify(record) })
  let data = await r.json()
  if (!r.ok && JSON.stringify(data).includes('manual_fields')) {
    const { manual_fields, ...rest } = record
    r = await fetch(url, { method, headers, body: JSON.stringify(rest) })
    data = await r.json()
  }
  if (!r.ok) return { ok: false, error: JSON.stringify(data) }
  return { ok: true, entry: Array.isArray(data) ? data[0] : data }
}
