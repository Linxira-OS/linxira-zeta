import { readFileSync } from "node:fs";
import { join } from "node:path";
import { completeSimple } from "@earendil-works/pi-ai/compat";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

const config = JSON.parse(readFileSync(join(process.env.USERPROFILE, ".omp", "agent", "models.json"), "utf8"));
const provider = config.providers.L;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  const headers = init?.headers ?? {};
  const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
  console.log("request", JSON.stringify({ url, method: init?.method, body: { ...body, messages: undefined }, hasAuthorization: Object.entries(headers).some(([key]) => key.toLowerCase() === "authorization") }));
  const response = await originalFetch(input, init);
  const clone = response.clone();
  const responseText = await clone.text();
  console.log("response", JSON.stringify({ status: response.status, contentType: response.headers.get("content-type"), bodyPrefix: responseText.slice(0, 300), bodySuffix: responseText.slice(-300) }));
  return response;
};

const modelId = provider.models[0].id;
const runtime = await ModelRuntime.create({ modelsPath: join(process.env.USERPROFILE, ".omp", "agent", "models.json") });
const model = runtime.getModel("L", modelId);
const result = await completeSimple(model, { messages: [{ role: "user", content: "Reply with OK only.", timestamp: Date.now() }] }, {
  apiKey: provider.apiKey,
  maxTokens: 16,
  timeoutMs: 20000,
  maxRetries: 0,
  cacheRetention: "none",
});
console.log("result", JSON.stringify({ stopReason: result.stopReason, errorMessage: result.errorMessage }));
