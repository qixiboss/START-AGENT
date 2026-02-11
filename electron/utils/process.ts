import { spawnSync } from "node:child_process";
import fsSync from "node:fs";
import path from "node:path";

/**
 * 检查进程是否存活
 */
export const isProcessAlive = (pid: number): boolean => {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "ESRCH"
    ) {
      return false;
    }
    return true;
  }
};

/**
 * 解析 PowerShell 候选路径列表
 */
export const resolvePowerShellCandidates = (): string[] => {
  const candidates: string[] = [];

  const systemRoot = process.env.SystemRoot || process.env.WINDIR;
  if (systemRoot) {
    candidates.push(path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"));
  }

  const whereResult = spawnSync("where", ["powershell.exe"], {
    windowsHide: true,
    encoding: "utf-8"
  });
  if (whereResult.status === 0 && whereResult.stdout) {
    for (const line of whereResult.stdout.split(/\r?\n/)) {
      const resolved = line.trim();
      if (resolved.length > 0) {
        candidates.push(resolved);
      }
    }
  }

  candidates.push("powershell.exe");

  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const item of candidates) {
    const key = process.platform === "win32" ? item.toLowerCase() : item;
    if (!seen.has(key)) {
      seen.add(key);
      normalized.push(item);
    }
  }
  return normalized;
};

/**
 * 测试 PowerShell 命令是否可用
 */
export const probePowerShellCommand = (candidate: string): { ok: boolean; reason?: string } => {
  const result = spawnSync(
    candidate,
    ["-NoLogo", "-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"],
    {
      windowsHide: true,
      encoding: "utf-8",
      timeout: 2500
    }
  );
  if (result.error) {
    return { ok: false, reason: result.error.message };
  }
  if (typeof result.status === "number") {
    return { ok: true };
  }
  return {
    ok: false,
    reason: `signal=${result.signal ?? "unknown"}`
  };
};

/**
 * 解析并验证 PowerShell 可执行文件路径
 */
export const resolvePowerShellPath = (
  appendRuntimeLog?: (message: string) => void
): string | null => {
  const candidates = resolvePowerShellCandidates();
  const probeLogs: string[] = [];
  for (const candidate of candidates) {
    if (candidate !== "powershell.exe" && !fsSync.existsSync(candidate)) {
      probeLogs.push(`${candidate} => missing`);
      continue;
    }
    const probe = probePowerShellCommand(candidate);
    if (probe.ok) {
      if (appendRuntimeLog) {
        appendRuntimeLog(`powershell resolved via '${candidate}'`);
      }
      return candidate;
    }
    probeLogs.push(`${candidate} => ${probe.reason ?? "probe failed"}`);
  }
  if (appendRuntimeLog) {
    appendRuntimeLog(`powershell resolution failed. probes: ${probeLogs.join(" | ")}`);
  }
  return null;
};

/**
 * 启动新的 PowerShell 窗口
 */
export const launchPowerShellWindow = (
  powerShellPath: string,
  projectPath: string,
  encodedCommand: string
): { ok: true; pid: number } | { ok: false; message: string } => {
  const escapedExe = powerShellPath.replace(/'/g, "''");
  const escapedCwd = projectPath.replace(/'/g, "''");
  const launchScript = [
    `$argList = @('-NoLogo','-NoExit','-EncodedCommand','${encodedCommand}')`,
    `$p = Start-Process -FilePath '${escapedExe}' -WorkingDirectory '${escapedCwd}' -ArgumentList $argList -PassThru`,
    "$p.Id"
  ].join("; ");
  const result = spawnSync(powerShellPath, ["-NoLogo", "-NoProfile", "-Command", launchScript], {
    windowsHide: true,
    encoding: "utf-8",
    timeout: 5000
  });
  if (result.error) {
    return { ok: false, message: result.error.message };
  }
  if (result.status !== 0) {
    const stderrText = (result.stderr || result.stdout || "").trim();
    return { ok: false, message: stderrText || "Start-Process failed." };
  }
  const pidText = (result.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^\d+$/.test(line));
  if (!pidText) {
    return { ok: false, message: "Could not read started process id." };
  }
  const pid = Number(pidText);
  if (!Number.isInteger(pid) || pid <= 0) {
    return { ok: false, message: "Invalid started process id." };
  }
  return { ok: true, pid };
};

/**
 * 聚焦到指定 PID 的窗口
 */
export const focusPowerShellWindow = (
  powerShellPath: string,
  processId: number
): { ok: true } | { ok: false; message: string } => {
  const focusScript = [
    "$shell = New-Object -ComObject WScript.Shell",
    `$ok = $shell.AppActivate(${processId})`,
    "if ($ok) { exit 0 }",
    "exit 2"
  ].join("; ");
  const result = spawnSync(powerShellPath, ["-NoLogo", "-NoProfile", "-Command", focusScript], {
    windowsHide: true,
    encoding: "utf-8",
    timeout: 2500
  });
  if (result.error) {
    return { ok: false, message: `Failed to focus terminal: ${result.error.message}` };
  }
  if (result.status !== 0) {
    return { ok: false, message: "Failed to bring terminal window to front." };
  }
  return { ok: true };
};

/**
 * 关闭指定进程
 */
export const closeProcess = (pid: number): { ok: true } | { ok: false; message: string } => {
  if (!Number.isInteger(pid) || pid <= 0) {
    return { ok: false, message: "Invalid terminal process id." };
  }
  const result = spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
    windowsHide: true,
    encoding: "utf-8",
    timeout: 5000
  });
  if (result.error) {
    return { ok: false, message: result.error.message };
  }
  if (result.status !== 0) {
    const stderrText = (result.stderr || result.stdout || "").trim();
    const lower = stderrText.toLowerCase();
    if (
      lower.includes("not found") ||
      lower.includes("no running instance") ||
      lower.includes("not running")
    ) {
      return { ok: true };
    }
    return { ok: false, message: stderrText || "taskkill failed." };
  }
  return { ok: true };
};
