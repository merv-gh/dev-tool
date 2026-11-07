// Real browser + owned HTTP jobs against demo/ui-ux.js only. Infrastructure and
// optional model replies are synthetic; no production queries or real LLM calls.
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { chromium } = require("playwright");
async function run(
  manifestFile = "work/workbench/fixture.json",
  out = "work/workbench/browser",
  capture = false,
) {
  let m = JSON.parse(fs.readFileSync(manifestFile));
  const base = new URL(m.base).origin;
  if (
    !["127.0.0.1", "localhost"].includes(new URL(base).hostname) ||
    !path.basename(m.home || "").startsWith("dt-ux-review-")
  )
    throw Error("Use the disposable UX fixture");
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      if (
        (await fetch(base + "/health", { signal: AbortSignal.timeout(1000) }))
          .ok
      ) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!ready) throw Error("Disposable fixture did not become ready");
  m = JSON.parse(fs.readFileSync(manifestFile));
  fs.mkdirSync(out, { recursive: true });
  const report = {
    fixture:
      "synthetic infrastructure and model; actual indexed code, HTTP execution and browser",
    checks: [],
    pageErrors: [],
    captures: [],
  };
  const browser = await chromium.launch({ headless: true });
  let p;
  const check = async (name, fn) => {
    await fn();
    report.checks.push({ name, ok: true });
    console.log("PASS " + name);
  };
  const pick = async (label, text) => {
    const toggle = p.getByRole("button", {
      name: "Browse " + label,
      exact: true,
    });
    if (
      !(await toggle.evaluate(
        (e) =>
          e.parentElement
            .querySelector("input,textarea")
            .getAttribute("aria-expanded") === "true",
      ))
    )
      await toggle.click();
    const popup = p.locator(".dt-combo-popup:not([hidden])");
    await popup
      .locator(".dt-combo-status")
      .filter({ hasNotText: "Loading indexed choices…" })
      .waitFor();
    const exact = ["enabled tools", "code tool calls"].includes(label);
    const option = exact
      ? popup.locator("[role=option]").filter({
          has: p
            .locator("strong")
            .filter({ hasText: new RegExp("^" + text + "$") }),
        })
      : popup.locator("[role=option]").filter({ hasText: text });
    for (let i = 0; i < 8 && !(await option.count()); i++) {
      const more = popup.getByRole("button", {
        name: "Load more choices",
        exact: true,
      });
      if (!(await more.isVisible())) break;
      await more.click();
      await popup
        .locator(".dt-combo-status")
        .filter({ hasNotText: "Loading indexed choices…" })
        .waitFor();
    }
    await option.first().click();
  };
  const runAction = async (tool) => {
    await p.locator("#wbRun").click();
    await p
      .locator("#wbResultTitle")
      .filter({ hasText: tool + " · done" })
      .waitFor();
    await p.locator("#wbRun:not([disabled])").waitFor();
  };
  const choose = async (name) => {
    await p.locator("#wbToolGroup").selectOption("");
    await pick("enabled tools", name);
    assert.equal(await p.locator("#wbTool").inputValue(), name);
  };
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "reduce",
    });
    await context.addInitScript(() => {
      try {
        sessionStorage.setItem("dt-admin-story", "default");
      } catch {}
    });
    p = await context.newPage();
    p.setDefaultTimeout(9000);
    p.on("pageerror", (e) => report.pageErrors.push(e.message));
    p.on("dialog", (d) => d.accept());
    await p.goto(base + "/admin");
    await p.locator("#wbFields [data-arg=service]").waitFor();
    await check(
      "default entry and empty catalog recovery are clickable",
      async () => {
        assert.equal(await p.locator("#tab-workbench").isVisible(), true);
        if (
          await p
            .getByRole("button", { name: "Prepare cached index", exact: true })
            .isVisible()
        ) {
          await p
            .getByRole("button", { name: "Prepare cached index", exact: true })
            .click();
          await runAction("catalog_sync");
        }
        await p.locator("[data-wb-intent=service-boundaries]").click();
      },
    );
    await check(
      "mouse-only service → passport → table → usage → bounded SQL draft",
      async () => {
        await pick("service", "checkout");
        const draft = JSON.parse(await p.locator("#wbArgs").inputValue());
        assert.equal(draft.env, undefined);
        assert.equal(draft.job, undefined);
        await p
          .getByRole("button", { name: "New investigation", exact: true })
          .click();
        await p.waitForFunction(() =>
          document.getElementById("wbContext").value.startsWith("workbench-"),
        );
        await runAction("passport");
        await p
          .frameLocator("#wbNative")
          .locator("#title")
          .filter({ hasText: "checkout" })
          .waitFor({ state: "attached" });
        assert.match(await p.locator("#wbFacts").innerText(), /sales.refunds/);
        assert.match(await p.locator("#wbResultMeta").innerText(), /Saved to/);
        await p
          .locator("#wbFollowups")
          .getByRole("button", { name: "Inspect table", exact: true })
          .click();
        await pick("name", "sales.refunds");
        await runAction("pg_table");
        await p
          .locator("#wbFollowups")
          .getByRole("button", {
            name: "Find readers and writers",
            exact: true,
          })
          .click();
        await runAction("pg_usage");
        await p
          .locator("#wbFollowups")
          .getByRole("button", { name: "Prepare a SQL query", exact: true })
          .click();
        await pick("SQL tables", "sales.refunds");
        await p
          .getByRole("button", { name: "Preview 20 rows", exact: true })
          .click();
        let args = JSON.parse(await p.locator("#wbArgs").inputValue());
        assert.match(args.sql, /SELECT \* FROM "sales"\."refunds" LIMIT 20/);
        assert.ok(args.db);
        await p
          .getByLabel("Insert sql syntax", { exact: true })
          .selectOption(" ORDER BY ");
        args = JSON.parse(await p.locator("#wbArgs").inputValue());
        assert.ok(args.db, "table database survives subsequent query editing");
        const previous = args.sql;
        await p
          .getByLabel("SQL table", { exact: true })
          .fill("unselected_table");
        await p
          .getByRole("button", { name: "Preview 20 rows", exact: true })
          .click();
        assert.equal(
          JSON.parse(await p.locator("#wbArgs").inputValue()).sql,
          previous,
          "a changed table input must not reuse its old selection",
        );
        await p.getByLabel("SQL table", { exact: true }).press("Escape");
      },
    );
    await check(
      "syntax and tool-call insertion use the real enabled registry",
      async () => {
        await p.locator("#wbToolGroup").selectOption("");
        await p.locator("#wbTool").focus();
        await p.locator("#wbTool").press("Tab");
        assert.equal(
          await p.evaluate(() => document.activeElement.textContent),
          "Load more choices",
        );
        await p.keyboard.press("Enter");
        await p
          .locator(".dt-combo-popup:not([hidden]) [role=option]")
          .nth(40)
          .waitFor();
        await p.keyboard.press("Escape");
        await choose("code");
        await pick("code tool calls", "catalog_search");
        const args = JSON.parse(await p.locator("#wbArgs").inputValue());
        assert.match(args.code, /await tools.call\("catalog_search"/);
        assert.doesNotMatch(args.code, /dt.call/);
        const code = p.locator("#wbFields [data-arg=code]");
        await code.fill("con");
        await code.press("ArrowDown");
        await p
          .locator(".dt-combo-popup:not([hidden]) [role=option]")
          .filter({ hasText: "const" })
          .first()
          .click();
        assert.equal(await code.inputValue(), "const");
      },
    );
    await check(
      "structured arrays, objects and nullable values need no JSON",
      async () => {
        await p.locator("#wbToolGroup").selectOption("demo");
        await pick("enabled tools", "demo_workbench");
        await p
          .getByRole("button", { name: "Add items item", exact: true })
          .click();
        await p
          .locator('#wbFields [data-arg="items.0.name"]')
          .selectOption({ label: "checkout" });
        await p.locator('#wbFields [data-arg="items.0.count"]').fill("1.5");
        assert.equal(await p.locator("#wbRun").isDisabled(), true);
        await p
          .getByRole("button", { name: "Remove item 1", exact: true })
          .click();
        assert.equal(
          await p.locator("#wbRun").isDisabled(),
          false,
          "removing an invalid item clears its errors",
        );
        await p
          .getByRole("button", { name: "Add items item", exact: true })
          .click();
        await p
          .locator('#wbFields [data-arg="items.0.name"]')
          .selectOption({ label: "checkout" });
        await p.locator('#wbFields [data-arg="items.0.count"]').fill("3");
        await p
          .getByLabel("options new property name", { exact: true })
          .fill("strict");
        await p
          .getByLabel("New property type", { exact: true })
          .selectOption("boolean");
        await p
          .getByRole("button", { name: "Add property", exact: true })
          .click();
        await p
          .locator('#wbFields [data-arg="options.strict"]')
          .selectOption("true");
        await p.locator("#wbFields [data-arg=nullable]").fill("7");
        await p.getByLabel("Use null", { exact: true }).check();
        await p.getByLabel("Use null", { exact: true }).uncheck();
        assert.equal(
          JSON.parse(await p.locator("#wbArgs").inputValue()).nullable,
          7,
          "unchecking null preserves the numeric type",
        );
        await p.getByLabel("Use null", { exact: true }).check();
        await runAction("demo_workbench");
        const r = JSON.parse(await p.locator("#wbResultRaw").textContent());
        assert.deepEqual(r.result.arguments.items, [
          { name: "checkout", count: 3 },
        ]);
        assert.equal(r.result.arguments.options.strict, true);
        assert.equal(r.result.arguments.nullable, null);
      },
    );
    const successfulLink = p.url();
    await check(
      "model help returns editable suggestions and interprets the selected evidence",
      async () => {
        let submissions = 0;
        const listener = (req) => {
          if (
            req.method() === "POST" &&
            req.url().endsWith("/api/admin/workbench/run")
          )
            submissions++;
        };
        p.on("request", listener);
        await p.locator("#wbSuggest").click();
        await p
          .locator("#wbHelp")
          .getByRole("button", { name: /Prepare / })
          .first()
          .waitFor();
        assert.match(
          await p.locator("#wbHelp").innerText(),
          /Synthetic model help/,
        );
        assert.equal(submissions, 0);
        await p.locator("#wbInterpret").click();
        await p
          .locator("#wbHelp")
          .getByText("Retained evidence was supplied.", { exact: true })
          .waitFor();
        assert.equal(submissions, 0);
        await p
          .locator("#wbHelp")
          .getByRole("button", { name: /Prepare / })
          .first()
          .click();
        assert.equal(submissions, 0);
        p.off("request", listener);
      },
    );
    await check(
      "owned runs expose progress and cancellation, and preserve previous evidence",
      async () => {
        await choose("demo_workbench");
        await p.locator("#wbFields [data-arg=slow]").selectOption("true");
        await p.locator("#wbRun").click();
        await p.locator("#wbCancel").waitFor({ state: "visible" });
        assert.equal(await p.locator("#wbRun").isDisabled(), true);
        await p.locator("#wbCancel").click();
        await p
          .locator("#wbResultTitle")
          .filter({ hasText: "cancelled" })
          .waitFor();
        assert.match(await p.locator("#wbOutcome").innerText(), /Cancelled/);
        await p.locator("#wbFields [data-arg=slow]").selectOption("false");
        await p.locator("#wbFields .tool-extra summary").click();
        await p.locator("#wbFields [data-arg=fail]").selectOption("true");
        await runAction("demo_workbench");
        assert.match(
          await p.locator("#wbOutcome").innerText(),
          /Tool failed.*Synthetic failure/,
        );
        await p
          .locator("#wbHistory button")
          .filter({ hasText: "passport" })
          .click();
        assert.match(
          await p.locator("#wbResultTitle").innerText(),
          /passport · done/,
        );
      },
    );
    await check(
      "owned run links reopen without submitting another action",
      async () => {
        let replays = 0;
        const listener = (req) => {
          if (
            req.method() === "POST" &&
            req.url().endsWith("/api/admin/workbench/run")
          )
            replays++;
        };
        p.on("request", listener);
        await p.goto(successfulLink);
        await p
          .locator("#wbResultTitle")
          .filter({ hasText: "demo_workbench · done" })
          .waitFor();
        assert.equal(replays, 0);
        p.off("request", listener);
      },
    );
    await check(
      "inline chat evidence has a workbench continuation with no replay",
      async () => {
        const sample = m.samples.find((s) => s.name === "table");
        await p.goto(sample.url + "?embed=1");
        await p.locator("details.inline-result > summary").click();
        const link = p.getByRole("link", {
          name: "Continue in Workbench",
          exact: true,
        });
        await link.waitFor();
        const href = await link.getAttribute("href");
        await p.goto(base + href);
        await p
          .locator("#wbResultTitle")
          .filter({ hasText: "saved" })
          .waitFor();
        assert.match(
          await p.locator("#wbOutcome").innerText(),
          /No action was replayed/,
        );
      },
    );
    await check(
      "new task scope clears earlier evidence and ignores delayed choice responses",
      async () => {
        await p.goto(base + "/admin#workbench");
        await p.locator("#wbFields [data-arg=service]").waitFor();
        await p.route("**/api/admin/workbench/choices", async (route) => {
          await new Promise((r) => setTimeout(r, 400));
          await route.continue();
        });
        await p
          .getByRole("button", { name: "Browse service", exact: true })
          .click();
        await p.locator("#rtStory").fill("workbench-other-task");
        await p.locator("#rtScopeApply").click();
        await p.waitForFunction(
          () =>
            document.getElementById("rtStory").value ===
              "workbench-other-task" &&
            document.getElementById("wbEvidence").hidden,
        );
        assert.equal(await p.locator("#wbResultRaw").textContent(), "");
        await p.unrouteAll({ behavior: "wait" });
      },
    );
    if (capture) {
      await p.goto(base + "/admin#workbench?story=default");
      await p.locator("#wbFields [data-arg=service]").waitFor();
      await pick("service", "checkout");
      await runAction("passport");
      await p
        .frameLocator("#wbNative")
        .locator("#title")
        .filter({ hasText: "checkout" })
        .waitFor({ state: "attached" });
      const disclosure = p
        .frameLocator("#wbNative")
        .locator("details.inline-result");
      if (!(await disclosure.evaluate((e) => e.open)))
        await disclosure.locator(":scope > summary").click();
      // One consolidated screenshot batch, after functional acceptance.
      for (const width of [1440, 390]) {
        await p.setViewportSize({ width, height: 1000 });
        await p.evaluate(() => window.scrollTo(0, 0));
        await p.waitForTimeout(160);
        const top = path.join(out, "workbench-" + width + ".png");
        await p.screenshot({ path: top, fullPage: false });
        report.captures.push(top);
        await p.locator("#wbEvidence").scrollIntoViewIfNeeded();
        await p.waitForTimeout(160);
        const evidence = path.join(out, "workbench-evidence-" + width + ".png");
        await p.screenshot({ path: evidence, fullPage: false });
        report.captures.push(evidence);
        assert.ok(
          await p.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 2,
          ),
          "no document overflow at " + width,
        );
      }
    }
    assert.deepEqual(report.pageErrors, []);
  } catch (error) {
    report.error = error.stack;
    report.lastState = await p
      .evaluate(() => ({
        url: location.href,
        status: document.getElementById("wbStatus")?.textContent,
        title: document.getElementById("wbResultTitle")?.textContent,
        scope: typeof wbScope === "function" ? wbScope() : null,
        phase: typeof wbLife === "object" ? wbLife.state : null,
      }))
      .catch(() => null);
    console.error(JSON.stringify(report.lastState));
    throw error;
  } finally {
    fs.writeFileSync(
      path.join(out, "report.json"),
      JSON.stringify(report, null, 2),
    );
    await browser.close();
  }
  return report;
}
if (require.main === module)
  run(process.argv[2], process.argv[3], process.argv.includes("--screenshots"))
    .then((r) =>
      console.log(
        JSON.stringify({
          checks: r.checks.length,
          screenshots: r.captures.length,
        }),
      ),
    )
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    });
module.exports = { run };
