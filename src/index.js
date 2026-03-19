import "dotenv/config";
import { TwitterClient } from "./twitter.js";
import { OllamaClient } from "./ollama.js";
import { hasReplied, markReplied, logActivity } from "./store.js";
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import chalk from "chalk";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "..", ".env");

// ─── Config ───────────────────────────────────
const {
  TWITTER_API_KEY,
  TWITTER_USERNAME,
  TWITTER_EMAIL,
  TWITTER_PASSWORD,
  TWITTER_TOTP_SECRET,
  PROXY,
  OLLAMA_URL = "http://localhost:11434",
  OLLAMA_MODEL = "llama2",
  DRY_RUN = "false",
} = process.env;

let loginCookie = process.env.LOGIN_COOKIE;
const isDryRun = DRY_RUN === "true";

// ─── Helpers ──────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const randDelay = () => randInt(30, 60) * 1000;
const randScanInterval = () => randInt(5, 10) * 60 * 1000;

const log = {
  info: (msg) => console.log(chalk.blue("ℹ"), msg),
  ok: (msg) => console.log(chalk.green("✓"), msg),
  warn: (msg) => console.log(chalk.yellow("⚠"), msg),
  err: (msg) => console.log(chalk.red("✗"), msg),
  reply: (msg) => console.log(chalk.magenta("💬"), msg),
  bot: (msg) => console.log(chalk.cyan("🤖"), msg),
  pattern: (msg) => console.log(chalk.yellow("⚡"), msg),
};

// ─── Auto Login ───────────────────────────────
async function autoLogin() {
  log.info("🔐 Auto re-logging in...");
  const twitter = new TwitterClient(TWITTER_API_KEY, PROXY);
  try {
    const { cookie } = await twitter.login(TWITTER_USERNAME, TWITTER_EMAIL, TWITTER_PASSWORD, TWITTER_TOTP_SECRET);
    if (!cookie) { log.err("No cookie returned"); return false; }
    loginCookie = cookie;
    log.ok(`Login successful! Cookie: ${cookie.length} chars`);
    try {
      let env = readFileSync(envPath, "utf-8");
      env = env.match(/^LOGIN_COOKIE=.*$/m)
        ? env.replace(/^LOGIN_COOKIE=.*$/m, `LOGIN_COOKIE=${cookie}`)
        : env + `\nLOGIN_COOKIE=${cookie}\n`;
      writeFileSync(envPath, env);
      log.ok("Cookie saved to .env");
    } catch {}
    return true;
  } catch (err) {
    log.err(`Login failed: ${err.message}`);
    return false;
  }
}

// ─── Preflight ────────────────────────────────
async function preflight() {
  console.log(chalk.bold("\n══════════════════════════════════════════"));
  console.log(chalk.bold("  🐦 Twitter Reply Bot v3 — Optimized"));
  console.log(chalk.bold("══════════════════════════════════════════\n"));

  if (!TWITTER_API_KEY || !PROXY) { log.err("Missing TWITTER_API_KEY or PROXY"); process.exit(1); }

  if (!loginCookie && !isDryRun) {
    const ok = await autoLogin();
    if (!ok) { log.err("Auto-login failed"); process.exit(1); }
  }

  if (isDryRun) log.warn("DRY RUN mode\n");

  const ollama = new OllamaClient(OLLAMA_URL, OLLAMA_MODEL);
  const status = await ollama.isAvailable();
  if (!status.online) { log.err(`Ollama not running — run: ollama serve`); process.exit(1); }
  if (!status.hasModel) { log.err(`Model "${OLLAMA_MODEL}" not found — run: ollama pull ${OLLAMA_MODEL}`); process.exit(1); }

  log.ok(`Ollama: ${OLLAMA_MODEL}`);
  log.ok(`Delays: 30-60s replies, 5-10min scans`);
  log.ok(`Optimized: 1 API call per user, max 3 proxy tries per post`);
  console.log("");
}

// ─── Main Cycle ───────────────────────────────
async function runCycle() {
  const twitter = new TwitterClient(TWITTER_API_KEY, PROXY);
  twitter.setLoginCookie(loginCookie);
  const ollama = new OllamaClient(OLLAMA_URL, OLLAMA_MODEL);

  let repliesSent = 0, skipped = 0, errors = 0;
  let creditsExhausted = false;

  // 1. Get followings (1 API call)
  log.info(`Fetching followings for @${TWITTER_USERNAME}...`);
  let followings;
  try {
    followings = await twitter.getFollowings(TWITTER_USERNAME);
    log.ok(`Found ${followings.length} followings`);
  } catch (err) {
    log.err(`Followings failed: ${err.message}`);
    return;
  }

  log.info(`Scanning ${followings.length} accounts...\n`);

  // 2. Loop each following
  for (let i = 0; i < followings.length; i++) {
    if (creditsExhausted) break;

    const user = followings[i];
    const username = user.userName;
    const displayName = user.name || username;
    const bio = user.description || "";
    const prefix = chalk.dim(`[${i + 1}/${followings.length}]`);
    log.info(`${prefix} @${username} (${displayName})`);

    try {
      // 3. Get tweets (1 API call per user — NO getTweetById)
      const tweets = await twitter.getLatestTweets(username, user.id);
      if (!tweets.length) { log.warn(`  No tweets`); continue; }

      // 4. Filter to last 3 hours, newest first
      const now = Date.now();
      const maxAge = 3 * 60 * 60 * 1000;
      const fresh = tweets
        .filter((t) => !t.createdAt || (now - new Date(t.createdAt).getTime()) < maxAge)
        .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

      if (!fresh.length) { log.warn(`  No tweets in last 3h`); continue; }
      log.info(`  ${fresh.length} fresh tweets`);

      let repliedThisUser = 0;

      for (const tweet of fresh) {
        if (creditsExhausted) break;
        if (hasReplied(tweet.id)) continue;

        // Use tweet text directly — no extra API call
        const fullText = tweet.text;
        log.reply(`  "${fullText}"`);

        // 5. Generate reply
        let result;
        try {
          result = await ollama.generateReply(fullText, username, displayName, bio);
        } catch (err) {
          log.err(`  Ollama: ${err.message}`);
          errors++;
          continue;
        }

        if (!result || !result.reply || result.reply.length < 3) {
          markReplied(tweet.id);
          skipped++;
          continue;
        }

        const { reply, method } = result;
        if (method !== "llm") {
          log.pattern(`  [${method}] → "${reply}"`);
        } else {
          log.bot(`  [llm] → "${reply}"`);
        }

        // 6. Post reply
        if (!isDryRun) {
          let posted = false;
          let reloginDone = false;

          try {
            const replyId = await twitter.postReply(tweet.id, reply);
            log.ok(`  ✅ Posted! (${replyId})`);
            repliesSent++;
            repliedThisUser++;
            posted = true;
            logActivity({ type: "reply", method, targetUser: username, tweetId: tweet.id, tweetText: fullText.slice(0, 200), replyText: reply, replyId });
          } catch (err) {
            const msg = err.message || "";

            // Credits exhausted — stop everything
            if (msg.includes("402") || msg.includes("credits")) {
              log.err("  💳 API credits exhausted! Top up at twitterapi.io/dashboard");
              creditsExhausted = true;
              break;
            }

            // Note tweet (too long) — regenerate and retry once
            if (msg.includes("note tweet") || msg.includes("37")) {
              log.warn(`  Too long — regenerating...`);
              try {
                const retry = await ollama.generateReply(fullText, username, displayName, bio);
                if (retry?.reply && retry.reply.length <= 200) {
                  log.bot(`  [retry] → "${retry.reply}"`);
                  const retryId = await twitter.postReply(tweet.id, retry.reply);
                  log.ok(`  ✅ Posted! (${retryId})`);
                  repliesSent++;
                  repliedThisUser++;
                  posted = true;
                }
              } catch {}
            }

            // Auth/proxy error — relogin once
            if (!posted && !reloginDone) {
              const isAuth = msg.includes("422") || msg.includes("authorization") || msg.includes("401") || msg.includes("403");
              if (isAuth) {
                reloginDone = true;
                const ok = await autoLogin();
                if (ok) {
                  twitter.setLoginCookie(loginCookie);
                  const cd = randDelay();
                  log.info(`  Cooling down ${Math.round(cd / 1000)}s...`);
                  await sleep(cd);
                  try {
                    const retryId = await twitter.postReply(tweet.id, reply);
                    log.ok(`  ✅ Posted after relogin! (${retryId})`);
                    repliesSent++;
                    repliedThisUser++;
                    posted = true;
                  } catch {
                    log.warn(`  Still failing — skipping, will retry next cycle`);
                  }
                }
              }
            }

            if (!posted) {
              log.warn(`  Skipping tweet — next cycle`);
              logActivity({ type: "error", targetUser: username, tweetId: tweet.id, error: msg });
            }
          }

          // Only mark replied if actually posted
          if (posted) markReplied(tweet.id);

          // Random delay
          const delay = randDelay();
          log.info(`  Waiting ${Math.round(delay / 1000)}s...`);
          await sleep(delay);
        } else {
          log.ok(`  [DRY RUN] Would post`);
          repliesSent++;
          markReplied(tweet.id);
        }
      }

      if (repliedThisUser > 0) log.ok(`  Replied to ${repliedThisUser} tweets from @${username}`);
    } catch (err) {
      log.err(`  Error: ${err.message}`);
      errors++;
    }

    await sleep(randInt(1000, 3000));
  }

  // Summary
  console.log(chalk.bold("\n── Cycle Complete ──────────────────────"));
  log.ok(`Replies: ${repliesSent}`);
  if (skipped) log.info(`Skipped: ${skipped}`);
  if (errors) log.warn(`Errors: ${errors}`);
  if (creditsExhausted) log.err("⚠️  Credits exhausted — bot paused until top-up");
  console.log("");

  return creditsExhausted;
}

// ─── Main Loop ────────────────────────────────
async function main() {
  await preflight();

  while (true) {
    const outOfCredits = await runCycle();

    if (outOfCredits) {
      log.err("Bot paused — add credits at twitterapi.io/dashboard then restart");
      process.exit(0);
    }

    const next = randScanInterval();
    log.info(`Next scan in ${Math.round(next / 60000)} minutes.\n`);
    await sleep(next);
  }
}

main().catch((err) => { console.error("FATAL:", err); process.exit(1); });