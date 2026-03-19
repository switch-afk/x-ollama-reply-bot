import "dotenv/config";
import { TwitterClient } from "./twitter.js";
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "..", ".env");

async function main() {
  console.log("\n🔐 Twitter Login via twitterapi.io\n");

  const {
    TWITTER_API_KEY,
    TWITTER_USERNAME,
    TWITTER_EMAIL,
    TWITTER_PASSWORD,
    TWITTER_TOTP_SECRET,
    PROXY,
  } = process.env;

  if (!TWITTER_API_KEY || !TWITTER_USERNAME || !TWITTER_EMAIL || !TWITTER_PASSWORD || !PROXY) {
    console.error("❌ Missing required env vars. Copy .env.example → .env and fill it out.");
    process.exit(1);
  }

  const client = new TwitterClient(TWITTER_API_KEY, PROXY);

  try {
    console.log(`  Logging in as @${TWITTER_USERNAME}...`);
    const { cookie, raw } = await client.login(
      TWITTER_USERNAME,
      TWITTER_EMAIL,
      TWITTER_PASSWORD,
      TWITTER_TOTP_SECRET
    );

    if (!cookie) {
      console.log("\n  ⚠️  Raw API response:");
      console.log(JSON.stringify(raw, null, 2));
      console.error("\n  ❌ No login_cookie found in response.");
      process.exit(1);
    }

    console.log(`  ✅ Login successful!`);
    console.log(`  Cookie length: ${cookie.length} chars\n`);

    // Auto-update .env with the cookie
    try {
      let envContent = readFileSync(envPath, "utf-8");
      if (envContent.match(/^LOGIN_COOKIE=.*$/m)) {
        envContent = envContent.replace(
          /^LOGIN_COOKIE=.*$/m,
          `LOGIN_COOKIE=${cookie}`
        );
      } else {
        envContent += `\nLOGIN_COOKIE=${cookie}\n`;
      }
      writeFileSync(envPath, envContent);
      console.log("  📝 LOGIN_COOKIE written to .env\n");
    } catch {
      console.log("  ⚠️  Could not auto-update .env — manually add to .env:");
      console.log(`\n  LOGIN_COOKIE=${cookie}\n`);
    }
  } catch (err) {
    console.error(`  ❌ Login failed: ${err.message}`);
    process.exit(1);
  }
}

main();