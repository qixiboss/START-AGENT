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

- Launching `Open Codex` / `Open Claude` opens a **new** Windows PowerShell window (`powershell.exe`) and auto-runs the target command.
- The app stores a launch history panel (recent project/tool launches) and supports relaunching from that history.
- If `powershell.exe` is unavailable, the app reports an explicit error and does not silently downgrade to embedded shells.

## Notes

- The project root defaults to the current working directory (`process.cwd()`).
- You can override root with environment variable: `PROJECT_ROOT`.
- Each project card has two actions: `Open Codex` and `Open Claude`.
