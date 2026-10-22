export default {
  id: "agnes-ai-cn",
  priority: 222,
  alias: "agnes-cn",
  aliases: ["agnes-ai-cn", "agnes-cn", "agnesai-cn", "agnes.cn"],
  uiAlias: "agnes-cn",
  display: {
    name: "Agnes AI CN",
    icon: "bolt",
    color: "#EF4444",
    textIcon: "AG-CN",
    website: "https://platform.agnes-ai.cn/",
    notice: {
      text: "Agnes AI (CN region) OpenAI-compatible gateway. Create an API key in the Agnes AI CN console (Settings → API Keys).",
      apiKeyUrl: "https://platform.agnes-ai.cn/settings/apiKeys",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.agnes-ai.cn/v1/chat/completions",
    format: "openai",
    validateUrl: "https://api.agnes-ai.cn/v1/models",
    auth: { combined: true, header: "Authorization", scheme: "bearer" },
  },
  serviceKinds: ["llm", "image", "video"],
  imageConfig: { baseUrl: "https://api.agnes-ai.cn/v1/images/generations" },
  videoConfig: {
    baseUrl: "https://api.agnes-ai.cn/v1/videos",
    pollBase: "https://api.agnes-ai.cn/agnesapi",
  },
  modelsFetcher: { url: "https://api.agnes-ai.cn/v1/models", type: "openai" },
  passthroughModels: true,
  models: [
    // --- chat / llm --- (contextLength = max input tokens; official Agnes catalog values)
    { id: "agnes-3.0-flash", name: "Agnes 3.0 Flash", contextLength: 524288 },
    { id: "agnes-2.5-flash", name: "Agnes 2.5 Flash", contextLength: 524288 },
    { id: "agnes-2.5-pro", name: "Agnes 2.5 Pro", contextLength: 1048576 },
    { id: "agnes-2.5-pro-alpha", name: "Agnes 2.5 Pro Alpha", contextLength: 1048576 },
    { id: "agnes-2.5-pro-beta", name: "Agnes 2.5 Pro Beta", contextLength: 1048576 },
    { id: "agnes-2.0-flash", name: "Agnes 2.0 Flash", contextLength: 262144 },
    // --- image ---
    { id: "agnes-image-2.5-flash", name: "Agnes Image 2.5 Flash", kind: "image", params: ["n", "size"] },
    { id: "agnes-image-2.1-flash", name: "Agnes Image 2.1 Flash", kind: "image", params: ["n", "size"] },
    { id: "agnes-image-2.0-flash", name: "Agnes Image 2.0 Flash", kind: "image", params: ["n", "size"] },
    // --- video ---
    { id: "agnes-video-2.5-flash", name: "Agnes Video 2.5 Flash", kind: "video", params: ["mode"] },
    { id: "agnes-video-2.5", name: "Agnes Video 2.5", kind: "video", params: ["mode"] },
    { id: "agnes-video-v2.0", name: "Agnes Video 2.0", kind: "video", params: ["mode"] },
  ],
};
