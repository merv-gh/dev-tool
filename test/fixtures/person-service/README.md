# Person name service

Java 21, Spring Boot 2.7.18, Gradle; one HTTP route: `GET /person/{id}`.
The fixture runner supplies a disposable PostgreSQL database and a fixed UTC date.
No production database is written.

The newest **currently valid, active, non-annulled** document supplies its complete
ФИО. A future or revoked name change must not win. Rank by `effective_from`, then
document ID (largest wins), not `issued_on`. `expires_on` is inclusive. A complete
name requires a nonblank family and given name; patronymic is optional. Never mix
registry name fields into a selected document's name. If no document qualifies,
use the registry's whole ФИО. Birth date always comes from the person registry.
Address belongs to that same person. Missing person returns 404.

Trace the boundary chain: HTTP ID → person/documents SQL → ResultSet columns →
eligibility and ranking → selected whole name → response fields. Use raw PG rows
to check SQL/data assumptions, source/control-flow to inspect selection, then
rebuild and run `person.PersonHttpTest` for real HTTP/database feedback. Static
Joern reachability alone cannot establish which row won at runtime; SQL strings
and generated record accessors may remain explicit analysis gaps.

Runtime inputs: `PERSON_JDBC_URL`, `PERSON_DB_USER`, `PERSON_DB_PASSWORD`,
`PERSON_AS_OF` (`YYYY-MM-DD`). Run `gradle runtimeClasspath`, then use that
classpath to start `person.PersonApplication --server.port=<port>`. For tests,
run `gradle test --tests person.PersonHttpTest` with the same inputs.

The standalone repository generator also supplies `src/test/resources/seed.sql`.
Load it only into your disposable PostgreSQL database before running this service.
The mutation runner keeps its independent expected values and extra test people
outside the repository; changing this public seed cannot change the private grade.
