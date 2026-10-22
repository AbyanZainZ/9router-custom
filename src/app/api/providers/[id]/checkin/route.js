// Ensure proxyFetch patches globalThis.fetch (same requirement as the usage route).
import "open-sse/index.js";

import { getProviderConnectionById, updateProviderConnection } from "@/lib/localDb";
import {
  checkInAutoClaw,
  bindAutoClawInviteCode,
  claimAutoClawLoginReward,
  getAutoClawInviteUrl,
  getAutoClawTasks,
  getAutoClawWalletTotal,
  AUTOCLAW_DAILY_SIGNIN_TASK_ID,
} from "open-sse/services/usage/misc.js";
import { getExecutor } from "open-sse/executors/index.js";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";

/** Refresh the AutoClaw access token in place when it is due, persisting updates. */
async function refreshConnectionIfNeeded(connection, proxyOptions) {
  const executor = getExecutor(connection.provider);
  const credentials = {
    accessToken: connection.accessToken,
    refreshToken: connection.refreshToken,
    expiresAt: connection.expiresAt || connection.tokenExpiresAt,
    lastRefreshAt: connection.lastRefreshAt,
    connectionId: connection.id,
    providerSpecificData: connection.providerSpecificData,
  };
  if (!executor.needsRefresh(credentials)) return connection;

  const refreshed = await executor.refreshCredentials(credentials, console, proxyOptions);
  if (!refreshed?.accessToken) return connection;

  const updateData = {
    accessToken: refreshed.accessToken,
    updatedAt: new Date().toISOString(),
  };
  if (refreshed.refreshToken) updateData.refreshToken = refreshed.refreshToken;
  await updateProviderConnection(connection.id, updateData);
  return { ...connection, ...updateData };
}

async function buildProxyOptions(connection) {
  const cfg = await resolveConnectionProxyConfig(connection.providerSpecificData);
  return {
    connectionProxyEnabled: cfg.connectionProxyEnabled === true,
    connectionProxyUrl: cfg.connectionProxyUrl || "",
    connectionNoProxy: cfg.connectionNoProxy || "",
    vercelRelayUrl: cfg.vercelRelayUrl || "",
    strictProxy: false,
  };
}

/**
 * POST /api/providers/autoclaw/checkin?connectionId=<id>&taskId=<optional>
 * Claims an AutoClaw client-task reward (default: the daily check-in
 * "daily_signin"). Uses the connection's stored OAuth token.
 *
 * Subject to AutoClaw's terms of service — this triggers AutoClaw's own
 * daily check-in on behalf of the account owner.
 */
export async function POST(request, { params }) {
  const { id } = await params;
  if (id !== "autoclaw") {
    return Response.json({ error: "Check-in is only supported for AutoClaw" }, { status: 400 });
  }

  const url = new URL(request.url);
  const connectionId = url.searchParams.get("connectionId");
  // No taskId = claim every daily grant (login reward + check-in + Hub).
  // An explicit taskId narrows the request back to a single task.
  const taskId = (url.searchParams.get("taskId") || "").trim() || null;
  if (!connectionId) {
    return Response.json({ error: "connectionId is required" }, { status: 400 });
  }

  try {
    let connection = await getProviderConnectionById(connectionId);
    if (!connection || connection.provider !== "autoclaw") {
      return Response.json({ error: "AutoClaw connection not found" }, { status: 404 });
    }

    const proxyOptions = await buildProxyOptions(connection);
    try {
      connection = await refreshConnectionIfNeeded(connection, proxyOptions);
    } catch {
      // Fall back to the existing token.
    }

    // ?action=bind-invite { inviteCode } - one-time referral binding for this
    // account. Separate from the daily claim path below.
    if (url.searchParams.get("action") === "bind-invite") {
      let body = {};
      try {
        body = await request.json();
      } catch {
        body = {};
      }
      const bound = await bindAutoClawInviteCode(
        connection.accessToken || connection.apiKey,
        connection.providerSpecificData?.deviceId,
        body?.inviteCode,
        proxyOptions,
      );
      return Response.json(bound, { status: bound.ok ? 200 : 502 });
    }

    // Three independent daily grants:
    //  1. user-info ("user active" login reward, 500 during the Oct 19-25 event)
    //  2. daily_signin      (daily check-in, 400)
    //  3. daily_inspiration_center (open the Inspiration Hub, 200)
    // An explicit taskId narrows it back to a single task for callers that
    // only want the old behaviour.
    const claimAll = async (conn) => {
      const token = conn.accessToken || conn.apiKey;
      const deviceId = conn.providerSpecificData?.deviceId;
      const before = await getAutoClawWalletTotal(token, proxyOptions);

      const results = [];
      if (!taskId || taskId === AUTOCLAW_DAILY_SIGNIN_TASK_ID) {
        const login = await claimAutoClawLoginReward(token, deviceId, proxyOptions);
        results.push({
          taskId: "daily_login",
          ok: login.ok,
          alreadyCompleted: false,
          rewardPoints: 0,
          error: login.error,
        });
      }

      const wanted = taskId
        ? [taskId]
        : [AUTOCLAW_DAILY_SIGNIN_TASK_ID, "daily_inspiration_center"];
      for (const id of wanted) {
        const res = await checkInAutoClaw(token, conn.providerSpecificData, proxyOptions, id);
        results.push({
          taskId: id,
          ok: res.ok,
          alreadyCompleted: !!res.alreadyCompleted,
          rewardPoints: Number(res.rewardPoints) || 0,
          error: res.error,
        });
      }

      const after = await getAutoClawWalletTotal(token, proxyOptions);
      return { results, before, after };
    };

    let { results, before, after } = await claimAll(connection);

    // Token may have been stale mid-flight — force-refresh and retry once.
    const authFailure = results.some(
      (r) => !r.ok && /expired|invalid|log in|401|403/i.test(r.error || ""),
    );
    if (authFailure && connection.refreshToken) {
      try {
        connection = await refreshConnectionIfNeeded(
          { ...connection, expiresAt: null, lastRefreshAt: null },
          proxyOptions,
        );
      } catch {
        // ignore, retry with whatever token we have
      }
      ({ results, before, after } = await claimAll(connection));
    }

    // Only tasks that actually paid out count as a new claim; the login-reward
    // entry carries no per-task amount, so totalGained is compared as well.
    const claimed = results.filter((r) => r.ok && !r.alreadyCompleted && r.rewardPoints > 0);
    const totalGained =
      Number.isFinite(before) && Number.isFinite(after) ? Math.max(0, after - before) : null;
    const ok = results.some((r) => r.ok);

    return Response.json(
      {
        ok,
        // Legacy fields kept for the existing row button.
        taskId: results[results.length - 1]?.taskId,
        rewardPoints: totalGained ?? claimed.reduce((sum, r) => sum + r.rewardPoints, 0),
        alreadyCompleted: claimed.length === 0 && !(totalGained > 0),
        totalGained,
        balance: Number.isFinite(after) ? after : null,
        tasks: results,
      },
      { status: ok ? 200 : 502 },
    );
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

/**
 * GET /api/providers/autoclaw/checkin?connectionId=<id>&lang=<lang>
 * Returns the AutoClaw client-task list (so a UI can show whether today's
 * check-in is still claimable) without claiming anything.
 */
export async function GET(request, { params }) {
  const { id } = await params;
  if (id !== "autoclaw") {
    return Response.json({ error: "Not supported for this provider" }, { status: 400 });
  }
  const url = new URL(request.url);
  const connectionId = url.searchParams.get("connectionId");
  const lang = url.searchParams.get("lang") || "en";
  if (!connectionId) {
    return Response.json({ error: "connectionId is required" }, { status: 400 });
  }

  const connection = await getProviderConnectionById(connectionId);
  if (!connection || connection.provider !== "autoclaw") {
    return Response.json({ error: "AutoClaw connection not found" }, { status: 404 });
  }

  // ?action=invite hands back the referral link (it embeds the account token,
  // so the UI only opens it instead of rendering it).
  if (url.searchParams.get("action") === "invite") {
    const proxyOptions = await buildProxyOptions(connection);
    const invite = await getAutoClawInviteUrl(
      connection.accessToken || connection.apiKey,
      { lang },
      proxyOptions,
    );
    return Response.json(invite, { status: invite.ok ? 200 : 502 });
  }

  const result = await getAutoClawTasks(connection.accessToken || connection.apiKey, lang);
  return Response.json(result, { status: result.ok ? 200 : 502 });
}
