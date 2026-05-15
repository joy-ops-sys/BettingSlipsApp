# DailySlips.app

Daily sports bet leaderboard — biggest wins and longest odds. Users upload bet slip images, AI reads them automatically, and the best slips rise to the top.

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Create your environment file
Copy `.env.local.template` to `.env.local` and fill in your keys:
```bash
cp .env.local.template .env.local
```

Edit `.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=https://xgtzayqdhfbgeeycqved.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your_publishable_key
SUPABASE_SECRET_KEY=your_secret_key
ANTHROPIC_API_KEY=your_anthropic_key
```

### 3. Set up the database
- Go to your Supabase project
- Click **SQL Editor**
- Paste the contents of `supabase/schema.sql` and click **Run**

### 4. Run locally
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000)

### 5. Deploy to Vercel
- Push this code to your GitHub repo (BettingSlipsApp)
- Go to your Vercel project dashboard
- Go to **Settings → Environment Variables**
- Add all four variables from your `.env.local`
- Redeploy

## Features
- 📸 Bet slip image upload with AI auto-extraction
- 🏆 Two leaderboards: Top $ Won and Longest Odds
- 📱 Installable PWA (Add to Home Screen on iPhone/Android)
- 𝕏 Daily X post preview — copy and post in one click
- 🔄 Daily reset — fresh leaderboard every day

## Stack
- Next.js 14
- Supabase (database + image storage)
- Anthropic Claude API (slip reading)
- Vercel (hosting)
