import { useState, useEffect, useRef } from 'react'
import Head from 'next/head'
import styles from '../styles/Home.module.css'

function oddsToDecimal(oddsStr) {
  const n = parseFloat(oddsStr)
  if (isNaN(n)) return 0
  if (n > 0) return (n / 100) + 1
  if (n < 0) return (100 / Math.abs(n)) + 1
  return 1
}

function formatMoney(n) {
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function todayDate() {
  return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

export default function Home() {
  const [entries, setEntries] = useState([])
  const [tab, setTab] = useState('dollars')
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [imagePreview, setImagePreview] = useState(null)
  const [imageBase64, setImageBase64] = useState(null)
  const [mediaType, setMediaType] = useState('image/jpeg')
  const [fileName, setFileName] = useState('')
  const [form, setForm] = useState({ name: '', odds: '', stake: '', payout: '', description: '' })
  const [status, setStatus] = useState({ msg: '', type: '' })
  const [submitting, setSubmitting] = useState(false)
  const [aiReading, setAiReading] = useState(false)
  const [copied, setCopied] = useState(false)
  const fileRef = useRef()

  useEffect(() => { fetchEntries() }, [])

  async function fetchEntries() {
    setLoading(true)
    try {
      const r = await fetch('/api/entries')
      const data = await r.json()
      setEntries(data.entries || [])
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  function sortedEntries() {
    const copy = [...entries]
    if (tab === 'dollars') return copy.sort((a, b) => b.payout - a.payout)
    return copy.sort((a, b) => oddsToDecimal(b.odds) - oddsToDecimal(a.odds))
  }

  async function handleFile(e) {
    const file = e.target.files[0]
    if (!file) return
    setFileName(file.name)
    setMediaType(file.type || 'image/jpeg')
    const reader = new FileReader()
    reader.onload = async (ev) => {
      const dataUrl = ev.target.result
      const base64 = dataUrl.split(',')[1]
      setImageBase64(base64)
      setImagePreview(dataUrl)
      setShowForm(true)
      setAiReading(true)
      setStatus({ msg: 'Reading your slip with AI...', type: 'info' })
      try {
        const r = await fetch('/api/read-slip', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageBase64: base64, mediaType: file.type })
        })
        const parsed = await r.json()
        setForm(f => ({
          ...f,
          odds: parsed.odds || '',
          stake: parsed.stake || '',
          payout: parsed.payout || '',
          description: parsed.description || ''
        }))
        setStatus({ msg: 'Slip read — verify the fields below then submit.', type: 'ok' })
      } catch {
        setStatus({ msg: 'Could not auto-read slip — fill in the fields manually.', type: 'err' })
      }
      setAiReading(false)
    }
    reader.readAsDataURL(file)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.name) return setStatus({ msg: 'Enter a name or handle.', type: 'err' })
    if (!form.odds) return setStatus({ msg: 'Enter the odds.', type: 'err' })
    if (!form.stake || isNaN(form.stake)) return setStatus({ msg: 'Enter a valid stake.', type: 'err' })
    if (!form.payout || isNaN(form.payout)) return setStatus({ msg: 'Enter a valid payout.', type: 'err' })
    if (!form.description) return setStatus({ msg: 'Add a bet description.', type: 'err' })

    setSubmitting(true)
    setStatus({ msg: 'Submitting...', type: 'info' })

    try {
      let image_url = null
      if (imageBase64) {
        const upRes = await fetch('/api/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageBase64, mediaType, fileName })
        })
        const upData = await upRes.json()
        image_url = upData.url || null
      }

      const r = await fetch('/api/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, image_url })
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error)

      setEntries(prev => [...prev, data.entry])
      setStatus({ msg: 'Added to the leaderboard!', type: 'ok' })
      setTimeout(resetForm, 1500)
    } catch (err) {
      setStatus({ msg: 'Error: ' + err.message, type: 'err' })
    }
    setSubmitting(false)
  }

  function resetForm() {
    setShowForm(false)
    setImagePreview(null)
    setImageBase64(null)
    setForm({ name: '', odds: '', stake: '', payout: '', description: '' })
    setStatus({ msg: '', type: '' })
    if (fileRef.current) fileRef.current.value = ''
  }

  function buildXPost() {
    const dollarTop = [...entries].sort((a, b) => b.payout - a.payout).slice(0, 3)
    const oddsTop = [...entries].sort((a, b) => oddsToDecimal(b.odds) - oddsToDecimal(a.odds)).slice(0, 3)
    const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    let post = `💰 DAILYSLIPS LEADERBOARD — ${dateStr}\n\n`
    post += `🏆 TOP $ WON\n`
    dollarTop.forEach((e, i) => { post += `${i + 1}. ${e.name} — ${formatMoney(e.payout)} (${e.odds})\n` })
    post += `\n🎲 LONGEST ODDS HIT\n`
    oddsTop.forEach((e, i) => { post += `${i + 1}. ${e.name} — ${e.odds} · ${formatMoney(e.payout)}\n` })
    post += `\ndailyslips.app  #SportsBetting #DailySlips`
    return post
  }

  async function copyXPost() {
    await navigator.clipboard.writeText(buildXPost())
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const sorted = sortedEntries()

  return (
    <>
      <Head>
        <title>DailySlips — Daily Bet Leaderboard</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </Head>

      <div className={styles.container}>
        {/* Header */}
        <header className={styles.header}>
          <div className={styles.headerLeft}>
            <h1 className={styles.logo}>DailySlips</h1>
            <span className={styles.date}>{todayDate()}</span>
          </div>
          <button className={styles.submitBtn} onClick={() => { setShowForm(true); setTimeout(() => fileRef.current?.click(), 100) }}>
            + Submit Slip
          </button>
        </header>

        {/* Tabs */}
        <div className={styles.tabs}>
          <button className={`${styles.tab} ${tab === 'dollars' ? styles.tabActive : ''}`} onClick={() => setTab('dollars')}>
            💰 Top $ Won
          </button>
          <button className={`${styles.tab} ${tab === 'odds' ? styles.tabActive : ''}`} onClick={() => setTab('odds')}>
            🎲 Longest Odds
          </button>
        </div>

        {/* Leaderboard */}
        <div className={styles.board}>
          {loading ? (
            <div className={styles.empty}>Loading today&apos;s board...</div>
          ) : sorted.length === 0 ? (
            <div className={styles.empty}>
              <span className={styles.emptyIcon}>🎫</span>
              <span>No slips yet today — be the first!</span>
            </div>
          ) : (
            sorted.slice(0, 10).map((entry, i) => (
              <div key={entry.id} className={`${styles.entry} ${i === 0 ? styles.rank1 : i === 1 ? styles.rank2 : ''}`}>
                <span className={styles.rank}>{i + 1}</span>
                <div className={styles.entryInfo}>
                  <span className={styles.entryName}>{entry.name}</span>
                  <span className={styles.entryDesc}>{entry.description}</span>
                </div>
                <div className={styles.entryMeta}>
                  <span className={styles.mainVal}>
                    {tab === 'dollars' ? <span className={styles.green}>{formatMoney(entry.payout)}</span> : entry.odds}
                  </span>
                  <span className={styles.subVal}>
                    {tab === 'dollars' ? `staked ${formatMoney(entry.stake)}` : `won ${formatMoney(entry.payout)}`}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>

        {/* X Post Preview */}
        {entries.length > 0 && (
          <div className={styles.xpost}>
            <div className={styles.xpostLabel}>𝕏 Today&apos;s post preview</div>
            <pre className={styles.xpostText}>{buildXPost()}</pre>
            <button className={styles.copyBtn} onClick={copyXPost}>
              {copied ? '✓ Copied!' : 'Copy post text'}
            </button>
          </div>
        )}

        {/* Hidden file input */}
        <input type="file" accept="image/*" ref={fileRef} style={{ display: 'none' }} onChange={handleFile} />

        {/* Submit Modal */}
        {showForm && (
          <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && resetForm()}>
            <div className={styles.modal}>
              <div className={styles.modalHeader}>
                <h2 className={styles.modalTitle}>Submit Your Slip</h2>
                <button className={styles.closeBtn} onClick={resetForm}>✕</button>
              </div>

              {!imagePreview ? (
                <div className={styles.dropzone} onClick={() => fileRef.current?.click()}>
                  <span className={styles.dropIcon}>📸</span>
                  <p>Tap to upload your bet slip image</p>
                  <p className={styles.dropSub}>JPG, PNG, HEIC supported</p>
                </div>
              ) : (
                <>
                  <img src={imagePreview} alt="Bet slip" className={styles.preview} />
                  {aiReading && <p className={styles.aiStatus}>🤖 Reading your slip with AI...</p>}
                </>
              )}

              <form onSubmit={handleSubmit} className={styles.form}>
                <div className={styles.formGrid}>
                  <div className={styles.formField}>
                    <label>Your name / handle</label>
                    <input type="text" placeholder="@handle" maxLength={30} value={form.name}
                      onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
                  </div>
                  <div className={styles.formField}>
                    <label>Odds (e.g. +450)</label>
                    <input type="text" placeholder="+450" value={form.odds}
                      onChange={e => setForm(f => ({ ...f, odds: e.target.value }))} />
                  </div>
                  <div className={styles.formField}>
                    <label>Amount bet ($)</label>
                    <input type="number" placeholder="50" min="1" value={form.stake}
                      onChange={e => setForm(f => ({ ...f, stake: e.target.value }))} />
                  </div>
                  <div className={styles.formField}>
                    <label>Amount won ($)</label>
                    <input type="number" placeholder="275" min="0" value={form.payout}
                      onChange={e => setForm(f => ({ ...f, payout: e.target.value }))} />
                  </div>
                  <div className={`${styles.formField} ${styles.fullWidth}`}>
                    <label>Bet description</label>
                    <input type="text" placeholder="Chiefs ML + Over 52.5 parlay" maxLength={80}
                      value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
                  </div>
                </div>

                {status.msg && (
                  <p className={`${styles.status} ${styles['status_' + status.type]}`}>{status.msg}</p>
                )}

                <div className={styles.formActions}>
                  <button type="submit" className={styles.primaryBtn} disabled={submitting || aiReading}>
                    {submitting ? 'Submitting...' : 'Add to leaderboard'}
                  </button>
                  <button type="button" className={styles.secondaryBtn} onClick={resetForm}>Cancel</button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
