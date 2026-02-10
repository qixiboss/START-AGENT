import type { DesktopApi } from "../types/ipc";

const api = window.desktopApi;

if (!api) {
  throw new Error(
    "Electron preload API not found. Ensure preload is built and loaded before renderer starts."
  );
}

export const electronApi: DesktopApi = api;
