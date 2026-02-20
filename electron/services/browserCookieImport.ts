import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import type { QuotaBrowserSource } from "../../src/types/ipc.js";

type SupportedBrowser = Exclude<QuotaBrowserSource, "auto">;

type BrowserImportRequest = {
  browser: QuotaBrowserSource;
  domainSuffixes: string[];
  preferredCookieNames: string[];
};

export type BrowserImportSuccess = {
  ok: true;
  browser: SupportedBrowser;
  profile: string;
  cookieHeader: string;
  cookieCount: number;
};

export type BrowserImportFailure = {
  ok: false;
  message: string;
};

export type BrowserImportResult = BrowserImportSuccess | BrowserImportFailure;

type RawCookieRow = {
  hostKey: string;
  name: string;
  value: string;
  encryptedValue: Buffer;
  lastAccessUtc: number;
};

type CookieValueEntry = {
  name: string;
  value: string;
  lastAccessUtc: number;
};

type ProfileResult = {
  browser: SupportedBrowser;
  profile: string;
  cookieHeader: string;
  cookieCount: number;
  score: number;
  maxLastAccessUtc: number;
};

type BrowserAttemptResult = {
  best: ProfileResult | null;
  diagnostics: string[];
};

type SqlJsModule = {
  Database: new (data?: Uint8Array) => SqlJsDatabase;
};

type SqlJsDatabase = {
  prepare: (sql: string) => SqlJsStatement;
  close: () => void;
};

type SqlJsStatement = {
  bind: (params: Record<string, unknown>) => void;
  step: () => boolean;
  getAsObject: () => Record<string, unknown>;
  free: () => void;
};

const IMPORT_TIMEOUT_MS = 7000;
const COPY_RETRY_ATTEMPTS = 3;
const COPY_RETRY_DELAY_MS = 160;
const PROFILE_NAME_PATTERN = /^Profile \d+$/;

const browserUserDataPaths: Record<SupportedBrowser, string> = {
  chrome: path.join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "User Data"),
  edge: path.join(process.env.LOCALAPPDATA ?? "", "Microsoft", "Edge", "User Data")
};

const dpapiUnprotectScript =
  "$ErrorActionPreference='Stop';" +
  "$bytes=[Convert]::FromBase64String($args[0]);" +
  "$out=[System.Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser);" +
  "[Console]::Out.Write([Convert]::ToBase64String($out));";

let sqlJsPromise: Promise<SqlJsModule> | null = null;

const toFiniteNumber = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const toText = (value: unknown): string => {
  return typeof value === "string" ? value : "";
};

const toBuffer = (value: unknown): Buffer => {
  if (!value) {
    return Buffer.alloc(0);
  }
  if (Buffer.isBuffer(value)) {
    return value;
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }
  if (Array.isArray(value)) {
    return Buffer.from(value);
  }
  return Buffer.alloc(0);
};

const fileExists = async (targetPath: string): Promise<boolean> => {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
};

const sleep = async (durationMs: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, durationMs));
};

const formatError = (error: unknown, fallback: string): string => {
  if (!error) {
    return fallback;
  }
  if (error instanceof Error) {
    return error.message || fallback;
  }
  return typeof error === "string" ? error : fallback;
};

const getErrorCode = (error: unknown): string => {
  if (!error || typeof error !== "object") {
    return "";
  }
  const maybe = error as { code?: unknown };
  return typeof maybe.code === "string" ? maybe.code : "";
};

const isLockedFileError = (error: unknown): boolean => {
  const code = getErrorCode(error);
  return code === "EBUSY" || code === "EPERM" || code === "EACCES";
};

type ProcessRunResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  spawnError: string | null;
};

const safeRunProcess = async (command: string, args: string[], timeoutMs: number): Promise<ProcessRunResult> => {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let finished = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    const complete = (result: ProcessRunResult) => {
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
      child = spawn(command, args, {
        windowsHide: true
      });
    } catch (error) {
      const message = formatError(error, "Unknown process spawn error.");
      complete({
        code: null,
        stdout,
        stderr,
        timedOut: false,
        spawnError: message
      });
      return;
    }

    child.stdout.on("data", (chunk) => {
      stdout += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    });
    child.on("error", (error) => {
      const message = formatError(error, "Unknown process error.");
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
        // Ignore kill failures.
      }
      complete({
        code: null,
        stdout,
        stderr,
        timedOut: true,
        spawnError: null
      });
    }, timeoutMs);
  });
};

const runEsentutlCopy = async (sourcePath: string, destinationPath: string): Promise<string | null> => {
  if (process.platform !== "win32") {
    return "Esentutl copy is only supported on Windows.";
  }

  const result = await safeRunProcess("esentutl.exe", ["/y", sourcePath, "/d", destinationPath, "/o"], 15_000);
  if (result.spawnError) {
    return result.spawnError;
  }
  if (result.timedOut) {
    return "esentutl copy timed out.";
  }
  if (result.code !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim();
    return detail ? `esentutl exited with code ${String(result.code)}: ${detail}` : `esentutl exited with code ${String(result.code)}.`;
  }
  return null;
};

const copyCookieDbToTemp = async (sourcePath: string, destinationPath: string): Promise<string | null> => {
  let lastError: unknown = null;

  for (let attempt = 0; attempt < COPY_RETRY_ATTEMPTS; attempt += 1) {
    try {
      await fs.copyFile(sourcePath, destinationPath);
      return null;
    } catch (error) {
      lastError = error;
      if (!isLockedFileError(error) || attempt >= COPY_RETRY_ATTEMPTS - 1) {
        break;
      }
      await sleep(COPY_RETRY_DELAY_MS * (attempt + 1));
    }
  }

  if (lastError && isLockedFileError(lastError)) {
    const esentError = await runEsentutlCopy(sourcePath, destinationPath);
    if (!esentError) {
      return null;
    }

    try {
      const bytes = await fs.readFile(sourcePath);
      await fs.writeFile(destinationPath, bytes);
      return null;
    } catch (readError) {
      const primary = formatError(lastError, "Failed to copy locked cookie db.");
      const secondary = formatError(readError, "Failed to read locked cookie db.");
      return `${primary} | esentutl: ${esentError} | read: ${secondary}`;
    }
  }

  return formatError(lastError, "Failed to copy cookies database.");
};

const getSqlJs = async (): Promise<SqlJsModule> => {
  if (sqlJsPromise) {
    return sqlJsPromise;
  }

  const initSqlJs = require("sql.js") as (options: { locateFile: (file: string) => string }) => Promise<SqlJsModule>;
  const wasmPath = require.resolve("sql.js/dist/sql-wasm.wasm");
  const wasmDirectory = path.dirname(wasmPath);
  sqlJsPromise = initSqlJs({
    locateFile: (file) => path.join(wasmDirectory, file)
  });
  return sqlJsPromise;
};

const unprotectDpapiBuffer = async (encrypted: Buffer): Promise<Buffer | null> => {
  if (encrypted.length === 0) {
    return null;
  }

  return new Promise((resolve) => {
    const encoded = encrypted.toString("base64");
    let stdout = "";
    let stderr = "";
    let finished = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    const finalize = (value: Buffer | null): void => {
      if (finished) {
        return;
      }
      finished = true;
      if (timeoutHandle !== null) {
        clearTimeout(timeoutHandle);
      }
      resolve(value);
    };

    const child = spawn("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      dpapiUnprotectScript,
      encoded
    ], {
      windowsHide: true
    });

    child.stdout.on("data", (chunk) => {
      stdout += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    });
    child.on("error", () => finalize(null));
    child.on("close", (code) => {
      if (code !== 0) {
        void stderr;
        finalize(null);
        return;
      }

      const output = stdout.trim();
      if (!output) {
        finalize(null);
        return;
      }

      try {
        finalize(Buffer.from(output, "base64"));
      } catch {
        finalize(null);
      }
    });

    timeoutHandle = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // Ignore kill failures.
      }
      finalize(null);
    }, IMPORT_TIMEOUT_MS);
  });
};

const readMasterKey = async (userDataDir: string): Promise<Buffer | null> => {
  const localStatePath = path.join(userDataDir, "Local State");
  if (!(await fileExists(localStatePath))) {
    return null;
  }

  try {
    const raw = await fs.readFile(localStatePath, "utf-8");
    const parsed = JSON.parse(raw) as { os_crypt?: { encrypted_key?: string } };
    const encodedKey = parsed.os_crypt?.encrypted_key;
    if (!encodedKey) {
      return null;
    }

    const encrypted = Buffer.from(encodedKey, "base64");
    if (encrypted.length === 0) {
      return null;
    }

    const dpapiPrefix = Buffer.from("DPAPI");
    if (encrypted.subarray(0, dpapiPrefix.length).equals(dpapiPrefix)) {
      return unprotectDpapiBuffer(encrypted.subarray(dpapiPrefix.length));
    }

    return encrypted;
  } catch {
    return null;
  }
};

const resolveCookiesDbPath = async (profilePath: string): Promise<string | null> => {
  const networkCookies = path.join(profilePath, "Network", "Cookies");
  if (await fileExists(networkCookies)) {
    return networkCookies;
  }
  const legacyCookies = path.join(profilePath, "Cookies");
  if (await fileExists(legacyCookies)) {
    return legacyCookies;
  }
  return null;
};

const listProfileNames = async (userDataDir: string): Promise<string[]> => {
  try {
    const entries = await fs.readdir(userDataDir, { withFileTypes: true });
    const names = entries
      .filter((entry) => entry.isDirectory() && (entry.name === "Default" || PROFILE_NAME_PATTERN.test(entry.name)))
      .map((entry) => entry.name);
    names.sort((left, right) => {
      if (left === "Default") {
        return -1;
      }
      if (right === "Default") {
        return 1;
      }
      return left.localeCompare(right);
    });
    return names;
  } catch {
    return [];
  }
};

const readCookieRows = async (
  cookieDbPath: string,
  domainSuffixes: string[]
): Promise<{ rows: RawCookieRow[]; error: string | null }> => {
  const temporaryPath = path.join(
    os.tmpdir(),
    `start-agent-cookie-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`
  );

  try {
    const copyError = await copyCookieDbToTemp(cookieDbPath, temporaryPath);
    if (copyError) {
      return {
        rows: [],
        error: copyError
      };
    }
    const dbBytes = await fs.readFile(temporaryPath);
    const SQL = await getSqlJs();
    const db = new SQL.Database(new Uint8Array(dbBytes));
    const rows: RawCookieRow[] = [];
    const seen = new Set<string>();

    const conditions = domainSuffixes.map((_, index) => `host_key LIKE $pattern${String(index)}`).join(" OR ");
    const params: Record<string, unknown> = {};
    for (let index = 0; index < domainSuffixes.length; index += 1) {
      params[`$pattern${String(index)}`] = `%${domainSuffixes[index].toLowerCase()}`;
    }

    const statement = db.prepare(
      `SELECT host_key, name, value, encrypted_value, last_access_utc FROM cookies WHERE ${conditions}`
    );
    statement.bind(params);

    while (statement.step()) {
      const raw = statement.getAsObject();
      const hostKey = toText(raw.host_key).toLowerCase();
      const name = toText(raw.name);
      if (!hostKey || !name) {
        continue;
      }

      const lastAccessUtc = toFiniteNumber(raw.last_access_utc);
      const dedupeKey = `${hostKey}|${name}|${String(lastAccessUtc)}`;
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);

      rows.push({
        hostKey,
        name,
        value: toText(raw.value),
        encryptedValue: toBuffer(raw.encrypted_value),
        lastAccessUtc
      });
    }

    statement.free();
    db.close();
    return {
      rows,
      error: null
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown cookie db read error.";
    return {
      rows: [],
      error: message
    };
  } finally {
    try {
      await fs.unlink(temporaryPath);
    } catch {
      // Ignore cleanup failures.
    }
  }
};

const decryptCookieValue = async (encryptedValue: Buffer, masterKey: Buffer | null): Promise<string | null> => {
  if (encryptedValue.length === 0) {
    return null;
  }

  const prefix = encryptedValue.subarray(0, 3).toString("utf8");
  if (/^v\d\d$/.test(prefix)) {
    if (!masterKey || masterKey.length === 0 || encryptedValue.length <= 3 + 12 + 16) {
      return null;
    }

    try {
      const nonce = encryptedValue.subarray(3, 15);
      const encryptedBytes = encryptedValue.subarray(15, encryptedValue.length - 16);
      const authTag = encryptedValue.subarray(encryptedValue.length - 16);
      const decipher = crypto.createDecipheriv("aes-256-gcm", masterKey, nonce);
      decipher.setAuthTag(authTag);
      const decrypted = Buffer.concat([decipher.update(encryptedBytes), decipher.final()]);
      return decrypted.toString("utf8");
    } catch {
      return null;
    }
  }

  const unprotected = await unprotectDpapiBuffer(encryptedValue);
  return unprotected ? unprotected.toString("utf8") : null;
};

const buildCookieHeader = async (
  rows: RawCookieRow[],
  masterKey: Buffer | null,
  preferredCookieNames: string[]
): Promise<{ cookieHeader: string; cookieCount: number; score: number; maxLastAccessUtc: number }> => {
  const byName = new Map<string, CookieValueEntry>();
  const preferredLower = preferredCookieNames
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name.length > 0);

  for (const row of rows) {
    let cookieValue = row.value.trim();
    if (!cookieValue) {
      const decrypted = await decryptCookieValue(row.encryptedValue, masterKey);
      cookieValue = decrypted?.trim() ?? "";
    }
    if (!cookieValue) {
      continue;
    }

    const existing = byName.get(row.name);
    if (existing && existing.lastAccessUtc > row.lastAccessUtc) {
      continue;
    }
    byName.set(row.name, {
      name: row.name,
      value: cookieValue,
      lastAccessUtc: row.lastAccessUtc
    });
  }

  if (byName.size === 0) {
    return {
      cookieHeader: "",
      cookieCount: 0,
      score: 0,
      maxLastAccessUtc: 0
    };
  }

  const values = [...byName.values()];
  values.sort((left, right) => left.name.localeCompare(right.name));
  const cookieHeader = values.map((entry) => `${entry.name}=${entry.value}`).join("; ");

  let preferredHitCount = 0;
  let maxLastAccessUtc = 0;
  for (const entry of values) {
    const nameLower = entry.name.toLowerCase();
    if (preferredLower.some((preferred) => nameLower === preferred || nameLower.startsWith(`${preferred}.`))) {
      preferredHitCount += 1;
    }
    if (entry.lastAccessUtc > maxLastAccessUtc) {
      maxLastAccessUtc = entry.lastAccessUtc;
    }
  }

  return {
    cookieHeader,
    cookieCount: values.length,
    score: values.length + preferredHitCount * 20,
    maxLastAccessUtc
  };
};

const tryBrowserProfiles = async (
  browser: SupportedBrowser,
  domainSuffixes: string[],
  preferredCookieNames: string[]
): Promise<BrowserAttemptResult> => {
  const diagnostics: string[] = [];
  const userDataDir = browserUserDataPaths[browser];
  if (!userDataDir) {
    return {
      best: null,
      diagnostics: [`${browser}: no user data path available.`]
    };
  }
  if (!(await fileExists(userDataDir))) {
    return {
      best: null,
      diagnostics: [`${browser}: user data path not found.`]
    };
  }

  const profileNames = await listProfileNames(userDataDir);
  if (profileNames.length === 0) {
    return {
      best: null,
      diagnostics: [`${browser}: no browser profile found.`]
    };
  }

  const masterKey = await readMasterKey(userDataDir);
  let best: ProfileResult | null = null;

  for (const profileName of profileNames) {
    const profilePath = path.join(userDataDir, profileName);
    const cookieDbPath = await resolveCookiesDbPath(profilePath);
    if (!cookieDbPath) {
      continue;
    }

    const readResult = await readCookieRows(cookieDbPath, domainSuffixes);
    if (readResult.error) {
      diagnostics.push(`${browser}/${profileName}: ${readResult.error}`);
    }
    if (readResult.rows.length === 0) {
      continue;
    }

    const summary = await buildCookieHeader(readResult.rows, masterKey, preferredCookieNames);
    if (!summary.cookieHeader || summary.cookieCount === 0) {
      continue;
    }

    const candidate: ProfileResult = {
      browser,
      profile: profileName,
      cookieHeader: summary.cookieHeader,
      cookieCount: summary.cookieCount,
      score: summary.score,
      maxLastAccessUtc: summary.maxLastAccessUtc
    };

    if (!best || candidate.score > best.score || (candidate.score === best.score && candidate.maxLastAccessUtc > best.maxLastAccessUtc)) {
      best = candidate;
    }
  }

  return {
    best,
    diagnostics
  };
};

export const importCookieHeaderFromBrowser = async (
  request: BrowserImportRequest
): Promise<BrowserImportResult> => {
  const trimmedSuffixes = request.domainSuffixes
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);
  if (trimmedSuffixes.length === 0) {
    return {
      ok: false,
      message: "No cookie domain configured for provider."
    };
  }

  const browserOrder: SupportedBrowser[] = request.browser === "auto"
    ? ["chrome", "edge"]
    : [request.browser];

  const diagnostics: string[] = [];
  let best: ProfileResult | null = null;
  for (const browser of browserOrder) {
    const attempt = await tryBrowserProfiles(browser, trimmedSuffixes, request.preferredCookieNames);
    diagnostics.push(...attempt.diagnostics);
    if (!attempt.best) {
      continue;
    }
    if (!best || attempt.best.score > best.score || (attempt.best.score === best.score && attempt.best.maxLastAccessUtc > best.maxLastAccessUtc)) {
      best = attempt.best;
    }
  }

  if (!best) {
    const diagnosticSummary = diagnostics.length > 0
      ? ` Diagnostics: ${diagnostics.slice(0, 3).join(" | ")}`
      : "";
    return {
      ok: false,
      message:
        "No usable browser cookies found. Ensure Chrome/Edge is logged in for this provider." +
        diagnosticSummary
    };
  }

  return {
    ok: true,
    browser: best.browser,
    profile: best.profile,
    cookieHeader: best.cookieHeader,
    cookieCount: best.cookieCount
  };
};
