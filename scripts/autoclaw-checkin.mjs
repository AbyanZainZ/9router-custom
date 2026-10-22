#!/usr/bin/env node
/**
 * AutoClaw daily check-in — standalone tester (no 9router server needed).
 *
 * Endpoint verified from the AutoClaw desktop client (renderer "AuthAPI" task
 * client -> IPC AUTH_COMPLETE_CLIENT_TASK -> main-process completeClientTask):
 *   POST https://autoglm-api.autoglm.ai/autoclaw-proxy/proxy/autoclaw-task-complete
 *   body: { "task_id": "daily_signin" }
 *
 * Usage:
 *   node scripts/autoclaw-checkin.mjs <access_token> [task_id]
 *   AUTOCLAW_TOKEN=<token> node scripts/autoclaw-checkin.mjs
 *
 * Get the access_token from your 9router AutoClaw connection (~/.9router DB)
 * or from the AutoClaw desktop client's network tab.
 *
 * NOTE: triggers AutoClaw's own daily check-in for the account that owns the
 * token. Subject to AutoClaw's terms of service.
 */
import crypto from "crypto";

const BASE = process.env.AUTOCLAW_API_BASE || "https://autoglm-api.autoglm.ai";
const APP_ID = process.env.AUTOCLAW_APP_ID || "100003";
const APP_KEY = process.env.AUTOCLAW_APP_KEY || "38d2391985e2369a5fb8227d8e6cd5e5";
const APP_VERSION = process.env.AUTOCLAW_APP_VERSION || "1.17.8";

const token = process.env.AUTOCLAW_TOKEN || process.argv[2];
const taskId = process.argv[3] || process.env.AUTOCLAW_TASK_ID || "daily_signin";

if (!token) {
  console.error("Missing access token.\n  node scripts/autoclaw-checkin.mjs <access_token> [task_id]");
  process.exit(1);
}

const ts = String(Math.floor(Date.now() / 1000));
const sign = crypto.createHash("md5").update(`${APP_ID}&${ts}&${APP_KEY}`).digest("hex");

const headers = {
  "X-Auth-Appid": APP_ID,
  "X-Auth-TimeStamp": ts,
  "X-Auth-Sign": sign,
  "X-Product": "autoclaw",
  "X-Version": APP_VERSION,
  "X-Tm": "mac",
  "X-Lang": "en",
  "X-Client-Type": "pc",
  "X-Trace-Id": crypto.randomUUID(),
  "Content-Type": "application/json",
  authorization: token.startsWith("Bearer ") ? token : `Bearer ${token}`,
};

console.log(`POST ${BASE}/autoclaw-proxy/proxy/autoclaw-task-complete  task_id=${taskId}`);
const res = await fetch(`${BASE}/autoclaw-proxy/proxy/autoclaw-task-complete`, {
  method: "POST",
  headers,
  body: JSON.stringify({ task_id: taskId }),
});
const text = await res.text();
console.log(`HTTP ${res.status}`);
console.log(text);
process.exit(res.ok ? 0 : 1);
