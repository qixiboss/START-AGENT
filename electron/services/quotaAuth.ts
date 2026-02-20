import path from "node:path";
import fs from "node:fs/promises";
import { app, safeStorage } from "electron";
import type {
  QuotaAuthImportRequest,
  QuotaAuthImportResult,
  QuotaAuthListResult,
  QuotaAuthProviderConfig,
  QuotaAuthSaveRequest,
  QuotaAuthSaveResult,
  QuotaBrowserSource,
  QuotaMethod,
  QuotaProvider,
  QuotaSecretStorageMode
} from "../../src/types/ipc.js";
import {
  getQuotaProviderDefinition,
  QUOTA_PROVIDER_DEFINITIONS
} from "./quotaProviders.js";
import { importCookieHeaderFromBrowser } from "./browserCookieImport.js";

const QUOTA_AUTH_FILE_VERSION = 1;

type StoredSecret =
  | {
      encoding: "safe_storage";
      value: string;
    }
  | {
      encoding: "plain";
      value: string;
    };

type StoredProviderConfig = {
  consoleUrl?: string;
  apiUrl?: string;
  methods?: QuotaMethod[];
  commandJson?: string;
  cookie?: StoredSecret;
  updatedAt?: number;
};

type StoredQuotaAuthFile = {
  version: number;
  providers: Partial<Record<QuotaProvider, StoredProviderConfig>>;
};

export type QuotaRuntimeConfig = {
  provider: QuotaProvider;
  title: string;
  consoleUrl: string;
  apiUrl: string;
  cookie: string;
  methods: QuotaMethod[];
  commandJson: string;
};

const quotaMethodValues: readonly QuotaMethod[] = ["api", "command", "page"];
const quotaBrowserValues: readonly QuotaBrowserSource[] = ["auto", "chrome", "edge"];

const getQuotaAuthPath = (): string => path.join(app.getPath("userData"), "quota-auth.json");

const isHttpUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
};

const sanitizeMethods = (value: unknown, fallback: readonly QuotaMethod[]): QuotaMethod[] => {
  if (!Array.isArray(value)) {
    return [...fallback];
  }

  const next: QuotaMethod[] = [];
  const seen = new Set<QuotaMethod>();
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const normalized = item.trim().toLowerCase();
    if (!quotaMethodValues.includes(normalized as QuotaMethod)) {
      continue;
    }
    const method = normalized as QuotaMethod;
    if (seen.has(method)) {
      continue;
    }
    next.push(method);
    seen.add(method);
  }

  return next.length > 0 ? next : [...fallback];
};

const validateCommandJson = (raw: string): string | null => {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return "Command JSON must be an object.";
    }

    const data = parsed as Record<string, unknown>;
    const command = typeof data.command === "string" ? data.command.trim() : "";
    if (!command) {
      return "Command JSON requires a non-empty command string.";
    }
    if (command.length > 200 || /[\r\n]/.test(command)) {
      return "Command is too long or contains invalid line breaks.";
    }

    if (data.args !== undefined) {
      if (!Array.isArray(data.args)) {
        return "Command args must be an array of strings.";
      }
      for (const item of data.args) {
        if (typeof item !== "string") {
          return "Command args must be an array of strings.";
        }
        const arg = item.trim();
        if (!arg || arg.length > 500 || /[\r\n]/.test(arg)) {
          return "Command args contain invalid value.";
        }
      }
    }

    if (data.cwd !== undefined) {
      if (typeof data.cwd !== "string") {
        return "Command cwd must be a string.";
      }
      const cwd = data.cwd.trim();
      if (!cwd || cwd.length > 400 || /[\r\n]/.test(cwd)) {
        return "Command cwd is invalid.";
      }
    }

    return null;
  } catch {
    return "Command JSON is not valid JSON.";
  }
};

const sanitizeStoredSecret = (value: unknown): StoredSecret | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const candidate = value as { encoding?: unknown; value?: unknown };
  if (candidate.encoding !== "safe_storage" && candidate.encoding !== "plain") {
    return undefined;
  }
  if (typeof candidate.value !== "string" || candidate.value.length === 0) {
    return undefined;
  }

  return {
    encoding: candidate.encoding,
    value: candidate.value
  };
};

const sanitizeStoredProvider = (provider: QuotaProvider, rawValue: unknown): StoredProviderConfig => {
  const definition = getQuotaProviderDefinition(provider);
  if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) {
    return {};
  }

  const data = rawValue as Record<string, unknown>;
  const consoleUrlRaw = typeof data.consoleUrl === "string" ? data.consoleUrl.trim() : "";
  const apiUrlRaw = typeof data.apiUrl === "string" ? data.apiUrl.trim() : "";
  const commandJsonRaw = typeof data.commandJson === "string" ? data.commandJson.trim() : "";
  const updatedAtRaw = typeof data.updatedAt === "number" && Number.isFinite(data.updatedAt)
    ? data.updatedAt
    : 0;

  return {
    consoleUrl: consoleUrlRaw && isHttpUrl(consoleUrlRaw) ? consoleUrlRaw : undefined,
    apiUrl: apiUrlRaw && isHttpUrl(apiUrlRaw) ? apiUrlRaw : undefined,
    methods: sanitizeMethods(data.methods, definition.defaultMethods),
    commandJson: commandJsonRaw.length > 0 ? commandJsonRaw : undefined,
    cookie: sanitizeStoredSecret(data.cookie),
    updatedAt: updatedAtRaw > 0 ? updatedAtRaw : undefined
  };
};

const createDefaultStore = (): StoredQuotaAuthFile => {
  return {
    version: QUOTA_AUTH_FILE_VERSION,
    providers: {}
  };
};

export class QuotaAuthManager {
  private storeCache: StoredQuotaAuthFile | null = null;
  private loadPromise: Promise<StoredQuotaAuthFile> | null = null;

  async init(): Promise<void> {
    await this.ensureLoaded();
  }

  private getStorageMode(): QuotaSecretStorageMode {
    return safeStorage.isEncryptionAvailable() ? "encrypted" : "plain";
  }

  private encodeCookie(cookie: string): StoredSecret {
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(cookie);
      return {
        encoding: "safe_storage",
        value: encrypted.toString("base64")
      };
    }

    return {
      encoding: "plain",
      value: cookie
    };
  }

  private decodeCookie(secret: StoredSecret | undefined): string {
    if (!secret) {
      return "";
    }
    if (secret.encoding === "plain") {
      return secret.value;
    }
    if (!safeStorage.isEncryptionAvailable()) {
      return "";
    }

    try {
      const encryptedBuffer = Buffer.from(secret.value, "base64");
      return safeStorage.decryptString(encryptedBuffer);
    } catch {
      return "";
    }
  }

  private buildPublicProviderConfig(
    provider: QuotaProvider,
    stored: StoredProviderConfig | undefined
  ): QuotaAuthProviderConfig {
    const definition = getQuotaProviderDefinition(provider);
    const methods = sanitizeMethods(stored?.methods, definition.defaultMethods);
    const decodedCookie = this.decodeCookie(stored?.cookie).trim();

    return {
      provider,
      title: definition.title,
      consoleUrl: stored?.consoleUrl?.trim() || definition.defaultConsoleUrl,
      apiUrl: stored?.apiUrl?.trim() || "",
      methods,
      commandJson: stored?.commandJson?.trim() || "",
      hasCookie: decodedCookie.length > 0,
      updatedAt: stored?.updatedAt ?? 0
    };
  }

  private async ensureLoaded(): Promise<StoredQuotaAuthFile> {
    if (this.storeCache) {
      return this.storeCache;
    }
    if (this.loadPromise) {
      return this.loadPromise;
    }

    this.loadPromise = this.loadStoreFromDisk();
    const loaded = await this.loadPromise;
    this.storeCache = loaded;
    this.loadPromise = null;
    return loaded;
  }

  private async loadStoreFromDisk(): Promise<StoredQuotaAuthFile> {
    try {
      const raw = await fs.readFile(getQuotaAuthPath(), "utf-8");
      const parsed = JSON.parse(raw) as Partial<StoredQuotaAuthFile>;
      const providersRaw = parsed.providers ?? {};
      const providers: Partial<Record<QuotaProvider, StoredProviderConfig>> = {};
      for (const definition of QUOTA_PROVIDER_DEFINITIONS) {
        providers[definition.provider] = sanitizeStoredProvider(
          definition.provider,
          providersRaw[definition.provider]
        );
      }
      return {
        version: typeof parsed.version === "number" ? parsed.version : QUOTA_AUTH_FILE_VERSION,
        providers
      };
    } catch {
      return createDefaultStore();
    }
  }

  private async persistStore(store: StoredQuotaAuthFile): Promise<void> {
    await fs.mkdir(path.dirname(getQuotaAuthPath()), { recursive: true });
    await fs.writeFile(getQuotaAuthPath(), JSON.stringify(store, null, 2), "utf-8");
  }

  async getAuthConfigs(): Promise<QuotaAuthListResult> {
    try {
      const store = await this.ensureLoaded();
      const providers = QUOTA_PROVIDER_DEFINITIONS.map((definition) =>
        this.buildPublicProviderConfig(definition.provider, store.providers[definition.provider])
      );
      return {
        ok: true,
        providers,
        storageMode: this.getStorageMode()
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load quota authorization.";
      return {
        ok: false,
        message,
        providers: [],
        storageMode: this.getStorageMode()
      };
    }
  }

  private normalizeBrowserSource(value: QuotaBrowserSource | undefined): QuotaBrowserSource {
    if (!value) {
      return "auto";
    }
    return quotaBrowserValues.includes(value) ? value : "auto";
  }

  private buildStorageWarning(hasCookie: boolean): string | undefined {
    if (!hasCookie) {
      return undefined;
    }
    return this.getStorageMode() === "plain"
      ? "OS encryption is unavailable. Secret is stored locally in plain text under app data."
      : undefined;
  }

  async saveAuthConfig(request: QuotaAuthSaveRequest): Promise<QuotaAuthSaveResult> {
    if (!request || typeof request !== "object") {
      return {
        ok: false,
        message: "Invalid request."
      };
    }

    const definition = QUOTA_PROVIDER_DEFINITIONS.find((item) => item.provider === request.provider);
    if (!definition) {
      return {
        ok: false,
        message: "Unknown quota provider."
      };
    }

    const store = await this.ensureLoaded();
    const existing = store.providers[definition.provider] ?? {};
    const next: StoredProviderConfig = { ...existing };

    if (typeof request.consoleUrl === "string") {
      const normalized = request.consoleUrl.trim();
      if (normalized.length > 0 && !isHttpUrl(normalized)) {
        return {
          ok: false,
          message: "Console URL must be http or https."
        };
      }
      next.consoleUrl = normalized.length > 0 ? normalized : undefined;
    }

    if (typeof request.apiUrl === "string") {
      const normalized = request.apiUrl.trim();
      if (normalized.length > 0 && !isHttpUrl(normalized)) {
        return {
          ok: false,
          message: "API URL must be http or https."
        };
      }
      next.apiUrl = normalized.length > 0 ? normalized : undefined;
    }

    if (Array.isArray(request.methods)) {
      next.methods = sanitizeMethods(request.methods, definition.defaultMethods);
    }

    if (typeof request.commandJson === "string") {
      const normalized = request.commandJson.trim();
      if (normalized.length === 0) {
        next.commandJson = undefined;
      } else {
        const validationError = validateCommandJson(normalized);
        if (validationError) {
          return {
            ok: false,
            message: validationError
          };
        }
        next.commandJson = normalized;
      }
    }

    if (request.clearCookie) {
      next.cookie = undefined;
    }

    if (typeof request.cookie === "string") {
      const normalized = request.cookie.trim();
      if (normalized.length > 0) {
        next.cookie = this.encodeCookie(normalized);
      }
    }

    next.updatedAt = Date.now();
    store.providers[definition.provider] = next;
    await this.persistStore(store);

    const warning = this.buildStorageWarning(!!next.cookie);

    return {
      ok: true,
      config: this.buildPublicProviderConfig(definition.provider, next),
      storageMode: this.getStorageMode(),
      warning
    };
  }

  async importAuthFromBrowser(request: QuotaAuthImportRequest): Promise<QuotaAuthImportResult> {
    if (!request || typeof request !== "object") {
      return {
        ok: false,
        message: "Invalid request."
      };
    }

    const definition = QUOTA_PROVIDER_DEFINITIONS.find((item) => item.provider === request.provider);
    if (!definition) {
      return {
        ok: false,
        message: "Unknown quota provider."
      };
    }

    const browser = this.normalizeBrowserSource(request.browser);
    const imported = await importCookieHeaderFromBrowser({
      browser,
      domainSuffixes: definition.cookieDomainSuffixes,
      preferredCookieNames: definition.preferredCookieNames
    });
    if (!imported.ok) {
      return {
        ok: false,
        message: imported.message
      };
    }

    const store = await this.ensureLoaded();
    const existing = store.providers[definition.provider] ?? {};
    const next: StoredProviderConfig = {
      ...existing,
      cookie: this.encodeCookie(imported.cookieHeader),
      updatedAt: Date.now()
    };

    store.providers[definition.provider] = next;
    await this.persistStore(store);

    const warning = this.buildStorageWarning(true);
    return {
      ok: true,
      config: this.buildPublicProviderConfig(definition.provider, next),
      storageMode: this.getStorageMode(),
      browser: imported.browser,
      profile: imported.profile,
      cookieCount: imported.cookieCount,
      warning
    };
  }

  async getRuntimeConfig(provider: QuotaProvider): Promise<QuotaRuntimeConfig> {
    const definition = getQuotaProviderDefinition(provider);
    const store = await this.ensureLoaded();
    const stored = store.providers[provider];

    return {
      provider,
      title: definition.title,
      consoleUrl: stored?.consoleUrl?.trim() || definition.defaultConsoleUrl,
      apiUrl: stored?.apiUrl?.trim() || "",
      cookie: this.decodeCookie(stored?.cookie).trim(),
      methods: sanitizeMethods(stored?.methods, definition.defaultMethods),
      commandJson: stored?.commandJson?.trim() || ""
    };
  }
}
