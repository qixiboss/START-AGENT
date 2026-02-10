# Repository Guidelines

## Project Structure & Module Organization
- `src/` contains the React renderer app (entry: `src/main.tsx`, root UI: `src/App.tsx`).
- `src/components/` holds UI modules such as project cards and terminal tabs.
- `src/services/` contains renderer-side IPC wrappers (`electronApi`), and `src/types/` stores shared IPC types.
- `electron/` contains Electron main/preload process code (`electron/main.ts`, `electron/preload.ts`).
- Build outputs are generated in `dist/` (renderer) and `dist-electron/` (Electron TS compile). Do not hand-edit generated files.

## Build, Test, and Development Commands
- `npm install`: install dependencies.
- `npm run dev`: starts full local dev loop (Vite renderer + Electron TS watch + Electron app launch).
- `npm run dev:renderer`: run only Vite frontend dev server.
- `npm run build`: build renderer and compile Electron TypeScript.
- `npm run start`: run Electron using built artifacts.

## Coding Style & Naming Conventions
- Language stack is TypeScript (`strict: true`) for both renderer and Electron code.
- Use 2-space indentation and semicolons, matching existing files.
- React components and types: `PascalCase` (`ProjectList`, `TerminalSessionInfo`).
- Functions/variables: `camelCase`; constants may use `UPPER_SNAKE_CASE` only when truly constant.
- Keep shared contract changes in sync across `src/types/ipc.ts`, `electron/main.ts`, and preload/service layers.

## Testing Guidelines
- No automated test framework is currently configured in this repo.
- Minimum validation before PR: `npm run build` and a manual smoke test via `npm run dev`.
- Verify core flows: project scan, folder selection, opening/closing Codex/Claude sessions, and terminal resize/input behavior.
- When adding tests later, place renderer tests under `src/` with `*.test.ts(x)` naming.

## Commit & Pull Request Guidelines
- Git history is not available in this workspace snapshot; use Conventional Commits as the default style (`feat:`, `fix:`, `chore:`).
- Keep commits focused and atomic (one functional change per commit).
- PRs should include:
  - what changed and why,
  - manual verification steps (commands + observed result),
  - screenshots/GIFs for UI changes,
  - linked issue/task when applicable.

## Security & Configuration Tips
- `PROJECT_ROOT` can override default scan path; avoid committing machine-specific paths.
- Never commit secrets, shell history, or terminal session output containing credentials.
