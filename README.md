# START-AGENT Project Manager

Desktop app for Windows to manage local projects and launch `codex` / `claude` in external Windows PowerShell windows.

## Run

```powershell
npm install
npm run dev
```

## Build

```powershell
npm run build
npm run start
```

## Windows EXE (NSIS)

```powershell
npm run dist:win
```

Installer output:

- `release/START-AGENT Manager-Setup-<version>.exe`

## Behavior Notes

- Terminal mode now supports two options:
  - **Embedded Session Mode**: run Codex / Claude / Shell sessions inside the app with tabbed sessions.
  - **External PowerShell Mode**: launch independent Windows PowerShell windows (legacy-compatible).
- Launching `Open Codex` / `Open Claude` opens a **new** Windows PowerShell window (`powershell.exe`) and auto-runs the target command.
- The app stores a launch history panel (recent project/tool launches) and supports relaunching from that history.
- If `powershell.exe` is unavailable, the app reports an explicit error and does not silently downgrade to embedded shells.
- Embedded sessions include:
  - session list and close actions,
  - persisted session snapshots,
  - approval prompts for dangerous commands before execution.

## Notes

- The project root defaults to the current working directory (`process.cwd()`).
- You can override root with environment variable: `PROJECT_ROOT`.
- Each project card has two actions: `Open Codex` and `Open Claude`.
