export default {
  id: "infron",
  alias: "infron",
  display: {
    name: "Infron",
    icon: "infron",
    color: "#111827",
    textIcon: "IN",
    website: "https://infron.ai",
    notice: {
      text: "Free tier: 6 free models. Powered by OneRouter.",
      apiKeyUrl: "https://infron.ai",
    },
  },
  category: "freeTier",
  authType: "apikey",
  authModes: ["apikey"],
  passthroughModels: true,
  modelsFetcher: { url: "https://llm.onerouter.pro/v1/models", type: "generic" },
  transport: {
    baseUrl: "https://llm.onerouter.pro/v1/chat/completions",
    validateUrl: "https://llm.onerouter.pro/v1/models",
    thinkingFormat: "openai",
  },
  models: [
    { id: "qwen/qwen3.8-flash:free", name: "Qwen 3.8 Flash (Free)", contextLength: 1048576 },
    { id: "deepseek/deepseek-v4-flash-0731:free", name: "DeepSeek V4 Flash 0731 (Free)", contextLength: 1000000 },
    { id: "qwen/qwen3.8-27b:free", name: "Qwen 3.8 27B (Free)", contextLength: 32768 },
    { id: "qwen/qwen3.8-27b-abliterated-cyber:free", name: "Qwen 3.8 27B Abliterated Cyber (Free)", contextLength: 32768 },
    { id: "deepseek/deepseek-v4.1-flash:free", name: "DeepSeek V4.1 Flash (Free)", contextLength: 1000000 },
    { id: "deepseek/deepseek-v4-flash:free", name: "DeepSeek V4 Flash (Free)", contextLength: 1000000 },
  ],
  serviceKinds: ["llm"],
};
