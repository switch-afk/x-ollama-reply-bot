import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, "..", "data", "replied.json");
const LOG_PATH = join(__dirname, "..", "data", "activity.json");

function ensureDir() {
  const dir = dirname(DB_PATH);
  if (!existsSync(dir)) {
    import("fs").then((fs) => fs.mkdirSync(dir, { recursive: true }));
  }
}

// ─── Replied Tweets Tracker ─────────────────
export function hasReplied(tweetId) {
  const db = loadDB();
  return db.repliedTweets.includes(tweetId);
}

export function markReplied(tweetId) {
  const db = loadDB();
  db.repliedTweets.push(tweetId);
  // Keep last 5000 entries to prevent bloat
  if (db.repliedTweets.length > 5000) {
    db.repliedTweets = db.repliedTweets.slice(-5000);
  }
  saveDB(db);
}

function loadDB() {
  ensureDir();
  if (!existsSync(DB_PATH)) {
    return { repliedTweets: [] };
  }
  try {
    return JSON.parse(readFileSync(DB_PATH, "utf-8"));
  } catch {
    return { repliedTweets: [] };
  }
}

function saveDB(db) {
  ensureDir();
  writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

// ─── Activity Log ───────────────────────────
export function logActivity(entry) {
  ensureDir();
  let log = [];
  if (existsSync(LOG_PATH)) {
    try {
      log = JSON.parse(readFileSync(LOG_PATH, "utf-8"));
    } catch {
      log = [];
    }
  }

  log.push({
    ...entry,
    timestamp: new Date().toISOString(),
  });

  // Keep last 500 entries
  if (log.length > 500) {
    log = log.slice(-500);
  }

  writeFileSync(LOG_PATH, JSON.stringify(log, null, 2));
}

export function getActivityLog() {
  if (!existsSync(LOG_PATH)) return [];
  try {
    return JSON.parse(readFileSync(LOG_PATH, "utf-8"));
  } catch {
    return [];
  }
}
