/**
 * Misc usage handlers (iFlow, Ollama, GLM, Vercel AI Gateway, Qoder)
 */

import crypto from "crypto";
import { PROVIDER_OAUTH } from "../../providers/index.js";
import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { U } from "./shared.js";

export { getGlmUsage } from "./glm.js";


// Vercel AI Gateway credits endpoint
// Returns { balance: "95.50", total_used: "4.50" } (USD as decimal strings).
const VERCEL_AI_GATEWAY_CREDITS_URL = U("vercel-ai-gateway").url;

/**
 * iFlow Usage
 */
export async function getIflowUsage(accessToken) {
  try {
    // iFlow may have usage endpoint
    return { message: "iFlow connected. Usage tracked per request." };
  } catch (error) {
    return { message: "Unable to fetch iFlow usage." };
  }
}

const OLLAMA_LIMIT_WINDOWS = {
  session: "Session (5h)",
  weekly: "Weekly (7d)",
  monthly: "Monthly",
};

function addUtcMonths(date, months) {
  const total = date.getUTCMonth() + months;
  const year = date.getUTCFullYear() + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(
    year, month, Math.min(date.getUTCDate(), lastDay),
    date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(),
  ));
}

// Free plan: "usage resets monthly from the date you signed up" (ollama.com/pricing).
function nextMonthlyResetFromSignup(createdAt, now = new Date()) {
  const anchor = new Date(createdAt);
  if (Number.isNaN(anchor.getTime())) return null;
  const elapsedMonths = (now.getUTCFullYear() - anchor.getUTCFullYear()) * 12
    + (now.getUTCMonth() - anchor.getUTCMonth());
  for (let i = Math.max(0, elapsedMonths); i <= elapsedMonths + 1; i++) {
    const candidate = addUtcMonths(anchor, i);
    if (candidate > now) return candidate.toISOString();
  }
  return null;
}

/**
 * Ollama Cloud Usage
 * GET https://ollama.com/api/usage — `limits.<window>.usage` is a 0..1 ratio
 *   (1.0 = limit reached). Paid plans report session (5h) + weekly (7d); the
 *   free plan reports a single monthly window. No reset timestamp exposed;
 *   the free monthly reset is derived from the account's signup date.
 * POST https://ollama.com/api/me — plan label + CreatedAt (fail-open).
 * Auth: Authorization: Bearer <apiKey>
 */
export async function getOllamaUsage(apiKey, providerSpecificData, proxyOptions = null) {
  if (!apiKey) {
    return { message: "Ollama Cloud API key not available." };
  }

  try {
    const response = await proxyAwareFetch("https://ollama.com/api/usage", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    }, proxyOptions);

    if (response.status === 401 || response.status === 403) {
      return { message: "Ollama Cloud API key invalid or expired." };
    }

    if (!response.ok) {
      return { message: `Ollama Cloud usage API error (${response.status}).` };
    }

    let data;
    try {
      data = await response.json();
    } catch {
      return { message: "Ollama Cloud usage response was not JSON." };
    }

    // Best-effort plan label from /api/me
    const me = await proxyAwareFetch("https://ollama.com/api/me", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        "Content-Length": "0",
      },
    }, proxyOptions).then((r) => (r.ok ? r.json() : null)).catch(() => null);

    const planRaw = typeof me?.Plan === "string" ? me.Plan : "";
    const plan = planRaw
      ? planRaw.charAt(0).toUpperCase() + planRaw.slice(1).toLowerCase()
      : "Ollama Cloud";

    const limits = data?.limits && typeof data.limits === "object" ? data.limits : {};

    // Ollama `usage` is a 0..1 ratio (1.0 = limit reached). Convert to a 0..100
    // bar. Do NOT set absolute `remaining` — QuotaTable reads remainingPercentage.
    function ratioQuota(usageRatio, resetAt = null) {
      const ratio = Math.max(0, Math.min(1, Number(usageRatio) || 0));
      const usedPct = Math.round(ratio * 100);
      return { used: usedPct, total: 100, remainingPercentage: 100 - usedPct, resetAt, unlimited: false };
    }

    const monthlyResetAt = planRaw.toLowerCase() === "free" && me?.CreatedAt
      ? nextMonthlyResetFromSignup(me.CreatedAt)
      : null;

    const quotas = {};
    for (const [key, label] of Object.entries(OLLAMA_LIMIT_WINDOWS)) {
      const raw = limits[key]?.usage;
      if (raw === undefined || raw === null) continue;
      const ratio = Number(raw);
      if (Number.isNaN(ratio)) continue;
      quotas[label] = ratioQuota(ratio, key === "monthly" ? monthlyResetAt : null);
    }

    if (Object.keys(quotas).length === 0) {
      return {
        plan,
        message: "Ollama Cloud connected. No usage limits reported.",
        quotas: {},
      };
    }

    return { plan, quotas };
  } catch (error) {
    return { message: `Ollama Cloud error: ${error.message}` };
  }
}



/**
 * Vercel AI Gateway usage — credit balance for the API key
 *
 * Calls GET /v1/credits which returns:
 *   { "balance": "95.50", "total_used": "4.50" }   (USD as decimal strings)
 *
 * We surface this as a single "Balance ($)" quota row so the existing
 * QuotaTable / progress-bar UI can render it. used = total_used,
 * total = balance + total_used (the original credit allotment), so the
 * remaining percentage equals balance / total.
 *
 * Docs: https://vercel.com/docs/ai-gateway/usage
 */
export async function getVercelAiGatewayUsage(apiKey, proxyOptions = null) {
  if (!apiKey) {
    return { message: "Vercel AI Gateway API key not available." };
  }

  try {
    const response = await proxyAwareFetch(VERCEL_AI_GATEWAY_CREDITS_URL, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    }, proxyOptions);

    if (response.status === 401 || response.status === 403) {
      return { message: "Vercel AI Gateway API key invalid or expired." };
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      const trimmed = errorText ? `: ${errorText.slice(0, 200)}` : "";
      return { message: `Vercel AI Gateway credits API error (${response.status})${trimmed}` };
    }

    const data = await response.json();

    // Vercel returns numeric strings; coerce safely.
    const balance = Number(data?.balance) || 0;
    const totalUsed = Number(data?.total_used) || 0;

    // Vercel gives $5/month free credit. The API doesn't return the
    // monthly allocation so we use the known constant as the denominator.
    const MONTHLY_CREDIT = 5;
    const remainingPercentage = (balance / MONTHLY_CREDIT) * 100;

    if (balance <= 0 && totalUsed <= 0) {
      return {
        plan: "Pay-as-you-go",
        message: "Vercel AI Gateway connected. No credit allocation found (BYOK or unfunded account).",
        quotas: {},
      };
    }

    // "Used (USD)": how much has been spent this month (no fixed cap → unlimited).
    // "Remaining (USD)": balance remaining out of the $5 monthly allocation.
    return {
      plan: "Pay-as-you-go",
      quotas: {
        "Used (USD)": {
          used: totalUsed,
          total: 0,
          remaining: 0,
          remainingPercentage: 100,
          unlimited: true,
        },
        "Remaining (USD)": {
          used: balance,
          total: MONTHLY_CREDIT,
          remaining: balance,
          remainingPercentage,
          unlimited: false,
        },
      },
    };
  } catch (error) {
    return { message: `Vercel AI Gateway error: ${error.message}` };
  }
}

export async function getQoderUsage(accessToken, proxyOptions = null, providerId = "qoder") {
  if (!accessToken) {
    return { message: "Qoder usage unavailable: no access token" };
  }
  try {
    const response = await proxyAwareFetch(
      U(providerId).url,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      },
      proxyOptions,
    );
    if (!response.ok) {
      return { message: `Qoder connected. Usage fetch returned ${response.status}.` };
    }
    const body = await response.json().catch(() => null);
    if (!body) {
      return { message: "Qoder connected. Usage response was not JSON." };
    }
    // Quota records live under `quotas`; scalar metadata
    // (totalUsagePercentage, isQuotaExceeded, expiresAt) are surfaced as
    // siblings so the dashboard parser doesn't try to render them as rows.
    const userQuota = body.userQuota || {};
    const orgQuota = body.orgResourcePackage || {};
    // Add-on credits (free grants / promos). Qoder emits this block only when
    // the account actually holds a grant — an account that never redeemed one,
    // or consumed it, omits the key entirely. Verified against both regions:
    // qoder CN returns it (e.g. 2200 total) after redeeming the free-credit
    // promo, while an intl account without a grant has no such key. Gating on
    // total > 0 keeps the intl/no-grant shape byte-identical to before.
    const addOnQuota = body.addOnQuota || {};
    const addOnTotal = Number(addOnQuota.total) || 0;
    // Qoder publishes a single absolute reset timestamp (`expiresAt` in ms);
    // surface it on every quota record as ISO so the table can render
    // "resets at" alongside used/total. 253402214400000 (9999-12-31T00:00:00Z)
    // is Qoder's "never expires" sentinel, returned by both regions for
    // open-ended plans — rendering a reset date in the year 9999 is noise, so
    // flag it instead and let the tracker word it as "Never expires".
    const expiresAtMs = Number.isFinite(Number(body.expiresAt)) && Number(body.expiresAt) > 0
      ? Number(body.expiresAt)
      : null;
    const NO_RESET_SENTINEL_MS = 253402214400000;
    const neverExpires = expiresAtMs === NO_RESET_SENTINEL_MS;
    const resetAt = expiresAtMs && !neverExpires ? new Date(expiresAtMs).toISOString() : null;
    const quotas = {
      user: {
        total: Number(userQuota.total) || 0,
        used: Number(userQuota.used) || 0,
        remaining: Number(userQuota.remaining) || 0,
        unit: userQuota.unit || "credits",
        resetAt,
        neverExpires,
      },
      organization: {
        total: Number(orgQuota.total) || 0,
        used: Number(orgQuota.used) || 0,
        remaining: Number(orgQuota.remaining) || 0,
        unit: orgQuota.unit || "credits",
        resetAt,
        neverExpires,
      },
    };
    if (addOnTotal > 0) {
      quotas.addOn = {
        total: addOnTotal,
        used: Number(addOnQuota.used) || 0,
        remaining: Number(addOnQuota.remaining) || 0,
        unit: addOnQuota.unit || "credits",
        // The add-on block carries no expiry of its own in this API. Qoder's
        // web console lists every redeemed resource package with its own
        // deadline (check-in bonuses do expire, typically ~30 days), but
        // openapi only exposes the account-level `expiresAt` sentinel above,
        // which describes the plan, not the grants — reusing it here would
        // advertise "never expires" for credits that actually expire. So
        // leave the reset date unset and let the row link to Qoder's own
        // usage page (detailUrl) where the per-package dates live.
        resetAt: null,
        neverExpires: false,
        detailUrl: addOnQuota.detailUrl || null,
      };
    }
    return {
      quotas,
      totalUsagePercentage: Number(body.totalUsagePercentage) || 0,
      isQuotaExceeded: !!body.isQuotaExceeded,
      expiresAt: expiresAtMs,
    };
  } catch (error) {
    return { message: `Qoder connected. Unable to fetch usage: ${error.message}` };
  }
}

const AUTOCLAW_API_BASE = "https://autoglm-api.autoglm.ai";
const AUTOCLAW_WALLETS_PATH = "/agent-assetmgr/api/v2/wallets";
const AUTOCLAW_WALLET_INSTANCES_PATH = "/agent-assetmgr/api/v1/wallet-instances";
const AUTOCLAW_TASK_LIST_PATH = "/autoclaw-proxy/proxy/autoclaw-task-list";
const AUTOCLAW_TASK_COMPLETE_PATH = "/autoclaw-proxy/proxy/autoclaw-task-complete";

// The task id AutoClaw's "Daily Check In" banner claims (400 pts/day).
export const AUTOCLAW_DAILY_SIGNIN_TASK_ID = "daily_signin";

function autoClawAppHeaders() {
  const oauth = PROVIDER_OAUTH["autoclaw"] || {};
  const appId = oauth.appId || "100003";
  const appKey = oauth.appKey || "38d2391985e2369a5fb8227d8e6cd5e5";
  const ts = String(Math.floor(Date.now() / 1000));
  const sign = crypto
    .createHash("md5")
    .update(`${appId}&${ts}&${appKey}`)
    .digest("hex");
  return {
    "X-Auth-Appid": appId,
    "X-Auth-TimeStamp": ts,
    "X-Auth-Sign": sign,
    "X-Product": "autoclaw",
    "X-Version": oauth.appVersion || "2.2.1",
    "X-Channel": oauth.channel || "AutoClaw5",
    "X-Tm": "win",
    "X-Lang": "zh-CN",
    "X-Client-Type": "pc",
    "X-Trace-Id": crypto.randomUUID(),
    Accept: "application/json",
  };
}

function autoClawBearer(token) {
  const t = String(token || "");
  return t.startsWith("Bearer ") ? t : `Bearer ${t}`;
}

/**
 * Fetch the AutoClaw client-task list. The daily check-in status lives here
 * (task_id "daily_signin": status, reward_points, completed flag).
 * @returns {Promise<{ok:boolean, tasks?:Array, error?:string}>}
 */
export async function getAutoClawTasks(accessToken, lang = "en", proxyOptions = null) {
  if (!accessToken) {
    return { ok: false, error: "AutoClaw access token not available." };
  }
  try {
    const url = `${AUTOCLAW_API_BASE}${AUTOCLAW_TASK_LIST_PATH}?lang=${encodeURIComponent(lang)}`;
    const res = await proxyAwareFetch(
      url,
      {
        method: "GET",
        headers: { ...autoClawAppHeaders(), authorization: autoClawBearer(accessToken) },
      },
      proxyOptions,
    );
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: "AutoClaw access token invalid or expired." };
    }
    if (!res.ok) {
      return { ok: false, error: `AutoClaw task-list HTTP ${res.status}` };
    }
    const json = await res.json().catch(() => null);
    if (!json) {
      return { ok: false, error: "AutoClaw task-list non-JSON response." };
    }
    if (json.code != null && json.code !== 0) {
      return { ok: false, error: `AutoClaw task-list error: ${json.msg || json.code}` };
    }
    const tasks = Array.isArray(json.data) ? json.data : json.data?.tasks || [];
    return { ok: true, tasks };
  } catch (error) {
    return { ok: false, error: `AutoClaw task-list error: ${error.message}` };
  }
}

// AutoClaw sells credits, not rate-limit windows. The v2 wallet endpoint
// returns one total plus per-bucket balances; older accounts only have the
// wallet-instances endpoint. display_name ships in Chinese, so the labels are
// ours.
const AUTOCLAW_WALLET_LABELS = {
  reward: "Reward points",
  earned: "Earned points",
  daily: "Daily points",
  monthly: "Monthly credits",
  long_term: "Long-term credits",
  annual: "Annual credits",
  campaign: "Campaign credits",
  subscription: "Subscription credits",
  fuel_pack: "Fuel pack",
  other: "Other credits",
};

function autoClawNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/,/g, "").trim();
    if (cleaned) {
      const n = Number(cleaned);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function autoClawWalletKey(wallet) {
  const raw = wallet.public_wallet_type || wallet.wallet_type || wallet.wallet_scope || "";
  return String(raw).trim().toLowerCase().replace(/^wallet_scope_/, "");
}

function autoClawWalletLabel(wallet, key) {
  return AUTOCLAW_WALLET_LABELS[key] || (key ? key.replace(/_/g, " ") : "Credits");
}

/**
 * AutoClaw credit balance (wallets + per-bucket breakdown).
 * @returns {Promise<{quotas?:Object, message?:string}>}
 */
export async function getAutoClawUsage(accessToken, proxyOptions = null) {
  if (!accessToken) {
    return { message: "AutoClaw access token not available." };
  }

  const headers = { ...autoClawAppHeaders(), authorization: autoClawBearer(accessToken) };

  const readEnvelope = async (path, query) => {
    const qs = new URLSearchParams(query).toString();
    const res = await proxyAwareFetch(
      `${AUTOCLAW_API_BASE}${path}${qs ? `?${qs}` : ""}`,
      { method: "GET", headers },
      proxyOptions,
    );
    if (res.status === 401 || res.status === 403) {
      return { error: "AutoClaw access token invalid or expired." };
    }
    if (!res.ok) return { error: `AutoClaw wallet HTTP ${res.status}` };
    const json = await res.json().catch(() => null);
    if (!json) return { error: "AutoClaw wallet non-JSON response." };
    if (json.code != null && json.code !== 0) {
      return { error: `AutoClaw wallet error: ${json.msg || json.code}` };
    }
    return { data: json.data || {} };
  };

  try {
    let total = null;
    let wallets = [];

    const primary = await readEnvelope(AUTOCLAW_WALLETS_PATH, { biz_app_id: "autoclaw" });
    if (!primary.error && Array.isArray(primary.data.wallets)) {
      total = autoClawNumber(primary.data.total_balance);
      wallets = primary.data.wallets
        .filter((w) => w && w.display !== false)
        .sort(
          (a, b) =>
            (autoClawNumber(a.priority) ?? Number.MAX_SAFE_INTEGER) -
            (autoClawNumber(b.priority) ?? Number.MAX_SAFE_INTEGER),
        )
        .map((w) => {
          const key = autoClawWalletKey(w);
          return { key, label: autoClawWalletLabel(w, key), balance: autoClawNumber(w.balance) };
        });
    }

    if (total === null) {
      const legacy = await readEnvelope(AUTOCLAW_WALLET_INSTANCES_PATH, {
        wallet_type: "all",
        wallet_scope: "all",
      });
      if (legacy.error) return { message: legacy.error };
      total = autoClawNumber(legacy.data.total_balance);
      wallets = (Array.isArray(legacy.data.wallet_instances) ? legacy.data.wallet_instances : [])
        .filter(
          (w) =>
            w &&
            w.display !== false &&
            String(w.status || "active").toLowerCase() === "active",
        )
        .map((w) => {
          const key = autoClawWalletKey(w);
          return { key, label: autoClawWalletLabel(w, key), balance: autoClawNumber(w.balance) };
        });
    }

    const quotas = {
      Credits: {
        used: 0,
        total: total ?? 0,
        isCreditBalance: true,
        currency: "credits",
        detailUrl: "https://autoclaw.z.ai/web/",
      },
    };

    const used = new Set(["credits"]);
    for (const wallet of wallets) {
      if (!Number.isFinite(wallet.balance)) continue;
      let name = wallet.label;
      // Two buckets can share a label (reward + earned); keep both readable.
      if (used.has(name.toLowerCase())) name = `${name} (${wallet.key})`;
      if (used.has(name.toLowerCase())) continue;
      used.add(name.toLowerCase());
      quotas[name] = {
        used: 0,
        total: wallet.balance,
        isCreditBalance: true,
        currency: "credits",
        detailUrl: "https://autoclaw.z.ai/web/",
      };
    }

    return { quotas };
  } catch (error) {
    return { message: `AutoClaw usage error: ${error.message}` };
  }
}

/** Credit balance across every wallet - used to measure what a claim added. */
export async function getAutoClawWalletTotal(accessToken, proxyOptions = null) {
  if (!accessToken) return null;
  try {
    const res = await proxyAwareFetch(
      `${AUTOCLAW_API_BASE}${AUTOCLAW_WALLETS_PATH}?biz_app_id=autoclaw`,
      {
        method: "GET",
        headers: { ...autoClawAppHeaders(), authorization: autoClawBearer(accessToken) },
      },
      proxyOptions,
    );
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    if (!json || (json.code != null && json.code !== 0)) return null;
    return autoClawNumber(json.data?.total_balance);
  } catch {
    return null;
  }
}

/**
 * Trigger AutoClaw's "user active" login reward.
 *
 * The desktop client calls user-info on every start; that is what grants the
 * daily login credits (ledger event "autoclaw_user_active", currently 500/day
 * during the Oct 19-25 event). Same call also reports whether the daily
 * check-in was completed by the request itself.
 */
export async function claimAutoClawLoginReward(accessToken, deviceId, proxyOptions = null) {
  if (!accessToken) {
    return { ok: false, error: "AutoClaw access token not available." };
  }
  try {
    const res = await proxyAwareFetch(
      `${AUTOCLAW_API_BASE}/userapi/v1/user-info`,
      {
        method: "POST",
        headers: {
          ...autoClawAppHeaders(),
          "Content-Type": "application/json",
          authorization: autoClawBearer(accessToken),
        },
        body: JSON.stringify({
          source_id: "autoclaw",
          device_id: deviceId || crypto.randomUUID(),
        }),
      },
      proxyOptions,
    );
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: "AutoClaw access token invalid or expired." };
    }
    if (!res.ok) return { ok: false, error: `AutoClaw user-info HTTP ${res.status}` };
    const json = await res.json().catch(() => null);
    if (!json) return { ok: false, error: "AutoClaw user-info non-JSON response." };
    if (json.code != null && json.code !== 0) {
      return { ok: false, error: `AutoClaw user-info error: ${json.msg || json.code}` };
    }
    return {
      ok: true,
      dailyCheckInCompletedOnRequest: json.data?.daily_check_in_completed_on_request === true,
    };
  } catch (error) {
    return { ok: false, error: `AutoClaw user-info error: ${error.message}` };
  }
}

/** Numeric AutoClaw account id carried by the access token. */
function autoClawUserId(accessToken) {
  try {
    const payload = String(accessToken).replace(/^Bearer\s+/i, "").split(".")[1];
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const uid = json.uid ?? json.user_id ?? json.numeric_user_id;
    return uid == null ? null : String(uid);
  } catch {
    return null;
  }
}

/**
 * Bind a friend's invite code to this account (referral activity
 * "autoclaw_fission"). One-time per account; the reward goes to the code owner.
 */
export async function bindAutoClawInviteCode(accessToken, deviceId, inviteCode, proxyOptions = null) {
  const code = String(inviteCode || "").trim();
  if (!accessToken) return { ok: false, error: "AutoClaw access token not available." };
  if (!code) return { ok: false, error: "Invite code is empty." };

  try {
    const res = await proxyAwareFetch(
      `${AUTOCLAW_API_BASE}/agent-assetmgr/api/v1/fission-v2/bind`,
      {
        method: "POST",
        headers: {
          ...autoClawAppHeaders(),
          "Content-Type": "application/json",
          authorization: autoClawBearer(accessToken),
        },
        body: JSON.stringify({
          activity_id: "autoclaw_fission",
          business: "autoclaw",
          invite_code: code,
          source_id: "autoclaw",
          device_id: deviceId || crypto.randomUUID(),
        }),
      },
      proxyOptions,
    );
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: "AutoClaw access token invalid or expired." };
    }
    const json = await res.json().catch(() => null);
    if (!json) return { ok: false, error: `AutoClaw invite bind HTTP ${res.status}` };
    if (json.code !== 0) {
      const message =
        json.code === 400001 || json.code === 650005
          ? `Invite code is not valid for this account${json.msg ? ` (${json.msg})` : ""}.`
          : `AutoClaw invite bind error: ${json.msg || json.code}`;
      return { ok: false, code: json.code, error: message };
    }
    return { ok: true, message: "Invite code bound" };
  } catch (error) {
    return { ok: false, error: `AutoClaw invite bind error: ${error.message}` };
  }
}

/**
 * Referral link from the "invite_friends" client task. The template ships with
 * {{userId}} / {{token}} placeholders that the desktop client fills in.
 */
export async function getAutoClawInviteUrl(
  accessToken,
  { appVersion = "2.2.1", os = "win", lang = "en" } = {},
  proxyOptions = null,
) {
  const list = await getAutoClawTasks(accessToken, lang, proxyOptions);
  if (!list.ok) return { ok: false, error: list.error };
  const task = (list.tasks || []).find((t) => t && t.task_id === "invite_friends");
  const template = task?.metadata?.url;
  if (!template) return { ok: false, error: "AutoClaw did not return an invite link." };

  const token = String(accessToken || "").replace(/^Bearer\s+/i, "");
  const uid = autoClawUserId(token) || "";
  const url = String(template)
    .split("{{name}}").join("AutoClaw")
    .split("{{version}}").join(appVersion)
    .split("{{os}}").join(os)
    .split("{{userId}}").join(uid)
    .split("{{token}}").join(token);

  return {
    ok: true,
    url,
    invited: Number(task.current_count) || 0,
    target: Number(task.target_count) || 0,
  };
}

/**
 * Claim an AutoClaw client-task reward. Defaults to the daily check-in.
 * @returns {Promise<{ok:boolean, taskId?:string, alreadyCompleted?:boolean, rewardPoints?:number, message?:string, error?:string}>}
 */
export async function checkInAutoClaw(
  accessToken,
  providerSpecificData = null,
  proxyOptions = null,
  taskId = AUTOCLAW_DAILY_SIGNIN_TASK_ID,
) {
  if (!accessToken) {
    return { ok: false, error: "AutoClaw access token not available." };
  }
  try {
    const res = await proxyAwareFetch(
      `${AUTOCLAW_API_BASE}${AUTOCLAW_TASK_COMPLETE_PATH}`,
      {
        method: "POST",
        headers: {
          ...autoClawAppHeaders(),
          "Content-Type": "application/json",
          authorization: autoClawBearer(accessToken),
        },
        body: JSON.stringify({ task_id: taskId }),
      },
      proxyOptions,
    );
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: "AutoClaw access token invalid or expired." };
    }
    if (!res.ok) {
      return { ok: false, error: `AutoClaw task-complete HTTP ${res.status}` };
    }
    const json = await res.json().catch(() => null);
    if (!json) {
      return { ok: false, error: "AutoClaw task-complete non-JSON response." };
    }
    if (json.code != null && json.code !== 0) {
      return { ok: false, error: `AutoClaw task-complete error: ${json.msg || json.code}` };
    }
    const data = json.data || {};
    const rewardPoints = Number(data.reward_points) || 0;
    return {
      ok: true,
      taskId,
      alreadyCompleted: !!data.already_completed,
      rewardPoints,
      message: data.already_completed
        ? "Already checked in today."
        : `Checked in successfully. +${rewardPoints} points.`,
    };
  } catch (error) {
    return { ok: false, error: `AutoClaw task-complete error: ${error.message}` };
  }
}
