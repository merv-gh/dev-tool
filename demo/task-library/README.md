# Task-first library UX

Run `node dev/check-task-library-browser.js work/task-library/screenshots` from
the repository root. The script creates and closes its own isolated fixture app.

The story starts at a ticket context: find and edit a nested note, open related
script collections, restore a content-search link, then prepare and explicitly
send a request from an indexed service API. Local Git and HTTP execute; service
passports are synthetic. No model or production infrastructure is contacted.

The retained before examples are
[Context](../../docs/screenshots/ux-context-scratchpad.png) and
[Workbench](../../docs/screenshots/workbench-explorer-desktop.png).
The new captures contain `context-{width}-{theme}.png` and
`task-{width}-{theme}.png` at 1440px and 390px, plus a machine-readable browser
report. Their purpose is to compare the task path, not just surface styling:

- Context files follow their folder hierarchy; filtering keeps matching parents.
- Notes, scripts, service APIs and workspaces are reachable from the task overview.
- Cross-source search replaces separately searching each tab.
- API requests retain their source service and require an explicit deployment choice.
- Editing, preparing, executing and retaining evidence have distinct feedback.

Retained after examples: [task desktop](../../docs/screenshots/task-library-desktop.png),
[task mobile, dark](../../docs/screenshots/task-library-mobile-dark.png),
[context files](../../docs/screenshots/context-library.png) and
[service API draft](../../docs/screenshots/service-api-draft.png).

See the [operator guide](../../docs/task-library.md) for limits and tool examples.
