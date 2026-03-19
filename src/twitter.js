import axios from "axios";

export class TwitterClient {
  constructor(apiKey, proxy) {
    this.apiKey = apiKey;
    this.proxy = proxy;
    this.baseURL = "https://api.twitterapi.io/twitter";
    this.loginCookie = null;

    const proxyList = process.env.PROXY_LIST;
    this.proxies = proxyList ? proxyList.split(",").map((p) => p.trim()) : [proxy];
    this.proxyIndex = 0;
    // Track which proxies work for posting
    this.workingProxies = [...this.proxies];

    this.http = axios.create({
      baseURL: this.baseURL,
      headers: { "x-api-key": this.apiKey, "Content-Type": "application/json" },
      timeout: 60000,
    });
  }

  getNextProxy() {
    // Prefer working proxies
    const pool = this.workingProxies.length > 0 ? this.workingProxies : this.proxies;
    const p = pool[this.proxyIndex % pool.length];
    this.proxyIndex++;
    return p;
  }

  markProxyBad(proxy) {
    this.workingProxies = this.workingProxies.filter((p) => p !== proxy);
  }

  markProxyGood(proxy) {
    if (!this.workingProxies.includes(proxy)) this.workingProxies.push(proxy);
  }

  setLoginCookie(cookie) { this.loginCookie = cookie; }

  // ─── Auth ───────────────────────────────────
  async login(username, email, password, totpSecret) {
    const { data } = await this.http.post("/user_login_v2", {
      user_name: username, email, password,
      proxy: this.proxy,
      totp_secret: totpSecret || undefined,
    });
    if (data.status !== "success") throw new Error(`Login failed: ${data.msg || JSON.stringify(data)}`);
    const cookie = data.login_cookie || data.login_cookies || data.cookie || data.cookies;
    this.loginCookie = cookie;
    return { cookie, raw: data };
  }

  // ─── Followings ─────────────────────────────
  async getFollowings(username, maxPages = 5) {
    const all = [];
    let cursor = "";
    for (let page = 0; page < maxPages; page++) {
      const { data } = await this.http.get("/user/followings", {
        params: { userName: username, cursor, pageSize: 200 },
      });
      if (data.status !== "success") throw new Error(`Followings failed: ${data.message}`);
      all.push(...(data.followings || []));
      if (!data.has_next_page || !data.next_cursor) break;
      cursor = data.next_cursor;
    }
    return all;
  }

  // ─── Get tweets (single API call per user) ──
  async getLatestTweets(username, userId = null) {
    let allTweets = [];

    // ONE call — tweet_timeline with userId
    if (userId) {
      try {
        const { data } = await this.http.get("/user/tweet_timeline", { params: { userId } });
        allTweets = data?.data?.tweets || data?.tweets || [];
      } catch (err) {
        console.log(`    [debug] tweet_timeline failed: ${err.message}`);
      }
    }

    // Fallback ONE call — last_tweets
    if (allTweets.length === 0) {
      try {
        const { data } = await this.http.get("/user/last_tweets", { params: { userName: username } });
        allTweets = data?.data?.tweets || data?.tweets || [];
      } catch (err) {
        console.log(`    [debug] last_tweets failed: ${err.message}`);
      }
    }

    console.log(`    [debug] Raw: ${allTweets.length} tweets`);

    // Filter: skip retweets, keep everything with text
    const filtered = allTweets.filter((t) => {
      if (!t.text) return false;
      if (t.retweeted_tweet) return false;
      if (t.text.startsWith("RT @")) return false;
      if (t.isLimitedReply) return false;
      return true;
    });

    console.log(`    [debug] After filter: ${filtered.length} tweets`);
    return filtered;
  }

  // ─── Post Reply (smart proxy — max 3 proxies tried) ──
  async postReply(tweetId, text) {
    if (!this.loginCookie) throw new Error("Not logged in");

    let lastError = "";
    // Try max 3 proxies, not all 10
    const maxTries = Math.min(3, this.proxies.length);

    for (let i = 0; i < maxTries; i++) {
      const proxy = this.getNextProxy();
      const pShort = proxy.split("@")[1] || proxy;

      let data;
      try {
        const res = await this.http.post("/create_tweet_v2", {
          login_cookies: this.loginCookie,
          tweet_text: text,
          proxy,
          reply_to_tweet_id: tweetId,
        });
        data = res.data;
      } catch (err) {
        // Timeout — tweet likely posted
        if (err.code === "ECONNABORTED" || err.message.includes("timeout")) {
          console.log(`    [proxy] ${pShort} timed out (tweet may have posted)`);
          return "timeout-ok";
        }
        // 402 = out of credits — stop immediately
        if (err.message.includes("402")) {
          throw new Error("API credits exhausted (402) — top up at twitterapi.io/dashboard");
        }
        console.log(`    [proxy] ${pShort} error: ${err.message}`);
        lastError = err.message;
        this.markProxyBad(proxy);
        continue;
      }

      const status = data?.status || data?.data?.status;
      const msg = data?.msg || data?.data?.msg || data?.message || "";
      const code = data?.code || 0;
      const resultId = data?.tweet_id || data?.data?.tweet_id;

      if (status === "success" && resultId) {
        console.log(`    [proxy] Posted via ${pShort}`);
        this.markProxyGood(proxy);
        return resultId;
      }

      lastError = msg || JSON.stringify(data);

      // Fatal errors — don't retry
      if (code === 461 || msg.includes("461")) throw new Error("Tweet too old");
      if (code === 37 || msg.includes("note tweet")) throw new Error(`note tweet: ${msg}`);
      if (msg.includes("402")) throw new Error("API credits exhausted (402)");

      // 226 = bot detection, mark proxy as bad
      if (code === 226 || msg.includes("226")) {
        this.markProxyBad(proxy);
      }

      console.log(`    [proxy] ${pShort} failed (${code || "err"}), next...`);
    }

    throw new Error(`Failed after ${maxTries} proxies: ${lastError}`);
  }
}