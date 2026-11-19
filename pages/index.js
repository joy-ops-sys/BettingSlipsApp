import { useState, useEffect, useRef } from 'react'
import Head from 'next/head'
import styles from '../styles/Home.module.css'
import {
  oddsToDecimal, formatMoney, formatName, chicagoToday, addDays,
  shortDate, longDate, buildBoardPost,
} from '../lib/board'

const STATUS_CONFIG = {
  won:     { label: 'Won',     emoji: '✅', cls: 'statusWon' },
  lost:    { label: 'Lost',    emoji: '❌', cls: 'statusLost' },
  pending: { label: 'Pending', emoji: '⏳', cls: 'statusPending' },
  void:    { label: 'Void',    emoji: '➖', cls: 'statusLost' },
}

const TABS = [
  { id: 'dollars', label: 'Biggest wins' },
  { id: 'odds',    label: 'Longest odds' },
  { id: 'pending', label: 'Pending' },
]

// What to tell the user when a slip can't be read
const UPLOAD_HELP = {
  not_a_slip: {
    title: "That doesn't look like a bet slip",
    tips: [
      'Upload a screenshot of the bet itself from your sportsbook app (FanDuel, DraftKings, etc.).',
      'Open My Bets → Settled, tap the bet, and screenshot that screen.',
      "Photos of a TV, a score, or a group chat won't work.",
    ],
  },
  missing_details: {
    title: "We couldn't find the odds or bet amount",
    tips: [
      'Make sure the odds, wager and payout are all visible in the screenshot.',
      "Don't crop off the top or bottom of the slip.",
      'For parlays, expand the bet so every leg shows.',
    ],
  },
  unreadable: {
    title: 'The slip was hard to read',
    tips: [
      'Use a screenshot instead of a photo of your screen.',
      'Zoom out so the whole slip fits on one screen.',
      'Avoid blurry, dim or glare-covered images.',
    ],
  },
  old_slip: {
    title: 'This bet settled too long ago',
    tips: [
      'Only bets that settled today can go on the board.',
      'Bets that settled yesterday can be submitted until 10am CT.',
      'Screenshot from My Bets → Settled so the settled date shows.',
    ],
  },
  window_closed: {
    title: "Yesterday's window has closed",
    tips: [
      "Slips that settled yesterday had to be in by 10am CT — yesterday's board is final.",
      'Bets that settle today can be submitted until 10am CT tomorrow.',
    ],
  },
  heic: {
    title: "This photo format can't be opened here",
    tips: [
      'Take a regular screenshot instead (on iPhone: side button + volume up).',
      'Or upload from your phone — iPhones convert HEIC photos automatically.',
      'Or save the image as JPG or PNG and try again.',
    ],
  },
  bad_format: {
    title: "This file type isn't supported",
    tips: [
      'Upload a JPG or PNG screenshot of your bet slip.',
      "PDFs, videos and screen recordings won't work.",
    ],
  },
  too_large: {
    title: 'That image is too large',
    tips: [
      'Crop the screenshot down to just the bet slip.',
      'Use a screenshot rather than a full-resolution photo.',
    ],
  },
  ai_busy: {
    title: 'The slip reader is busy right now',
    tips: [
      'Wait about 30 seconds and try the same screenshot again.',
      "Your slip wasn't rejected — this one is on our end.",
    ],
  },
  ai_timeout: {
    title: 'Reading the slip took too long',
    tips: [
      'Try again — it usually works on the second try.',
      'Very tall screenshots take longer, so crop to just the slip.',
    ],
  },
  ai_unavailable: {
    title: "The slip reader isn't working right now",
    tips: [
      'Try again in a few minutes.',
      "Your slip wasn't rejected — this one is on our end.",
    ],
  },
  network: {
    title: "Couldn't reach DailySlips",
    tips: [
      'Check your Wi-Fi or cell signal.',
      'Then try the same screenshot again.',
    ],
  },
  no_image: {
    title: 'No image was received',
    tips: ['Pick the screenshot again — the upload may have been interrupted.'],
  },
  unknown: {
    title: 'Something went wrong reading that slip',
    tips: [
      'Try the same screenshot again.',
      'If it keeps failing, take a fresh screenshot from My Bets → Settled.',
    ],
  },
}

const HTTP_CODE = { 413: 'too_large', 415: 'bad_format', 504: 'ai_timeout', 502: 'ai_unavailable', 503: 'ai_busy' }

function codedError(code, message) {
  const err = new Error(message || code)
  err.code = code
  return err
}

// Shrinks the image and converts it to JPEG before upload.
// Smaller uploads are faster, stay under size limits, and turn HEIC into something the reader accepts.
function prepareImage(file) {
  return new Promise((resolve, reject) => {
    const name = (file.name || '').toLowerCase()
    const isHeic = /heic|heif/.test(file.type) || /\.(heic|heif)$/.test(name)
    if (!file.type.startsWith('image/') && !isHeic) {
      return reject(codedError('bad_format'))
    }
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      try {
        const MAX = 2000
        const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight))
        const w = Math.round(img.naturalWidth * scale)
        const h = Math.round(img.naturalHeight * scale)
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, w, h)
        ctx.drawImage(img, 0, 0, w, h)
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
        URL.revokeObjectURL(url)
        resolve({ dataUrl, base64: dataUrl.split(',')[1], mediaType: 'image/jpeg' })
      } catch (e) {
        URL.revokeObjectURL(url)
        reject(codedError('unreadable'))
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(codedError(isHeic ? 'heic' : 'bad_format'))
    }
    img.src = url
  })
}

// Reads a JSON response, or turns a non-JSON error page (e.g. "Request Entity Too Large") into a coded error
async function readJson(r) {
  const text = await r.text()
  try {
    return JSON.parse(text)
  } catch {
    throw codedError(HTTP_CODE[r.status] || 'unknown', `Unexpected response (${r.status})`)
  }
}

const EMPTY_FORM = { name: '', odds: '', stake: '', payout: '', description: '', betStatus: 'won', legs: [] }

export default function Home() {
  const today = chicagoToday()
  const [selectedDate, setSelectedDate] = useState(today)
  const [entries, setEntries] = useState([])
  const [tab, setTab] = useState('dollars')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [expandedEntry, setExpandedEntry] = useState(null)

  const [showForm, setShowForm] = useState(false)
  const [scanStep, setScanStep] = useState('idle') // idle | scanning | error | confirm | done
  const [scanError, setScanError] = useState(null)  // { code, message }
  const [imagePreview, setImagePreview] = useState(null)
  const [imageBase64, setImageBase64] = useState(null)
  const [mediaType, setMediaType] = useState('image/jpeg')
  const [form, setForm] = useState(EMPTY_FORM)
  const [status, setStatus] = useState({ msg: '', type: '' })
  const [submitting, setSubmitting] = useState(false)

  const [isAdmin, setIsAdmin] = useState(false)
  const [showAdminLogin, setShowAdminLogin] = useState(false)
  const [adminPin, setAdminPin] = useState('')
  const [adminError, setAdminError] = useState('')
  const [copied, setCopied] = useState(false)

  const [installPrompt, setInstallPrompt] = useState(null)
  const [showInstallBanner, setShowInstallBanner] = useState(false)
  const [isIOS, setIsIOS] = useState(false)
  const fileRef = useRef()

  const ADMIN_PIN = '5757'
  const isToday = selectedDate === today

  useEffect(() => {
    fetchEntries(today)
    const ios = /iphone|ipad|ipod/.test(navigator.userAgent.toLowerCase())
    const standalone = window.navigator.standalone
    let dismissed = false
    try { dismissed = localStorage.getItem('ds_install_dismissed') === '1' } catch {}
    if (ios && !standalone && !dismissed) { setIsIOS(true); setShowInstallBanner(true) }
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault()
      setInstallPrompt(e)
      if (!dismissed) setShowInstallBanner(true)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function fetchEntries(date) {
    setLoading(true)
    setLoadError(false)
    setExpandedEntry(null)
    try {
      const url = date && date !== today ? `/api/entries?date=${date}` : '/api/entries'
      const r = await fetch(url)
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Load failed')
      setEntries(data.entries || [])
    } catch (e) {
      console.error(e)
      setEntries([])
      setLoadError(true)
    }
    setLoading(false)
  }

  function goToDate(date) {
    if (!date || date > today) return
    setSelectedDate(date)
    fetchEntries(date)
  }

  const dayEntries = entries.filter(e => !e.date || e.date === selectedDate)
  const won = entries.filter(e => e.bet_status === 'won')
  const pending = entries.filter(e => e.bet_status === 'pending')

  function sortedEntries() {
    if (tab === 'dollars') return [...won].sort((a, b) => b.payout - a.payout)
    if (tab === 'odds') return [...won].sort((a, b) => oddsToDecimal(b.odds) - oddsToDecimal(a.odds))
    return [...pending].sort((a, b) => oddsToDecimal(b.odds) - oddsToDecimal(a.odds))
  }

  // ── Upload flow ──────────────────────────────────────────

  function openUpload() {
    setShowForm(true)
    setScanStep('idle')
    fileRef.current?.click()
  }

  function pickAnother() {
    setScanStep('idle')
    setScanError(null)
    setImagePreview(null)
    setImageBase64(null)
    if (fileRef.current) {
      fileRef.current.value = ''
      fileRef.current.click()
    }
  }

  function showScanError(code, message) {
    setScanError({ code: UPLOAD_HELP[code] ? code : 'unknown', message })
    setScanStep('error')
  }

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setShowForm(true)
    setScanError(null)
    setStatus({ msg: '', type: '' })
    setScanStep('scanning')

    let prepared
    try {
      prepared = await prepareImage(file)
    } catch (err) {
      setImagePreview(null)
      return showScanError(err.code || 'unknown')
    }
    setImagePreview(prepared.dataUrl)
    setImageBase64(prepared.base64)
    setMediaType(prepared.mediaType)

    let parsed
    try {
      const r = await fetch('/api/read-slip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: prepared.base64,
          mediaType: prepared.mediaType,
          clientDate: new Date().toLocaleDateString('en-CA'),
        }),
      })
      parsed = await readJson(r)
      if (!r.ok || parsed.error) {
        return showScanError(parsed.code || HTTP_CODE[r.status] || 'unknown', parsed.error)
      }
      if (parsed.date_error) return showScanError('old_slip', parsed.date_error)
    } catch (err) {
      return showScanError(err.code || 'network', err.message)
    }

    let savedHandle = ''
    try { savedHandle = localStorage.getItem('ds_handle') || '' } catch {}
    setForm(f => ({
      ...f,
      name: f.name || savedHandle,
      odds: parsed.odds || '',
      stake: parsed.stake || '',
      payout: parsed.payout || '',
      description: parsed.description || '',
      betStatus: ['won', 'lost', 'pending'].includes(parsed.bet_status) ? parsed.bet_status : 'won',
      legs: Array.isArray(parsed.legs) ? parsed.legs : [],
    }))
    setScanStep('confirm')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.name.replace(/^@/, '').trim()) return setStatus({ msg: 'Add your X handle so we can tag you.', type: 'err' })
    if (!form.odds) return setStatus({ msg: 'Add the odds (e.g. +450).', type: 'err' })
    if (!form.stake || isNaN(parseFloat(form.stake)) || parseFloat(form.stake) <= 0) return setStatus({ msg: 'Add the amount you bet.', type: 'err' })
    if (form.betStatus !== 'pending' && (!form.payout || isNaN(parseFloat(form.payout)))) return setStatus({ msg: `Add the amount ${form.betStatus === 'lost' ? 'lost' : 'won'}.`, type: 'err' })
    if (!form.description) return setStatus({ msg: 'Add a short bet description.', type: 'err' })

    setSubmitting(true)
    setStatus({ msg: 'Submitting…', type: 'info' })

    try {
      let image_url = null
      if (imageBase64) {
        try {
          const upRes = await fetch('/api/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageBase64, mediaType, fileName: 'slip' }),
          })
          const upData = await readJson(upRes)
          image_url = upData.url || null
        } catch {
          image_url = null // the slip still goes on the board without the image link
        }
      }

      const name = form.name.trim().replace(/^@+/, '')
      const payload = {
        name,
        odds: form.odds,
        stake: parseFloat(form.stake),
        payout: form.betStatus === 'pending' ? 0 : parseFloat(form.payout),
        potential_payout: parseFloat(form.payout) || 0,
        description: form.description,
        bet_status: form.betStatus,
        image_url,
        legs: form.legs?.length ? form.legs : null,
      }

      const r = await fetch('/api/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await readJson(r)
      if (!r.ok) throw new Error(data.error || 'Save failed')

      try { localStorage.setItem('ds_handle', name) } catch {}
      if (isToday) setEntries(prev => [...prev, data.entry])
      setTab(form.betStatus === 'pending' ? 'pending' : 'dollars')
      setScanStep('done')
      setStatus({ msg: '', type: '' })
    } catch (err) {
      setStatus({
        msg: err.code === 'network' || err instanceof TypeError
          ? "Your slip wasn't saved — check your connection and tap Add again."
          : "Your slip wasn't saved — tap Add again. If it keeps failing, try again in a few minutes.",
        type: 'err',
      })
    }
    setSubmitting(false)
  }

  async function handleUpdateStatus(entry, newStatus) {
    try {
      const body = { bet_status: newStatus }
      if (newStatus === 'won' && (!entry.payout || entry.payout === 0) && entry.potential_payout) {
        body.payout = entry.potential_payout
      }
      const r = await fetch(`/api/entries/${entry.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) throw new Error('Update failed')
      const data = await r.json()
      setEntries(prev => prev.map(e => e.id === entry.id ? { ...e, bet_status: newStatus, payout: data.entry?.payout ?? e.payout } : e))
      setExpandedEntry(null)
    } catch (err) {
      alert('Could not update: ' + err.message)
    }
  }

  function resetForm() {
    setShowForm(false)
    setImagePreview(null)
    setImageBase64(null)
    setScanStep('idle')
    setScanError(null)
    setForm(EMPTY_FORM)
    setStatus({ msg: '', type: '' })
    if (fileRef.current) fileRef.current.value = ''
  }

  // ── Admin ────────────────────────────────────────────────

  function checkAdmin() {
    if (adminPin === ADMIN_PIN) {
      setIsAdmin(true)
      setShowAdminLogin(false)
      setAdminError('')
    } else {
      setAdminError('Incorrect PIN')
    }
    setAdminPin('')
  }

  const xPost = buildBoardPost(dayEntries, selectedDate)

  async function copyXPost() {
    try {
      await navigator.clipboard.writeText(xPost)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }

  async function handleInstall() {
    if (installPrompt) {
      installPrompt.prompt()
      const { outcome } = await installPrompt.userChoice
      if (outcome === 'accepted') setShowInstallBanner(false)
    }
  }

  function dismissInstall() {
    setShowInstallBanner(false)
    try { localStorage.setItem('ds_install_dismissed', '1') } catch {}
  }

  // ── Render ───────────────────────────────────────────────

  const sorted = sortedEntries()
  const topWin = won.reduce((m, e) => Math.max(m, Number(e.payout) || 0), 0)
  const topOdds = won.reduce((best, e) => (!best || oddsToDecimal(e.odds) > oddsToDecimal(best.odds) ? e : best), null)
  const help = scanError ? UPLOAD_HELP[scanError.code] || UPLOAD_HELP.unknown : null

  return (
    <>
      <Head>
        <title>DailySlips — Daily Bet Leaderboard</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </Head>

      <header className={styles.header}>
        <div className={styles.headerInner}>
          <div className={styles.brand}>
            <h1 className={styles.logo}>DailySlips</h1>
            <span className={styles.tagline}>Daily bet leaderboard</span>
          </div>
          <button className={styles.submitBtn} onClick={openUpload}>+ Submit slip</button>
        </div>
      </header>

      <main className={styles.container}>
        {showInstallBanner && (
          <div className={styles.installBanner}>
            <div className={styles.installText}>
              <span className={styles.installTitle}>Add DailySlips to your home screen</span>
              <span className={styles.installSub}>
                {isIOS ? 'Tap Share, then "Add to Home Screen"' : 'Open it like an app, one tap away'}
              </span>
            </div>
            {!isIOS && installPrompt && <button className={styles.installBtn} onClick={handleInstall}>Install</button>}
            <button className={styles.iconBtn} onClick={dismissInstall} aria-label="Dismiss">✕</button>
          </div>
        )}

        {/* Date navigation */}
        <div className={styles.dateNav}>
          <button className={styles.dateArrow} onClick={() => goToDate(addDays(selectedDate, -1))} aria-label="Previous day">‹</button>
          <div className={styles.dateCenter}>
            <span className={styles.dateKicker}>{isToday ? 'Today' : selectedDate === addDays(today, -1) ? 'Yesterday' : 'Past board'}</span>
            <span className={styles.dateLabel}>{longDate(selectedDate)} <span className={styles.caret}>▾</span></span>
            <input
              type="date"
              className={styles.dateOverlay}
              value={selectedDate}
              max={today}
              onClick={e => { try { e.currentTarget.showPicker && e.currentTarget.showPicker() } catch {} }}
              onChange={e => goToDate(e.target.value)}
              aria-label="Pick a date"
            />
          </div>
          <button className={styles.dateArrow} onClick={() => goToDate(addDays(selectedDate, 1))} disabled={isToday} aria-label="Next day">›</button>
        </div>
        {!isToday && (
          <button className={styles.backToday} onClick={() => goToDate(today)}>Back to today</button>
        )}

        {/* Day summary */}
        <div className={styles.stats}>
          <div className={styles.stat}>
            <span className={styles.statValue}>{loading ? '–' : dayEntries.length}</span>
            <span className={styles.statLabel}>Slips</span>
          </div>
          <div className={styles.stat}>
            <span className={`${styles.statValue} ${topWin ? styles.green : ''}`}>{loading || !topWin ? '–' : formatMoney(topWin)}</span>
            <span className={styles.statLabel}>Biggest win</span>
          </div>
          <div className={styles.stat}>
            <span className={`${styles.statValue} ${topOdds ? styles.accent : ''}`}>{loading || !topOdds ? '–' : topOdds.odds}</span>
            <span className={styles.statLabel}>Longest odds</span>
          </div>
        </div>

        {/* Tabs */}
        <div className={styles.tabs} role="tablist">
          {TABS.map(t => {
            const count = t.id === 'pending' ? pending.length : won.length
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                className={`${styles.tab} ${tab === t.id ? styles.tabActive : ''}`}
                onClick={() => { setTab(t.id); setExpandedEntry(null) }}
              >
                {t.label}
                {t.id === 'pending' && count > 0 && <span className={styles.tabCount}>{count}</span>}
              </button>
            )
          })}
        </div>

        {/* Board */}
        <section className={styles.board}>
          {loading ? (
            <>
              <div className={styles.skeleton} />
              <div className={styles.skeleton} />
              <div className={styles.skeleton} />
            </>
          ) : loadError ? (
            <div className={styles.empty}>
              <span className={styles.emptyTitle}>Couldn&apos;t load the board</span>
              <span className={styles.emptySub}>Check your connection and try again.</span>
              <button className={styles.secondaryBtn} onClick={() => fetchEntries(selectedDate)}>Retry</button>
            </div>
          ) : sorted.length === 0 ? (
            <div className={styles.empty}>
              {tab === 'pending' ? (
                <>
                  <span className={styles.emptyTitle}>No pending slips</span>
                  <span className={styles.emptySub}>Bets still in play will show up here.</span>
                </>
              ) : isToday ? (
                <>
                  <span className={styles.emptyTitle}>{entries.length ? 'No winners yet today' : 'No slips yet today'}</span>
                  <span className={styles.emptySub}>Cash a ticket, upload the screenshot, and take the #1 spot.</span>
                  <ol className={styles.howItWorks}>
                    <li><b>1</b> Screenshot your settled bet</li>
                    <li><b>2</b> Upload it — AI reads the slip</li>
                    <li><b>3</b> Add your X handle and climb the board</li>
                  </ol>
                  <button className={styles.primaryBtn} onClick={openUpload}>Submit a slip</button>
                </>
              ) : (
                <>
                  <span className={styles.emptyTitle}>No winning slips on {shortDate(selectedDate)}</span>
                  <span className={styles.emptySub}>Try another day with the arrows above.</span>
                </>
              )}
            </div>
          ) : (
            sorted.slice(0, 10).map((entry, i) => {
              const isPending = entry.bet_status === 'pending'
              const isExpanded = expandedEntry === entry.id
              const rankCls = isPending ? '' : [styles.rank1, styles.rank2, styles.rank3][i] || ''
              return (
                <article key={entry.id} className={`${styles.entry} ${rankCls} ${isPending ? styles.entryPending : ''} ${isExpanded ? styles.entryOpen : ''}`}>
                  <button className={styles.entryRow} onClick={() => setExpandedEntry(isExpanded ? null : entry.id)} aria-expanded={isExpanded}>
                    <span className={styles.rank}>{isPending ? '⏳' : i + 1}</span>
                    <span className={styles.entryInfo}>
                      <span className={styles.entryName}>{formatName(entry.name)}</span>
                      <span className={styles.entryDesc}>{entry.description}</span>
                    </span>
                    <span className={styles.entryMeta}>
                      {isPending ? (
                        <>
                          <span className={styles.mainVal}>{entry.odds}</span>
                          <span className={styles.subVal}>
                            {entry.potential_payout ? `to win ${formatMoney(entry.potential_payout)}` : `${formatMoney(entry.stake)} bet`}
                          </span>
                        </>
                      ) : tab === 'dollars' ? (
                        <>
                          <span className={`${styles.mainVal} ${styles.green}`}>{formatMoney(entry.payout)}</span>
                          <span className={styles.subVal}>{entry.odds}</span>
                        </>
                      ) : (
                        <>
                          <span className={`${styles.mainVal} ${styles.accent}`}>{entry.odds}</span>
                          <span className={styles.subVal}>won {formatMoney(entry.payout)}</span>
                        </>
                      )}
                    </span>
                    <span className={styles.chevron} aria-hidden="true">›</span>
                  </button>

                  {isExpanded && (
                    <div className={styles.entryDetail}>
                      <div className={styles.detailStats}>
                        <span><em>Odds</em>{entry.odds}</span>
                        <span><em>Bet</em>{formatMoney(entry.stake)}</span>
                        <span>
                          <em>{isPending ? 'To win' : entry.bet_status === 'lost' ? 'Lost' : 'Won'}</em>
                          {formatMoney(isPending ? entry.potential_payout : entry.payout)}
                        </span>
                      </div>

                      {entry.legs && entry.legs.length > 0 && (
                        <>
                          <div className={styles.legsTitle}>
                            {entry.legs.length === 1 ? 'Bet details' : `Parlay · ${entry.legs.length} legs`}
                          </div>
                          {entry.legs.map((leg, li) => {
                            const legSc = leg.status ? STATUS_CONFIG[leg.status] || STATUS_CONFIG.pending : null
                            return (
                              <div key={li} className={styles.legRow}>
                                <div className={styles.legInfo}>
                                  <span className={styles.legSelection}>{leg.selection}</span>
                                  <span className={styles.legMarket}>{leg.market}</span>
                                </div>
                                <div className={styles.legMeta}>
                                  {leg.odds && <span className={styles.legOdds}>{leg.odds}</span>}
                                  {legSc && <span className={`${styles.legStatus} ${styles[legSc.cls]}`}>{legSc.label}</span>}
                                </div>
                              </div>
                            )
                          })}
                        </>
                      )}

                      <div className={styles.detailActions}>
                        {entry.image_url && (
                          <a href={entry.image_url} target="_blank" rel="noopener noreferrer" className={styles.linkBtn}>
                            View slip ↗
                          </a>
                        )}
                        {isPending && (
                          <div className={styles.settleRow}>
                            <span>Settled?</span>
                            <button className={styles.wonBtn} onClick={() => handleUpdateStatus(entry, 'won')}>Won</button>
                            <button className={styles.lostBtn} onClick={() => handleUpdateStatus(entry, 'lost')}>Lost</button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </article>
              )
            })
          )}
        </section>

        {/* Admin-only X post */}
        {isAdmin && (
          <section className={styles.xpost}>
            <div className={styles.xpostHead}>
              <span className={styles.xpostLabel}>𝕏 post · {shortDate(selectedDate)}</span>
              <span className={styles.adminBadge}>Admin</span>
            </div>
            <pre className={styles.xpostText}>{loading ? 'Loading…' : xPost}</pre>
            <div className={styles.xpostActions}>
              <button className={styles.copyBtn} onClick={copyXPost} disabled={loading}>
                {copied ? 'Copied ✓' : 'Copy post'}
              </button>
              <a className={styles.postBtn} href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(xPost)}`} target="_blank" rel="noopener noreferrer">
                Open in 𝕏
              </a>
            </div>
          </section>
        )}

        <footer className={styles.footer}>
          <span>Slips that settle today can be submitted until 10am CT tomorrow.</span>
          {isAdmin ? (
            <button className={styles.footerLink} onClick={() => { setIsAdmin(false); setAdminPin('') }}>Sign out of admin</button>
          ) : showAdminLogin ? (
            <div className={styles.adminRow}>
              <input
                className={styles.adminInput}
                type="password"
                inputMode="numeric"
                placeholder="PIN"
                autoFocus
                value={adminPin}
                onChange={e => setAdminPin(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && checkAdmin()}
              />
              <button className={styles.adminBtn} onClick={checkAdmin}>Enter</button>
              <button className={styles.footerLink} onClick={() => { setShowAdminLogin(false); setAdminError('') }}>Cancel</button>
            </div>
          ) : (
            <button className={styles.footerLink} onClick={() => setShowAdminLogin(true)}>Admin</button>
          )}
          {adminError && <span className={styles.adminError}>{adminError}</span>}
        </footer>
      </main>

      {/* Thumb-reachable submit button on phones */}
      {!showForm && (
        <div className={styles.bottomBar}>
          <button className={styles.bottomCta} onClick={openUpload}>📸 Submit your slip</button>
        </div>
      )}

      <input type="file" accept="image/*,.heic,.heif" ref={fileRef} style={{ display: 'none' }} onChange={handleFile} />

      {showForm && (
        <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && !submitting && resetForm()}>
          <div className={styles.modal} role="dialog" aria-modal="true">
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>
                {scanStep === 'confirm' ? 'Check your slip' : scanStep === 'done' ? 'You’re on the board' : 'Submit your slip'}
              </h2>
              <button className={styles.iconBtn} onClick={resetForm} aria-label="Close">✕</button>
            </div>

            {scanStep === 'idle' && (
              <>
                <button className={styles.dropzone} onClick={() => fileRef.current?.click()}>
                  <span className={styles.dropIcon}>📸</span>
                  <span className={styles.dropTitle}>Upload a screenshot of your bet slip</span>
                  <span className={styles.dropSub}>JPG, PNG or HEIC · phone or desktop</span>
                </button>
                <div className={styles.tipBox}>
                  <span className={styles.tipTitle}>For a quick read</span>
                  <ul>
                    <li>Screenshot from <b>My Bets → Settled</b> so the result and date show</li>
                    <li>Make sure the <b>odds, wager and payout</b> are visible</li>
                    <li>Only bets that <b>settled today</b> count (yesterday&apos;s until 10am CT)</li>
                  </ul>
                </div>
              </>
            )}

            {scanStep === 'scanning' && (
              <div className={styles.scanning}>
                {imagePreview && <img src={imagePreview} alt="Your bet slip" className={styles.preview} />}
                <div className={styles.scanLabel}><span className={styles.spinner} /> Reading your slip…</div>
              </div>
            )}

            {scanStep === 'error' && help && (
              <div className={styles.errorState}>
                {imagePreview && <img src={imagePreview} alt="Your bet slip" className={`${styles.preview} ${styles.previewSmall}`} />}
                <div className={styles.helpCard}>
                  <span className={styles.helpTitle}>{help.title}</span>
                  {scanError.message && (scanError.code === 'old_slip' || scanError.code === 'window_closed') && (
                    <span className={styles.helpDetail}>{scanError.message}</span>
                  )}
                  <span className={styles.helpLead}>What to try:</span>
                  <ul className={styles.helpTips}>
                    {help.tips.map((t, i) => <li key={i}>{t}</li>)}
                  </ul>
                </div>
                <div className={styles.formActions}>
                  <button className={styles.primaryBtn} onClick={pickAnother}>Try another screenshot</button>
                  <button className={styles.secondaryBtn} onClick={resetForm}>Close</button>
                </div>
              </div>
            )}

            {scanStep === 'confirm' && (
              <form onSubmit={handleSubmit} className={styles.form}>
                {imagePreview && <img src={imagePreview} alt="Your bet slip" className={`${styles.preview} ${styles.previewSmall}`} />}
                <p className={styles.confirmNote}>We read your slip — check the details, add your handle, and submit.</p>

                <div className={styles.statusSelector}>
                  {['won', 'pending', 'lost'].map(s => (
                    <button key={s} type="button"
                      className={`${styles.statusOption} ${form.betStatus === s ? styles.statusOptionActive : ''} ${styles['statusOption_' + s]}`}
                      onClick={() => setForm(f => ({ ...f, betStatus: s }))}>
                      {STATUS_CONFIG[s].label}
                    </button>
                  ))}
                </div>

                <div className={styles.formGrid}>
                  <div className={`${styles.formField} ${styles.fullWidth}`}>
                    <label htmlFor="f-name">Your X handle</label>
                    <div className={styles.handleInput}>
                      <span>@</span>
                      <input id="f-name" type="text" placeholder="yourhandle" maxLength={30} autoCapitalize="none" autoCorrect="off"
                        value={form.name.replace(/^@+/, '')}
                        onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
                    </div>
                  </div>
                  <div className={styles.formField}>
                    <label htmlFor="f-odds">Odds</label>
                    <input id="f-odds" type="text" placeholder="+450" value={form.odds}
                      onChange={e => setForm(f => ({ ...f, odds: e.target.value }))} />
                  </div>
                  <div className={styles.formField}>
                    <label htmlFor="f-stake">Amount bet ($)</label>
                    <input id="f-stake" type="number" inputMode="decimal" placeholder="50.00" min="0.01" step="0.01" value={form.stake}
                      onChange={e => setForm(f => ({ ...f, stake: e.target.value }))} />
                  </div>
                  <div className={`${styles.formField} ${styles.fullWidth}`}>
                    <label htmlFor="f-payout">{form.betStatus === 'pending' ? 'To win ($)' : form.betStatus === 'lost' ? 'Amount lost ($)' : 'Amount won ($)'}</label>
                    <input id="f-payout" type="number" inputMode="decimal" placeholder="275.00" min="0" step="0.01" value={form.payout}
                      onChange={e => setForm(f => ({ ...f, payout: e.target.value }))} />
                  </div>
                  <div className={`${styles.formField} ${styles.fullWidth}`}>
                    <label htmlFor="f-desc">Bet description</label>
                    <input id="f-desc" type="text" placeholder="Chiefs ML + Over 52.5 parlay" maxLength={80}
                      value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
                  </div>
                </div>

                {form.legs?.length > 1 && (
                  <p className={styles.legsNote}>Parlay · {form.legs.length} legs detected — they&apos;ll show when someone taps your slip.</p>
                )}

                {status.msg && (
                  <p className={`${styles.status} ${styles['status_' + status.type]}`}>{status.msg}</p>
                )}

                <div className={styles.formActions}>
                  <button type="submit" className={styles.primaryBtn} disabled={submitting}>
                    {submitting ? 'Submitting…' : 'Add to leaderboard'}
                  </button>
                  <button type="button" className={styles.secondaryBtn} onClick={resetForm} disabled={submitting}>Cancel</button>
                </div>
              </form>
            )}

            {scanStep === 'done' && (
              <div className={styles.doneState}>
                <span className={styles.doneIcon}>🎉</span>
                <span className={styles.doneTitle}>Your slip is on the board</span>
                <span className={styles.doneSub}>
                  {form.betStatus === 'pending'
                    ? 'Come back when it settles and tap your slip to mark it Won or Lost.'
                    : 'Share it — the top slips get posted on X with your handle tagged.'}
                </span>
                <button className={styles.primaryBtn} onClick={resetForm}>See the board</button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
