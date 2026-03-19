import axios from "axios";

// ═══════════════════════════════════════════════
//  SMART PATTERN MATCHING — Instant, no LLM
// ═══════════════════════════════════════════════

const PATTERNS = [
  {
    match: /\bgm\b|good\s*morning|morning\s*(everyone|fam|all|guys|frens|gang)/i,
    type: "gm",
    replies: (n) => [`GM ${n} 🌅`, `Good Morning ${n} ☀️`, `GM ${n}, let's get it 🌅`, `Morning ${n} ☀️`, `GM ${n} 🔆`],
  },
  {
    match: /\bgn\b|good\s*night|nighty?\b|sleep\s*well|sweet\s*dreams/i,
    type: "gn",
    replies: (n) => [`GN ${n} 🌙`, `Good Night ${n} 🌙`, `GN ${n}, rest up 💤`, `Night ${n} 🌜`],
  },
  {
    match: /\bge\b|good\s*evening|evening\s*(everyone|fam|all|guys|frens|gang)/i,
    type: "ge",
    replies: (n) => [`GE ${n} 🌆`, `Good Evening ${n} 🌇`, `Evening ${n} 🌆`],
  },
  {
    match: /\bga\b|good\s*afternoon|afternoon\s*(everyone|fam|all|guys|frens|gang)/i,
    type: "ga",
    replies: (n) => [`GA ${n} ☀️`, `Good Afternoon ${n} 🌤️`, `Afternoon ${n} ☀️`],
  },
  {
    match: /\b(who'?s?\s*(here|active|around|up|online|awake)|anyone\s*(here|active|around|up|awake)|roll\s*call|who'?s?\s*still\s*(here|up))/i,
    type: "active",
    replies: (n) => [`Right here 🙋`, `Present and building 🛠️`, `Always active 💪`, `Locked in 🔥`, `Here 🙋‍♂️`],
  },
  {
    match: /^(say\s*(gm|hello|hi|hey|sup)|drop\s*a\s*(hi|hey|gm|hello))\b/i,
    type: "say_hi",
    replies: (n) => [`Hey ${n} 👋`, `Hi ${n} 👋`, `Yo ${n} 🤙`, `What's up ${n} 👋`],
  },
  {
    match: /\b(let'?s?\s*connect|follow\s*(me|back|4follow|for\s*follow)|f4f|gain\s*follow|grow\s*together|follow\s*train|follow\s*thread|engagement\s*thread|repost\s*&?\s*follow|like\s*&?\s*follow|rt\s*&?\s*follow|engagement\s*gang|support\s*each|mutual\s*follow|follow\s*party)/i,
    type: "connect",
    replies: (n) => [`Let's connect 🤝`, `Connected! Let's grow 🤝`, `Let's build together 🤝`, `Count me in 🤝`],
  },
  {
    match: /\b(like\s*if|rt\s*if|retweet\s*if|repost\s*if)\b/i,
    type: "agree",
    replies: (n) => [`Facts 💯`, `No debate here 🔥`, `Straight facts 💯`, `100% this 🔥`],
  },
  {
    match: /^(lfg|let'?s?\s*(fucking|f\*cking)?\s*go)\b/i,
    type: "hype",
    replies: (n) => [`LFG 🚀`, `We're so early 🔥`, `Send it 🚀`, `LFG ${n} 🔥`],
  },
];

function getFirstName(name) {
  if (!name) return "";
  return name.replace(/[^\w\s]/g, "").trim().split(/\s+/)[0] || "";
}

function tryPatternMatch(text, displayName) {
  const clean = text
    .replace(/https?:\/\/t\.co\/\w+/g, "")
    .replace(/&amp;/g, "&")
    .replace(/^(@\w+\s*)+/, "")
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
    .trim();

  const firstName = getFirstName(displayName);

  for (const p of PATTERNS) {
    if (p.match.test(clean)) {
      // For 2-letter greetings, verify standalone word exists
      if (["gm", "gn", "ge", "ga"].includes(p.type)) {
        const words = clean.toLowerCase().split(/\s+/);
        const hasStandalone = words.some((w) => w.replace(/[^a-z]/g, "") === p.type);
        const hasFullPhrase = /good\s*(morning|night|evening|afternoon)/i.test(clean);
        if (!hasStandalone && !hasFullPhrase) continue;
      }
      const options = p.replies(firstName);
      return { reply: options[Math.floor(Math.random() * options.length)], type: p.type };
    }
  }
  return null;
}

// ═══════════════════════════════════════════════
//  OLLAMA CLIENT
// ═══════════════════════════════════════════════

export class OllamaClient {
  constructor(baseURL = "http://localhost:11434", model = "llama2") {
    this.baseURL = baseURL;
    this.model = model;
  }

  cleanTweet(text) {
    return text
      .replace(/^RT @\w+:\s*/i, "")
      .replace(/https?:\/\/t\.co\/\w+/g, "")
      .replace(/^(@\w+\s*)+/, "")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .trim();
  }

  cleanReply(text) {
    let r = text.trim();
    r = r.replace(/^["'"'"]+|["'"'"]+$/g, "");
    r = r.replace(/^(Reply|Response|Here'?s? ?(my|a) reply|Sure|Okay|Alright|Note):?\s*/i, "");
    r = r.replace(/^RT @\w+:\s*/i, "");
    r = r.replace(/\n.*/s, "");
    r = r.replace(/#\w+/g, "");
    r = r.replace(/^(@\w+\s*)+/, "");
    r = r.replace(/^["'"'"]+|["'"'"]+$/g, "");
    r = r.replace(/\?+\s*$/, ""); // strip trailing questions
    r = r.replace(/\s*(right|huh|yeah|no|eh)\s*$/i, "");
    r = r.replace(/\s+/g, " ").trim();
    return r;
  }

  isBadReply(reply, isCrypto) {
    const bad = [
      /\[/, /wallet/i, /address/i, /DM me/i, /send me/i,
      /check (my|the) (bio|profile|link)/i, /interesting read/i,
      /great (post|article|read|thread)/i, /^(SKIP|N\/A|none|undefined)$/i,
      /^RT /i, /insert/i, /\bfollow me\b/i,
      /I can't/i, /I cannot/i, /I'm just an AI/i, /as an AI/i, /I'm not able/i,
      /I don't think/i, /I'm sorry/i, /I apologize/i,
      /satisfy your request/i, /can't (help|assist|create|generate)/i,
      /inappropriate/i, /offensive/i, /harmful/i, /violat/i,
      /^I /i, // never start with "I"
    ];
    for (const p of bad) { if (p.test(reply)) return true; }

    // Reject crypto in non-crypto tweets
    if (!isCrypto && /\b(solana|pump\.?fun|raydium|jupiter|phantom|tensor|magic\s*eden|marinade|defi|nft|token|blockchain|web3|crypto|on-chain)\b/i.test(reply)) {
      return true;
    }
    return false;
  }

  async generateReply(tweetText, authorUsername, authorDisplayName = "", authorBio = "") {
    // 1. Pattern match first (free, instant)
    const match = tryPatternMatch(tweetText, authorDisplayName);
    if (match) return { reply: match.reply, method: match.type };

    // 2. Clean for LLM
    const clean = this.cleanTweet(tweetText);
    if (clean.length < 5) return null;

    // 3. Crypto detection
    const isCrypto = /\b(crypto|bitcoin|btc|eth|sol|solana|defi|nft|token|blockchain|web3|pump\.?fun|raydium|jupiter|phantom|dex|swap|mint|airdrop|staking|rug|degen|wagmi|ngmi|hodl|bullish|bearish)\b/i.test(clean);

    // 4. Try up to 3 times with decreasing char limits
    for (let attempt = 0; attempt < 3; attempt++) {
      const maxC = attempt === 0 ? 120 : attempt === 1 ? 80 : 50;
      const tokens = attempt === 0 ? 45 : 25;

      const systemPrompt = `Tweet reply under ${maxC} characters. Rules:
- MAX ${maxC} chars. Short and punchy.
- Reply about the tweet content ONLY.
- Never mention unrelated topics.
- Witty, confident, human-sounding.
- One short sentence. Max 1 emoji.
- NO questions. NO question marks.
- Never start with I, Wow, This, Oh, So, Haha.
- Never refuse or apologize.
- No brackets, placeholders, hashtags.
- No wallets, addresses, DMs, links.
- No "great post" or "interesting".
${isCrypto ? "- Crypto tweet: flex Solana/crypto knowledge" : "- NOT crypto: zero crypto mentions"}
- ONLY output the reply`;

      try {
        const { data } = await axios.post(
          `${this.baseURL}/api/generate`,
          {
            model: this.model,
            prompt: `Tweet: "${clean.slice(0, 200)}"\n\nReply:`,
            system: systemPrompt,
            stream: false,
            options: { temperature: 0.75, top_p: 0.85, num_predict: tokens },
          },
          { timeout: 90000 }
        );

        let reply = this.cleanReply(data.response || "");
        if (!reply || reply.length < 5) continue;
        if (this.isBadReply(reply, isCrypto)) continue;
        if (reply.length > 250) {
          if (attempt < 2) continue; // retry shorter
          return null;
        }

        if (attempt > 0) console.log(`    [ollama] Good reply on attempt ${attempt + 1}`);
        return { reply, method: "llm" };
      } catch (err) {
        if (err.code === "ECONNREFUSED") {
          throw new Error(`Ollama not running at ${this.baseURL} — run: ollama serve`);
        }
        continue;
      }
    }
    return null;
  }

  async isAvailable() {
    try {
      const { data } = await axios.get(`${this.baseURL}/api/tags`, { timeout: 5000 });
      const models = (data.models || []).map((m) => m.name);
      return { online: true, models, hasModel: models.some((m) => m.startsWith(this.model)) };
    } catch {
      return { online: false, models: [], hasModel: false };
    }
  }
}