# Test data from passports: a proposal

## Where test_context stands (trial, 2026-10-28)

`test_context` was run on 8 targets of `test/fixtures/payments-service`. Each skeleton was written as it came and run with Maven 3.9.11 and the scratch Postgres.

| Target | Style | Compiles | Run |
|---|---|---|---|
| FeeCalculator | unit | yes | passed |
| PaymentService#create | mockito | yes | passed, asserts nothing (`save` returns null) |
| PaymentService#settle | mockito | yes | error: `no payment 1` (no `findById` stub) |
| PaymentController | webmvc | yes | 3 passed, status only |
| BalanceDao | jdbc | yes | 2 passed on an empty table (the inserts are comments) |
| PaymentRepository | jpa | yes | 2 passed, `isNotNull` only |
| SettlementListener#onSettlement | flow | yes | error: `"test"` is passed where the code does `Long.valueOf` |
| POST /payments | flow | yes | error: body `{}`, so `amount must be positive` |

The structure is right in every case: style, mocks vs real beans, imports, the DDL snapshot, and `@MockBean` for this Boot version. The weak part is the data:
- **Values ignore the types and constraints.** Values come from the Java type only (`"test"`, `1L`, `{}`). The DB CHECKs (`amount > 0`, `status IN (...)`), the record a request body maps to, and how a String parameter is parsed are all ignored.
- **Mock stubs are missing.** Stubs are listed as comments. There is no `findById → Optional.of(entity)`, and no `save → returnsFirstArg`, so the happy path cannot run.
- **DB rows are not real.** The inserts are comments, and the FK value is a literal `1L`, not the parent's generated id. Dictionary tables are not loaded, so an FK to a `d_` table cannot be satisfied.
- **Tests that pass prove nothing.** No assertion is derived from the code.
- **Unused imports.** The class's own imports are copied (`@Service`, `@Transactional`).
- **Not ready for new versions.** The skeletons use the `org.testcontainers.containers.PostgreSQLContainer` import. On Testcontainers 2.x that becomes `org.testcontainers.postgresql.PostgreSQLContainer`, with no type parameter. On Spring Boot 4, the web slice moved to `spring-boot-webmvc-test` with new packages, and `@MockBean` is gone.

## Iteration 1: the edges (done)

`test_data` generates `TestData.java` from the code graph and the synced database. It is plain Java with no new dependency, so Instancio stays an option for large object graphs later.
- **Edges covered:**
  - request bodies and path variables;
  - Kafka payloads in (JSON DTOs, and text the listener parses) and out (`KafkaTemplate<K, V>`);
  - repository entities as rows, with dictionary entities from their real rows;
  - Feign answers.
- **Ids that agree.** The ids of one concept are one constant, so the body, the event and the row describe the same order.
- **Validation cases.** Bodies validated with `@Valid` get `<body>Cases()`.
- **DDL snapshot.** It now carries the `d_*` rows and every function of the tables' schemas.
- **`test_context` uses it:**
  - arguments from TestData;
  - real stubs (`findById` → `Optional.of`, `save` → the argument);
  - a guard lookup (`isPresent()`) stubbed empty, so the happy path runs.

Measured on `test/fixtures/shipping-service`: 42 tests written against TestData passed on the first run. They cover 31 validation cases through MockMvc, 7 service tests, a listener, and 3 JPA tests on the snapshot with dictionaries. The five `test_context` skeletons tried passed as they came, including `PaymentService#settle`, which failed in the first trial.

## Iteration 2: inside the service, dictionaries, topics (done)

- **Rows.** `TestData.Rows` holds plain SQL inserts: parents first, dictionary FKs pointing at loaded rows, unique columns counting up.
- **Flows.** Flow skeletons take their input from TestData. A read-only DAO is mocked at the edge, while a DAO that writes stays real and is verified.
- **Dictionaries.** Every form is covered: an enum named like the table (with differences reported), an `@Entity`, and model classes (`ParcelTypeDictionary`, or a library's `DictionaryModel`). They are read through repositories or `JdbcTemplate` DAOs, and the stubs follow the query's active filter.
- **Topics.** Values come from the topic's schema and its last messages, except personal fields. A JSON-text listener gets the DTO as JSON. Schema differences are reported.
- **Kept by hand.** TestData is kept once edited by hand.
- **Push.** `workspace_push` pushes to branches that are not protected.

## Next (earlier list)

- **Rows for tables without an entity.** `Rows.insert(table, ...)` fills required columns, creates parents first, and picks dictionary FKs. In payments-service, for example, `pay.payments` needs a row in `pay.customers`, which has no entity.
- **Scenarios along a flow.** The steps of a chain produce data the next step reads: an `orderPaid()` event, then the `shipment()` row it creates, then a status change with the `shipmentSent()` it emits. `TestData` would give each step's data from the same ids, and the flow test would check what leaves the service against the factory of what it sends.
- **Limits from the dictionaries.** Values that depend on other values: a parcel's weight within the chosen carrier's `max_weight_kg`, and boundary cases from those limits.
- **Kafka schemas.** When a topic has an Avro or JSON schema in the synced catalog, its enums, defaults and logical types join the sources of values.

## The form: two generated classes, one runtime library

dt writes two classes into the module's test sources, regenerated when the passport changes and checked in with the tests:

```
src/test/java/<base package>/testdata/TestData.java    objects and cases (no Spring, no Docker)
src/test/java/<base package>/testdata/TestInfra.java   Postgres + Kafka for integration tests (@TestConfiguration)
src/test/resources/dt-schema/<db>.sql                  DDL + all functions + rows of d_* tables
src/test/resources/dt-schema/<db>.json                 the same schema as data: columns, CHECKs, FKs, enums, uniques
```

Test dependencies (`testImplementation`), added by dt only when missing:
- **Objects:** `org.instancio:instancio-junit`. It fills large object graphs, is reproducible by seed, supports records and constructors, and is actively released.
- **Integration only:**
  - `spring-boot-testcontainers` (gives `@ServiceConnection`);
  - `testcontainers-postgresql`;
  - `testcontainers-kafka`, for services that use Kafka;
  - Confluent's `kafka-avro-serializer`, only when the service already uses Avro.
- **Not added:**
  - `junit-jupiter-params` is already in `spring-boot-starter-test`.
  - jqwik is not used: it is in maintenance mode, and JUnit's parameterized tests cover the need.

### 1. `TestData`: valid objects, built through the real constructors

For each class the tests need, dt writes a factory method and an Instancio `Model`. The class can be an entity, a DTO, a request record, or a Kafka event.

```java
public final class TestData {
    // valid as the DB says: amount numeric(12,2) > 0, status in (NEW, SETTLED, FAILED), customer_id -> pay.customers
    public static final Model<Payment> PAYMENT = Instancio.of(Payment.class)
        .withSetting(Keys.ON_CONSTRUCTOR_ERROR, FAIL)                   // constructors run; their checks apply (sketch: exact key names to confirm)
        .generate(field(Payment::getAmount), g -> g.math().bigDecimal().min(new BigDecimal("0.01")).scale(2))
        .set(field(Payment::getStatus), PaymentStatus.NEW)
        .toModel();
    public static Payment payment() { return Instancio.create(PAYMENT); }

    // the body POST /payments maps to (CreatePayment), valid per its @Positive / @NotNull
    public static CreatePayment createPayment() { return new CreatePayment(1L, new BigDecimal("10.00")); }
    public static String createPaymentJson() { return json(createPayment()); }

    // the Kafka value of "settlements": the payment id as text (the listener does Long.valueOf on it)
    public static String settlementMessage(long paymentId) { return String.valueOf(paymentId); }
    ...
}
```

A test reads like this:

```java
var p = TestData.payment();
var settled = Instancio.of(TestData.PAYMENT).set(field(Payment::getStatus), SETTLED).create();
```

Rules dt follows when generating:
- **Values come from what is known, most binding first:**
  1. DB constraints of the entity's table: NOT NULL, CHECK lists and ranges, `length`/`precision`/`scale`, enum types, uniques;
  2. Bean Validation annotations;
  3. the Avro or JSON schema of the topic: enums, logical types, defaults;
  4. how the code uses the value (`Long.valueOf(x)`, `UUID.fromString(x)`, a regex match);
  5. the Java type.
- **Built through the constructor.** Objects are made through the class's own constructor, or its builder when Lombok `@Builder` is there. Instancio runs with `ON_CONSTRUCTOR_ERROR=FAIL`, so it never bypasses the constructor and an object never skips its own checks.
- **No copied data.** Sample Kafka messages and DB rows give only the shape: which fields are set and their typical length. Values are never copied from an environment, since they may be personal data. The exception is the `d_` dictionaries, which are reference data and are loaded as they are.
- **The schema is the contract.** When the entity and the DB disagree (a nullable field on a NOT NULL column, a length that does not match), dt reports it in the answer. That is often the bug.

### 2. `TestData` cases: null, empty, boundaries, same and mixed types

For a method's parameters, dt generates a `Stream<Arguments>` with a name for each case:

```java
// cases for settleAll(List<Payment> payments, Instant at)
static Stream<Arguments> settleAllCases() {
    return TestData.cases(TestData::payment)              // valid value per parameter
        .param("payments", nullValue(), empty(), one(), many(3), mixed(CardPayment.class, SepaPayment.class))
        .param("at", nullValue(), Instant.EPOCH, Instant.parse("9999-12-31T00:00:00Z"))
        .eachAlone();                                     // one parameter varies, the rest stay valid
}

@ParameterizedTest(name = "{0}")
@MethodSource("settleAllCases")
void settleAll(String name, List<Payment> payments, Instant at, Outcome expected) {
    expected.check(() -> subject.settleAll(payments, at));
}
```

- **What varies:**
  - `nullValue` and `empty` for Strings, collections, maps and Optionals;
  - boundaries: `0`, `±1`, max, the column length and length+1, scale+1;
  - `mixed` for interface or abstract element types. dt lists the implementations from the code graph.
- **One parameter at a time.** `eachAlone` keeps the other parameters valid, so each case shows one thing.
- **What each case should do.** Read from the code: `requireNonNull`, `@NotNull`/`@NotEmpty`, guard clauses that throw, and DB constraints give the outcomes "throws IllegalArgumentException" and "rejected". Everything else gets the general outcome: it may succeed or throw an expected exception, but never `NullPointerException`, `ClassCastException` or `IndexOutOfBoundsException`. The model confirms or changes these outcomes; they are marked as dt's guess.
- **Size.** `cases`, `Outcome` and the builders are nested in `TestData`, so it stays one file.

### 3. Unit vs integration: one decision, made by dt

`test_context mode=unit|slice|integration`. The default follows the role, as it does today.

| | unit | slice (`@WebMvcTest`, `@DataJpaTest`, `@JdbcTest`) | integration (`@SpringBootTest` or the flow chain) |
|---|---|---|---|
| Subject | `@InjectMocks`, constructor injection | the slice | the real beans of the chain |
| Repositories | `@Mock`: `save → returnsFirstArg()`, `findById → Optional.of(TestData.x())` | real, against Postgres | real, against Postgres |
| Kafka out | `@Mock KafkaTemplate`, captor on `send` | — | real Kafka container: read the topic back, check the payload against the schema |
| HTTP out (Feign, RestClient) | mock | mock | mock (the edge stays mocked) |
| Data | `TestData` objects | `TestInfra.rows` | `TestInfra.rows` + `TestData` |

Stubs are written, not commented out: dt sees which calls return what (`findById` → `Optional<Payment>`). The happy path is stubbed so it runs as written. The test then asserts the outcome (`getStatus()` is `SETTLED`) and verifies what leaves the service.

### 4. `TestInfra`: Postgres from the cache, d_ tables loaded, Kafka

```java
@TestConfiguration(proxyBeanMethods = false)
public class TestInfra {
    @Bean @ServiceConnection                                   // Boot sets spring.datasource.* from it
    PostgreSQLContainer postgres() {                           // one per JVM, reused by every test class
        return new PostgreSQLContainer("postgres:16-alpine").withInitScript("dt-schema/pay.sql");
    }
    @Bean @ServiceConnection KafkaContainer kafka() { ... }    // only when the service uses Kafka
    @Bean Rows rows(JdbcTemplate jdbc) { return new Rows(jdbc, "dt-schema/pay.json"); }

    public static final class Rows {
        public Map<String, Object> insert(String table, Object... columnValues)
        ...
    }
}
```

```java
@DataJpaTest @Import(TestInfra.class)
class BalanceDaoTest {
    @Autowired TestInfra.Rows rows;
    @Autowired BalanceDao subject;

    @Test void balance() {
        var c = rows.insert("pay.customers");
        rows.insert("pay.payments", "customer_id", c.get("id"), "amount", new BigDecimal("12.50"), "status", "SETTLED");
        assertThat(subject.balance((Long) c.get("id"))).isEqualByComparingTo("12.50");
    }
}
```

- **The snapshot.** `<db>.sql` is dt's DDL snapshot from the cache. By default it has the tables the code touches and their closure, all the functions, and the rows of the `d_` tables, so FKs to dictionaries and functions that read them work. The `d_` rows are captured at `catalog_sync` and capped at 10,000 rows per table.
- **`Rows.insert` fills the row:**
  - it fills every required column (NOT NULL without a default) from `<db>.json`;
  - it creates missing parents first and uses their generated ids;
  - it picks an existing dictionary row for FKs to `d_` tables;
  - it respects CHECK lists and ranges;
  - it makes unique columns unique.
  - It returns the row as inserted.
- **Rollback.** Slices roll back after each test. `@SpringBootTest` tests use `@Transactional`, or `Rows` deletes what it inserted.
- **Two ways to get a database.** When dt's `test_run` provides a throwaway database (`SPRING_DATASOURCE_URL` is set), `TestInfra` starts no container. With Docker, the container is used. The same test works both ways, and in CI.
- **Avro.** The serializer is configured with `schema.registry.url=mock://dt` and auto-registration, so no registry container is needed.

## Why this form

- **Few classes.** There are two, both generated, and the logic lives in one place. A test file uses `TestData.x()`, `rows.insert(...)` and the usual JUnit, Mockito and AssertJ. Nothing new is needed to read a test.
- **Robust.** Values follow the DB and schema constraints, and objects go through their constructors. Containers are real Postgres, with real functions, dictionaries and CHECKs. Runs repeat by seed.
- **Generated, not hand-kept.** A schema change in the passport regenerates `TestData`, the snapshot and `<db>.json`. dt's compile check then shows which tests broke.

## Steps, if agreed

1. **Fix the trial's gaps in `test_context`:**
   - write the stubs (`returnsFirstArg`, `Optional.of`);
   - derive values from use (`Long.valueOf`) and from the request record;
   - real inserts with parent ids;
   - asserts derived from the code;
   - drop unused imports;
   - imports for Testcontainers 2.x and Boot 4.
2. Generate `TestData` from the code graph and the DB catalog (entities, DTOs, constructors, constraints).
3. Write `TestData.cases` with outcomes read from guards and validation.
4. Generate `TestInfra` and `<db>.json`, and add `d_` rows to the snapshot (a new step in `catalog_sync`).
5. Add Kafka: schema-driven event factories, the Kafka container, and `mock://` for Avro.

Each step is tried the same way as the trial above: skeletons written as they come must pass with meaningful assertions on payments-service, order-service and a Gradle multi-module project.
