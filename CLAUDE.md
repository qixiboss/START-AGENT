# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architecture Overview

This is an Electron + React desktop application that manages local projects and launches `codex`/`claude` in embedded terminal tabs.

**Process Architecture:**
- **Main Process** (`electron/main.ts`): Manages PTY sessions (via node-pty), file system operations, IPC handlers
- **Preload Script** (`electron/preload.ts`): Bridges main process to renderer via contextBridge
- **Renderer Process** (`src/`): React app with xterm.js for terminal UI

**IPC Communication:**
- All IPC channels and types are defined in `src/types/ipc.ts` (shared between renderer and Electron)
- Channels follow pattern `category:action` (e.g., `terminal:create`, `terminal:data`)
- Renderer calls `electronApi` wrapper from `src/services/electronApi.ts`

**Terminal Session Flow:**
1. User clicks "Open Codex/Claude" on project card
2. `electronApi.createTerminal()` sends IPC to main process
3. Main process spawns PowerShell PTY via node-pty
4. PTY output streamed to renderer via IPC events
5. xterm.js renders output in `TerminalSessionPane` component

## Directory Structure

```
src/
├── main.tsx           # React entry point
├── App.tsx            # Root component, manages project list + terminal sessions
├── components/        # UI components (ProjectList, TerminalTabs, TerminalSessionPane)
├── services/          # IPC wrappers (electronApi.ts)
└── types/             # Shared TypeScript types (Ipc.ts)
electron/
├── main.ts            # Electron main process
└── preload.ts         # Context bridge script
dist/                  # Renderer build output (Vite)
dist-electron/         # Electron TS compile output (DO NOT EDIT)
```

## Development Commands

```powershell
npm install              # Install dependencies
npm run dev              # Full dev mode: Vite dev server + Electron TS watch + Electron launch
npm run dev:renderer     # Vite frontend dev server only
npm run build            # Build renderer + compile Electron TypeScript
npm run start            # Run Electron with built artifacts
```

## TypeScript Configuration

- **Renderer** (`tsconfig.json`): ES2020 target, ESM modules, react-jsx transform
- **Electron** (`tsconfig.electron.json`): ES2022 target, CommonJS modules, Node types
- Both use `strict: true`

## Key Implementation Notes

- Terminal sessions use `node-pty` with PowerShell on Windows
- `PROJECT_ROOT` env var overrides default project scan path (defaults to `process.cwd()`)
- Settings persisted to `{userData}/settings.json`
- All IPC calls in renderer wrapped with 7s timeout via `withTimeout()` helper
- Project list sorted by `localeCompare("zh-CN")` for Chinese locale support
