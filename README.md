# START-AGENT Project Manager

Desktop app for Windows to manage local projects and launch `codex` / `claude` in embedded terminal tabs.

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

## Performance Notes

- Main window now uses `show: false` and displays on `ready-to-show` to reduce startup jank.
- DevTools only opens when `OPEN_DEVTOOLS=1` in dev mode.
- Project cards are memoized to reduce unnecessary list rerenders.
- Settings persistence keeps debounce writes and forces sync flush on quit to reduce runtime IO churn and avoid data loss.

## Notes

- The project root defaults to the current working directory (`process.cwd()`).
- You can override root with environment variable: `PROJECT_ROOT`.
- Each project card has two actions: `Open Codex` and `Open Claude`.
