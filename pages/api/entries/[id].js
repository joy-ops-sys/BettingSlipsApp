import { getServiceClient } from '../../../lib/supabase'
import { isAdmin } from '../../../lib/security'

// PATCH /api/entries/:id — admin only (requires the x-admin-pin header).
// Players settle their own pending bets by uploading the settled slip instead.
export default async function handler(req, res) {
  const { id } = req.query

  if (req.method === 'PATCH') {
    if (!isAdmin(req)) return res.status(401).json({ error: 'Admin only' })

    const { bet_status, payout } = req.body || {}
    const updates = {}
    if (['won', 'lost', 'pending'].includes(bet_status)) updates.bet_status = bet_status
    if (payout !== undefined && !isNaN(Number(payout))) updates.payout = Number(payout)
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update' })

    const supabase = getServiceClient()
    const { data, error } = await supabase
      .from('entries')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ entry: data })
  }

  res.setHeader('Allow', ['PATCH'])
  res.status(405).end(`Method ${req.method} Not Allowed`)
}
