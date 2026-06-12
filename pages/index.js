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
  const todayValue = new Date().toLocaleDateString('en-CA')
  const [selectedDate, setSelectedDate] = useState(todayValue)
  const [showForm, setShowForm] = useState(false)
  const [imagePreview, setImagePreview] = useState(null)
  const [imageBase64, setImageBase64] = useState(null)
  const [mediaType, setMediaType] = useState('image/jpeg')
  const [fileName, setFileName] = useState('')
  const [form, setForm] = useState({ name: '', odds: '', stake: '', payout: '', description: '', betStatus: 'won', legs: [] })
  const [status, setStatus] = useState({ msg: '', type: '' })
  const [submitting, setSubmitting] = useState(false)
  const [aiReading, setAiReading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [installPrompt, setInstallPrompt] = useState(null)
  const [showInstallBanner, setShowInstallBanner] = useState(false)
  const [isIOS, setIsIOS] = useState(false)
  const [scanStep, setScanStep] = useState('idle')
  const [scanError, setScanError] = useState(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [adminPin, setAdminPin] = useState('')
  const [adminError, setAdminError] = useState('')
  const [expandedEntry, setExpandedEntry] = useState(null)
  const fileRef = useRef()

  const ADMIN_PIN = '5757'

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

  async function fetchEntries(date = '') {
    setLoading(true)
    try {
      const url = date ? `/api/entries?date=${date}` : '/api/entries'
      const r = await fetch(url)
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
      setShowForm(true)
      setScanStep('scanning')
      setScanError(null)
      setAiReading(true)
      setStatus({ msg: 'Reading your slip with AI...', type: 'info' })
      try {
        const r = await fetch('/api/read-slip', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageBase64: base64,
            mediaType: file.type,
            clientDate: new Date().toLocaleDateString('en-CA')
          })
        })
        const parsed = await r.json()

        if (parsed.error) throw new Error(parsed.error)

        if (parsed.date_error) {
          setScanError(parsed.date_error)
          setScanStep('error')
          setStatus({ msg: '', type: '' })
          setAiReading(false)
          return
        }

        setForm(f => ({
          ...f,
          odds: parsed.odds || '',
          stake: parsed.stake || '',
          payout: parsed.payout || '',
          description: parsed.description || '',
          betStatus: parsed.bet_status || 'won',
          legs: parsed.legs || [],
        }))
        setScanStep('confirm')
        setStatus({ msg: 'Slip read — verify the fields below then submit.', type: 'ok' })
      } catch (err) {
        setScanStep('error')
        setScanError(err.message || 'Could not read slip — try a clearer photo.')
        setStatus({ msg: '', type: '' })
      }
      setAiReading(false)
    }
    reader.readAsDataURL(file)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.name) return setStatus({ msg: 'Enter a name or handle.', type: 'err' })
    if (!form.odds) return setStatus({ msg: 'Enter the odds.', type: 'err' })
    if (!form.stake || isNaN(parseFloat(form.stake)) || parseFloat(form.stake) <= 0) return setStatus({ msg: 'Enter a valid stake amount.', type: 'err' })
    if (form.betStatus !== 'pending' && (!form.payout || isNaN(parseFloat(form.payout)))) return setStatus({ msg: 'Enter a valid payout amount.', type: 'err' })
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

      const payload = {
        name: form.name,
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
        body: JSON.stringify(payload)
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error)

      setEntries(prev => [...prev, data.entry])
      setStatus({ msg: 'Added to the leaderboard! 🎉', type: 'ok' })
      setTimeout(resetForm, 1500)
    } catch (err) {
      setStatus({ msg: 'Error: ' + err.message, type: 'err' })
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
        body: JSON.stringify(body)
      })
      if (!r.ok) throw new Error('Update failed')
      const data = await r.json()
      setEntries(prev => prev.map(e => e.id === entry.id ? { ...e, bet_status: newStatus, payout: data.entry?.payout ?? e.payout } : e))
    } catch (err) {
      alert('Could not update: ' + err.message)
    }
  }

  function checkAdmin() {
    if (adminPin === ADMIN_PIN) {
      setIsAdmin(true)
      setAdminError('')
      setAdminPin('')
    } else {
      setAdminError('Incorrect PIN')
      setAdminPin('')
    }
  }

  function resetForm() {
    setShowForm(false)
    setImagePreview(null)
    setImageBase64(null)
    setScanStep('idle')
    setScanError(null)
    setForm({ name: '', odds: '', stake: '', payout: '', description: '', betStatus: 'won', legs: [] })
    setStatus({ msg: '', type: '' })
    if (fileRef.current) fileRef.current.value = ''
  }

  function formatName(name) {
    if (!name) return ''
    const clean = name.replace(/^@/, '')
    return `@${clean}`
  }

  function buildXPost() {
    const wonEntries = entries.filter(e => e.bet_status === 'won')
    const pendingEntries = entries.filter(e => e.bet_status === 'pending')
    const dollarTop = [...wonEntries].sort((a, b) => b.payout - a.payout).slice(0, 3)
    const oddsTop = [...wonEntries].sort((a, b) => oddsToDecimal(b.odds) - oddsToDecimal(a.odds)).slice(0, 3)

    const dateObj = new Date(selectedDate + 'T12:00:00')
    const dateStr = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

    let post = `💰 DAILYSLIPS — ${dateStr}\n\n`
    post += `🏆 TOP $ WON\n`
    dollarTop.forEach((e, i) => {
      post += `${i + 1}. ${formatName(e.name)} — ${formatMoney(e.payout)} (${e.odds})${e.description ? ' · ' + e.description : ''}\n`
    })
    post += `\n🎲 LONGEST ODDS HIT\n`
    oddsTop.forEach((e, i) => {
      post += `${i + 1}. ${formatName(e.name)} — ${e.odds} · ${formatMoney(e.payout)}${e.description ? ' · ' + e.description : ''}\n`
    })
    if (pendingEntries.length > 0) {
      post += `\n🔥 STILL PENDING\n`
      pendingEntries.slice(0, 3).forEach((e, i) => {
        post += `${i + 1}. ${formatName(e.name)} — ${e.odds}${e.description ? ' · ' + e.description : ''}\n`
      })
    }
    post += `\ndailyslips.app #DailySlips #SportsBetting`
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
          <button className={styles.submitBtn} onClick={() => { setShowForm(true); setTimeout(() => fileRef.current?.click(), 100) }}>
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

        <div className={styles.datePicker}>
          <input
            type="date"
            className={styles.dateInput}
            value={selectedDate}
            max={todayValue}
            onChange={e => {
              setSelectedDate(e.target.value)
              fetchEntries(e.target.value !== todayValue ? e.target.value : '')
            }}
          />
          {selectedDate !== todayValue && (
            <button className={styles.dateClear} onClick={() => { setSelectedDate(todayValue); fetchEntries('') }}>
              Today
            </button>
          )}
        </div>

        <div className={styles.tabs}>
          <button className={`${styles.tab} ${tab === 'dollars' ? styles.tabActive : ''}`} onClick={() => setTab('dollars')}>💰 Top $ Won</button>
          <button className={`${styles.tab} ${tab === 'odds' ? styles.tabActive : ''}`} onClick={() => setTab('odds')}>🎲 Longest Odds</button>
          <button className={`${styles.tab} ${tab === 'pending' ? styles.tabActive : ''}`} onClick={() => setTab('pending')}>
            🔥 Pending {pendingCount > 0 && <span className={styles.pendingCount}>{pendingCount}</span>}
          </button>
        </div>

        <div className={styles.board}>
          {loading ? (
            <div className={styles.empty}>Loading{selectedDate !== todayValue ? ` ${new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ' today'}&apos;s board...</div>
          ) : sorted.length === 0 ? (
            <div className={styles.empty}>
              <span className={styles.emptyIcon}>{tab === 'pending' ? '⏳' : '🎫'}</span>
              <span>{tab === 'pending' ? 'No pending slips' : `No slips${selectedDate !== todayValue ? ` for ${new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ' yet today — be the first!'}`}</span>
            </div>
          ) : (
            sorted.slice(0, 10).map((entry, i) => {
              const sc = STATUS_CONFIG[entry.bet_status] || STATUS_CONFIG.won
              const isPending = entry.bet_status === 'pending'
              const isExpanded = expandedEntry === entry.id
              return (
                <div key={entry.id}>
                  <div
                    className={`${styles.entry} ${i === 0 && !isPending ? styles.rank1 : i === 1 && !isPending ? styles.rank2 : ''} ${isPending ? styles.entryPending : ''} ${isExpanded ? styles.entryExpanded0 : ''}`}
                    onClick={() => setExpandedEntry(isExpanded ? null : entry.id)}
                    style={{ cursor: 'pointer' }}
                  >
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
                            <button className={styles.wonBtn} onClick={e => { e.stopPropagation(); handleUpdateStatus(entry, 'won') }}>✅</button>
                            <button className={styles.lostBtn} onClick={e => { e.stopPropagation(); handleUpdateStatus(entry, 'lost') }}>❌</button>
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

                  {isExpanded && (
                    <div className={styles.entryExpanded}>
                      {entry.legs && entry.legs.length > 0 ? (
                        <>
                          <div className={styles.legsTitle}>
                            {entry.legs.length === 1 ? 'Bet Details' : `Parlay — ${entry.legs.length} Legs`}
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
                                  {legSc && <span className={styles.legStatus}>{legSc.emoji}</span>}
                                </div>
                              </div>
                            )
                          })}
                        </>
                      ) : (
                        <div className={styles.legsTitle}>
                          {entry.description}<br />
                          <span style={{ color: '#555', fontSize: '11px' }}>Odds: {entry.odds} · Stake: {formatMoney(entry.stake)}</span>
                        </div>
                      )}
                      {entry.image_url && (
                        <a href={entry.image_url} target="_blank" rel="noopener noreferrer" className={styles.viewSlipBtn}>
                          View Slip 🎫
                        </a>
                      )}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>

        {isAdmin && (
          <div className={styles.xpost}>
            <div className={styles.xpostLabel}>
              𝕏 {selectedDate !== todayValue
                ? `${new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} post`
                : "Today's post preview"}
            </div>
            {entries.length > 0 ? (
              <>
                <pre className={styles.xpostText}>{buildXPost()}</pre>
                <div className={styles.xpostActions}>
                  <button className={styles.copyBtn} onClick={copyXPost}>
                    {copied ? '✅ Copied!' : '📋 Copy Post'}
                  </button>
                  <a className={styles.postBtn} href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(buildXPost())}`} target="_blank" rel="noopener noreferrer">𝕏 Open in X</a>
                </div>
              </>
            ) : (
              <div className={styles.xpostEmpty}>No entries to post yet</div>
            )}
          </div>
        )}

        <div className={styles.adminWrap}>
          {!isAdmin ? (
            <div className={styles.adminRow}>
              <input className={styles.adminInput} type="password" placeholder="Admin PIN" value={adminPin} onChange={e => setAdminPin(e.target.value)} onKeyDown={e => e.key === 'Enter' && checkAdmin()} />
              <button className={styles.adminBtn} onClick={checkAdmin}>Enter</button>
            </div>
          ) : (
            <button className={styles.adminSignOut} onClick={() => { setIsAdmin(false); setAdminPin('') }}>Sign out of admin</button>
          )}
          {adminError && <p className={styles.adminError}>{adminError}</p>}
        </div>

        <input type="file" accept="image/*,.heic,.heif" ref={fileRef} style={{ display: 'none' }} onChange={handleFile} />

        {showForm && (
          <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && resetForm()}>
            <div className={styles.modal}>
              <div className={styles.modalHeader}>
                <h2 className={styles.modalTitle}>Submit Your Slip</h2>
                <button className={styles.closeBtn} onClick={resetForm}>✕</button>
              </div>

              {scanStep === 'scanning' && (
                <>
                  {imagePreview && <img src={imagePreview} alt="Bet slip" className={styles.preview} />}
                  <p className={styles.aiStatus}>🤖 Reading your slip with AI...</p>
                </>
              )}

              {scanStep === 'error' && (
                <>
                  {imagePreview && <img src={imagePreview} alt="Bet slip" className={styles.preview} />}
                  <p className={styles.aiStatus} style={{ color: '#e05c5c' }}>⚠️ {scanError}</p>
                  <button className={styles.secondaryBtn} style={{ marginBottom: '12px' }} onClick={() => { setScanStep('idle'); setImagePreview(null); setImageBase64(null); if (fileRef.current) fileRef.current.value = ''; setTimeout(() => fileRef.current?.click(), 100) }}>
                    Try Another Slip
                  </button>
                </>
              )}

              {scanStep === 'idle' && !imagePreview && (
                <div className={styles.dropzone} onClick={() => fileRef.current?.click()}>
                  <span className={styles.dropIcon}>📸</span>
                  <p>Tap to upload your bet slip image</p>
                  <p className={styles.dropSub}>JPG, PNG, HEIC supported</p>
                </div>
              )}

              {(scanStep === 'confirm' || (imagePreview && scanStep !== 'scanning' && scanStep !== 'error')) && (
                <form onSubmit={handleSubmit} className={styles.form}>
                  {imagePreview && scanStep !== 'scanning' && <img src={imagePreview} alt="Bet slip" className={styles.preview} />}

                  <div className={styles.statusSelector}>
                    {['won', 'pending', 'lost'].map(s => (
                      <button key={s} type="button"
                        className={`${styles.statusOption} ${form.betStatus === s ? styles.statusOptionActive : ''} ${styles['statusOption_' + s]}`}
                        onClick={() => setForm(f => ({ ...f, betStatus: s }))}>
                        {STATUS_CONFIG[s].emoji} {STATUS_CONFIG[s].label}
                      </button>
                    ))}
                  </div>

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
                      <input type="number" placeholder="50.00" min="0.01" step="0.01" value={form.stake}
                        onChange={e => setForm(f => ({ ...f, stake: e.target.value }))} />
                    </div>
                    {form.betStatus !== 'pending' && (
                      <div className={styles.formField}>
                        <label>Amount {form.betStatus === 'lost' ? 'lost' : 'won'} ($)</label>
                        <input type="number" placeholder="275.00" min="0" step="0.01" value={form.payout}
                          onChange={e => setForm(f => ({ ...f, payout: e.target.value }))} />
                      </div>
                    )}
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
              )}
            </div>
          </div>
        )}
      </div>
    </>
  )
}
