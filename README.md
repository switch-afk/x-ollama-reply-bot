# 🤖 X (Twitter) Auto Reply Bot

An intelligent auto-reply bot that monitors tweets from your followings and generates contextual replies using **Ollama LLaMA2** locally. Built with [twitterapi.io](https://twitterapi.io) for Twitter interactions.

## ✨ Features

- **Smart Pattern Matching** — Instant replies for common tweet types (no LLM needed):
  - `GM` / `Good Morning` → `GM {Name} 🌅`
  - `GN` / `Good Night` → `GN {Name} 🌙`
  - `GE` / `Good Evening` → `GE {Name} 🌆`
  - `GA` / `Good Afternoon` → `GA {Name} ☀️`
  - `Who's active?` / `Roll call` → `Right here 🙋`
  - `Follow train` / `Let's connect` → `Let's connect 🤝`
  - `LFG` / `Bullish` → `LFG 🚀`
  - And more...

- **Context-Aware LLM Replies** — For regular tweets, uses Ollama to generate relevant replies that actually reference the tweet content
- **Crypto Detection** — Only talks crypto/Solana when the tweet is about crypto
- **Proxy Rotation** — Rotates through multiple proxies on 226 blocks
- **Auto Re-Login** — Automatically re-authenticates when cookies expire
- **Smart Filtering** — Skips retweets, image-only tweets, and old tweets (>3 hours)
- **Activity Dashboard** — Web UI to monitor all bot activity
- **Random Delays** — 30-60s between replies, 5-10min between scans (looks human)

## 📐 Architecture

```
┌──────────────────────────────────────────────────────────┐
│                     SCAN CYCLE (5-10 min)                │
│                                                          │
│  1. Get Followings  ──→  twitterapi.io /user/followings  │
│  2. Get Tweets      ──→  twitterapi.io /tweet_timeline   │
│  3. Pattern Match?  ──→  Instant reply (GM/GN/connect)   │
│     └─ No match     ──→  Ollama LLaMA2 generates reply   │
│  4. Post Reply      ──→  twitterapi.io /create_tweet_v2  │
│                                                          │
│  ┌────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  ollama.js │  │  twitter.js  │  │    store.js      │  │
│  │  patterns  │  │  API client  │  │  replied tracker │  │
│  │  + LLM     │  │  + proxy rot │  │  + activity log  │  │
│  └────────────┘  └──────────────┘  └──────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

## 🛠️ Prerequisites

- **Node.js** 18+
- **Ollama** — [Install](https://ollama.ai)
- **LLaMA2** model — `ollama pull llama2`
- **twitterapi.io** API key — [Get one](https://twitterapi.io)
- **Proxy** — Residential recommended (datacenter may get 226'd)
- **Twitter/X 2FA** — Strongly recommended for reliable login

## 🚀 Setup

### 1. Clone & Install

```bash
git clone https://github.com/switch-afk/x-ollama-reply-bot.git
cd x-ollama-reply-bot
npm install
```

### 2. Configure

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

| Variable | Description |
|---|---|
| `TWITTER_API_KEY` | Your twitterapi.io API key |
| `TWITTER_USERNAME` | Your X handle (no @) |
| `TWITTER_EMAIL` | Account email |
| `TWITTER_PASSWORD` | Account password |
| `TWITTER_TOTP_SECRET` | 2FA secret (Twitter shows this when you click "can't scan QR code") |
| `PROXY` | Primary proxy `http://user:pass@ip:port` |
| `PROXY_LIST` | Comma-separated proxy list for rotation |
| `OLLAMA_MODEL` | Ollama model (default: `llama2`, try `llama3` or `mistral`) |

### 3. Start Ollama

```bash
ollama serve
ollama pull llama2
```

### 4. Run

```bash
# Dry run (generates replies but doesn't post)
DRY_RUN=true node src/index.js

# Live
node src/index.js

# Dashboard (separate terminal)
node src/dashboard.js
# → http://localhost:3000
```

## 🎯 How It Works

1. **Fetches your followings** via twitterapi.io
2. **Scans each user's tweets** (all tweets, no per-user limit)
3. **Filters**: skips retweets, image-only tweets, tweets older than 3 hours, already-replied tweets
4. **Pattern matching first**: checks for GM/GN/GE/GA, who's active, follow trains, LFG etc. — replies instantly without LLM
5. **LLM for everything else**: sends tweet to Ollama with context-aware prompt. Crypto tweets get crypto replies, non-crypto tweets get normal replies
6. **Posts reply** via twitterapi.io with proxy rotation
7. **Waits 30-60s** (random), then next tweet
8. **Repeats cycle** every 5-10 minutes (random)

## 🔄 Auto Re-Login

If the bot detects an auth error (expired cookie, 401, 403), it automatically:
1. Re-logs in using credentials from `.env`
2. Saves new cookie to `.env`
3. Retries the failed post
4. Continues normally

No manual intervention needed.

## 📊 Dashboard

Run `node src/dashboard.js` and open `http://localhost:3000` to see:
- Total replies sent
- Errors & dry runs
- Unique users engaged
- Full activity feed with tweet text + reply text

## 🖥️ PM2 Deployment

```bash
pm2 start src/index.js --name "reply-bot"
pm2 start src/dashboard.js --name "reply-dash"
pm2 save
pm2 startup
```

## 💰 Cost Estimate (twitterapi.io)

Per scan cycle (depends on number of followings):
- Followings fetch: ~$0.0003
- Tweet timeline per user: ~$0.00015 each
- Reply post: ~$0.003 each

~**$0.01–0.10 per cycle** depending on reply volume.

## ⚙️ Tuning

### Better Reply Quality
```bash
# Use a better model
ollama pull llama3
# In .env: OLLAMA_MODEL=llama3
```

### Customize Patterns
Edit the `PATTERNS` array in `src/ollama.js` to add/modify instant reply patterns.

### Customize LLM Personality
Edit the `systemPrompt` in `src/ollama.js` → `generateReply()` method.

## 📁 Project Structure

```
├── src/
│   ├── index.js       # Main bot loop — scan, reply, repeat
│   ├── twitter.js      # twitterapi.io client — auth, tweets, posting
│   ├── ollama.js       # Pattern matching + LLM reply generation
│   ├── store.js        # JSON storage — replied tweets + activity log
│   ├── login.js        # Standalone login script
│   └── dashboard.js    # Express web dashboard
├── data/               # Auto-created — replied.json, activity.json
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

## ⚠️ Disclaimer

This bot is for educational purposes. Use responsibly and in compliance with Twitter/X's Terms of Service. Excessive automated activity may result in account restrictions.

## 📝 License

MIT