// Agnes AI video adapter.
// Create: POST {baseUrl} (collection root). The body MUST include a "mode"
//   field (agnes-video-2.5: text|keyframe|reference ; agnes-video-v2.0: ti2vid|keyframes).
// Poll:   GET {pollBase}?video_id={id}  - Agnes returns task progress via a
//   query param on /agnesapi, NOT a path segment like xAI/OpenRouter.
const SUPPORTED_ACTIONS = new Set(["generations"]);

function headers(config, token) {
  return {
    Accept: "application/json",
    ...(config.headers || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export default {
  buildRequest({ config, action, requestId, suffix, rawBody, contentType, token }) {
    if (requestId) {
      const pollBase = (config.pollBase || config.baseUrl.replace(/\/videos$/, "")).replace(/\/$/, "");
      const q = new URLSearchParams({ video_id: requestId });
      if (config.pollModelName) q.set("model_name", config.pollModelName);
      return { method: "GET", url: `${pollBase}?${q.toString()}`, headers: headers(config, token) };
    }
    if (!SUPPORTED_ACTIONS.has(action)) {
      return { error: `Agnes video supports 'generations' only (got '${action}')` };
    }
    if (contentType && !contentType.includes("application/json")) {
      return { error: "Agnes video requires an application/json body" };
    }
    return {
      method: "POST",
      url: config.baseUrl.replace(/\/$/, ""),
      headers: { ...headers(config, token), "Content-Type": "application/json" },
      body: rawBody,
    };
  },
};
