# Changed code coverage presentation

Run the real regression first to retain its reports:

```sh
DT_TEST_MAVEN="$(command -v mvn)" DT_TEST_GRADLE="$(command -v gradle)" \
 DT_WORKSPACE_COVERAGE_DEMO="$PWD/work/change-coverage" \
 node --test test/lombok-coverage.live.test.js
node demo/change-coverage/run.js
```

The demo prints links for the missed path, covered path, stale evidence and native
inline view. Default ports are 44424/44425; pass a port to change them. The second
port wraps the real view in a 390px iframe for layout inspection. It is a narrow
document preview, not a mobile browser simulation.

Reports come from actual local JUnit/Lombok/JaCoCo execution. Their temporary
workspaces have been cleaned up: source-read/coverage-run buttons prepare drafts
but cannot run against those removed workspaces. Use a current workspace to
execute the prepared tools. Without retained files, the demo uses the explicitly
illustrative built-in sample. Ctrl-C stops the owned servers and clears its
temporary demo home.
