/// <reference types="vite/client" />

import type { DesktopApi } from "./types/ipc";

declare global {
  interface Window {
    desktopApi: DesktopApi;
  }
}

export {};
