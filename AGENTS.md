# AGENTS.md
Guidance for autonomous coding agents operating in this repository.

## 1) Project Overview
- Stack: Electron + React + TypeScript.
- Renderer entry: `src/main.tsx`; root UI: `src/App.tsx`.
- Electron main entry: `electron/main.ts`; preload bridge: `electron/preload.ts`.
- Shared cross-process contracts: `src/types/ipc.ts`.
- Renderer IPC wrapper: `src/services/electronApi.ts`.
- Generated artifacts (do not edit): `dist/`, `dist-electron/`, `release/`.

## 2) Directory Map
- `src/`: renderer app.
- `src/components/`: UI components.
- `src/hooks/`: renderer hooks and state orchestration.
- `src/services/`: renderer service wrappers.
- `src/types/`: shared TypeScript types and IPC channels.
- `electron/ipc/`: IPC registration by domain (`projects`, `git`, `terminal`, `window`).
- `electron/services/`: main-process domain services.
- `electron/utils/`: helper utilities.

## 3) Build, Lint, Test, and Run Commands
Run from repo root: `D:\project\START-AGENT`.

### Install
```powershell
npm install
```

### Development
```powershell
npm run dev
```
- Runs Vite renderer + Electron TS watch + Electron app launch.

```powershell
npm run dev:renderer
```
- Runs only renderer dev server.

### Build and Start
```powershell
npm run build
npm run start
```
- `build` executes `vite build` and `tsc -p tsconfig.electron.json`.

### Packaging
```powershell
npm run pack:win
npm run dist:win
```
- Windows packaging output lands in `release/`.

### Lint / Format Status
- No ESLint config found (`.eslintrc*` / `eslint.config.*` absent).
- No Prettier config found (`.prettierrc*` / `prettier.config.*` absent).
- No lint script in `package.json`.
- Use strict TypeScript + successful build as baseline static validation.

### Test Status
- No test framework configured.
- No `npm test` script.
- No committed `*.test.*` or `*.spec.*` files.

### Single-Test Command (Important)
There is currently no executable single-test command because tests are not set up.

If Vitest (or similar) is added later, use patterns like:
```powershell
# Run one test file
npx vitest run src/components/ProjectList.test.tsx

# Run one test by name
npx vitest run -t "renders launch actions"
```
Use these only after test tooling/config exists.

## 4) Minimum Validation Before Merge
Run:
```powershell
npm run build
npm run dev
```
Manual smoke checks:
- Project scan/list from current root.
- Directory picker and root path switch.
- External terminal launch for Codex/Claude.
- Embedded terminal create/input/resize/close flow.
- Git-related UI actions still behave correctly.

## 5) Code Style and Formatting
- TypeScript strict mode is required for renderer and Electron code.
- 2-space indentation; semicolons required.
- Prefer double quotes for strings.
- Prefer `const`; use `let` only when reassignment is required.
- Keep functions small and focused; extract reusable logic into hooks/services.
- Prefer explicit return/result shapes over implicit behavior.
- Do not hand-edit generated output directories.

## 6) Imports and Module Conventions
- Order imports as: external modules, then internal relative modules.
- Use type-only imports via `import type` (or inline `type` specifiers).
- Preserve existing module style (`.js` extension in Electron TS imports where already used).
- Keep shared contract changes synchronized across all layers.

## 7) Types and IPC Contract Rules
- Prefer explicit union/result types; avoid `any` unless unavoidable.
- Continue discriminated result pattern: `{ ok: true | false, ... }`.
- Keep IPC channel names in `IpcChannels` within `src/types/ipc.ts`.
- When changing a channel payload, update all affected files together:
  - `src/types/ipc.ts`
  - `electron/preload.ts`
  - `electron/ipc/*.ts`
  - `src/services/electronApi.ts`
  - calling hooks/components

## 8) Naming Conventions
- Components: `PascalCase` (e.g., `ProjectList`).
- Hooks: `camelCase` with `use` prefix (e.g., `useProjects`).
- Variables/functions: `camelCase`.
- Type aliases/interfaces/enums: `PascalCase`.
- True constants may use `UPPER_SNAKE_CASE`.
- Follow established file naming patterns in each folder.

## 9) Error Handling Guidelines
- Wrap async side effects with `try/catch`.
- Normalize unknown caught values:
  - `error instanceof Error ? error.message : "<fallback>"`.
- Across IPC boundaries, return structured error objects instead of throwing.
- Keep user-facing status/messages explicit in renderer state.
- Use timeout wrappers for renderer IPC calls (existing pattern in `src/App.tsx`).
- Keep fallback behavior safe when preload API is unavailable (`src/services/electronApi.ts`).

## 10) React and State Practices
- Keep domain logic in hooks, not large components.
- Use `useMemo`/`useCallback` where identity stability affects behavior.
- Always clean up IPC/event subscriptions in effect teardown.
- Reuse shared hooks for localStorage-backed preferences.

## 11) Security and Environment
- `PROJECT_ROOT` can override default root scanning path.
- Never commit secrets, tokens, or sensitive terminal/log output.
- Avoid hardcoding machine-specific absolute paths.
- Validate/sanitize shell-bound input in Electron service paths.

## 12) Cursor/Copilot Rule Files
Checked and currently absent:
- `.cursor/rules/`
- `.cursorrules`
- `.github/copilot-instructions.md`

If any of these files are added, treat them as authoritative and merge their instructions into this document.

## 13) Commit and PR Expectations
- Prefer Conventional Commits (`feat:`, `fix:`, `chore:`, etc.).
- Keep commits focused and atomic.
- In PR descriptions include:
  - what changed and why,
  - verification commands and observed outcomes,
  - screenshots/GIFs for UI changes,
  - linked issue/task when applicable.
