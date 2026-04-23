export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const webhook = process.env.VITE_SHEETS_WEBHOOK
  if (!webhook) return res.status(500).json({ error: 'Sheets webhook not configured on server' })

  try {
    const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body)
    const upstream = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body,
    })
    const text = await upstream.text()
    res.status(200).send(text)
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
}
