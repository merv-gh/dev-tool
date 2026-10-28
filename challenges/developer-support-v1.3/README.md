# Supplement build setup v1.3

Run `node supplement-project.cjs <prepared-directory>` once after v1.2 source provisioning. This creates a public Git project with the unchanged v1.2 consumer, a JDBC adapter, pinned Maven/JUnit dependencies and compiler metadata. It adds no test or refactor.

Export the printed task-local GIT_CONFIG_GLOBAL before tool calls. `workspace_open {project:"CASES",repo:"order-projection",ref:"main"}` then works through normal transport. The original fake Bitbucket REST repo listing is static; direct opening uses the local route. The source index is available as CASES/order-projection.

`tests.env` provides DT_FUNCTIONS_URL/USERNAME/PASSWORD and DT_DATA_SOURCE_ENV=fixture. JdbcFunctions.fromEnvironment uses these SELECT-only source bindings; it does not grant writes. This is local test execution reading a fixture environment, and does not establish a remote dev test target. Any local replay must include required function DDL; table-only capture is not proof that functions were recreated.
