import type { Cookie, Session } from "electron";
import { BrowserWindow, ipcMain, shell } from "electron";
import { IpcChannels } from "../../src/types/ipc.js";
import type {
  QuotaAuthAuthorizeInAppRequest,
  QuotaAuthAuthorizeInAppResult,
  QuotaAuthImportRequest,
  QuotaAuthImportResult,
  QuotaAuthListResult,
  QuotaAuthSaveRequest,
  QuotaAuthSaveResult,
  QuotaListResult
} from "../../src/types/ipc.js";
import { getQuotaProviderDefinition } from "../services/quotaProviders.js";

type RegisterQuotaIpcDeps = {
  listQuotas: () => Promise<QuotaListResult>;
  getQuotaAuthConfigs: () => Promise<QuotaAuthListResult>;
  saveQuotaAuthConfig: (request: QuotaAuthSaveRequest) => Promise<QuotaAuthSaveResult>;
  importQuotaAuthFromBrowser: (request: QuotaAuthImportRequest) => Promise<QuotaAuthImportResult>;
};

const isAllowedExternalUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
};

export const registerQuotaIpc = (_mainWindow: BrowserWindow, deps: RegisterQuotaIpcDeps): void => {
  ipcMain.handle(IpcChannels.QuotaList, async () => deps.listQuotas());
  ipcMain.handle(IpcChannels.QuotaAuthGet, async () => deps.getQuotaAuthConfigs());
  ipcMain.handle(IpcChannels.QuotaAuthSave, async (_event, payload: QuotaAuthSaveRequest) => {
    return deps.saveQuotaAuthConfig(payload);
  });
  ipcMain.handle(IpcChannels.QuotaAuthImportBrowser, async (_event, payload: QuotaAuthImportRequest) => {
    return deps.importQuotaAuthFromBrowser(payload);
  });

  ipcMain.handle(IpcChannels.QuotaAuthAuthorizeInApp, async (_event, payload: QuotaAuthAuthorizeInAppRequest) => {
    const provider = typeof payload?.provider === "string" ? payload.provider : null;
    if (!provider) {
      return {
        ok: false,
        message: "Invalid provider."
      };
    }

    let definition;
    try {
      definition = getQuotaProviderDefinition(provider);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown quota provider.";
      return {
        ok: false,
        message
      };
    }

    let consoleUrl = definition.defaultConsoleUrl;
    try {
      const configs = await deps.getQuotaAuthConfigs();
      const matched = configs.providers.find((item) => item.provider === provider);
      if (matched?.consoleUrl) {
        consoleUrl = matched.consoleUrl;
      }
    } catch {
      // Ignore load failures; fall back to default URL.
    }

    const buildCookieHeader = (
      cookies: Cookie[]
    ): { cookieHeader: string; cookieCount: number; cookieNamesLower: Set<string> } => {
      const byName = new Map<string, Cookie>();
      for (const cookie of cookies) {
        const name = cookie.name?.trim();
        const value = cookie.value ?? "";
        if (!name || !value) {
          continue;
        }

        const existing = byName.get(name);
        if (!existing) {
          byName.set(name, cookie);
          continue;
        }

        const existingExpiry = typeof existing.expirationDate === "number" ? existing.expirationDate : 0;
        const nextExpiry = typeof cookie.expirationDate === "number" ? cookie.expirationDate : 0;
        if (nextExpiry > existingExpiry) {
          byName.set(name, cookie);
        }
      }

      const values = [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
      const cookieHeader = values.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
      const cookieNamesLower = new Set(values.map((cookie) => cookie.name.toLowerCase()));
      return {
        cookieHeader,
        cookieCount: values.length,
        cookieNamesLower
      };
    };

    const getSessionCookies = async (session: Session): Promise<Cookie[]> => {
      const suffixes = definition.cookieDomainSuffixes
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
      if (suffixes.length === 0) {
        return [];
      }

      const suffixesLower = suffixes.map((suffix) => suffix.toLowerCase());
      const lists = await Promise.all(suffixesLower.map((suffix) => session.cookies.get({ domain: suffix })));
      const merged = lists.flat();
      if (merged.length > 0) {
        return merged;
      }

      // Fallback: some Electron versions treat the `domain` filter strictly. Pull all cookies and filter locally.
      const allCookies = await session.cookies.get({});
      return allCookies.filter((cookie) => {
        const domain = (cookie.domain ?? "").toLowerCase().replace(/^\\./, "");
        if (!domain) {
          return false;
        }
        return suffixesLower.some((suffix) => domain === suffix || domain.endsWith(`.${suffix}`));
      });
    };

    return new Promise<QuotaAuthAuthorizeInAppResult>((resolve) => {
      const partition = `quota-auth-${provider}-${Date.now()}`;
      const authWindow = new BrowserWindow({
        parent: _mainWindow,
        modal: true,
        width: 1080,
        height: 820,
        show: true,
        title: `${definition.title} Authorization`,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
          partition
        }
      });

      const authSession = authWindow.webContents.session;
      const preferredLower = definition.preferredCookieNames
        .map((name) => name.trim().toLowerCase())
        .filter((name) => name.length > 0);

      let resolved = false;
      let attemptInFlight = false;
      let pollTimer: NodeJS.Timeout | null = null;

      const finalize = (result: QuotaAuthAuthorizeInAppResult): void => {
        if (resolved) {
          return;
        }
        resolved = true;
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
        resolve(result);
        try {
          if (!authWindow.isDestroyed()) {
            authWindow.close();
          }
        } catch {
          // Ignore close failures.
        }
      };

      const attemptSaveFromSession = async (): Promise<boolean> => {
        if (resolved || attemptInFlight) {
          return false;
        }
        attemptInFlight = true;
        try {
          const cookies = await getSessionCookies(authSession);
          const summary = buildCookieHeader(cookies);
          if (summary.cookieCount === 0 || summary.cookieHeader.length === 0) {
            return false;
          }

          const hasPreferred = preferredLower.length === 0
            ? true
            : [...summary.cookieNamesLower].some((cookieName) =>
              preferredLower.some((preferred) =>
                cookieName === preferred || cookieName.startsWith(`${preferred}.`)
              )
            );
          if (!hasPreferred) {
            return false;
          }

          const saved = await deps.saveQuotaAuthConfig({
            provider,
            cookie: summary.cookieHeader
          });
          if (!saved.ok) {
            finalize({
              ok: false,
              message: saved.message
            });
            return false;
          }

          finalize({
            ok: true,
            config: saved.config,
            storageMode: saved.storageMode,
            cookieCount: summary.cookieCount,
            warning: saved.warning
          });
          return true;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to save authorization cookies.";
          finalize({
            ok: false,
            message
          });
          return false;
        } finally {
          attemptInFlight = false;
        }
      };

      authWindow.on("closed", () => {
        void (async () => {
          const saved = await attemptSaveFromSession();
          if (resolved) {
            return;
          }
          if (saved) {
            return;
          }
          finalize({
            ok: false,
            cancelled: true,
            message: "Authorization window closed."
          });
        })();
      });

      authWindow.webContents.on("did-fail-load", (_event, code, description) => {
        if (resolved) {
          return;
        }
        finalize({
          ok: false,
          message: `Failed to load authorization page: ${String(code)} ${description}`
        });
      });

      authWindow.webContents.on("did-finish-load", () => {
        void attemptSaveFromSession();
      });

      pollTimer = setInterval(() => {
        void attemptSaveFromSession();
      }, 1200);

      void authWindow.loadURL(consoleUrl);
    });
  });

  ipcMain.handle(IpcChannels.SystemOpenExternal, async (_event, payload: { url?: string }) => {
    const targetUrl = typeof payload?.url === "string" ? payload.url.trim() : "";
    if (!isAllowedExternalUrl(targetUrl)) {
      return { ok: false, message: "Invalid URL." };
    }

    try {
      await shell.openExternal(targetUrl);
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to open external URL.";
      return { ok: false, message };
    }
  });
};
