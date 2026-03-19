import axios from "axios";

// ═══════════════════════════════════════════════
//  SMART PATTERN MATCHING — No LLM needed
// ═══════════════════════════════════════════════

const PATTERNS = [
  {
    // GM: standalone "gm" anywhere — \b handles word boundaries including emoji/punctuation
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
    replies: (n) => [`Right here 🙋`, `Present and building 🛠️`, `Always active 💪`, `Locked in 🔥`, `Here 🙋‍♂️`, `Active and ready 🫡`],
  },
  {
    match: /^(say\s*(gm|hello|hi|hey|sup)|drop\s*a\s*(hi|hey|gm|hello))\b/i,
    type: "say_hi",
    replies: (n) => [`Hey ${n} 👋`, `Hi ${n} 👋`, `Yo ${n} 🤙`, `What's up ${n} 👋`, `Hey there 👋`],
  },
  {
    match: /\b(let'?s?\s*connect|follow\s*(me|back|4follow|for\s*follow)|f4f|gain\s*follow|grow\s*together|follow\s*train|follow\s*thread|engagement\s*thread|repost\s*&?\s*follow|like\s*&?\s*follow|rt\s*&?\s*follow|engagement\s*gang|support\s*each|mutual\s*follow|follow\s*party)/i,
    type: "connect",
    replies: (n) => [`Let's connect 🤝`, `Connected! Let's grow 🤝`, `Let's build together 🤝`, `Count me in 🤝`, `Let's go 🤝🔥`],
  },
  {
    match: /\b(like\s*if|rt\s*if|retweet\s*if|repost\s*if)\b/i,
    type: "agree",
    replies: (n) => [`Facts 💯`, `No debate here 🔥`, `Straight facts 💯`, `100% this 🔥`, `Can't argue with that 💯`],
  },
  {
    match: /^(lfg|let'?s?\s*(fucking|f\*cking)?\s*go)\b/i,
    type: "hype",
    replies: (n) => [`LFG 🚀`, `We're so early 🔥`, `Bullish 🚀`, `Send it 🚀`, `LFG ${n} 🔥`],
  },
];

function getFirstName(name) {
  if (!name) return "";
  const clean = name.replace(/[^\w\s]/g, "").trim();
  return clean.split(/\s+/)[0] || "";
}

function tryPatternMatch(text, displayName) {
  // Strip links, @mentions, and emojis to get clean text for matching
  const clean = text
    .replace(/https?:\/\/t\.co\/\w+/g, "")
    .replace(/&amp;/g, "&")
    .replace(/^(@\w+\s*)+/, "")
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "") // strip emojis
    .trim();

  const firstName = getFirstName(displayName);

  // Words that contain "gm", "gn", "ge", "ga" but aren't greetings
  const falsePositives = /program|gaming|begin|began|organ|again|engage|page|stage|image|manage|package|change|challenge|genre|gene|general|generate|gesture|gentleman|together|get|gem|agent|agenda|gear|signal|sign|design|assign|ignore|magnet|segment|magazine/i;

  for (const p of PATTERNS) {
    if (p.match.test(clean)) {
      // For 2-letter greetings, verify it's not a false positive
      if (["gm", "gn", "ge", "ga"].includes(p.type)) {
        // Check if any word in the tweet contains gm/gn/ge/ga as part of a longer word
        const words = clean.toLowerCase().split(/\s+/);
        const abbrev = p.type;
        const hasStandalone = words.some(w => w.replace(/[^a-z]/g, "") === abbrev);
        const hasFullPhrase = /good\s*(morning|night|evening|afternoon)/i.test(clean);

        if (!hasStandalone && !hasFullPhrase) {
          continue; // "gm" only found inside another word
        }
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
    r = r.replace(/\s+/g, " ").trim();
    return r;
  }

  async generateReply(tweetText, authorUsername, authorDisplayName = "", authorBio = "") {
    // 1. Try instant pattern match
    const match = tryPatternMatch(tweetText, authorDisplayName);
    if (match) return { reply: match.reply, method: match.type };

    // 2. Clean for LLM
    const clean = this.cleanTweet(tweetText);
    if (clean.length < 5) return null; // image-only

    // 3. Detect if tweet is crypto-related
    const isCrypto = /\b(crypto|bitcoin|btc|eth|sol|solana|defi|nft|token|blockchain|web3|pump\.?fun|raydium|jupiter|phantom|dex|swap|mint|airdrop|staking|rug|degen|wagmi|ngmi|hodl|bullish|bearish)\b/i.test(clean);

    // 4. LLM generation with context-aware prompt
    const systemPrompt = `You reply to tweets. RULES:
- MAXIMUM 120 characters. Hard limit. Count carefully.
- Read the tweet carefully. Reply ONLY about what the tweet says.
- NEVER bring up topics the tweet doesn't mention.
- NEVER mention Solana, crypto, DeFi, NFTs, pump.fun unless the tweet is about them.
- Be witty, sharp, natural. Sound like a real person.
- One sentence only. Max 1 emoji.
- Never start with "I" "Wow" "This" "Oh" "So"
- No brackets, placeholders, quotes, hashtags
- No wallets, addresses, DMs, links
- No generic filler like "great post" or "interesting"
- Be energetic and positive
${isCrypto ? "- The tweet IS about crypto so you can flex crypto/Solana knowledge" : "- The tweet is NOT about crypto so do NOT mention any crypto topics"}
- Output ONLY the reply text, absolutely nothing else`;

    const userPrompt = `Tweet: "${clean}"

Reply:`;

    try {
      const { data } = await axios.post(
        `${this.baseURL}/api/generate`,
        {
          model: this.model,
          prompt: userPrompt,
          system: systemPrompt,
          stream: false,
          options: { temperature: 0.75, top_p: 0.85, num_predict: 50 },
        },
        { timeout: 90000 }
      );

      let reply = this.cleanReply(data.response || "");
      if (!reply || reply.length < 5) return null;

      // Reject bad content
      const bad = [/\[/, /wallet/i, /address/i, /DM me/i, /send me/i,
        /check (my|the) (bio|profile|link)/i, /interesting read/i,
        /great (post|article|read|thread)/i, /^(SKIP|N\/A|none|undefined)$/i,
        /^RT /i, /insert/i, /\bfollow me\b/i];
      for (const p of bad) { if (p.test(reply)) return null; }

      // If tweet is NOT crypto but reply mentions crypto stuff, reject it
      if (!isCrypto && /\b(solana|pump\.?fun|raydium|jupiter|phantom|tensor|magic\s*eden|marinade|defi|nft|token|blockchain|web3|crypto|on-chain)\b/i.test(reply)) {
        return null;
      }

      if (reply.length > 250) {
        reply = reply.slice(0, 247);
        const sp = reply.lastIndexOf(" ");
        if (sp > 180) reply = reply.slice(0, sp);
      }

      return { reply, method: "llm" };
    } catch (err) {
      if (err.code === "ECONNREFUSED") {
        throw new Error(`Ollama not running at ${this.baseURL} — run: ollama serve`);
      }
      throw err;
    }
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