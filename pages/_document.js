import { Html, Head, Main, NextScript } from 'next/document'

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <meta charSet="utf-8" />
        <meta name="application-name" content="DailySlips" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="DailySlips" />
        <meta name="description" content="Daily sports bet leaderboard — biggest wins and longest odds" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="theme-color" content="#0a0a0a" />

        {/* Link previews on X, iMessage, Discord, etc. */}
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="DailySlips" />
        <meta property="og:url" content="https://dailyslips.app" />
        <meta property="og:title" content="DailySlips — Daily Bet Leaderboard" />
        <meta property="og:description" content="Cash a ticket, post the slip, top the board. AI reads your bet slip screenshot in seconds." />
        <meta property="og:image" content="https://dailyslips.app/og.png" />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="DailySlips — Daily Bet Leaderboard" />
        <meta name="twitter:description" content="Cash a ticket, post the slip, top the board. AI reads your bet slip screenshot in seconds." />
        <meta name="twitter:image" content="https://dailyslips.app/og.png" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  )
}
