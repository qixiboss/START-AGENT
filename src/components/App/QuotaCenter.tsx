import { memo, useEffect, useMemo, useState } from "react";
import type {
  QuotaBrowserSource,
  QuotaAuthProviderConfig,
  QuotaAuthSaveRequest,
  QuotaItem,
  QuotaMethod,
  QuotaProvider,
  QuotaSecretStorageMode
} from "../../types/ipc";

const quotaStatusPillClass = (status: QuotaItem["status"]): string => {
  if (status === "available") {
    return "ok";
  }
  if (status === "error") {
    return "err";
  }
  return "warn";
};

const quotaStatusLabel = (status: QuotaItem["status"]): string => {
  if (status === "available") {
    return "Live";
  }
  if (status === "error") {
    return "Error";
  }
  return "Manual";
};

type QuotaMetricCardProps = {
  quotaLoading: boolean;
  quotaSummary: string;
  quotaCheckedAt: number;
  quotaStatusCounts: {
    available: number;
    manualOnly: number;
    error: number;
  };
  showQuotaPanel: boolean;
  onRefresh: () => void;
  onTogglePanel: () => void;
};

export const QuotaMetricCard = memo(({
  quotaLoading,
  quotaSummary,
  quotaCheckedAt,
  quotaStatusCounts,
  showQuotaPanel,
  onRefresh,
  onTogglePanel
}: QuotaMetricCardProps): JSX.Element => {
  const checkedAtLabel = useMemo(() => {
    if (quotaCheckedAt <= 0) {
      return "No sync";
    }
    return new Date(quotaCheckedAt).toLocaleTimeString();
  }, [quotaCheckedAt]);

  return (
    <div className={`metric-card quota-card ${quotaStatusCounts.error > 0 ? "state-error" : ""}`}>
      <span>Quota</span>
      <strong>{quotaLoading ? "Checking..." : quotaSummary}</strong>
      <div className="quota-card-meta" title={`Available ${quotaStatusCounts.available}, Manual ${quotaStatusCounts.manualOnly}, Error ${quotaStatusCounts.error}`}>
        <span className="quota-dot available">{quotaStatusCounts.available}</span>
        <span className="quota-dot manual">{quotaStatusCounts.manualOnly}</span>
        <span className="quota-dot error">{quotaStatusCounts.error}</span>
        <span className="quota-checked">{checkedAtLabel}</span>
      </div>
      <div className="quota-card-actions">
        <button className="btn secondary tiny" onClick={onRefresh} disabled={quotaLoading}>
          Refresh
        </button>
        <button className="btn secondary tiny" onClick={onTogglePanel}>
          {showQuotaPanel ? "Hide" : "View"}
        </button>
      </div>
    </div>
  );
});

QuotaMetricCard.displayName = "QuotaMetricCard";

type QuotaAuthDraft = {
  cookie: string;
  apiUrl: string;
  consoleUrl: string;
  methodsText: string;
  commandJson: string;
  clearCookie: boolean;
  browserSource: QuotaBrowserSource;
  showAdvanced: boolean;
};

const quotaMethodValues: readonly QuotaMethod[] = ["api", "command", "page"];

const buildQuotaAuthDraft = (config: QuotaAuthProviderConfig): QuotaAuthDraft => {
  return {
    cookie: "",
    apiUrl: config.apiUrl,
    consoleUrl: config.consoleUrl,
    methodsText: config.methods.join(","),
    commandJson: config.commandJson,
    clearCookie: false,
    browserSource: "auto",
    showAdvanced: false
  };
};

const parseQuotaMethods = (value: string, fallback: QuotaMethod[]): QuotaMethod[] => {
  const next: QuotaMethod[] = [];
  const seen = new Set<QuotaMethod>();
  for (const token of value.split(",")) {
    const normalized = token.trim().toLowerCase();
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
  return next.length > 0 ? next : fallback;
};

type QuotaCenterPanelProps = {
  show: boolean;
  quotaItems: QuotaItem[];
  quotaLoading: boolean;
  quotaError: string | null;
  quotaCheckedAt: number;
  quotaAuthConfigs: QuotaAuthProviderConfig[];
  quotaAuthLoading: boolean;
  quotaAuthError: string | null;
  quotaSecretStorageMode: QuotaSecretStorageMode;
  onRefresh: () => void;
  onRefreshAuth: () => void;
  onSaveAuth: (request: QuotaAuthSaveRequest) => Promise<boolean>;
  onImportAuthFromBrowser: (provider: QuotaProvider, browser?: QuotaBrowserSource) => Promise<boolean>;
  onAuthorizeInApp: (provider: QuotaProvider) => Promise<boolean>;
  onClose: () => void;
  onOpenConsole: (url: string) => void;
};

export const QuotaCenterPanel = memo(({
  show,
  quotaItems,
  quotaLoading,
  quotaError,
  quotaCheckedAt,
  quotaAuthConfigs,
  quotaAuthLoading,
  quotaAuthError,
  quotaSecretStorageMode,
  onRefresh,
  onRefreshAuth,
  onSaveAuth,
  onImportAuthFromBrowser,
  onAuthorizeInApp,
  onClose,
  onOpenConsole
}: QuotaCenterPanelProps): JSX.Element | null => {
  const [draftByProvider, setDraftByProvider] = useState<Record<string, QuotaAuthDraft>>({});
  const [savingProvider, setSavingProvider] = useState<QuotaProvider | null>(null);
  const [importingProvider, setImportingProvider] = useState<QuotaProvider | null>(null);
  const [authorizingProvider, setAuthorizingProvider] = useState<QuotaProvider | null>(null);
  const [importingAll, setImportingAll] = useState<boolean>(false);

  useEffect(() => {
    const nextDrafts: Record<string, QuotaAuthDraft> = {};
    for (const config of quotaAuthConfigs) {
      nextDrafts[config.provider] = buildQuotaAuthDraft(config);
    }
    setDraftByProvider(nextDrafts);
  }, [quotaAuthConfigs]);

  if (!show) {
    return null;
  }

  const checkedAtLabel = quotaCheckedAt > 0
    ? new Date(quotaCheckedAt).toLocaleString()
    : "No quota check has run yet.";

  const updateDraft = (provider: QuotaProvider, patch: Partial<QuotaAuthDraft>): void => {
    setDraftByProvider((prev) => {
      const current = prev[provider] ?? {
        cookie: "",
        apiUrl: "",
        consoleUrl: "",
        methodsText: "api,command,page",
        commandJson: "",
        clearCookie: false,
        browserSource: "auto",
        showAdvanced: false
      };
      return {
        ...prev,
        [provider]: {
          ...current,
          ...patch
        }
      };
    });
  };

  const handleSave = async (config: QuotaAuthProviderConfig): Promise<void> => {
    const draft = draftByProvider[config.provider] ?? buildQuotaAuthDraft(config);
    const methods = parseQuotaMethods(draft.methodsText, config.methods);
    setSavingProvider(config.provider);
    const saved = await onSaveAuth({
      provider: config.provider,
      cookie: draft.cookie,
      clearCookie: draft.clearCookie,
      apiUrl: draft.apiUrl,
      consoleUrl: draft.consoleUrl,
      methods,
      commandJson: draft.commandJson
    });

    if (saved) {
      updateDraft(config.provider, {
        cookie: "",
        clearCookie: false,
        methodsText: methods.join(",")
      });
    }
    setSavingProvider(null);
  };

  const handleImportFromBrowser = async (
    provider: QuotaProvider,
    browser: QuotaBrowserSource
  ): Promise<void> => {
    setImportingProvider(provider);
    const imported = await onImportAuthFromBrowser(provider, browser);
    if (imported) {
      updateDraft(provider, {
        cookie: "",
        clearCookie: false
      });
    }
    setImportingProvider(null);
  };

  const handleAuthorizeInApp = async (provider: QuotaProvider): Promise<void> => {
    setAuthorizingProvider(provider);
    const authorized = await onAuthorizeInApp(provider);
    if (authorized) {
      updateDraft(provider, {
        cookie: "",
        clearCookie: false
      });
    }
    setAuthorizingProvider(null);
  };

  const handleImportMissing = async (): Promise<void> => {
    if (importingAll) {
      return;
    }
    setImportingAll(true);
    try {
      for (const config of quotaAuthConfigs) {
        if (config.hasCookie) {
          continue;
        }
        await handleImportFromBrowser(config.provider, "auto");
      }
    } finally {
      setImportingAll(false);
    }
  };

  return (
    <section className="quota-panel">
      <header className="quota-panel-header">
        <div>
          <h2>Quota Center</h2>
          <p className="hint">
            {quotaCheckedAt > 0 ? `Last checked: ${checkedAtLabel}` : checkedAtLabel}
          </p>
        </div>
        <div className="quota-panel-actions">
          <button className="btn secondary" onClick={onRefresh} disabled={quotaLoading}>
            {quotaLoading ? "Checking..." : "Refresh"}
          </button>
          <button className="btn secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </header>
      <div className="quota-panel-body">
        <section className="quota-auth-section">
          <header className="quota-auth-header">
            <div>
              <strong>Authorization</strong>
              <p className="hint">Import from logged-in browser directly, or use manual fields. Secrets stay in local app data.</p>
            </div>
            <div className="quota-auth-header-actions">
              <span className={`pill ${quotaSecretStorageMode === "encrypted" ? "ok" : "warn"}`}>
                {quotaSecretStorageMode === "encrypted" ? "Encrypted local storage" : "Plain local storage"}
              </span>
              <button
                className="btn secondary tiny"
                onClick={() => void handleImportMissing()}
                disabled={importingAll || quotaAuthLoading || quotaAuthConfigs.length === 0}
              >
                {importingAll ? "Importing..." : "Import Missing"}
              </button>
              <button className="btn secondary tiny" onClick={onRefreshAuth} disabled={quotaAuthLoading}>
                {quotaAuthLoading ? "Loading..." : "Reload"}
              </button>
            </div>
          </header>

          {quotaAuthError ? <div className="error-box">{quotaAuthError}</div> : null}
          {quotaAuthConfigs.length === 0 && !quotaAuthLoading ? (
            <div className="empty">No quota providers configured.</div>
          ) : null}

          {quotaAuthConfigs.map((config) => {
            const draft = draftByProvider[config.provider] ?? buildQuotaAuthDraft(config);
            const isSaving = savingProvider === config.provider;
            const isImporting = importingProvider === config.provider;
            const isAuthorizing = authorizingProvider === config.provider;
            return (
              <article key={config.provider} className="quota-auth-row">
                <div className="quota-auth-row-head">
                  <strong>{config.title}</strong>
                  <span className={`pill ${config.hasCookie ? "ok" : "warn"}`}>
                    {config.hasCookie ? "Authorized" : "Cookie missing"}
                  </span>
                </div>

                {draft.showAdvanced ? (
                  <div className="quota-auth-grid">
                    <label className="quota-auth-field">
                      <span>Session Cookie (manual fallback)</span>
                      <input
                        className="editor-input"
                        type="password"
                        value={draft.cookie}
                        placeholder={config.hasCookie ? "Saved. Paste to replace." : "Paste session cookie"}
                        onChange={(event) => updateDraft(config.provider, { cookie: event.target.value })}
                      />
                    </label>
                    <label className="quota-auth-field">
                      <span>Methods (api,command,page)</span>
                      <input
                        className="editor-input"
                        type="text"
                        value={draft.methodsText}
                        onChange={(event) => updateDraft(config.provider, { methodsText: event.target.value })}
                      />
                    </label>
                    <label className="quota-auth-field">
                      <span>API URL (optional)</span>
                      <input
                        className="editor-input"
                        type="text"
                        value={draft.apiUrl}
                        onChange={(event) => updateDraft(config.provider, { apiUrl: event.target.value })}
                      />
                    </label>
                    <label className="quota-auth-field">
                      <span>Console URL</span>
                      <input
                        className="editor-input"
                        type="text"
                        value={draft.consoleUrl}
                        onChange={(event) => updateDraft(config.provider, { consoleUrl: event.target.value })}
                      />
                    </label>
                    <label className="quota-auth-field full">
                      <span>Command JSON (optional)</span>
                      <textarea
                        className="editor-input quota-auth-command"
                        value={draft.commandJson}
                        onChange={(event) => updateDraft(config.provider, { commandJson: event.target.value })}
                      />
                    </label>
                  </div>
                ) : null}

                <div className="quota-auth-actions">
                  <label className="quota-auth-clear">
                    <input
                      type="checkbox"
                      checked={draft.clearCookie}
                      onChange={(event) => updateDraft(config.provider, { clearCookie: event.target.checked })}
                    />
                    Clear saved cookie
                  </label>
                  <label className="quota-auth-browser">
                    <span>Browser</span>
                    <select
                      className="editor-input quota-auth-browser-select"
                      value={draft.browserSource}
                      onChange={(event) =>
                        updateDraft(config.provider, { browserSource: event.target.value as QuotaBrowserSource })}
                      disabled={importingAll || isImporting || isSaving || isAuthorizing || quotaAuthLoading}
                    >
                      <option value="auto">Auto</option>
                      <option value="edge">Edge</option>
                      <option value="chrome">Chrome</option>
                    </select>
                  </label>
                  <button
                    className="btn secondary tiny"
                    onClick={() => void handleImportFromBrowser(config.provider, draft.browserSource)}
                    disabled={importingAll || isImporting || isSaving || isAuthorizing || quotaAuthLoading}
                  >
                    {isImporting ? "Importing..." : "Import Browser"}
                  </button>
                  <button
                    className="btn secondary tiny"
                    onClick={() => void handleAuthorizeInApp(config.provider)}
                    disabled={importingAll || isAuthorizing || isImporting || isSaving || quotaAuthLoading}
                  >
                    {isAuthorizing ? "Authorizing..." : "Login Window"}
                  </button>
                  <button
                    className="btn secondary tiny"
                    onClick={() => void handleSave(config)}
                    disabled={importingAll || isSaving || isImporting || isAuthorizing || quotaAuthLoading}
                  >
                    {isSaving ? "Saving..." : "Save Auth"}
                  </button>
                  <button
                    className="btn secondary tiny"
                    onClick={() => onOpenConsole(config.consoleUrl)}
                  >
                    Open Console
                  </button>
                  <button
                    className="btn secondary tiny"
                    onClick={() => updateDraft(config.provider, { showAdvanced: !draft.showAdvanced })}
                    disabled={importingAll || isSaving || isImporting || isAuthorizing || quotaAuthLoading}
                  >
                    {draft.showAdvanced ? "Hide Advanced" : "Advanced"}
                  </button>
                  <span className="hint">
                    {config.updatedAt > 0
                      ? `Updated: ${new Date(config.updatedAt).toLocaleString()}`
                      : "Not saved yet."}
                  </span>
                </div>
              </article>
            );
          })}
        </section>

        {quotaError ? <div className="error-box">{quotaError}</div> : null}
        {quotaItems.length === 0 && !quotaLoading ? (
          <div className="empty">No quota providers available.</div>
        ) : null}

        {quotaItems.map((item) => (
          <article key={item.provider} className="quota-row">
            <div className="quota-row-main">
              <strong>{item.title}</strong>
              <p>{item.detail}</p>
              <span className="hint">Checked: {new Date(item.checkedAt).toLocaleString()}</span>
            </div>
            <div className="quota-row-actions">
              <span className={`pill ${quotaStatusPillClass(item.status)}`}>
                {quotaStatusLabel(item.status)}
              </span>
              <button
                className="btn secondary tiny"
                onClick={() => onOpenConsole(item.consoleUrl)}
              >
                Open Console
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
});

QuotaCenterPanel.displayName = "QuotaCenterPanel";
