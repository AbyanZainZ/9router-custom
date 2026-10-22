import crypto from "crypto";
import { AUTOCLOW_CONFIG } from "../constants/oauth.js";

// AutoClaw rejects every signed userapi call whose app headers are missing or
// stale, so the signing recipe lives in one place.
function buildAppHeaders(config) {
  const appId = config.appId;
  const appKey = config.appKey;
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
    "X-Version": config.appVersion || "2.2.1",
    "X-Channel": config.channel || "AutoClaw5",
    "X-Tm": "win",
    "X-Lang": "zh-CN",
    Accept: "*/*",
    "X-Trace-Id": crypto.randomUUID(),
    "Content-Type": "application/json",
  };
}

/**
 * Fetch the challenge AutoClaw wants before it will hand out an OAuth URL.
 * The desktop client asks the same endpoint and renders the captcha locally;
 * the verify param then travels with the OAuth URL request.
 */
export async function fetchAutoClawCaptchaConfig(config) {
  if (!config.captchaConfigUrl) return { enabled: false, supplier: null };
  const response = await fetch(config.captchaConfigUrl, {
    method: "POST",
    headers: buildAppHeaders(config),
    body: "{}",
  });
  if (!response.ok) {
    throw new Error(`AutoClaw captcha config failed: ${response.status}`);
  }
  const resp = await response.json();
  if (resp.code != null && resp.code !== 0) {
    throw new Error(`AutoClaw captcha config error: code=${resp.code} msg=${resp.msg}`);
  }
  const data = resp.data || {};
  // The dashboard only renders Aliyun's widget; other suppliers (shumei) need
  // their own SDK, so report them as unsupported rather than pretending.
  const supplier = String(data.captcha_supplier || "").trim().toLowerCase() || null;
  // Aliyun hosts the same widget on region-specific backends; the browser SDK
  // must be told which one, or the proof it issues is signed by the wrong
  // service and the OAuth URL call answers 630014.
  const region = String(data.region || "").trim().toLowerCase() || null;
  const prefix = data.prefix ? String(data.prefix).trim() : null;
  const sceneId = data.scene_id ? String(data.scene_id).trim() : null;
  const aliyunReady =
    supplier === "aliyun" &&
    ["cn", "sgp", "ga"].includes(region) &&
    Boolean(sceneId && prefix);
  return {
    enabled: Boolean(data.enabled) && aliyunReady,
    supplier,
    sceneId,
    prefix,
    region,
  };
}


// Loopback ports the desktop client listens on (first free wins).
const AUTOCLAW_CALLBACK_PORTS = [18432, 19654, 19723, 53699];

// AutoClaw — Google OAuth via AutoClaw overseas endpoint (device_code-shaped).
const autoclaw = {
  config: AUTOCLOW_CONFIG,
  flowType: "device_code",
  // AutoClaw's Google OAuth flow is a 2-step intermediary: we ask AutoClaw's
  // API for a Google consent URL (with app-signing headers), the user logs in,
  // Google redirects to localhost:18432/auth/callback-google, and we exchange
  // the code via AutoClaw's google-oauth-login endpoint. Modelled as
  // device_code so requestDeviceCode (async) can call the API + start a
  // fixed-port proxy, and pollToken checks the proxy session.
  requestDeviceCode: async (config, _codeChallenge, options = {}) => {
    const { startAutoClawProxy, registerAutoClawSession } =
      await import("../utils/server.js");
    const authMethod = options.authMethod === "zai" ? "zai" : "google";
    const deviceId = crypto.randomUUID();

    // App-signing headers for AutoClaw userapi calls.
    const headers = buildAppHeaders(config);

    // Start the callback listener before the browser redirects. navigate_uri
    // must carry the port that actually bound, because AutoClaw's Google client
    // only accepts its own registered loopback ports.
    const proxyResult = await startAutoClawProxy(
      config.callbackPorts || AUTOCLAW_CALLBACK_PORTS,
    );
    if (!proxyResult.success) {
      if (proxyResult.reason === "port_busy") {
        const ports = (config.callbackPorts || AUTOCLAW_CALLBACK_PORTS).join(", ");
        throw new Error(
          `AutoClaw login needs one of the local callback ports (${ports}) but all of them are in use - ` +
            "usually the AutoClaw desktop app, which keeps 18432 open. Close it and retry, " +
            'or use "1-Click Import from App" instead.',
        );
      }
      throw new Error(`Failed to start callback proxy: ${proxyResult.reason}`);
    }
    const callbackOrigin = options.callbackOrigin;
    const callbackBase = callbackOrigin
      ? `${callbackOrigin}/api/oauth/autoclaw/callback/`
      : `http://localhost:${proxyResult.port}/auth/callback-`;
    const navigateUri = callbackOrigin
      ? `${callbackBase}${authMethod}`
      : authMethod === "zai"
        ? `${callbackBase}zai`
        : `${callbackBase}google`;

    const authorizeUrl =
      authMethod === "zai" ? config.zaiAuthorizeUrl : config.authorizeUrl;
    const response = await fetch(authorizeUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        source_id: config.sourceId,
        device_id: deviceId,
        navigate_uri: navigateUri,
        // Server rejects the OAuth URL request (631002) without a valid
        // Aliyun captcha verify param.
        ...(options.captchaParam
          ? { ali_captcha_verify_param: options.captchaParam }
          : {}),
      }),
    });
    if (!response.ok) {
      throw new Error(`AutoClaw OAuth URL request failed: ${response.status}`);
    }
    const resp = await response.json();
    if (resp.code != null && resp.code !== 0) {
      // 631002 means "challenge missing/invalid" in practice: the server returns
      // it (with a stale-version message) whenever ali_captcha_verify_param is
      // absent, so point at the real cause instead of the misleading text.
      if (resp.code === 631002) {
        throw new Error(
          `AutoClaw requires a captcha check before login (code=631002 msg=${resp.msg}). ` +
            "Complete the security check in the Connect dialog and retry.",
        );
      }
      // 630014 is the server rejecting a proof it did receive: the challenge
      // expired, was already consumed, or was issued for another Aliyun region.
      // The dialog keeps the widget open so the user can solve it again.
      if (resp.code === 630014) {
        throw new Error(
          "AutoClaw rejected the security check (code=630014). " +
            "Solve the challenge again to continue.",
        );
      }
      throw new Error(
        `AutoClaw OAuth URL error: code=${resp.code} msg=${resp.msg}`,
      );
    }
    const data = resp.data || {};
    if (!data.oauth_url || !data.state) {
      throw new Error("AutoClaw OAuth URL response missing oauth_url/state");
    }

    // Register session keyed by AutoClaw's state (= device_code for poll).
    registerAutoClawSession(data.state, deviceId, authMethod, navigateUri);

    return {
      device_code: data.state,
      // No user_code: AutoClaw authorizes in the browser, and a pseudo code
      // only adds noise to the device-flow panel.
      verification_uri: data.oauth_url,
      verification_uri_complete: data.oauth_url,
      expires_in: 300,
      interval: 2,
    };
  },
  pollToken: async (config, deviceCode) => {
    const {
      getAutoClawSessionStatus,
      clearAutoClawSession,
      stopAutoClawProxy,
    } = await import("../utils/server.js");

    const session = getAutoClawSessionStatus(deviceCode);
    if (!session) {
      return { ok: false, data: { error: "authorization_pending" } };
    }
    if (session.status === "error") {
      clearAutoClawSession(deviceCode);
      stopAutoClawProxy();
      return { ok: false, data: { error: session.error || "access_denied" } };
    }
    if (session.status === "done") {
      // Already exchanged (shouldn't normally hit this path — tokens saved
      // by the route after the first success).
      return { ok: true, data: session.tokens };
    }
    if (session.status !== "exchanging") {
      return { ok: false, data: { error: "authorization_pending" } };
    }

    // Exchange the provider callback code for AutoClaw tokens.
    const headers = buildAppHeaders(config);

    const tokenUrl =
      session.authMethod === "zai" ? config.zaiTokenUrl : config.tokenUrl;
    const exchangeNavigateUri =
      session.navigateUri ||
      (session.authMethod === "zai"
        ? `${config.redirectUri.replace("callback-google", "callback-zai")}`
        : config.redirectUri);
    // The state Google handed back is the one AutoClaw signs into the consent
    // URL, so it is what the desktop client replays here. The value returned by
    // the URL endpoint is used only as a session key - and as a fallback in case
    // an older backend echoed a different value.
    const attemptExchange = async (state) => {
      const response = await fetch(tokenUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          source_id: config.sourceId,
          device_id: session.deviceId,
          code: session.code,
          state,
          navigate_uri: exchangeNavigateUri,
        }),
      });
      if (!response.ok) {
        return { ok: false, status: response.status, text: await response.text() };
      }
      return { ok: true, status: response.status, json: await response.json() };
    };

    const preferredState = session.callbackState || deviceCode;
    let resp = await attemptExchange(preferredState);
    // 631001 is AutoClaw's generic "login failed". When it comes back for the
    // callback state, retry once with the session key: one of the two is what
    // the server expects, and a rejection does not always consume the code.
    if (
      resp.ok &&
      resp.json?.code === 631001 &&
      session.callbackState &&
      session.callbackState !== deviceCode
    ) {
      console.log("[autoclaw oauth] exchange rejected for callback state, retrying with session state");
      resp = await attemptExchange(deviceCode);
    }

    if (!resp.ok) {
      session.status = "error";
      session.error = `AutoClaw token exchange failed: ${resp.status} ${resp.text}`;
      console.log(
        `[autoclaw oauth] token exchange http=${resp.status} body=${String(resp.text || "").slice(0, 300)}`,
      );
      return { ok: false, data: { error: session.error } };
    }
    if (resp.json.code != null && resp.json.code !== 0) {
      session.status = "error";
      // 631004 = the Google identity authenticated fine, but AutoClaw has no
      // account for it: signups moved to Z.AI, so a brand-new Google user is
      // turned away here rather than at the captcha.
      session.error =
        resp.json.code === 631004
          ? "AutoClaw has no account for this Google login yet (code=631004). " +
            "New users must sign up through Z.AI first - open https://autoclaw.z.ai, " +
            'complete the signup, then retry. Or use "1-Click Import from App".'
          : `AutoClaw login error: code=${resp.json.code} msg=${resp.json.msg}`;
      // Server-side breadcrumb: the dialog can only show the message, and the
      // trace id is what AutoClaw support needs to explain a rejection.
      console.log(
        `[autoclaw oauth] token exchange rejected code=${resp.json.code} msg=${resp.json.msg} trace=${resp.json.trace || "-"}`,
      );
      return { ok: false, data: { error: session.error } };
    }
    const data = resp.json.data || {};
    let accessToken = data.access_token || "";
    let refreshToken = data.refresh_token || "";
    if (accessToken.startsWith("Bearer ")) accessToken = accessToken.slice(7);
    if (refreshToken.startsWith("Bearer "))
      refreshToken = refreshToken.slice(7);

    // The JWT payload's device_id is authoritative for refresh.
    let jwtDeviceId = session.deviceId;
    try {
      const payload = accessToken.split(".")[1];
      const json = JSON.parse(
        Buffer.from(
          payload + "=".repeat(-payload.length % 4),
          "base64url",
        ).toString("utf8"),
      );
      if (json.device_id) jwtDeviceId = json.device_id;
    } catch {}

    // Decode JWT exp for refresh-lead scheduling.
    let expiresIn = 86400;
    try {
      const payload = accessToken.split(".")[1];
      const json = JSON.parse(
        Buffer.from(
          payload + "=".repeat(-payload.length % 4),
          "base64url",
        ).toString("utf8"),
      );
      if (typeof json.exp === "number") {
        expiresIn = Math.max(1, json.exp - Math.floor(Date.now() / 1000));
      }
    } catch {}

    session.status = "done";
    session.tokens = {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: expiresIn,
      _autoclawDeviceId: jwtDeviceId,
      _autoclawUserId: data.user_id,
      _autoclawUserName: data.user_name,
    };

    stopAutoClawProxy();
    return { ok: true, data: session.tokens };
  },
  mapTokens: (tokens) => ({
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresIn: tokens.expires_in,
    email: tokens._autoclawUserName
      ? `${tokens._autoclawUserName}`
      : tokens._autoclawUserId
        ? `autoclaw-${tokens._autoclawUserId}`
        : null,
    displayName: tokens._autoclawUserName || null,
    providerSpecificData: {
      sourceId: AUTOCLOW_CONFIG.sourceId,
      deviceId: tokens._autoclawDeviceId,
    },
  }),
};

export default autoclaw;
