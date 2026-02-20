import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { electronApi } from "../services/electronApi";
import type {
  QuotaBrowserSource,
  QuotaAuthProviderConfig,
  QuotaAuthSaveRequest,
  QuotaItem,
  QuotaProvider,
  QuotaSecretStorageMode
} from "../types/ipc";

const QUOTA_REFRESH_INTERVAL_MS = 60000;

type UseQuotaStatusArgs = {
  withTimeout: <T>(promise: Promise<T>, timeoutMs: number, errorMessage: string) => Promise<T>;
  setStatus: (value: string) => void;
};

type QuotaLoadMode = "initial" | "manual" | "auto";

const buildQuotaSummary = (items: QuotaItem[]): string => {
  if (items.length === 0) {
    return "Not checked";
  }

  const liveCount = items.filter((item) => item.status === "available").length;
  const manualCount = items.filter((item) => item.status === "manual_only").length;
  const errorCount = items.filter((item) => item.status === "error").length;

  if (errorCount > 0) {
    return `${errorCount} error`;
  }
  if (liveCount > 0) {
    return `${liveCount} live`;
  }
  return `${manualCount} manual`;
};

const upsertQuotaAuthConfig = (
  current: QuotaAuthProviderConfig[],
  next: QuotaAuthProviderConfig
): QuotaAuthProviderConfig[] => {
  const exists = current.some((item) => item.provider === next.provider);
  if (!exists) {
    return [...current, next];
  }
  return current.map((item) => (item.provider === next.provider ? next : item));
};

export const useQuotaStatus = ({ withTimeout, setStatus }: UseQuotaStatusArgs) => {
  const [quotaItems, setQuotaItems] = useState<QuotaItem[]>([]);
  const [quotaLoading, setQuotaLoading] = useState<boolean>(false);
  const [quotaError, setQuotaError] = useState<string | null>(null);
  const [showQuotaPanel, setShowQuotaPanel] = useState<boolean>(false);
  const latestRequestIdRef = useRef<number>(0);
  const latestAuthRequestIdRef = useRef<number>(0);

  const [quotaAuthConfigs, setQuotaAuthConfigs] = useState<QuotaAuthProviderConfig[]>([]);
  const [quotaAuthLoading, setQuotaAuthLoading] = useState<boolean>(false);
  const [quotaAuthError, setQuotaAuthError] = useState<string | null>(null);
  const [quotaSecretStorageMode, setQuotaSecretStorageMode] = useState<QuotaSecretStorageMode>("plain");

  const loadQuotas = useCallback(
    async (mode: QuotaLoadMode) => {
      const requestId = latestRequestIdRef.current + 1;
      latestRequestIdRef.current = requestId;
      const showLoading = mode !== "auto";
      const notifyStatus = mode === "manual";

      if (showLoading) {
        setQuotaLoading(true);
      }

      try {
        const result = await withTimeout(
          electronApi.listQuotas(),
          7000,
          "Timed out while loading quota status."
        );

        if (requestId !== latestRequestIdRef.current) {
          return;
        }

        if (!result.ok) {
          if (result.items.length > 0) {
            setQuotaItems(result.items);
          }
          setQuotaError(result.message);
          if (notifyStatus) {
            setStatus(`Quota check failed: ${result.message}`);
          }
          return;
        }

        setQuotaItems(result.items);
        setQuotaError(null);
        if (notifyStatus) {
          setStatus("Quota status updated.");
        }
      } catch (quotaLoadError) {
        if (requestId !== latestRequestIdRef.current) {
          return;
        }
        const message = quotaLoadError instanceof Error ? quotaLoadError.message : "Unknown quota loading error.";
        setQuotaError(message);
        if (notifyStatus) {
          setStatus(`Quota check failed: ${message}`);
        }
      } finally {
        if (showLoading && requestId === latestRequestIdRef.current) {
          setQuotaLoading(false);
        }
      }
    },
    [setStatus, withTimeout]
  );

  const loadQuotaAuthConfigs = useCallback(async (notifyStatus: boolean): Promise<void> => {
    const requestId = latestAuthRequestIdRef.current + 1;
    latestAuthRequestIdRef.current = requestId;
    setQuotaAuthLoading(true);
    try {
      const result = await withTimeout(
        electronApi.getQuotaAuthConfigs(),
        7000,
        "Timed out while loading quota authorization settings."
      );

      if (requestId !== latestAuthRequestIdRef.current) {
        return;
      }

      setQuotaSecretStorageMode(result.storageMode);
      setQuotaAuthConfigs(result.providers);
      if (!result.ok) {
        setQuotaAuthError(result.message);
        if (notifyStatus) {
          setStatus(`Failed to load quota authorization: ${result.message}`);
        }
        return;
      }

      setQuotaAuthError(null);
      if (notifyStatus) {
        setStatus("Quota authorization settings loaded.");
      }
    } catch (loadError) {
      if (requestId !== latestAuthRequestIdRef.current) {
        return;
      }
      const message = loadError instanceof Error ? loadError.message : "Unknown quota authorization loading error.";
      setQuotaAuthError(message);
      if (notifyStatus) {
        setStatus(`Failed to load quota authorization: ${message}`);
      }
    } finally {
      if (requestId === latestAuthRequestIdRef.current) {
        setQuotaAuthLoading(false);
      }
    }
  }, [setStatus, withTimeout]);

  useEffect(() => {
    void loadQuotas("initial");
    void loadQuotaAuthConfigs(false);
  }, [loadQuotas, loadQuotaAuthConfigs]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadQuotas("auto");
    }, QUOTA_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [loadQuotas]);

  const refreshQuotas = useCallback(async () => {
    await loadQuotas("manual");
  }, [loadQuotas]);

  const refreshQuotaAuthConfigs = useCallback(async () => {
    await loadQuotaAuthConfigs(true);
  }, [loadQuotaAuthConfigs]);

  const saveQuotaAuthConfig = useCallback(async (request: QuotaAuthSaveRequest): Promise<boolean> => {
    setQuotaAuthLoading(true);
    try {
      const result = await withTimeout(
        electronApi.saveQuotaAuthConfig(request),
        7000,
        "Timed out while saving quota authorization settings."
      );
      if (!result.ok) {
        setQuotaAuthError(result.message);
        setStatus(`Failed to save quota authorization: ${result.message}`);
        return false;
      }

      setQuotaSecretStorageMode(result.storageMode);
      setQuotaAuthError(null);
      setQuotaAuthConfigs((prev) => upsertQuotaAuthConfig(prev, result.config));
      if (result.warning) {
        setStatus(`Quota authorization saved. ${result.warning}`);
      } else {
        setStatus("Quota authorization saved.");
      }

      await loadQuotas("manual");
      return true;
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "Unknown quota authorization save error.";
      setQuotaAuthError(message);
      setStatus(`Failed to save quota authorization: ${message}`);
      return false;
    } finally {
      setQuotaAuthLoading(false);
    }
  }, [loadQuotas, setStatus, withTimeout]);

  const importQuotaAuthFromBrowser = useCallback(async (
    provider: QuotaProvider,
    browser: QuotaBrowserSource = "auto"
  ): Promise<boolean> => {
    setQuotaAuthLoading(true);
    try {
      const result = await withTimeout(
        electronApi.importQuotaAuthFromBrowser({
          provider,
          browser
        }),
        10000,
        "Timed out while importing browser authorization."
      );

      if (!result.ok) {
        setQuotaAuthError(result.message);
        setStatus(`Failed to import browser authorization: ${result.message}`);
        return false;
      }

      setQuotaSecretStorageMode(result.storageMode);
      setQuotaAuthError(null);
      setQuotaAuthConfigs((prev) => upsertQuotaAuthConfig(prev, result.config));
      if (result.warning) {
        setStatus(
          `Imported ${result.cookieCount} cookies from ${result.browser} (${result.profile}). ${result.warning}`
        );
      } else {
        setStatus(`Imported ${result.cookieCount} cookies from ${result.browser} (${result.profile}).`);
      }

      await loadQuotas("manual");
      return true;
    } catch (importError) {
      const message = importError instanceof Error
        ? importError.message
        : "Unknown browser authorization import error.";
      setQuotaAuthError(message);
      setStatus(`Failed to import browser authorization: ${message}`);
      return false;
    } finally {
      setQuotaAuthLoading(false);
    }
  }, [loadQuotas, setStatus, withTimeout]);

  const authorizeQuotaInApp = useCallback(async (provider: QuotaProvider): Promise<boolean> => {
    setQuotaAuthLoading(true);
    try {
      const result = await withTimeout(
        electronApi.authorizeQuotaInApp({ provider }),
        600000,
        "Timed out while waiting for in-app authorization."
      );

      if (!result.ok) {
        setQuotaAuthError(result.message);
        if (result.cancelled) {
          setStatus("Quota authorization cancelled.");
        } else {
          setStatus(`Failed to authorize quota provider: ${result.message}`);
        }
        return false;
      }

      setQuotaSecretStorageMode(result.storageMode);
      setQuotaAuthError(null);
      setQuotaAuthConfigs((prev) => upsertQuotaAuthConfig(prev, result.config));
      if (result.warning) {
        setStatus(`Authorized with ${result.cookieCount} cookies. ${result.warning}`);
      } else {
        setStatus(`Authorized with ${result.cookieCount} cookies.`);
      }

      await loadQuotas("manual");
      return true;
    } catch (authError) {
      const message = authError instanceof Error ? authError.message : "Unknown in-app authorization error.";
      setQuotaAuthError(message);
      setStatus(`Failed to authorize quota provider: ${message}`);
      return false;
    } finally {
      setQuotaAuthLoading(false);
    }
  }, [loadQuotas, setStatus, withTimeout]);

  const openQuotaConsole = useCallback(async (url: string) => {
    try {
      const result = await withTimeout(
        electronApi.openExternal(url),
        5000,
        "Timed out while opening quota console."
      );
      if (!result.ok) {
        setStatus(`Failed to open quota console: ${result.message}`);
        return;
      }
      setStatus("Opened quota console.");
    } catch (openError) {
      const message = openError instanceof Error ? openError.message : "Unknown open-console error.";
      setStatus(`Failed to open quota console: ${message}`);
    }
  }, [setStatus, withTimeout]);

  const quotaCheckedAt = useMemo(() => {
    let latest = 0;
    for (const item of quotaItems) {
      if (item.checkedAt > latest) {
        latest = item.checkedAt;
      }
    }
    return latest;
  }, [quotaItems]);

  const quotaSummary = useMemo(() => buildQuotaSummary(quotaItems), [quotaItems]);

  const quotaStatusCounts = useMemo(() => {
    let available = 0;
    let manualOnly = 0;
    let error = 0;
    for (const item of quotaItems) {
      if (item.status === "available") {
        available += 1;
      } else if (item.status === "manual_only") {
        manualOnly += 1;
      } else if (item.status === "error") {
        error += 1;
      }
    }
    return {
      available,
      manualOnly,
      error
    };
  }, [quotaItems]);

  return {
    quotaItems,
    quotaLoading,
    quotaError,
    showQuotaPanel,
    setShowQuotaPanel,
    quotaCheckedAt,
    quotaSummary,
    quotaStatusCounts,
    refreshQuotas,
    openQuotaConsole,
    quotaAuthConfigs,
    quotaAuthLoading,
    quotaAuthError,
    quotaSecretStorageMode,
    refreshQuotaAuthConfigs,
    saveQuotaAuthConfig,
    importQuotaAuthFromBrowser,
    authorizeQuotaInApp
  };
};
