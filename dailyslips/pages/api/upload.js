import { getServiceClient } from '../../lib/supabase'

export const config = { api: { bodyParser: { sizeLimit: '10mb' } } }

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).end(`Method ${req.method} Not Allowed`)
  }

  const { imageBase64, mediaType, fileName } = req.body
  if (!imageBase64) return res.status(400).json({ error: 'No image provided' })

  try {
    const supabase = getServiceClient()
    const buffer = Buffer.from(imageBase64, 'base64')
    const ext = (mediaType || 'image/jpeg').split('/')[1]
    const path = `${Date.now()}-${fileName || 'slip'}.${ext}`

    const { error } = await supabase.storage
      .from('bet-slips')
      .upload(path, buffer, { contentType: mediaType || 'image/jpeg', upsert: false })

    if (error) return res.status(500).json({ error: error.message })

    const { data: { publicUrl } } = supabase.storage.from('bet-slips').getPublicUrl(path)
    return res.status(200).json({ url: publicUrl })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
