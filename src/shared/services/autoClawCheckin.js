// AutoClaw auto daily check-in — background scheduler.
//
// Runs once per day per AutoClaw connection (after the configured local hour),
// claiming AutoClaw's "daily_signin" client task via the same wallet/assetmgr
// auth 9router already uses. Opt-in and disabled by default.
//
// Enable via either:
//   - Settings `autoClawCheckin.enabled = true` (dashboard/storage), or
//   - env `AUTOCLAW_AUTO_CHECKIN=1`
// Optional: `AUTOCLAW_AUTO_CHECKIN_HOUR` (0-23, default 9),
//           `AUTOCLAW_AUTO_CHECKIN_TZ` (IANA tz, default server local).
//
// Fail-open everywhere: a tick error or a per-connection failure never kills
// the interval. Subject to AutoClaw's terms of service — it triggers AutoClaw's
// own daily check-in for the account that owns the stored token.

import "open-sse/index.js";

import {
  getProviderConnections,
  getSettings,
  updateSettings,
} from "@/lib/localDb";
import { checkInAutoClaw } from "open-sse/services/usage/misc.js";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { refreshAndUpdateCredentials } from "@/app/api/usage/[connectionId]/route.js";

export const AUTOCLAW_AUTO_CHECKIN_DEFAULTS = {
  enabled: false,
  hour: 9,
  tz: "",
  connections: {},
  lastRunByConnection: {},
};

const TICK_MS = 30 * 60 * 1000; // re-check every 30 min
const INITIAL_DELAY_MS = 30 * 1000;

// One scheduler per server process; survives Next.js hot reload.
const g = (global.__autoClawCheckin ??= {
  interval: null,
  initial: null,
  running: false,
});

function isTruthy(value) {
  if (value == null || value === "") return false;
  const v = String(value).trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function clampHour(value) {
  const h = Number(value);
  if (!Number.isFinite(h)) return AUTOCLAW_AUTO_CHECKIN_DEFAULTS.hour;
  return Math.min(23, Math.max(0, Math.floor(h)));
}

/** Resolve the effective config from settings + env overrides. */
export function resolveAutoClawCheckinConfig(settings) {
  const s = settings?.autoClawCheckin || {};
  const enabled =
    isTruthy(process.env.AUTOCLAW_AUTO_CHECKIN) || s.enabled === true;
  const hour = clampHour(
    process.env.AUTOCLAW_AUTO_CHECKIN_HOUR ?? s.hour ??
      AUTOCLAW_AUTO_CHECKIN_DEFAULTS.hour,
  );
  const tz = process.env.AUTOCLAW_AUTO_CHECKIN_TZ || s.tz || "";
  const connections =
    s.connections && typeof s.connections === "object" ? s.connections : null;
  return { enabled, hour, tz, connections };
}

function hourInTz(tz) {
  const now = new Date();
  if (!tz) return now.getHours();
  try {
    return Number(
      new Intl.DateTimeFormat("en-US", {
        hour: "2-digit",
        hour12: false,
        timeZone: tz,
      }).format(now),
    );
  } catch {
    return now.getHours();
  }
}

function dateKeyInTz(tz) {
  const now = new Date();
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz || undefined,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  }
}

async function buildProxyOptions(connection) {
  const cfg = await resolveConnectionProxyConfig(
    connection.providerSpecificData || {},
  );
  return {
    connectionProxyEnabled: cfg.connectionProxyEnabled === true,
    connectionProxyUrl: cfg.connectionProxyUrl || "",
    connectionNoProxy: cfg.connectionNoProxy || "",
    vercelRelayUrl: cfg.vercelRelayUrl || "",
    strictProxy: false,
  };
}

/** One scheduler pass. Safe to call directly (used by tests / manual trigger). */
export async function runAutoClawCheckinTick() {
  if (g.running) return { skipped: "already-running" };
  g.running = true;
  try {
    const settings = await getSettings();
    const cfg = resolveAutoClawCheckinConfig(settings);
    if (!cfg.enabled) return { skipped: "disabled" };
    if (hourInTz(cfg.tz) < cfg.hour) return { skipped: "before-hour" };

    const dateKey = dateKeyInTz(cfg.tz);
    const prev = settings.autoClawCheckin || {};
    const state = { ...(prev.lastRunByConnection || {}) };

    const connections = await getProviderConnections({ provider: "autoclaw" });
    const results = [];
    let stateChanged = false;

    for (const conn of connections) {
      if (conn.isActive === false) continue;
      if (cfg.connections && !cfg.connections[conn.id]) continue;
      if (state[conn.id] === dateKey) continue;

      try {
        const proxyOptions = await buildProxyOptions(conn);
        let active = conn;
        try {
          const refreshed = await refreshAndUpdateCredentials(conn, false, proxyOptions);
          active = refreshed.connection || conn;
        } catch {
          // fall back to the existing token
        }

        const res = await checkInAutoClaw(
          active.accessToken || active.apiKey,
          active.providerSpecificData,
          proxyOptions,
        );
        results.push({ connectionId: conn.id, provider: "autoclaw", ...res });
        if (res.ok) {
          state[conn.id] = dateKey;
          stateChanged = true;
        }
      } catch (error) {
        results.push({ connectionId: conn.id, ok: false, error: error.message });
      }
    }

    if (stateChanged) {
      await updateSettings({
        autoClawCheckin: { ...prev, lastRunByConnection: state },
      });
    }

    const claimed = results.filter((r) => r.ok && !r.alreadyCompleted);
    if (claimed.length) {
      console.log(
        `[AutoClawCheckin] claimed ${claimed.length} check-in(s): ` +
          claimed.map((r) => `${r.connectionId}(+${r.rewardPoints})`).join(", "),
      );
    }
    return { ok: true, dateKey, results };
  } catch (error) {
    console.log("[AutoClawCheckin] tick failed:", error.message);
    return { ok: false, error: error.message };
  } finally {
    g.running = false;
  }
}

export function startAutoClawCheckin() {
  if (g.interval) return;
  g.initial = setTimeout(() => {
    runAutoClawCheckinTick().catch(() => {});
  }, INITIAL_DELAY_MS);
  g.interval = setInterval(() => {
    runAutoClawCheckinTick().catch(() => {});
  }, TICK_MS);
}

export function stopAutoClawCheckin() {
  if (g.initial) {
    clearTimeout(g.initial);
    g.initial = null;
  }
  if (g.interval) {
    clearInterval(g.interval);
    g.interval = null;
  }
}

/** Apply settings: start the scheduler when enabled, stop it otherwise. */
export async function configureAutoClawCheckin(settings) {
  const resolved = settings ?? (await getSettings());
  const cfg = resolveAutoClawCheckinConfig(resolved);
  if (cfg.enabled) startAutoClawCheckin();
  else stopAutoClawCheckin();
  return cfg;
}
