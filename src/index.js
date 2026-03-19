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
  MAX_FOLLOWINGS_TO_SCAN = "9999",
  DRY_RUN = "false",
} = process.env;

let loginCookie = process.env.LOGIN_COOKIE;

const isDryRun = DRY_RUN === "true";
const maxFollowings = parseInt(MAX_FOLLOWINGS_TO_SCAN);

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
  auth: (msg) => console.log(chalk.red("🔐"), msg),
};

// ─── Auto Re-Login ────────────────────────────
async function autoLogin() {
  log.auth("Cookie expired or invalid — auto re-logging in...");

  const twitter = new TwitterClient(TWITTER_API_KEY, PROXY);

  try {
    const { cookie } = await twitter.login(
      TWITTER_USERNAME, TWITTER_EMAIL, TWITTER_PASSWORD, TWITTER_TOTP_SECRET
    );

    if (!cookie) {
      log.err("Re-login returned no cookie");
      return false;
    }

    loginCookie = cookie;
    log.ok(`Re-login successful! Cookie: ${cookie.length} chars`);

    // Save to .env
    try {
      let envContent = readFileSync(envPath, "utf-8");
      if (envContent.match(/^LOGIN_COOKIE=.*$/m)) {
        envContent = envContent.replace(/^LOGIN_COOKIE=.*$/m, `LOGIN_COOKIE=${cookie}`);
      } else {
        envContent += `\nLOGIN_COOKIE=${cookie}\n`;
      }
      writeFileSync(envPath, envContent);
      log.ok("Cookie saved to .env");
    } catch {
      log.warn("Could not save cookie to .env — using in-memory only");
    }

    return true;
  } catch (err) {
    log.err(`Re-login failed: ${err.message}`);
    return false;
  }
}

function isAuthError(errMsg) {
  const msg = (errMsg || "").toLowerCase();
  return msg.includes("authorization") || msg.includes("401") ||
    msg.includes("403") || msg.includes("422") ||
    msg.includes("not authenticated") || msg.includes("login") ||
    msg.includes("cookie") || msg.includes("session") || msg.includes("expired");
}

// ─── Preflight ────────────────────────────────
async function preflight() {
  console.log(chalk.bold("\n══════════════════════════════════════════"));
  console.log(chalk.bold("  🐦 Twitter Reply Bot v2 — Smart Mode"));
  console.log(chalk.bold("══════════════════════════════════════════\n"));

  if (!TWITTER_API_KEY || !PROXY) {
    log.err("Missing TWITTER_API_KEY or PROXY in .env");
    process.exit(1);
  }
  if (!loginCookie && !isDryRun) {
    log.warn("No LOGIN_COOKIE — attempting auto-login...");
    const ok = await autoLogin();
    if (!ok) {
      log.err("Auto-login failed. Check credentials in .env");
      process.exit(1);
    }
  }
  if (isDryRun) log.warn("DRY RUN mode — will NOT post replies\n");

  const ollama = new OllamaClient(OLLAMA_URL, OLLAMA_MODEL);
  const status = await ollama.isAvailable();

  if (!status.online) {
    log.err(`Ollama not running at ${OLLAMA_URL} — run: ollama serve`);
    process.exit(1);
  }
  if (!status.hasModel) {
    log.err(`Model "${OLLAMA_MODEL}" not found. Run: ollama pull ${OLLAMA_MODEL}`);
    process.exit(1);
  }

  log.ok(`Ollama online — model: ${OLLAMA_MODEL}`);
  log.ok(`Scanning ALL followings — NO tweet limit per user`);
  log.ok(`Delays: 30-60s between replies, 5-10min between scans`);
  console.log("");
}

// ─── Main Scan Cycle ──────────────────────────
async function runCycle() {
  const twitter = new TwitterClient(TWITTER_API_KEY, PROXY);
  twitter.setLoginCookie(loginCookie);
  const ollama = new OllamaClient(OLLAMA_URL, OLLAMA_MODEL);

  let repliesSent = 0;
  let skipped = 0;
  let errors = 0;
  let authFailed = false;

  // 1. Get followings
  log.info(`Fetching followings for @${TWITTER_USERNAME}...`);
  let followings;
  try {
    followings = await twitter.getFollowings(TWITTER_USERNAME);
    log.ok(`Found ${followings.length} followings`);
  } catch (err) {
    log.err(`Failed to fetch followings: ${err.message}`);
    return;
  }

  const toScan = followings.slice(0, maxFollowings);
  log.info(`Scanning ${toScan.length} accounts...\n`);

  // 2. Loop each following
  for (let i = 0; i < toScan.length; i++) {
    const user = toScan[i];
    const username = user.userName;
    const displayName = user.name || username;
    const bio = user.description || "";

    const prefix = chalk.dim(`[${i + 1}/${toScan.length}]`);
    log.info(`${prefix} @${username} (${displayName})`);

    try {
      // 3. Get ALL their tweets (no limit)
      const tweets = await twitter.getLatestTweets(username, user.id);

      if (!tweets.length) {
        log.warn(`  No tweets to reply to`);
        continue;
      }

      let repliedThisUser = 0;

      // Sort newest first and filter to last 3 hours
      const now = Date.now();
      const maxAge = 3 * 60 * 60 * 1000; // 3 hours
      const freshTweets = tweets
        .filter((t) => {
          if (!t.createdAt) return true; // keep if no date
          const age = now - new Date(t.createdAt).getTime();
          return age < maxAge;
        })
        .sort((a, b) => {
          const da = new Date(a.createdAt || 0).getTime();
          const db = new Date(b.createdAt || 0).getTime();
          return db - da; // newest first
        });

      if (!freshTweets.length) {
        log.warn(`  No tweets in last 3 hours`);
        continue;
      }

      log.info(`  ${freshTweets.length} fresh tweets (last 3h)`);

      for (const tweet of freshTweets) {
        // Skip already replied
        if (hasReplied(tweet.id)) continue;

        // Fetch full tweet text (timeline truncates)
        let fullText = tweet.text;
        try {
          const full = await twitter.getTweetById(tweet.id);
          if (full?.text) {
            fullText = full.text;
            if (fullText.length > tweet.text.length) {
              console.log(`    [debug] Full text fetched: ${fullText.length} chars (was ${tweet.text.length})`);
            }
          }
        } catch (err) {
          console.log(`    [debug] Full tweet fetch failed: ${err.message}`);
        }

        const preview = fullText;

        // Generate reply (pattern match or LLM)
        let result;
        try {
          result = await ollama.generateReply(fullText, username, displayName, bio);
        } catch (err) {
          log.err(`  Ollama error: ${err.message}`);
          errors++;
          continue;
        }

        if (!result || !result.reply || result.reply.length < 3) {
          markReplied(tweet.id);
          skipped++;
          continue;
        }

        const { reply, method } = result;

        log.reply(`  "${preview}"`);
        if (method !== "llm") {
          log.pattern(`  [${method}] → "${reply}"`);
        } else {
          log.bot(`  [llm] → "${reply}"`);
        }

        // Post reply
        if (!isDryRun) {
          let finalReply = reply;
          let posted = false;
          let reloginAttempted = false;

          // Try posting — up to 3 attempts (shorten on note tweet, relogin on auth)
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              const replyId = await twitter.postReply(tweet.id, finalReply);
              log.ok(`  ✅ Posted! (${replyId})`);
              repliesSent++;
              repliedThisUser++;
              posted = true;

              logActivity({
                type: "reply", method, targetUser: username,
                tweetId: tweet.id, tweetText: fullText.slice(0, 200),
                replyText: finalReply, replyId,
              });
              break;
            } catch (err) {
              const errMsg = err.message || "";

              // Note tweet error (code 37) — reply too long, REGENERATE
              if (errMsg.includes("note tweet") || errMsg.includes("37")) {
                log.warn(`  Reply too long (${finalReply.length} chars) — regenerating...`);
                try {
                  const retry = await ollama.generateReply(fullText, username, displayName, bio);
                  if (retry && retry.reply && retry.reply.length >= 5 && retry.reply.length <= 200) {
                    finalReply = retry.reply;
                    log.bot(`  [regenerated] → "${finalReply}"`);
                    continue;
                  }
                } catch {}
                log.err(`  Could not regenerate, skipping`);
                break;
              }

              // Auth/422 error — relogin ONCE only
              if (isAuthError(errMsg) && !reloginAttempted) {
                reloginAttempted = true;
                const relogged = await autoLogin();
                if (relogged) {
                  twitter.setLoginCookie(loginCookie);
                  const cooldown = randDelay();
                  log.info(`  Cooling down ${Math.round(cooldown / 1000)}s after relogin...`);
                  await sleep(cooldown);
                  log.ok("  Retrying once with new cookie...");
                  continue; // ONE more attempt
                }
                log.err("  Re-login failed");
              }

              // Skip this tweet — will retry next scan
              log.warn(`  Skipping tweet — will retry next cycle`);
              logActivity({ type: "error", targetUser: username, tweetId: tweet.id, error: errMsg });
              break;
            }
          }

          // Random delay 30-60s
          const delay = randDelay();
          log.info(`  Waiting ${Math.round(delay / 1000)}s...`);
          await sleep(delay);

          // Only mark as replied if actually posted
          if (posted) markReplied(tweet.id);
        } else {
          log.ok(`  [DRY RUN] Would post`);
          repliesSent++;
          logActivity({
            type: "dry_run", method, targetUser: username,
            tweetId: tweet.id, tweetText: fullText.slice(0, 200), replyText: reply,
          });
          markReplied(tweet.id);
        }
      }

      if (repliedThisUser > 0) {
        log.ok(`  Replied to ${repliedThisUser} tweets from @${username}`);
      }
    } catch (err) {
      log.err(`  Error scanning @${username}: ${err.message}`);
      errors++;
    }

    // Small delay between users
    await sleep(randInt(1000, 3000));
  }

  // Summary
  console.log(chalk.bold("\n── Cycle Complete ──────────────────────"));
  log.ok(`Replies sent: ${repliesSent}`);
  log.info(`Skipped: ${skipped} (image-only/low quality)`);
  if (errors) log.warn(`Errors: ${errors}`);
  console.log("");
}

// ─── Main Loop ────────────────────────────────
async function main() {
  await preflight();

  while (true) {
    await runCycle();

    const nextScan = randScanInterval();
    const mins = Math.round(nextScan / 60000);
    log.info(`Next scan in ${mins} minutes. Press Ctrl+C to stop.\n`);
    await sleep(nextScan);
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});