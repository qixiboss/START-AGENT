# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architecture Overview

This is an Electron + React desktop application that manages local projects and launches `codex`/`claude` in external Windows PowerShell windows.

**Process Architecture:**
- **Main Process** (`electron/main.ts`): Handles file system operations, git actions, Windows PowerShell launch requests, IPC handlers
- **Preload Script** (`electron/preload.ts`): Bridges main process to renderer via contextBridge
- **Renderer Process** (`src/`): React app with project command deck + launch history UI

**IPC Communication:**
- All IPC channels and types are defined in `src/types/ipc.ts` (shared between renderer and Electron)
- Terminal channels are launch-oriented (`terminal:launch`, `terminal:launches:list`, `terminal:launches:remove`)
- Renderer calls `electronApi` wrapper from `src/services/electronApi.ts`

**Terminal Launch Flow:**
1. User clicks "Open Codex/Claude" on a project
2. `electronApi.launchTerminal()` sends IPC to main process
3. Main process resolves `powershell.exe` and opens a new Windows PowerShell window
4. PowerShell starts in the target project directory and auto-runs the tool command
5. Renderer updates launch history cards

## Directory Structure

```text
src/
|- main.tsx           # React entry point
|- App.tsx            # Root component, manages command deck + launch history
|- components/        # UI components (ProjectList)
|- services/          # IPC wrappers (electronApi.ts)
`- types/             # Shared TypeScript IPC types
electron/
|- main.ts            # Electron main process
`- preload.ts         # Context bridge script
dist/                 # Renderer build output (Vite)
dist-electron/        # Electron TS compile output (DO NOT EDIT)
```

## Development Commands

```powershell
npm install              # Install dependencies
npm run dev              # Full dev mode: Vite dev server + Electron TS watch + Electron launch
npm run dev:renderer     # Vite frontend dev server only
npm run build            # Build renderer + compile Electron TypeScript
npm run start            # Run Electron with built artifacts
npm run pack:win         # Build and package Windows app (directory)
npm run dist:win         # Build and create Windows NSIS installer
```

**Windows NSIS Installer Output:** `release/START-AGENT Manager-Setup-<version>.exe`

## TypeScript Configuration

- **Renderer** (`tsconfig.json`): ES2020 target, ESM modules, react-jsx transform
- **Electron** (`tsconfig.electron.json`): ES2022 target, CommonJS modules, Node types
- Both use `strict: true`

## Key Implementation Notes

- Terminal launch uses Windows PowerShell (`powershell.exe`) on Windows
- `PROJECT_ROOT` env var overrides default project scan path (defaults to `process.cwd()`)
- Settings persisted to `{userData}/settings.json`
- All IPC calls in renderer wrapped with 7s timeout via `withTimeout()` helper
- Project list sorted by `localeCompare("zh-CN")` for Chinese locale support
