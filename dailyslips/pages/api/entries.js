import { getServiceClient } from '../../lib/supabase'

export default async function handler(req, res) {
  const supabase = getServiceClient()
  const today = new Date().toISOString().slice(0, 10)

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('entries')
      .select('*')
      .eq('date', today)
      .order('payout', { ascending: false })

    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ entries: data })
  }

  if (req.method === 'POST') {
    const { name, odds, stake, payout, description, image_url } = req.body

    if (!name || !odds || !stake || !payout || !description) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    const { data, error } = await supabase
      .from('entries')
      .insert([{ name, odds, stake: Number(stake), payout: Number(payout), description, image_url, date: today }])
      .select()
      .single()

    if (error) return res.status(500).json({ error: error.message })
    return res.status(201).json({ entry: data })
  }

  res.setHeader('Allow', ['GET', 'POST'])
  res.status(405).end(`Method ${req.method} Not Allowed`)
}
