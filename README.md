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

## Notes

- The project root defaults to the current working directory (`process.cwd()`).
- You can override root with environment variable: `PROJECT_ROOT`.
- Each project card has two actions: `Open Codex` and `Open Claude`.
