// POST /api/admin { pin } → checks the admin PIN against the ADMIN_PIN setting in Vercel.
import { adminConfigured, isAdmin } from '../../lib/security'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).end(`Method ${req.method} Not Allowed`)
  }
  if (!adminConfigured()) {
    return res.status(500).json({ error: 'Admin PIN is not set up on the server yet (ADMIN_PIN).' })
  }
  const pin = String(req.body?.pin || '')
  if (!isAdmin({ headers: { 'x-admin-pin': pin } })) {
    await new Promise(r => setTimeout(r, 800)) // slow down guessing
    return res.status(401).json({ error: 'Incorrect PIN' })
  }
  return res.status(200).json({ ok: true })
}
