import "dotenv/config";
import express from "express";
import { getActivityLog } from "./store.js";

const PORT = process.env.DASHBOARD_PORT || 3000;
const app = express();

app.get("/api/activity", (req, res) => {
  const log = getActivityLog();
  res.json(log.reverse());
});

app.get("/", (req, res) => {
  res.send(/* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Reply Bot — Dashboard</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;800&family=Outfit:wght@400;600;800&display=swap');
    
    * { margin: 0; padding: 0; box-sizing: border-box; }
    
    :root {
      --bg: #0a0a0f;
      --card: #12121a;
      --border: #1e1e2e;
      --text: #e0e0e8;
      --dim: #6b6b80;
      --accent: #7c5cfc;
      --green: #22c55e;
      --red: #ef4444;
      --yellow: #eab308;
    }
    
    body {
      font-family: 'Outfit', sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
    }
    
    .header {
      padding: 2rem 2rem 1rem;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      gap: 1rem;
    }
    
    .header h1 {
      font-size: 1.5rem;
      font-weight: 800;
      letter-spacing: -0.03em;
    }
    
    .header h1 span { color: var(--accent); }
    
    .stats {
      display: flex;
      gap: 1rem;
      padding: 1.5rem 2rem;
      flex-wrap: wrap;
    }
    
    .stat {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1rem 1.5rem;
      min-width: 160px;
    }
    
    .stat .label {
      font-size: 0.75rem;
      color: var(--dim);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-family: 'JetBrains Mono', monospace;
    }
    
    .stat .value {
      font-size: 2rem;
      font-weight: 800;
      margin-top: 0.25rem;
    }
    
    .feed {
      padding: 0 2rem 2rem;
    }
    
    .feed h2 {
      font-size: 1rem;
      color: var(--dim);
      margin-bottom: 1rem;
      font-family: 'JetBrains Mono', monospace;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    
    .entry {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1rem 1.25rem;
      margin-bottom: 0.75rem;
      transition: border-color 0.2s;
    }
    
    .entry:hover { border-color: var(--accent); }
    
    .entry-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.5rem;
    }
    
    .entry-user {
      font-weight: 600;
      color: var(--accent);
      font-family: 'JetBrains Mono', monospace;
    }
    
    .entry-time {
      font-size: 0.75rem;
      color: var(--dim);
      font-family: 'JetBrains Mono', monospace;
    }
    
    .entry-tweet {
      font-size: 0.9rem;
      color: var(--dim);
      margin-bottom: 0.5rem;
      line-height: 1.5;
    }
    
    .entry-reply {
      font-size: 0.95rem;
      color: var(--text);
      padding-left: 1rem;
      border-left: 3px solid var(--accent);
      line-height: 1.5;
    }
    
    .badge {
      display: inline-block;
      font-size: 0.65rem;
      font-family: 'JetBrains Mono', monospace;
      padding: 2px 8px;
      border-radius: 99px;
      text-transform: uppercase;
      font-weight: 600;
    }
    
    .badge-reply { background: #7c5cfc22; color: var(--accent); }
    .badge-dry { background: #eab30822; color: var(--yellow); }
    .badge-error { background: #ef444422; color: var(--red); }
    
    .empty {
      text-align: center;
      padding: 4rem;
      color: var(--dim);
    }
    
    .refresh-btn {
      margin-left: auto;
      background: var(--card);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 0.5rem 1rem;
      border-radius: 8px;
      cursor: pointer;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.8rem;
      transition: border-color 0.2s;
    }
    
    .refresh-btn:hover { border-color: var(--accent); }
  </style>
</head>
<body>
  <div class="header">
    <h1>🤖 Reply<span>Bot</span></h1>
    <button class="refresh-btn" onclick="loadData()">↻ Refresh</button>
  </div>
  <div class="stats" id="stats"></div>
  <div class="feed">
    <h2>Activity Feed</h2>
    <div id="feed"></div>
  </div>

  <script>
    async function loadData() {
      const res = await fetch('/api/activity');
      const data = await res.json();
      
      const replies = data.filter(e => e.type === 'reply').length;
      const dryRuns = data.filter(e => e.type === 'dry_run').length;
      const errors = data.filter(e => e.type === 'error').length;
      const uniqueUsers = new Set(data.map(e => e.targetUser)).size;
      
      document.getElementById('stats').innerHTML = [
        { label: 'Replies Sent', value: replies, color: 'var(--green)' },
        { label: 'Dry Runs', value: dryRuns, color: 'var(--yellow)' },
        { label: 'Errors', value: errors, color: 'var(--red)' },
        { label: 'Unique Users', value: uniqueUsers, color: 'var(--accent)' },
      ].map(s => \`
        <div class="stat">
          <div class="label">\${s.label}</div>
          <div class="value" style="color: \${s.color}">\${s.value}</div>
        </div>
      \`).join('');
      
      if (!data.length) {
        document.getElementById('feed').innerHTML = '<div class="empty">No activity yet. Run the bot first!</div>';
        return;
      }
      
      document.getElementById('feed').innerHTML = data.slice(0, 100).map(e => {
        const badgeClass = e.type === 'reply' ? 'badge-reply' : e.type === 'dry_run' ? 'badge-dry' : 'badge-error';
        const time = new Date(e.timestamp).toLocaleString();
        return \`
          <div class="entry">
            <div class="entry-header">
              <div>
                <span class="entry-user">@\${e.targetUser}</span>
                <span class="badge \${badgeClass}">\${e.type.replace('_', ' ')}</span>
              </div>
              <span class="entry-time">\${time}</span>
            </div>
            \${e.tweetText ? \`<div class="entry-tweet">"\${e.tweetText}"</div>\` : ''}
            \${e.replyText ? \`<div class="entry-reply">\${e.replyText}</div>\` : ''}
            \${e.error ? \`<div class="entry-reply" style="border-color: var(--red); color: var(--red)">\${e.error}</div>\` : ''}
          </div>
        \`;
      }).join('');
    }
    
    loadData();
    setInterval(loadData, 15000);
  </script>
</body>
</html>`);
});

app.listen(PORT, () => {
  console.log(`\n🖥️  Dashboard running at http://localhost:${PORT}\n`);
});
