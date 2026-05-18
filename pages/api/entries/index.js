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
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function todayDate() {
  return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

const STATUS_CONFIG = {
  won:     { label: 'Won',     emoji: '✅', cls: 'statusWon' },
  lost:    { label: 'Lost',    emoji: '❌', cls: 'statusLost' },
  pending: { label: 'Pending', emoji: '⏳', cls: 'statusPending' },
}

export default function Home() {
  const [entries, setEntries] = useState([])
  const [tab, setTab] = useState('dollars')
  const [loading, setLoading] = useState(true)

  // Scanner state
  const [scanStep, setScanStep] = useState('idle') // idle | scanning | confirm | submitting | success | error
  const [imagePreview, setImagePreview] = useState(null)
  const [imageBase64, setImageBase64] = useState(null)
  const [mediaType, setMediaType] = useState('image/jpeg')
  const [fileName, setFileName] = useState('')
  const [scanResult, setScanResult] = useState(null)
  const [form, setForm] = useState({ name: '', odds: '', stake: '', payout: '', description: '', betStatus: 'won' })
  const [scanError, setScanError] = useState(null)
  const [showModal, setShowModal] = useState(false)

  const [copied, setCopied] = useState(false)
  const [installPrompt, setInstallPrompt] = useState(null)
  const [showInstallBanner, setShowInstallBanner] = useState(false)
  const [isIOS, setIsIOS] = useState(false)
  const fileRef = useRef()

  useEffect(() => {
    fetchEntries()
    const ios = /iphone|ipad|ipod/.test(navigator.userAgent.toLowerCase())
    const standalone = window.navigator.standalone
    if (ios && !standalone) { setIsIOS(true); setShowInstallBanner(true) }
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault()
      setInstallPrompt(e)
      setShowInstallBanner(true)
    })
  }, [])

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
    if (tab === 'dollars') return copy.filter(e => e.bet_status === 'won').sort((a, b) => b.payout - a.payout)
    if (tab === 'odds') return copy.filter(e => e.bet_status === 'won').sort((a, b) => oddsToDecimal(b.odds) - oddsToDecimal(a.odds))
    if (tab === 'pending') return copy.filter(e => e.bet_status === 'pending').sort((a, b) => oddsToDecimal(b.odds) - oddsToDecimal(a.odds))
    return copy
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
      setShowModal(true)
      setScanStep('scanning')
      setScanError(null)
      setScanResult(null)

      try {
        const r = await fetch('/api/read-slip', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageBase64: base64, mediaType: file.type })
        })
        const parsed = await r.json()

        if (parsed.error) throw new Error(parsed.error)

        // Date validation
        if (parsed.date_error) {
          setScanError(parsed.date_error)
          setScanStep('error')
          return
        }

        setScanResult(parsed)
        setForm(f => ({
          ...f,
          odds: parsed.odds || '',
          stake: parsed.stake || '',
          payout: parsed.payout || '',
          description: parsed.description || '',
          betStatus: parsed.bet_status || 'won',
        }))
        setScanStep('confirm')
      } catch (err) {
        setScanError(err.message || 'Could not read slip — try a clearer photo.')
        setScanStep('error')
      }
    }
    reader.readAsDataURL(file)
  }

  async function handleSubmit() {
    if (!form.name) { setScanError('Enter your name or handle.'); return }
    setScanStep('submitting')
    setScanError(null)

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

      const payload = {
        name: form.name,
        odds: form.odds,
        stake: parseFloat(form.stake),
        payout: form.betStatus === 'pending' ? 0 : parseFloat(form.payout),
        description: form.description,
        bet_status: form.betStatus,
        image_url
      }

      const r = await fetch('/api/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error)

      setEntries(prev => [...prev, data.entry])
      setScanStep('success')
      setTimeout(resetScanner, 2000)
    } catch (err) {
      setScanError('Submission failed: ' + err.message)
      setScanStep('confirm')
    }
  }

  async function handleUpdateStatus(entry, newStatus) {
    try {
      const r = await fetch(`/api/entries/${entry.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bet_status: newStatus })
      })
      if (!r.ok) throw new Error('Update failed')
      setEntries(prev => prev.map(e => e.id === entry.id ? { ...e, bet_status: newStatus } : e))
    } catch (err) {
      alert('Could not update: ' + err.message)
    }
  }

  function resetScanner() {
    setScanStep('idle')
    setShowModal(false)
    setImagePreview(null)
    setImageBase64(null)
    setScanResult(null)
    setScanError(null)
    setForm({ name: '', odds: '', stake: '', payout: '', description: '', betStatus: 'won' })
    if (fileRef.current) fileRef.current.value = ''
  }

  function buildXPost() {
    const wonEntries = entries.filter(e => e.bet_status === 'won')
    const pendingEntries = entries.filter(e => e.bet_status === 'pending')
    const dollarTop = [...wonEntries].sort((a, b) => b.payout - a.payout).slice(0, 3)
    const oddsTop = [...wonEntries].sort((a, b) => oddsToDecimal(b.odds) - oddsToDecimal(a.odds)).slice(0, 3)
    const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    let post = `💰 DAILYSLIPS LEADERBOARD — ${dateStr}\n\n`
    post += `🏆 TOP $ WON\n`
    dollarTop.forEach((e, i) => { post += `${i + 1}. ${e.name} — ${formatMoney(e.payout)} (${e.odds})\n` })
    post += `\n🎲 LONGEST ODDS HIT\n`
    oddsTop.forEach((e, i) => { post += `${i + 1}. ${e.name} — ${e.odds} · ${formatMoney(e.payout)}\n` })
    if (pendingEntries.length > 0) {
      post += `\n🔥 STILL PENDING\n`
      pendingEntries.slice(0, 3).forEach((e, i) => { post += `${i + 1}. ${e.name} — ${e.odds} (${e.description})\n` })
    }
    post += `\ndailyslips.app  #SportsBetting #DailySlips`
    return post
  }

  async function handleInstall() {
    if (installPrompt) {
      installPrompt.prompt()
      const { outcome } = await installPrompt.userChoice
      if (outcome === 'accepted') setShowInstallBanner(false)
    } else {
      setShowInstallBanner(false)
    }
  }

  async function copyXPost() {
    await navigator.clipboard.writeText(buildXPost())
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const sorted = sortedEntries()
  const pendingCount = entries.filter(e => e.bet_status === 'pending').length

  return (
    <>
      <Head>
        <title>DailySlips — Daily Bet Leaderboard</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </Head>

      <div className={styles.container}>
        <header className={styles.header}>
          <div className={styles.headerLeft}>
            <h1 className={styles.logo}>DailySlips</h1>
            <span className={styles.date}>{todayDate()}</span>
          </div>
          <button className={styles.submitBtn} onClick={() => { setShowModal(true); setTimeout(() => fileRef.current?.click(), 100) }}>
            + Submit Slip
          </button>
        </header>

        {showInstallBanner && (
          <div className={styles.installBanner}>
            <span className={styles.installIcon}>📲</span>
            <div className={styles.installText}>
              <span className={styles.installTitle}>Add to Home Screen</span>
              <span className={styles.installSub}>
                {isIOS ? 'Tap Share → "Add to Home Screen"' : 'Install DailySlips as an app'}
              </span>
            </div>
            {!isIOS && <button className={styles.installBtn} onClick={handleInstall}>Install</button>}
            <button className={styles.installClose} onClick={() => setShowInstallBanner(false)}>✕</button>
          </div>
        )}

        <div className={styles.tabs}>
          <button className={`${styles.tab} ${tab === 'dollars' ? styles.tabActive : ''}`} onClick={() => setTab('dollars')}>💰 Top $ Won</button>
          <button className={`${styles.tab} ${tab === 'odds' ? styles.tabActive : ''}`} onClick={() => setTab('odds')}>🎲 Longest Odds</button>
          <button className={`${styles.tab} ${tab === 'pending' ? styles.tabActive : ''}`} onClick={() => setTab('pending')}>
            🔥 Pending {pendingCount > 0 && <span className={styles.pendingCount}>{pendingCount}</span>}
          </button>
        </div>

        <div className={styles.board}>
          {loading ? (
            <div className={styles.empty}>Loading today&apos;s board...</div>
          ) : sorted.length === 0 ? (
            <div className={styles.empty}>
              <span className={styles.emptyIcon}>{tab === 'pending' ? '⏳' : '🎫'}</span>
              <span>{tab === 'pending' ? 'No pending slips right now' : 'No slips yet today — be the first!'}</span>
            </div>
          ) : (
            sorted.slice(0, 10).map((entry, i) => {
              const sc = STATUS_CONFIG[entry.bet_status] || STATUS_CONFIG.won
              const isPending = entry.bet_status === 'pending'
              return (
                <div key={entry.id} className={`${styles.entry} ${i === 0 && !isPending ? styles.rank1 : i === 1 && !isPending ? styles.rank2 : ''} ${isPending ? styles.entryPending : ''}`}>
                  <span className={styles.rank}>{isPending ? sc.emoji : i + 1}</span>
                  <div className={styles.entryInfo}>
                    <div className={styles.entryNameRow}>
                      <span className={styles.entryName}>{entry.name}</span>
                      <span className={`${styles.statusBadge} ${styles[sc.cls]}`}>{sc.label}</span>
                    </div>
                    <span className={styles.entryDesc}>{entry.description}</span>
                  </div>
                  <div className={styles.entryMeta}>
                    {isPending ? (
                      <>
                        <span className={styles.mainVal}>{entry.odds}</span>
                        <span className={styles.subVal}>staked {formatMoney(entry.stake)}</span>
                        <div className={styles.updateBtns}>
                          <button className={styles.wonBtn} onClick={() => handleUpdateStatus(entry, 'won')}>✅</button>
                          <button className={styles.lostBtn} onClick={() => handleUpdateStatus(entry, 'lost')}>❌</button>
                        </div>
                      </>
                    ) : (
                      <>
                        <span className={styles.mainVal}>
                          {tab === 'dollars' ? <span className={styles.green}>{formatMoney(entry.payout)}</span> : entry.odds}
                        </span>
                        <span className={styles.subVal}>
                          {tab === 'dollars' ? `staked ${formatMoney(entry.stake)}` : `won ${formatMoney(entry.payout)}`}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>

        {entries.length > 0 && (
          <div className={styles.xpost}>
            <div className={styles.xpostLabel}>𝕏 Today&apos;s post preview</div>
            <pre className={styles.xpostText}>{buildXPost()}</pre>
          </div>
        )}

        <input type="file" accept="image/*,.heic,.heif" ref={fileRef} style={{ display: 'none' }} onChange={handleFile} />

        {/* SCANNER MODAL */}
        {showModal && (
          <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && resetScanner()}>
            <div className={styles.modal}>
              <div className={styles.modalHeader}>
                <h2 className={styles.modalTitle}>Submit Your Slip</h2>
                <button className={styles.closeBtn} onClick={resetScanner}>✕</button>
              </div>

              {/* IDLE — show upload prompt */}
              {scanStep === 'idle' && (
                <div className={styles.dropzone} onClick={() => fileRef.current?.click()}>
                  <span className={styles.dropIcon}>📸</span>
                  <p>Tap to upload your bet slip</p>
                  <p className={styles.dropSub}>JPG, PNG, HEIC supported</p>
                </div>
              )}

              {/* SCANNING */}
              {scanStep === 'scanning' && (
                <div className={styles.scanningState}>
                  {imagePreview && <img src={imagePreview} alt="Bet slip" className={styles.preview} />}
                  <div className={styles.scanningLabel}>
                    <div className={styles.scanSpinner} />
                    <span>Reading your slip with AI...</span>
                  </div>
                </div>
              )}

              {/* ERROR */}
              {scanStep === 'error' && (
                <div className={styles.scanErrorState}>
                  {imagePreview && <img src={imagePreview} alt="Bet slip" className={styles.preview} />}
                  <div className={styles.scanErrorMsg}>⚠️ {scanError}</div>
                  <button className={styles.retryBtn} onClick={() => { setScanStep('idle'); setImagePreview(null); setImageBase64(null); if (fileRef.current) fileRef.current.value = '' }}>
                    Try Another Slip
                  </button>
                </div>
              )}

              {/* CONFIRM */}
              {scanStep === 'confirm' && (
                <div className={styles.confirmState}>
                  {imagePreview && <img src={imagePreview} alt="Bet slip" className={styles.preview} />}

                  {scanResult?.sportsbook && (
                    <div className={styles.sportsbookTag}>{scanResult.sportsbook}</div>
                  )}

                  <div className={styles.formGrid}>
                    <div className={styles.formField}>
                      <label>Your name / X handle</label>
                      <input type="text" placeholder="@KyleJoy18" maxLength={30} value={form.name}
                        onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
                    </div>
                    <div className={styles.formField}>
                      <label>Odds</label>
                      <input type="text" value={form.odds}
                        onChange={e => setForm(f => ({ ...f, odds: e.target.value }))} />
                    </div>
                    <div className={styles.formField}>
                      <label>Stake ($)</label>
                      <input type="number" value={form.stake}
                        onChange={e => setForm(f => ({ ...f, stake: e.target.value }))} />
                    </div>
                    {form.betStatus !== 'pending' && (
                      <div className={styles.formField}>
                        <label>Payout ($)</label>
                        <input type="number" value={form.payout}
                          onChange={e => setForm(f => ({ ...f, payout: e.target.value }))} />
                      </div>
                    )}
                    <div className={`${styles.formField} ${styles.fullWidth}`}>
                      <label>Bet description</label>
                      <input type="text" maxLength={80} value={form.description}
                        onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
                    </div>
                  </div>

                  <div className={styles.statusSelector}>
                    {['won', 'pending', 'lost'].map(s => (
                      <button key={s} type="button"
                        className={`${styles.statusOption} ${form.betStatus === s ? styles.statusOptionActive : ''} ${styles['statusOption_' + s]}`}
                        onClick={() => setForm(f => ({ ...f, betStatus: s }))}>
                        {STATUS_CONFIG[s].emoji} {STATUS_CONFIG[s].label}
                      </button>
                    ))}
                  </div>

                  {scanError && <p className={styles.scanErrorMsg}>{scanError}</p>}

                  <div className={styles.formActions}>
                    <button className={styles.primaryBtn} onClick={handleSubmit}>
                      Add to leaderboard
                    </button>
                    <button className={styles.secondaryBtn} onClick={resetScanner}>Cancel</button>
                  </div>
                </div>
              )}

              {/* SUBMITTING */}
              {scanStep === 'submitting' && (
                <div className={styles.scanningState}>
                  {imagePreview && <img src={imagePreview} alt="Bet slip" className={styles.preview} />}
                  <div className={styles.scanningLabel}>
                    <div className={styles.scanSpinner} />
                    <span>Adding to leaderboard...</span>
                  </div>
                </div>
              )}

              {/* SUCCESS */}
              {scanStep === 'success' && (
                <div className={styles.successState}>
                  <div className={styles.successIcon}>🎉</div>
                  <div className={styles.successMsg}>Added to the leaderboard!</div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  )
}
