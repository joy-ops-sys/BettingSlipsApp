// Shared leaderboard helpers — used by the page (pages/index.js)
// and the API (pages/api/board-post.js) so the X post is built the same way everywhere.

export function oddsToDecimal(oddsStr) {
  const n = parseFloat(oddsStr)
  if (isNaN(n)) return 0
  if (n > 0) return (n / 100) + 1
  if (n < 0) return (100 / Math.abs(n)) + 1
  return 1
}

export function formatMoney(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function formatName(name) {
  if (!name) return ''
  return '@' + String(name).trim().replace(/^@+/, '')
}

// Today's date in Chicago time as YYYY-MM-DD
export function chicagoToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
}

// Shift a YYYY-MM-DD string by n days
export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// "Nov 18" style label for a YYYY-MM-DD string
export function shortDate(dateStr) {
  return new Date(dateStr + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

// "Wed, Nov 18" style label
export function longDate(dateStr) {
  return new Date(dateStr + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

// Builds the X post for one day's board. Always returns a post —
// when nothing was submitted it returns the "blank board / no slips" version.
export function buildBoardPost(entries, dateStr) {
  const list = Array.isArray(entries) ? entries : []
  const won = list.filter(e => e.bet_status === 'won')
  const pending = list.filter(e => e.bet_status === 'pending')
  const dollarTop = [...won].sort((a, b) => Number(b.payout) - Number(a.payout)).slice(0, 3)
  const oddsTop = [...won].sort((a, b) => oddsToDecimal(b.odds) - oddsToDecimal(a.odds)).slice(0, 3)
  const desc = e => (e.description ? ' · ' + e.description : '')

  let post = `💰 DAILYSLIPS — ${shortDate(dateStr)}\n\n`

  if (list.length === 0) {
    post += `🏆 TOP $ WON\n— No slips submitted\n\n`
    post += `🎲 LONGEST ODDS HIT\n— No slips submitted\n\n`
    post += `The board was wide open 👀 Cash a ticket, upload the slip, take the #1 spot.\n`
    post += `\ndailyslips.app #DailySlips #SportsBetting`
    return post
  }

  post += `🏆 TOP $ WON\n`
  if (dollarTop.length === 0) post += `— No winning slips yet\n`
  dollarTop.forEach((e, i) => {
    post += `${i + 1}. ${formatName(e.name)} — ${formatMoney(e.payout)} (${e.odds})${desc(e)}\n`
  })

  post += `\n🎲 LONGEST ODDS HIT\n`
  if (oddsTop.length === 0) post += `— No winning slips yet\n`
  oddsTop.forEach((e, i) => {
    post += `${i + 1}. ${formatName(e.name)} — ${e.odds} · ${formatMoney(e.payout)}${desc(e)}\n`
  })

  if (pending.length > 0) {
    post += `\n🔥 STILL PENDING\n`
    pending.slice(0, 3).forEach((e, i) => {
      post += `${i + 1}. ${formatName(e.name)} — ${e.odds}${desc(e)}\n`
    })
  }

  post += `\ndailyslips.app #DailySlips #SportsBetting`
  return post
}
