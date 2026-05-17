import { getServiceClient } from '../../../lib/supabase'

export default async function handler(req, res) {
  const supabase = getServiceClient()
  const { id } = req.query

  if (req.method === 'PATCH') {
    const { bet_status, payout } = req.body
    const updates = {}
    if (bet_status) updates.bet_status = bet_status
    if (payout !== undefined) updates.payout = payout

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
