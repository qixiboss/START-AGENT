import path from "node:path";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import { app } from "electron";
import { Settings } from "./types.js";
import { sanitizeLaunches, sanitizeSessionSnapshots } from "../utils/sanitize.js";
import { ProjectMeta } from "../../src/types/ipc.js";

const SETTINGS_SAVE_DEBOUNCE_MS = 400;

/**
 * 获取设置文件路径
 */
export const getSettingsPath = (): string => path.join(app.getPath("userData"), "settings.json");

/**
 * 持久化设置到文件
 */
export const persistSettings = async (settings: Settings): Promise<void> => {
  await fs.mkdir(path.dirname(getSettingsPath()), { recursive: true });
  await fs.writeFile(getSettingsPath(), JSON.stringify(settings, null, 2), "utf-8");
};

/**
 * 同步持久化设置到文件
 */
export const persistSettingsSync = (settings: Settings): void => {
  fsSync.mkdirSync(path.dirname(getSettingsPath()), { recursive: true });
  fsSync.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2), "utf-8");
};

/**
 * 从文件加载设置
 */
export const loadSettings = async (): Promise<Settings> => {
  try {
    const raw = await fs.readFile(getSettingsPath(), "utf-8");
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      projectRoot: parsed.projectRoot,
      projectMetaByPath: parsed.projectMetaByPath ?? {},
      terminalLaunches: sanitizeLaunches(parsed.terminalLaunches),
      terminalSessionSnapshots: sanitizeSessionSnapshots(parsed.terminalSessionSnapshots)
    };
  } catch {
    return {
      projectRoot: undefined,
      projectMetaByPath: {},
      terminalLaunches: [],
      terminalSessionSnapshots: []
    };
  }
};

/**
 * 防抖持久化设置管理器
 */
export class PersistManager {
  private settingsValue: Settings;
  private saveTimer: NodeJS.Timeout | null = null;
  private saveInFlight: Promise<void> | null = null;

  constructor(initialSettings: Settings) {
    this.settingsValue = initialSettings;
  }

  get settings(): Settings {
    return this.settingsValue;
  }

  set settings(value: Settings) {
    this.settingsValue = value;
  }

  /**
   * 计划异步持久化（防抖）
   */
  schedulePersist(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => {
      this.saveInFlight = persistSettings(this.settingsValue).catch(() => {
        // Ignore background save failures; foreground actions return explicit errors.
      });
      this.saveTimer = null;
    }, SETTINGS_SAVE_DEBOUNCE_MS);
  }

  /**
   * 立即刷新持久化设置
   */
  async flushPersist(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await persistSettings(this.settingsValue);
    if (this.saveInFlight) {
      await this.saveInFlight;
      this.saveInFlight = null;
    }
  }

  /**
   * 初始化根路径
   */
  async initRootPath(
    defaultRoot: string,
    isReadableDirectory: (path: string) => Promise<boolean>
  ): Promise<string> {
    this.settingsValue = await loadSettings();
    const candidate = this.settingsValue.projectRoot;
    if (candidate && (await isReadableDirectory(candidate))) {
      return candidate;
    }
    return defaultRoot;
  }
}

/**
 * 初始化根路径
 */
export const initRootPath = async (
  defaultRoot: string,
  isReadableDirectory: (path: string) => Promise<boolean>,
  persistManager: PersistManager
): Promise<string> => {
  return persistManager.initRootPath(defaultRoot, isReadableDirectory);
};
