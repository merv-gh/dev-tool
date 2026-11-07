const test = require("node:test"),
  assert = require("node:assert/strict"),
  vm = require("node:vm"),
  fs = require("node:fs"),
  path = require("node:path");
const filename = path.join(__dirname, "../web/tool-schema.js"),
  backend = require("../lib/schema");
const browser = {};
vm.runInNewContext(fs.readFileSync(filename, "utf8"), browser, { filename });
const validate = browser.dtToolSchema.validate;
test("browser argument validation and server validation agree on actual JSON shapes and nested failures", () => {
  const schemas = [
    { enum: [{ a: 1, b: [2] }, null, "text"] },
    {
      type: ["object", "null"],
      properties: {
        items: {
          type: "array",
          items: { type: "integer", minimum: 1 },
          uniqueItems: true,
          minItems: 1,
          maxItems: 2,
        },
      },
      required: ["items"],
      additionalProperties: false,
    },
    { type: "string", minLength: 2, maxLength: 4, pattern: "^a" },
    {
      type: "number",
      minimum: 1,
      maximum: 5,
      exclusiveMinimum: 1,
      exclusiveMaximum: 5,
      multipleOf: 0.5,
    },
    {
      anyOf: [{ type: "number" }, { type: "string" }],
      not: { const: "forbidden" },
    },
    {
      oneOf: [{ type: "number" }, { type: "integer" }],
      allOf: [{ minimum: 0 }],
    },
    {
      type: "array",
      prefixItems: [{ const: 1 }, { type: "string" }],
      items: false,
      contains: { type: "string" },
      minContains: 1,
      maxContains: 2,
    },
    {
      type: "object",
      patternProperties: { "^x": { type: "boolean" } },
      additionalProperties: { type: "string" },
      dependentRequired: { x: ["y"] },
      dependentSchemas: { y: { required: ["z"] } },
      propertyNames: { minLength: 1 },
      minProperties: 1,
      maxProperties: 3,
    },
    {
      if: { type: "string" },
      then: { maxLength: 3 },
      else: { type: "integer" },
    },
  ];
  const values = [
    null,
    true,
    0,
    1,
    1.5,
    3,
    5,
    "a",
    "abc",
    "abcdef",
    "forbidden",
    [1, "x"],
    [1, "x", 3],
    [],
    { b: [2], a: 1 },
    { items: [1, 2] },
    { items: [1, 1] },
    { items: [0], extra: 1 },
    { x: true, y: "s" },
    { x: false, y: "s", z: "ok" },
    { "": 1 },
  ];
  for (const schema of schemas)
    for (const value of values)
      assert.deepEqual(
        JSON.parse(JSON.stringify(validate(value, schema))),
        backend.validate(value, schema),
      );
  assert.deepEqual(
    JSON.parse(JSON.stringify(validate({ b: [2], a: 1 }, schemas[0]))),
    [],
    "property order is irrelevant",
  );
});
test("unsupported schema assertions and over-budget structures remain invalid in both runtimes", () => {
  for (const schema of [
    false,
    { madeUpAssertion: true },
    { $ref: "#/missing" },
    "invalid",
  ])
    assert.ok(validate({}, schema).length);
  const recursive = {
    type: "object",
    additionalProperties: { type: "object", additionalProperties: true },
  };
  assert.ok(
    validate({ a: { b: {} } }, recursive, { maxNodes: 1 }).some((e) =>
      /budget/.test(e.message),
    ),
  );
  let schema = { type: "string" },
    value = "leaf";
  for (let i = 0; i < 70; i++) {
    schema = { type: "array", items: schema };
    value = [value];
  }
  assert.ok(validate(value, schema).some((e) => /budget/.test(e.message)));
});
