export default {
  id: "routeway",
  alias: "routeway",
  category: "apikey",
  hasFree: true,
  display: {
    name: "Routeway",
    icon: "route",
    color: "#16A34A",
    textIcon: "RW",
    website: "https://routeway.ai",
    notice: {
      text: "Free models: DeepSeek V4 Flash, MiniMax M2.7, and Glimmer 30B. Requires a Routeway API key.",
      apiKeyUrl: "https://routeway.ai",
    },
  },
  transport: {
    baseUrl: "https://api.routeway.ai/v1/chat/completions",
    validateUrl: "https://api.routeway.ai/v1/models",
  },
  models: [
    { id: "deepseek-v4-flash:free", name: "DeepSeek V4 Flash (Free)" },
    { id: "minimax-m2.7:free", name: "MiniMax M2.7 (Free)" },
    { id: "muse-glimmer-30b:free", name: "Glimmer 30B (Free)" },
  ],
};
