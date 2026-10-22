export default {
  id: "empero-free",
  alias: "empero",
  display: {
    name: "Empero Free",
    icon: "empero",
    color: "#059669",
    textIcon: "EM",
    website: "https://free.empero.org",
    notice: {
      text: "Free tier: no API key required.",
    },
  },
  category: "freeTier",
  authType: "apikey",
  authModes: ["apikey"],
  noAuth: true,
  defaultApiKey: "free",
  passthroughModels: true,
  modelsFetcher: { url: "https://free.empero.org/v1/models", type: "generic" },
  transport: {
    baseUrl: "https://free.empero.org/v1/chat/completions",
    validateUrl: "https://free.empero.org/v1/models",
    thinkingFormat: "openai",
  },
  models: [
    { id: "Qwen/Qwen3.8-27B-FP8", name: "Qwen 3.8 27B FP8 (Free)", contextLength: 32768 },
  ],
  serviceKinds: ["llm"],
};
