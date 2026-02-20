# Git Team Workflow Smoke Checklist

## Preconditions
- Start app with `npm run dev` (or `npm run start` after build).
- Open a repo configured in this manager.
- Ensure `.start-agent/git-policy.json` exists in repo root.

## 1. Policy Load
- Open `Git Publish Flow` modal.
- Verify `Team Policy` section shows source (`project` or `default`).
- Break JSON format in `.start-agent/git-policy.json` and reopen modal.
- Expected: warning is shown, app falls back to default policy without crash.

## 2. Commit Format Precheck
- Input invalid commit message (for example: `update stuff`).
- Click `Run Precheck`.
- Expected: `COMMIT_FORMAT` warning with risk badge and suggestion.

## 3. Protected Branch Confirmation
- Select remote branch `main`/`master`/`release`.
- Click `Publish` without checking protected override.
- Expected: publish is blocked with confirmation hint.
- Check protected override and publish again.
- Expected: publish can continue.

## 4. Behind-Remote High-Risk Guard
- Make local branch behind `origin/<branch>`.
- Run `Run Precheck`.
- Expected: `REMOTE_BEHIND` warning (high risk when policy requires up-to-date).
- Click `Publish` without behind override.
- Expected: blocked with message to sync first.
- Click `Sync Now (...)`.
- Expected: sync executes using selected strategy.

## 5. Sync Error Guidance
- Trigger a sync conflict (rebase/merge conflict).
- Expected: status includes classified reason and suggestion (continue/abort etc.).
- Expected: `Sync Guidance` panel appears with command snippets matching failure type.
- Click `Copy` on a Sync Guidance command snippet.
- Expected: the command text is copied exactly.
- Click `Send` on a Sync Guidance command snippet (with an active embedded terminal session).
- Expected: command is sent to the terminal session input.

## 6. Stash Flow
- Create local changes.
- Click `Stash Push` (with and without include-untracked).
- Expected: stash entry appears.
- Click `Apply` on an entry.
- Expected: stash apply/pop result shown and context refreshed.

## 7. Graph/History Visibility
- Verify `Recent Commits` section loads recent commits.
- Verify `Remote history` still renders and updates after sync/publish.

## 8. Regression
- Existing `Git Add` flows still work (`git add .` and selected new files).
- `Refresh Git Data` still reloads branches/history/untracked data.
- Modal close/reopen resets transient confirmation state.
