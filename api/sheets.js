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

  const body = JSON.stringify(rows)

  try {
    // Step 1: POST to Apps Script with redirect: manual so we control the follow
    const r1 = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body,
      redirect: 'manual',
    })

    let text
    if (r1.status >= 300 && r1.status < 400) {
      // Apps Script returns 302 to a delivery URL — POST the body there too
      const location = r1.headers.get('location')
      if (!location) return res.status(502).json({ error: 'Redirect with no location header' })
      const r2 = await fetch(location, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body,
      })
      text = await r2.text()
    } else {
      text = await r1.text()
    }

    if (!text || text.toLowerCase().startsWith('error')) {
      return res.status(502).json({ error: text || 'Empty response from Apps Script' })
    }

    res.status(200).json({ ok: true, sent: rows.length })
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
}
