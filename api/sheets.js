export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const webhook =
    process.env.SHEETS_WEBHOOK_URL ||
    process.env.SHEETS_WEBHOOK ||
    process.env.VITE_SHEETS_WEBHOOK

  if (!webhook) {
    return res.status(500).json({ error: 'Sheets webhook not configured — set SHEETS_WEBHOOK_URL in Vercel env vars' })
  }

  const rows = Array.isArray(req.body) ? req.body : []
  if (rows.length === 0) {
    return res.status(400).json({ error: 'No contacts to send' })
  }

  try {
    // Node.js fetch follows redirects by default (POST → GET after 302).
    // Apps Script runs doPost() on the initial POST — redirect just delivers the response.
    const upstream = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(rows),
    })

    const text = await upstream.text()

    if (!text || text.toLowerCase().startsWith('error')) {
      return res.status(502).json({ error: text || 'Empty response from Apps Script' })
    }

    res.status(200).json({ ok: true, sent: rows.length })
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
}
