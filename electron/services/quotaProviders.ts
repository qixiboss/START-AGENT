import type { QuotaMethod, QuotaProvider } from "../../src/types/ipc.js";

export type QuotaProviderDefinition = {
  provider: QuotaProvider;
  title: string;
  defaultConsoleUrl: string;
  defaultMethods: QuotaMethod[];
  cookieDomainSuffixes: string[];
  preferredCookieNames: string[];
};

export const QUOTA_PROVIDER_DEFINITIONS: readonly QuotaProviderDefinition[] = [
  {
    provider: "codex_chatgpt",
    title: "ChatGPT Codex",
    defaultConsoleUrl: "https://chatgpt.com/codex/settings/usage",
    defaultMethods: ["api", "command", "page"],
    cookieDomainSuffixes: ["chatgpt.com"],
    preferredCookieNames: [
      "__Secure-next-auth.session-token",
      "__Host-next-auth.session-token",
      "__Secure-next-auth.csrf-token",
      "cf_clearance"
    ]
  },
  {
    provider: "volcengine_coding_plan",
    title: "Volcengine Coding Plan",
    defaultConsoleUrl:
      "https://console.volcengine.com/ark/region:ark+cn-beijing/openManagement?LLM=%7B%7D&advancedActiveKey=subscribe",
    defaultMethods: ["api", "command", "page"],
    cookieDomainSuffixes: ["volcengine.com"],
    preferredCookieNames: ["sessionid", "ttwid", "auth_token"]
  }
];

export const getQuotaProviderDefinition = (provider: QuotaProvider): QuotaProviderDefinition => {
  const matched = QUOTA_PROVIDER_DEFINITIONS.find((item) => item.provider === provider);
  if (!matched) {
    throw new Error(`Unknown quota provider: ${provider}`);
  }
  return matched;
};
