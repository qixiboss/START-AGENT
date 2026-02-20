import { spawn } from "node:child_process";
import type { QuotaItem, QuotaListResult, QuotaMethod, QuotaProvider } from "../../src/types/ipc.js";
import type { QuotaRuntimeConfig } from "./quotaAuth.js";

const FETCH_TIMEOUT_MS = 9000;
const COMMAND_TIMEOUT_MS = 8000;
const MAX_SCALAR_ENTRIES = 1200;
const MAX_COMMAND_OUTPUT_CHARS = 120_000;
const MAX_DIAGNOSTIC_MESSAGES = 4;
const METRIC_DECIMALS = 2;

const scalarNumberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: METRIC_DECIMALS
});

const defaultUserAgent = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;

type MetricSet = {
  used: number | null;
  total: number | null;
  remaining: number | null;
};

type ScalarEntry = {
  keyPath: string;
  value: string | number | boolean | null;
};

type QuotaProbeMethod = "api" | "command" | "page";

type QuotaSourceConfig = {
  provider: QuotaItem["provider"];
  title: string;
  consoleUrl: string;
  cookie: string;
  apiUrl: string;
  commandJson: string;
  methods: QuotaMethod[];
};

type CommandProbeSpec = {
  command: string;
  args: string[];
  cwd?: string;
};

type CommandProbeResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  spawnError: string | null;
};

type ProbeSuccess = {
  ok: true;
  metrics: MetricSet;
  sourceLabel: "API" | "Command" | "Page";
};

type ProbeFailure = {
  ok: false;
  message: string;
};

type ProbeOutcome = ProbeSuccess | ProbeFailure;

type ProbeFailureEntry = {
  method: QuotaProbeMethod;
  message: string;
};

const metricKeywords = {
  used: [
    "used",
    "usage",
    "consumed",
    "cost",
    "spend",
    "token_used",
    "tokens_used",
    "token_usage",
    "prompt_tokens",
    "completion_tokens",
    "input_tokens",
    "output_tokens",
    "credit_used",
    "credits_used",
    "\u5df2\u7528",
    "\u6d88\u8017"
  ],
  total: [
    "total",
    "limit",
    "quota",
    "allowance",
    "cap",
    "budget",
    "token_limit",
    "tokens_limit",
    "total_tokens",
    "credit_total",
    "credits_total",
    "monthly_limit",
    "\u603b\u91cf",
    "\u989d\u5ea6",
    "\u4e0a\u9650"
  ],
  remaining: [
    "remaining",
    "remain",
    "left",
    "available",
    "balance",
    "rest",
    "credit_remaining",
    "remaining_credit",
    "available_credit",
    "tokens_left",
    "available_tokens",
    "\u5269\u4f59",
    "\u53ef\u7528"
  ]
} as const;

const probeMethodValues: readonly QuotaProbeMethod[] = ["api", "command", "page"];

const methodLabelMap: Record<QuotaProbeMethod, string> = {
  api: "API",
  command: "Command",
  page: "Page"
};

const roundMetric = (value: number): number => {
  return Math.round(value * 10 ** METRIC_DECIMALS) / 10 ** METRIC_DECIMALS;
};

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().replace(/,/g, "");
  if (!normalized) {
    return null;
  }

  const match = normalized.match(/-?\d+(?:\.\d+)?(?:[kKmMbB])?/);
  if (!match) {
    return null;
  }

  const token = match[0];
  const suffix = token[token.length - 1];
  const hasSuffix = /[kKmMbB]/.test(suffix);
  const numericPart = hasSuffix ? token.slice(0, -1) : token;
  const parsed = Number(numericPart);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  if (!hasSuffix) {
    return parsed;
  }

  const multiplier = suffix.toLowerCase() === "k"
    ? 1_000
    : suffix.toLowerCase() === "m"
      ? 1_000_000
      : 1_000_000_000;
  return parsed * multiplier;
};

const collectScalarEntries = (
  value: unknown,
  keyPath: string,
  bucket: ScalarEntry[]
): void => {
  if (bucket.length >= MAX_SCALAR_ENTRIES) {
    return;
  }

  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    bucket.push({ keyPath, value });
    return;
  }

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (bucket.length >= MAX_SCALAR_ENTRIES) {
        return;
      }
      collectScalarEntries(value[index], `${keyPath}[${index}]`, bucket);
    }
    return;
  }

  if (typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      if (bucket.length >= MAX_SCALAR_ENTRIES) {
        return;
      }
      const nextPath = keyPath ? `${keyPath}.${key}` : key;
      collectScalarEntries(nested, nextPath, bucket);
    }
  }
};

const pickMetricValue = (entries: ScalarEntry[], keywords: readonly string[]): number | null => {
  for (const entry of entries) {
    const pathLower = entry.keyPath.toLowerCase();
    if (!keywords.some((keyword) => pathLower.includes(keyword.toLowerCase()))) {
      continue;
    }
    const numberValue = toFiniteNumber(entry.value);
    if (numberValue !== null) {
      return numberValue;
    }
  }
  return null;
};

const normalizeMetrics = (metrics: MetricSet): MetricSet => {
  let { used, total, remaining } = metrics;

  if (total === null && used !== null && remaining !== null) {
    total = used + remaining;
  }
  if (used === null && total !== null && remaining !== null) {
    used = total - remaining;
  }
  if (remaining === null && total !== null && used !== null) {
    remaining = total - used;
  }

  return {
    used: used === null ? null : roundMetric(used),
    total: total === null ? null : roundMetric(total),
    remaining: remaining === null ? null : roundMetric(remaining)
  };
};

const extractMetricsFromJson = (value: unknown): MetricSet => {
  const entries: ScalarEntry[] = [];
  collectScalarEntries(value, "", entries);

  return normalizeMetrics({
    used: pickMetricValue(entries, metricKeywords.used),
    total: pickMetricValue(entries, metricKeywords.total),
    remaining: pickMetricValue(entries, metricKeywords.remaining)
  });
};

const escapeRegExp = (value: string): string => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

const extractMetricFromText = (text: string, keywords: readonly string[]): number | null => {
  for (const keyword of keywords) {
    const escapedKeyword = escapeRegExp(keyword);
    const afterPattern = new RegExp(`${escapedKeyword}[^\\d-]{0,24}(-?\\d[\\d,.kmbKMB]{0,24})`, "i");
    const beforePattern = new RegExp(`(-?\\d[\\d,.kmbKMB]{0,24})[^\\d-]{0,24}${escapedKeyword}`, "i");
    const afterMatch = text.match(afterPattern);
    const afterValue = afterMatch?.[1] ? toFiniteNumber(afterMatch[1]) : null;
    if (afterValue !== null) {
      return afterValue;
    }
    const beforeMatch = text.match(beforePattern);
    const beforeValue = beforeMatch?.[1] ? toFiniteNumber(beforeMatch[1]) : null;
    if (beforeValue !== null) {
      return beforeValue;
    }
  }
  return null;
};

const stripHtml = (html: string): string => {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const extractNextDataJson = (html: string): unknown | null => {
  const match = html.match(
    /<script[^>]*id=["']__NEXT_DATA__["'][^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/i
  );
  if (!match?.[1]) {
    return null;
  }
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
};

const parseJsonCandidate = (candidate: string): unknown | null => {
  if (!candidate) {
    return null;
  }
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
};

const extractJsonFromText = (text: string): unknown | null => {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  const direct = parseJsonCandidate(trimmed);
  if (direct !== null) {
    return direct;
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    const fenced = parseJsonCandidate(fencedMatch[1].trim());
    if (fenced !== null) {
      return fenced;
    }
  }

  const lines = trimmed.split(/\r?\n/);
  for (const line of lines) {
    const candidate = line.trim();
    if (!(candidate.startsWith("{") || candidate.startsWith("["))) {
      continue;
    }
    const parsed = parseJsonCandidate(candidate);
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
};

const hasAnyMetric = (metrics: MetricSet): boolean => {
  return metrics.used !== null || metrics.total !== null || metrics.remaining !== null;
};

const formatMetric = (value: number): string => {
  return scalarNumberFormatter.format(value);
};

const buildMetricDetail = (metrics: MetricSet, sourceLabel: ProbeSuccess["sourceLabel"]): string => {
  const segments: string[] = [];
  if (metrics.used !== null) {
    segments.push(`used ${formatMetric(metrics.used)}`);
  }
  if (metrics.total !== null) {
    segments.push(`total ${formatMetric(metrics.total)}`);
  }
  if (metrics.remaining !== null) {
    segments.push(`remaining ${formatMetric(metrics.remaining)}`);
  }
  return `${sourceLabel} parsed: ${segments.join(" / ")}`;
};

const safeFetchText = async (url: string, cookie: string): Promise<{ status: number; body: string }> => {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: {
        "user-agent": defaultUserAgent,
        accept: "application/json,text/html,*/*",
        "accept-language": "en-US,en;q=0.9",
        cookie
      },
      signal: controller.signal
    });
    const body = await response.text();
    return { status: response.status, body };
  } finally {
    clearTimeout(timeoutHandle);
  }
};

const appendOutputChunk = (current: string, chunk: unknown): string => {
  const textChunk = typeof chunk === "string"
    ? chunk
    : Buffer.isBuffer(chunk)
      ? chunk.toString("utf8")
      : String(chunk);
  const next = `${current}${textChunk}`;
  if (next.length <= MAX_COMMAND_OUTPUT_CHARS) {
    return next;
  }
  return next.slice(next.length - MAX_COMMAND_OUTPUT_CHARS);
};

const safeRunCommand = async (spec: CommandProbeSpec): Promise<CommandProbeResult> => {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let finished = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    const complete = (result: CommandProbeResult) => {
      if (finished) {
        return;
      }
      finished = true;
      if (timeoutHandle !== null) {
        clearTimeout(timeoutHandle);
      }
      resolve(result);
    };

    let child;
    try {
      child = spawn(spec.command, spec.args, {
        cwd: spec.cwd,
        shell: false,
        windowsHide: true
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown command spawn error.";
      complete({
        code: null,
        stdout,
        stderr,
        timedOut: false,
        spawnError: message
      });
      return;
    }

    child.stdout?.on("data", (chunk) => {
      stdout = appendOutputChunk(stdout, chunk);
    });

    child.stderr?.on("data", (chunk) => {
      stderr = appendOutputChunk(stderr, chunk);
    });

    child.on("error", (error) => {
      const message = error instanceof Error ? error.message : "Unknown command spawn error.";
      complete({
        code: null,
        stdout,
        stderr,
        timedOut: false,
        spawnError: message
      });
    });

    child.on("close", (code) => {
      complete({
        code,
        stdout,
        stderr,
        timedOut: false,
        spawnError: null
      });
    });

    timeoutHandle = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // Child may have already exited.
      }
      complete({
        code: null,
        stdout,
        stderr,
        timedOut: true,
        spawnError: null
      });
    }, COMMAND_TIMEOUT_MS);
  });
};

const parseMetricsFromPage = (html: string): MetricSet => {
  const nextData = extractNextDataJson(html);
  if (nextData) {
    const nextDataMetrics = extractMetricsFromJson(nextData);
    if (hasAnyMetric(nextDataMetrics)) {
      return nextDataMetrics;
    }
  }

  const cleanText = stripHtml(html);
  return normalizeMetrics({
    used: extractMetricFromText(cleanText, metricKeywords.used),
    total: extractMetricFromText(cleanText, metricKeywords.total),
    remaining: extractMetricFromText(cleanText, metricKeywords.remaining)
  });
};

const parseMetricsFromApiBody = (body: string): MetricSet => {
  const parsedJson = extractJsonFromText(body);
  if (parsedJson !== null) {
    const jsonMetrics = extractMetricsFromJson(parsedJson);
    if (hasAnyMetric(jsonMetrics)) {
      return jsonMetrics;
    }
  }

  return normalizeMetrics({
    used: extractMetricFromText(body, metricKeywords.used),
    total: extractMetricFromText(body, metricKeywords.total),
    remaining: extractMetricFromText(body, metricKeywords.remaining)
  });
};

const parseCommandProbeSpec = (rawValue: string): CommandProbeSpec | null => {
  try {
    const parsed = JSON.parse(rawValue);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    const spec = parsed as Record<string, unknown>;
    const command = typeof spec.command === "string" ? spec.command.trim() : "";
    if (!command || command.length > 200 || /[\r\n]/.test(command)) {
      return null;
    }

    const args = Array.isArray(spec.args)
      ? spec.args
        .filter((arg): arg is string => typeof arg === "string")
        .map((arg) => arg.trim())
        .filter((arg) => arg.length > 0)
      : [];
    if (args.some((arg) => arg.length > 500 || /[\r\n]/.test(arg))) {
      return null;
    }

    const cwdRaw = typeof spec.cwd === "string" ? spec.cwd.trim() : "";
    const cwd = cwdRaw && cwdRaw.length <= 400 && !/[\r\n]/.test(cwdRaw) ? cwdRaw : undefined;

    return {
      command,
      args,
      cwd
    };
  } catch {
    return null;
  }
};

const parseProbeMethods = (methods: QuotaMethod[] | undefined): QuotaProbeMethod[] => {
  if (!Array.isArray(methods) || methods.length === 0) {
    return ["api", "command", "page"];
  }

  const selected: QuotaProbeMethod[] = [];
  const seen = new Set<QuotaProbeMethod>();
  for (const methodValue of methods) {
    const normalized = methodValue.trim().toLowerCase();
    if (!probeMethodValues.includes(normalized as QuotaProbeMethod)) {
      continue;
    }
    const method = normalized as QuotaProbeMethod;
    if (seen.has(method)) {
      continue;
    }
    selected.push(method);
    seen.add(method);
  }

  return selected.length > 0 ? selected : ["api", "command", "page"];
};

const probeApi = async (apiUrl: string, cookie: string): Promise<ProbeOutcome> => {
  try {
    const response = await safeFetchText(apiUrl, cookie);
    if (response.status < 200 || response.status >= 300) {
      return { ok: false, message: `HTTP ${response.status}.` };
    }

    const metrics = parseMetricsFromApiBody(response.body);
    if (!hasAnyMetric(metrics)) {
      return { ok: false, message: "Reachable but no parseable quota fields." };
    }

    return {
      ok: true,
      metrics,
      sourceLabel: "API"
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown API probe error.";
    return {
      ok: false,
      message
    };
  }
};

const probePage = async (consoleUrl: string, cookie: string): Promise<ProbeOutcome> => {
  try {
    const response = await safeFetchText(consoleUrl, cookie);
    if (response.status < 200 || response.status >= 300) {
      return { ok: false, message: `HTTP ${response.status}.` };
    }

    const metrics = parseMetricsFromPage(response.body);
    if (!hasAnyMetric(metrics)) {
      return { ok: false, message: "Page loaded but no parseable quota fields." };
    }

    return {
      ok: true,
      metrics,
      sourceLabel: "Page"
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown page probe error.";
    return {
      ok: false,
      message
    };
  }
};

const probeCommand = async (spec: CommandProbeSpec): Promise<ProbeOutcome> => {
  const commandResult = await safeRunCommand(spec);

  if (commandResult.spawnError) {
    return {
      ok: false,
      message: `Spawn failed: ${commandResult.spawnError}`
    };
  }

  if (commandResult.timedOut) {
    return {
      ok: false,
      message: `Timed out after ${COMMAND_TIMEOUT_MS} ms.`
    };
  }

  const combined = `${commandResult.stdout}\n${commandResult.stderr}`.trim();
  if (!combined) {
    return {
      ok: false,
      message: commandResult.code === 0
        ? "No output from command."
        : `Exited with code ${String(commandResult.code ?? "unknown")} and no output.`
    };
  }

  const metrics = parseMetricsFromApiBody(combined);
  if (!hasAnyMetric(metrics)) {
    return {
      ok: false,
      message: commandResult.code === 0
        ? "Output had no parseable quota fields."
        : `Exited with code ${String(commandResult.code ?? "unknown")} and no parseable quota fields.`
    };
  }

  return {
    ok: true,
    metrics,
    sourceLabel: "Command"
  };
};

const formatProbeFailures = (entries: ProbeFailureEntry[]): string => {
  if (entries.length === 0) {
    return "No parseable fields found across selected quota methods.";
  }
  return entries
    .slice(0, MAX_DIAGNOSTIC_MESSAGES)
    .map((entry) => `${methodLabelMap[entry.method]}: ${entry.message}`)
    .join(" | ");
};

const buildManualQuotaItem = (
  config: QuotaSourceConfig,
  checkedAt: number
): QuotaItem => {
  return {
    provider: config.provider,
    status: "manual_only",
    title: config.title,
    detail: "Automatic check unavailable. Authorize this provider in Quota Center first.",
    checkedAt,
    consoleUrl: config.consoleUrl
  };
};

const buildAvailableQuotaItem = (
  config: QuotaSourceConfig,
  checkedAt: number,
  detail: string
): QuotaItem => {
  return {
    provider: config.provider,
    status: "available",
    title: config.title,
    detail,
    checkedAt,
    consoleUrl: config.consoleUrl
  };
};

const buildErrorQuotaItem = (config: QuotaSourceConfig, checkedAt: number, detail: string): QuotaItem => {
  return {
    provider: config.provider,
    status: "error",
    title: config.title,
    detail,
    checkedAt,
    consoleUrl: config.consoleUrl
  };
};

const resolveQuotaItem = async (config: QuotaSourceConfig): Promise<QuotaItem> => {
  const checkedAt = Date.now();
  const cookie = config.cookie.trim();
  const apiUrl = config.apiUrl.trim();
  const commandRaw = config.commandJson.trim();
  const commandSpec = commandRaw ? parseCommandProbeSpec(commandRaw) : null;
  const methods = parseProbeMethods(config.methods);

  let attemptedCount = 0;
  const failures: ProbeFailureEntry[] = [];

  for (const method of methods) {
    if (method === "api") {
      if (!cookie || !apiUrl) {
        continue;
      }
      attemptedCount += 1;
      const outcome = await probeApi(apiUrl, cookie);
      if (outcome.ok) {
        return buildAvailableQuotaItem(config, checkedAt, buildMetricDetail(outcome.metrics, outcome.sourceLabel));
      }
      failures.push({
        method: "api",
        message: outcome.message
      });
      continue;
    }

    if (method === "command") {
      if (!commandRaw) {
        continue;
      }
      if (!commandSpec) {
        failures.push({
          method: "command",
          message: "Invalid command JSON configuration."
        });
        continue;
      }
      attemptedCount += 1;
      const outcome = await probeCommand(commandSpec);
      if (outcome.ok) {
        return buildAvailableQuotaItem(config, checkedAt, buildMetricDetail(outcome.metrics, outcome.sourceLabel));
      }
      failures.push({
        method: "command",
        message: outcome.message
      });
      continue;
    }

    if (!cookie) {
      continue;
    }
    attemptedCount += 1;
    const outcome = await probePage(config.consoleUrl, cookie);
    if (outcome.ok) {
      return buildAvailableQuotaItem(config, checkedAt, buildMetricDetail(outcome.metrics, outcome.sourceLabel));
    }
    failures.push({
      method: "page",
      message: outcome.message
    });
  }

  if (attemptedCount === 0 && failures.length === 0) {
    return buildManualQuotaItem(config, checkedAt);
  }

  return buildErrorQuotaItem(config, checkedAt, formatProbeFailures(failures));
};

type ListQuotasDeps = {
  getRuntimeConfig: (provider: QuotaProvider) => Promise<QuotaRuntimeConfig>;
};

const toQuotaSourceConfig = (runtime: QuotaRuntimeConfig): QuotaSourceConfig => {
  return {
    provider: runtime.provider,
    title: runtime.title,
    consoleUrl: runtime.consoleUrl,
    cookie: runtime.cookie,
    apiUrl: runtime.apiUrl,
    commandJson: runtime.commandJson,
    methods: runtime.methods
  };
};

export const listQuotas = async (deps: ListQuotasDeps): Promise<QuotaListResult> => {
  try {
    const [codexRuntime, volcengineRuntime] = await Promise.all([
      deps.getRuntimeConfig("codex_chatgpt"),
      deps.getRuntimeConfig("volcengine_coding_plan")
    ]);
    const [codexQuota, volcengineQuota] = await Promise.all([
      resolveQuotaItem(toQuotaSourceConfig(codexRuntime)),
      resolveQuotaItem(toQuotaSourceConfig(volcengineRuntime))
    ]);
    return {
      ok: true,
      items: [codexQuota, volcengineQuota]
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown quota service error.";
    return {
      ok: false,
      message,
      items: []
    };
  }
};
