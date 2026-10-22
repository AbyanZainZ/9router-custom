// Ensure proxyFetch patches globalThis.fetch (same requirement as the usage route).
import "open-sse/index.js";

import { getProviderConnectionById, updateProviderConnection } from "@/lib/localDb";
import {
  checkInAutoClaw,
  getAutoClawTasks,
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
  const taskId = (url.searchParams.get("taskId") || AUTOCLAW_DAILY_SIGNIN_TASK_ID).trim();
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

    let result = await checkInAutoClaw(
      connection.accessToken || connection.apiKey,
      connection.providerSpecificData,
      proxyOptions,
      taskId,
    );

    // Token may have been stale mid-flight — force-refresh and retry once.
    if (!result.ok && /expired|invalid|log in|401|403/i.test(result.error || "") && connection.refreshToken) {
      try {
        connection = await refreshConnectionIfNeeded(
          { ...connection, expiresAt: null, lastRefreshAt: null },
          proxyOptions,
        );
      } catch {
        // ignore, retry with whatever token we have
      }
      result = await checkInAutoClaw(
        connection.accessToken || connection.apiKey,
        connection.providerSpecificData,
        proxyOptions,
        taskId,
      );
    }

    return Response.json(result, { status: result.ok ? 200 : 502 });
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

  const result = await getAutoClawTasks(connection.accessToken || connection.apiKey, lang);
  return Response.json(result, { status: result.ok ? 200 : 502 });
}
