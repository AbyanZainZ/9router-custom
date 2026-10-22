import { afterEach, describe, expect, it, vi } from "vitest";
import { APIKEY_PROVIDERS } from "../../src/shared/constants/providers.js";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { getModelInfoCore } from "../../open-sse/services/model.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: vi.fn(async () => ({ id: "routeway-test", provider: "routeway", authType: "apikey", apiKey: "test-key" })),
  updateProviderConnection: vi.fn(),
}));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => ({})) }));
import { testSingleConnection } from "../../src/app/api/providers/[id]/test/testUtils.js";

afterEach(() => vi.unstubAllGlobals());

describe("Routeway", () => {
  it.each([
    ["deepseek-v4-flash:free", "DeepSeek V4 Flash (Free)", false, 42000],
    ["minimax-m2.7:free", "MiniMax M2.7 (Free)", false, 42000],
    ["muse-glimmer-30b:free", "Glimmer 30B (Free)", true, 131072],
  ])("routes %s with Bearer authentication", async (model, name, vision, contextWindow) => {
    expect(APIKEY_PROVIDERS.routeway.name).toBe("Routeway");
    expect(PROVIDER_MODELS.routeway).toContainEqual({ id: model, name });
    expect(PROVIDERS.routeway.format).toBe("openai");
    expect(await getModelInfoCore(`routeway/${model}`)).toEqual({ provider: "routeway", model });
    const executor = new DefaultExecutor("routeway");
    expect(executor.buildUrl(model, true)).toBe("https://api.routeway.ai/v1/chat/completions");
    expect(executor.buildHeaders({ apiKey: "test-key" }, true).Authorization).toBe("Bearer test-key");
    const body = {
      model,
      messages: [{ role: "user", content: "Hello" }],
      tools: [{ type: "function", function: { name: "test", parameters: { type: "object", properties: {} } } }],
      tool_choice: "auto",
      max_completion_tokens: 128,
      stream: true,
    };
    expect(executor.transformRequest(model, body)).toEqual(body);
    expect(getCapabilitiesForModel("routeway", model)).toMatchObject({ tools: true, reasoning: true, vision, contextWindow });
  });

  it("tests saved connections and rejects invalid credentials", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(new Response("{}", { status: 401 }));
    vi.stubGlobal("fetch", fetch);
    expect(await testSingleConnection("routeway-test")).toMatchObject({ valid: true });
    expect(fetch).toHaveBeenCalledWith("https://api.routeway.ai/v1/models", expect.objectContaining({
      headers: { Authorization: "Bearer test-key" },
    }));
    expect(await testSingleConnection("routeway-test")).toMatchObject({ valid: false, error: "Routeway returned HTTP 401" });
  });
});
