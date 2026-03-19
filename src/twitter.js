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

    this.http = axios.create({
      baseURL: this.baseURL,
      headers: { "x-api-key": this.apiKey, "Content-Type": "application/json" },
      timeout: 60000,
    });
  }

  getNextProxy() {
    const p = this.proxies[this.proxyIndex % this.proxies.length];
    this.proxyIndex++;
    return p;
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

  // ─── User Info ──────────────────────────────
  async getUserInfo(username) {
    const { data } = await this.http.get("/user/info", { params: { userName: username } });
    return data;
  }

  // ─── Get ALL tweets (no limit) ──────────────
  async getLatestTweets(username, userId = null) {
    let allTweets = [];

    // tweet_timeline with userId
    if (userId) {
      try {
        const { data } = await this.http.get("/user/tweet_timeline", { params: { userId } });
        allTweets = data?.data?.tweets || data?.tweets || [];
      } catch (err) {
        console.log(`    [debug] tweet_timeline failed: ${err.message}`);
      }
    }

    // Fallback: last_tweets by userName
    if (allTweets.length === 0) {
      try {
        const { data } = await this.http.get("/user/last_tweets", { params: { userName: username } });
        allTweets = data?.data?.tweets || data?.tweets || [];
      } catch (err) {
        console.log(`    [debug] last_tweets failed: ${err.message}`);
      }
    }

    console.log(`    [debug] Raw: ${allTweets.length} tweets`);

    // Filter: skip retweets, keep everything with text (including text+image)
    const filtered = allTweets.filter((t) => {
      if (!t.text) return false;
      if (t.retweeted_tweet) return false;
      if (t.text.startsWith("RT @")) return false;
      if (t.isLimitedReply) return false;
      return true;
    });

    console.log(`    [debug] After filter: ${filtered.length} tweets`);
    return filtered; // NO LIMIT — return all
  }

  // ─── Fetch full tweet ───────────────────────
  async getTweetById(tweetId) {
    try {
      const { data } = await this.http.get("/tweets", { params: { tweet_ids: tweetId } });
      const tweets = data?.data?.tweets || data?.tweets || [];
      return tweets[0] || null;
    } catch { return null; }
  }

  // ─── Post Reply (with proxy rotation) ───────
  async postReply(tweetId, text) {
    if (!this.loginCookie) throw new Error("Not logged in");

    let lastError = "";

    for (let i = 0; i < this.proxies.length; i++) {
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
        if (err.code === "ECONNABORTED" || err.message.includes("timeout")) {
          console.log(`    [proxy] ${pShort} timed out (tweet may have posted)`);
          return "timeout-ok";
        }
        console.log(`    [proxy] ${pShort} error: ${err.message}`);
        lastError = err.message;
        continue;
      }

      const status = data?.status || data?.data?.status;
      const msg = data?.msg || data?.data?.msg || data?.message || "";
      const code = data?.code || 0;
      const resultId = data?.tweet_id || data?.data?.tweet_id;

      if (status === "success" && resultId) {
        console.log(`    [proxy] Posted via ${pShort}`);
        return resultId;
      }

      lastError = msg || JSON.stringify(data);

      // 461 = old tweet, don't retry
      if (code === 461 || msg.includes("461")) throw new Error(`Tweet too old`);

      console.log(`    [proxy] ${pShort} failed (${code || "err"}), next...`);
    }

    throw new Error(`All proxies failed: ${lastError}`);
  }
}