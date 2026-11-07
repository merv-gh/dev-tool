// Recursive forms shared by the workbench and specialist pages.
(function (root) {
  const clone = (v) => (v === undefined ? undefined : structuredClone(v)),
    own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  function initial(s = {}) {
    if (own(s, "default")) return clone(s.default);
    if (own(s, "const")) return clone(s.const);
    if (s.enum?.length) return clone(s.enum[0]);
    const type = [].concat(s.type || "string").find((t) => t !== "null");
    return type === "object"
      ? {}
      : type === "array"
        ? []
        : type === "boolean"
          ? false
          : type === "null"
            ? null
            : ["number", "integer"].includes(type)
              ? 0
              : "";
  }
  function mount(host, schema, value = {}, change = () => {}, options = {}) {
    host._dtToolForm?.destroy();
    host.replaceChildren();
    let state = clone(value) || {},
      disposed = false;
    const cleanups = [],
      errors = new Map();
    const notify = () => {
      if (!disposed) change(clone(state));
    };
    function get(path) {
      return path.reduce((v, k) => v?.[k], state);
    }
    function set(path, value, emit = true) {
      if (!path.length) state = value;
      else {
        let owner = state;
        for (let i = 0; i < path.length - 1; i++) {
          const key = path[i];
          if (
            !own(owner, key) ||
            owner[key] === null ||
            typeof owner[key] !== "object"
          )
            Object.defineProperty(owner, key, {
              value: typeof path[i + 1] === "number" ? [] : {},
              writable: true,
              enumerable: true,
              configurable: true,
            });
          owner = owner[key];
        }
        const key = path.at(-1);
        if (value === undefined && !Array.isArray(owner)) delete owner[key];
        else
          Object.defineProperty(owner, key, {
            value,
            writable: true,
            enumerable: true,
            configurable: true,
          });
      }
      if (emit) notify();
    }
    const labelFor = (name) =>
      String(name)
        .replaceAll("_", " ")
        .replace(/([a-z])([A-Z])/g, "$1 $2");
    const clear = (node) => {
      for (const field of node.querySelectorAll("[data-field]"))
        errors.delete(field.dataset.field);
      for (const input of node.querySelectorAll("input,textarea"))
        input._dtCombo?.destroy();
      node.replaceChildren();
    };
    function control(container, s, path, required = false, depth = 0) {
      if (depth > 12) {
        container.textContent =
          "This deeply nested contract can be edited in exact JSON.";
        return;
      }
      s = s && typeof s === "object" ? s : {};
      const key = path.join("."),
        name = path.at(-1),
        current = get(path),
        type =
          []
            .concat(
              s.type ||
                (s.properties
                  ? "object"
                  : s.items
                    ? "array"
                    : current !== undefined
                      ? current === null
                        ? "null"
                        : Array.isArray(current)
                          ? "array"
                          : typeof current
                      : "string"),
            )
            .find((t) => t !== "null") || "null",
        field = document.createElement("div");
      field.className = "tool-field";
      field.dataset.field = key;
      container.append(field);
      const caption = document.createElement("label");
      caption.className = "tool-field-caption";
      caption.textContent = labelFor(name) + (required ? " · required" : "");
      field.append(caption);
      const issue = document.createElement("small");
      issue.className = "err-text";
      issue.setAttribute("role", "status");
      function invalid(message) {
        issue.textContent = message;
        if (message) errors.set(key, message);
        else errors.delete(key);
      }
      const variants = s.oneOf || s.anyOf;
      if (
        variants ||
        (!s.type && !s.properties && !s.items && !s.enum && !own(s, "const"))
      ) {
        const shapes =
            variants ||
            ["string", "number", "boolean", "object", "array", "null"].map(
              (type) => ({ type }),
            ),
          branch = document.createElement("select");
        branch.setAttribute("aria-label", labelFor(name) + " shape");
        shapes.forEach((v, i) =>
          branch.add(
            new Option(
              v.title ||
                v.description ||
                [].concat(v.type || "option").join("/"),
              String(i),
            ),
          ),
        );
        field.append(branch);
        const slot = document.createElement("div");
        field.append(slot);
        let selected = shapes.findIndex((v) => v.type === type);
        if (selected < 0) selected = 0;
        branch.value = String(selected);
        const render = () =>
          control(
            slot,
            {
              ...s,
              oneOf: undefined,
              anyOf: undefined,
              ...shapes[Number(branch.value)],
              type: shapes[Number(branch.value)].type || "object",
            },
            path,
            required,
            depth + 1,
          );
        render();
        branch.onchange = () => {
          set(path, initial(shapes[Number(branch.value)]), false);
          clear(slot);
          render();
          notify();
        };
        return;
      }
      if (type === "object" || type === "array") {
        const section = document.createElement("div");
        section.className = "tool-nested";
        field.append(section);
        const render = () => {
          clear(section);
          const v = get(path);
          if (type === "array") {
            const items = Array.isArray(v) ? v : [];
            items.slice(0, 200).forEach((item, i) => {
              const row = document.createElement("div");
              row.className = "tool-array-item";
              control(
                row,
                s.prefixItems?.[i] || s.items || {},
                [...path, i],
                true,
                depth + 1,
              );
              const remove = document.createElement("button");
              remove.type = "button";
              remove.textContent = "Remove item " + (i + 1);
              remove.onclick = () => {
                const next = clone(get(path) || []);
                next.splice(i, 1);
                set(path, next, false);
                render();
                notify();
              };
              row.append(remove);
              section.append(row);
            });
            const add = document.createElement("button");
            add.type = "button";
            add.textContent = "Add " + labelFor(name) + " item";
            add.disabled = items.length >= Math.min(s.maxItems ?? 200, 200);
            add.onclick = () => {
              set(path, [...clone(get(path) || []), initial(s.items || {})]);
              render();
            };
            section.append(add);
            if (items.length > 200) {
              const notice = document.createElement("p");
              notice.textContent =
                "First 200 items are editable here; exact JSON preserves the remaining items.";
              section.append(notice);
            }
          } else {
            for (const [prop, child] of Object.entries(s.properties || {}))
              control(
                section,
                child,
                [...path, prop],
                (s.required || []).includes(prop),
                depth + 1,
              );
            const extra = Object.keys(v || {}).filter(
              (k) => !own(s.properties || {}, k),
            );
            for (const prop of extra) {
              const row = document.createElement("div");
              row.className = "tool-map-item";
              control(
                row,
                typeof s.additionalProperties === "object"
                  ? s.additionalProperties
                  : {},
                [...path, prop],
                false,
                depth + 1,
              );
              const remove = document.createElement("button");
              remove.type = "button";
              remove.textContent = "Remove " + prop;
              remove.onclick = () => {
                set([...path, prop], undefined, false);
                render();
                notify();
              };
              row.append(remove);
              section.append(row);
            }
            if (s.additionalProperties !== false) {
              const addRow = document.createElement("div");
              addRow.className = "tool-add-property";
              const keyInput = document.createElement("input");
              keyInput.placeholder = "Property name";
              keyInput.setAttribute(
                "aria-label",
                labelFor(name) + " new property name",
              );
              const valueType = document.createElement("select");
              valueType.setAttribute("aria-label", "New property type");
              for (const kind of [
                "string",
                "number",
                "boolean",
                "object",
                "array",
                "null",
              ])
                valueType.add(new Option(kind, kind));
              const add = document.createElement("button");
              add.type = "button";
              add.textContent = "Add property";
              add.onclick = () => {
                const prop = keyInput.value.trim();
                if (
                  !prop ||
                  ["__proto__", "constructor", "prototype"].includes(prop) ||
                  prop.length > 200
                ) {
                  invalid("Choose a nonempty ordinary property name.");
                  return;
                }
                if (own(get(path) || {}, prop)) {
                  invalid("That property already exists.");
                  return;
                }
                set([...path, prop], initial({ type: valueType.value }));
                invalid("");
                render();
              };
              addRow.append(keyInput, valueType, add);
              section.append(addRow);
            }
          }
        };
        render();
        field.append(issue);
        if (s.description) {
          const hint = document.createElement("small");
          hint.className = "tool-field-help";
          hint.textContent = s.description;
          field.append(hint);
        }
        return;
      }
      if (type === "null") {
        const text = document.createElement("span");
        text.textContent = "null";
        field.append(text);
        return;
      }
      let input;
      if (s.enum) {
        input = document.createElement("select");
        if (!required) input.add(new Option("Not set", ""));
        s.enum.forEach((v, i) => input.add(new Option(String(v), String(i))));
        input.value =
          current === undefined
            ? ""
            : String(
                s.enum.findIndex(
                  (v) => JSON.stringify(v) === JSON.stringify(current),
                ),
              );
      } else if (type === "boolean") {
        input = document.createElement("select");
        input.add(
          new Option(required ? "Choose true or false" : "Not set", ""),
        );
        input.add(new Option("True", "true"));
        input.add(new Option("False", "false"));
        input.value = current === undefined ? "" : String(current);
      } else if (
        type === "string" &&
        ([
          "sql",
          "code",
          "content",
          "body",
          "text",
          "description",
          "reason",
          "summary",
          "goal",
        ].includes(String(name)) ||
          s.maxLength > 1000)
      ) {
        input = document.createElement("textarea");
        input.rows = ["sql", "code", "content"].includes(String(name)) ? 5 : 2;
        input.spellcheck = !["sql", "code"].includes(String(name));
      } else {
        input = document.createElement("input");
        input.type = ["number", "integer"].includes(type)
          ? "number"
          : s.writeOnly || /password|token|secret/i.test(String(name))
            ? "password"
            : "text";
        if (type === "number") input.step = "any";
        if (s.minimum !== undefined) input.min = s.minimum;
        if (s.maximum !== undefined) input.max = s.maximum;
      }
      const uid = "tool-field-" + Math.random().toString(36).slice(2);
      input.id = uid;
      caption.htmlFor = uid;
      input.setAttribute("aria-label", labelFor(name));
      input.dataset.arg = key;
      if (s.maxLength) input.maxLength = s.maxLength;
      if (s.readOnly || own(s, "const")) input.readOnly = true;
      if (!s.enum && type !== "boolean")
        input.value =
          current === undefined || current === null ? "" : String(current);
      const changed = () => {
        try {
          let v = input.value;
          if (s.enum) v = v === "" ? undefined : clone(s.enum[Number(v)]);
          else if (type === "boolean") v = v === "" ? undefined : v === "true";
          else if (["number", "integer"].includes(type))
            v = v === "" ? undefined : Number(v);
          else if (v === "" && !required) v = undefined;
          if (type === "integer" && v !== undefined && !Number.isInteger(v))
            throw Error("Enter a whole number.");
          if (typeof v === "number" && !Number.isFinite(v))
            throw Error("Enter a finite number.");
          invalid("");
          set(path, v);
        } catch (e) {
          invalid(e.message);
          notify();
        }
      };
      input.oninput = changed;
      input.onchange = changed;
      field.append(input);
      if (Array.isArray(s.type) && s.type.includes("null")) {
        const nullLabel = document.createElement("label"),
          useNull = document.createElement("input");
        nullLabel.className = "tool-null";
        useNull.type = "checkbox";
        useNull.checked = current === null;
        input.disabled = useNull.checked;
        nullLabel.append(useNull, document.createTextNode("Use null"));
        useNull.onchange = () => {
          input.disabled = useNull.checked;
          invalid("");
          if (useNull.checked) set(path, null);
          else changed();
        };
        field.append(nullLabel);
      }
      const lookup = options.choices || root.dtToolChoices;
      if (
        lookup &&
        root.dtCombo &&
        input.tagName === "INPUT" &&
        input.type === "text" &&
        !s.enum
      ) {
        const combo = root.dtCombo.attach(input, {
          label: labelFor(name),
          prefix:
            {
              service: "Service",
              repo: "Repository",
              workspace: "Workspace",
              db: "Database",
              name: "Object",
              topic: "Topic",
              path: "Path",
              env: "Environment",
              tool: "Tool",
              id: "ID",
            }[name] || "Known",
          epoch:
            options.epoch ||
            (() =>
              typeof adminRequestScope === "function"
                ? adminRequestScope() +
                  "|" +
                  (typeof env === "function" ? env() : "")
                : ""),
          load: (page) =>
            lookup({
              tool: options.tool,
              field: key,
              schema: s,
              arguments: clone(state),
              ...page,
            }),
          onPick: (item) => {
            set(path, clone(item.value), false);
            if (item.facts?.db && schema.properties?.db && !state.db) {
              set(["db"], item.facts.db, false);
              const db = host.querySelector('[data-arg="db"]');
              if (db) db.value = item.facts.db;
            }
            notify();
            options.onChoice?.(item, path, clone(state));
          },
        });
        cleanups.push(() => combo.destroy());
      }
      if (
        ["sql", "code"].includes(String(name)) &&
        input.tagName === "TEXTAREA"
      ) {
        if (root.dtCombo) {
          const token = () =>
              input.value
                .slice(0, input.selectionStart)
                .match(/[\w.]+$/)?.[0] || "",
            keywords =
              name === "sql"
                ? [
                    "SELECT",
                    "FROM",
                    "WHERE",
                    "AND",
                    "OR",
                    "ORDER BY",
                    "GROUP BY",
                    "LIMIT 20",
                    "count(*)",
                    "IS NULL",
                    "IS NOT NULL",
                    "ASC",
                    "DESC",
                  ]
                : [
                    "const",
                    "let",
                    "await",
                    "text",
                    "JSON.stringify",
                    "tools.call",
                  ];
          const complete = root.dtCombo.attach(input, {
            label: name + " completions",
            prefix: name === "sql" ? "SQL" : "Code",
            epoch: options.epoch,
            load: async () => {
              const text = token(),
                choices = keywords
                  .filter((k) => k.toLowerCase().startsWith(text.toLowerCase()))
                  .map((k) => ({ value: k, label: k, prefix: "Syntax" }));
              if (name === "sql" && lookup && text.length >= 2) {
                try {
                  const indexed = await lookup({
                    tool: options.tool,
                    field: key,
                    schema: s,
                    arguments: clone(state),
                    query: text,
                  });
                  choices.push(
                    ...indexed.choices.map((c) => ({
                      ...c,
                      value: (c.facts?.table || c.label)
                        .split(".")
                        .map((x) => '"' + x.replaceAll('"', '""') + '"')
                        .join("."),
                    })),
                  );
                } catch {}
              }
              return { source: name + " syntax and names", choices };
            },
            apply: (item, textarea) => {
              const length = token().length;
              textarea.setRangeText(
                String(item.value),
                textarea.selectionStart - length,
                textarea.selectionEnd,
                "end",
              );
            },
          });
          cleanups.push(() => complete.destroy());
        }
        const bar = document.createElement("div");
        bar.className = "tool-syntax";
        const select = document.createElement("select");
        select.setAttribute("aria-label", "Insert " + name + " syntax");
        select.add(new Option("Insert " + name + " syntax…", ""));
        const snippets =
          name === "sql"
            ? [
                ["Select a bounded sample", "SELECT * FROM "],
                ["Filter rows", " WHERE "],
                ["Add a condition", " AND "],
                ["Group values", " GROUP BY "],
                ["Order results", " ORDER BY "],
                ["Limit rows", " LIMIT 20"],
                ["Count rows", "SELECT count(*) FROM "],
              ]
            : [
                ["Print a value", "text();"],
                ["Inspect JSON", "JSON.stringify(value, null, 2)"],
                ["Store a named result", "const result = "],
                ["Await a promise", "await "],
              ];
        for (const [label, text] of snippets)
          select.add(new Option(label, text));
        select.onchange = () => {
          input.focus();
          input.setRangeText(
            select.value,
            input.selectionStart,
            input.selectionEnd,
            "end",
          );
          select.value = "";
          input.dispatchEvent(new Event("input", { bubbles: true }));
        };
        bar.append(select);
        field.append(bar);
        options.syntax?.(bar, input, name, () => clone(state));
      }
      if (s.description) {
        const hint = document.createElement("small");
        hint.className = "tool-field-help";
        hint.textContent = s.description;
        field.append(hint);
      }
      field.append(issue);
    }
    const main = document.createElement("div");
    main.className = "tool-fields";
    host.append(main);
    const more = document.createElement("details");
    more.className = "tool-extra";
    const summary = document.createElement("summary");
    summary.textContent = "More arguments";
    const extra = document.createElement("div");
    extra.className = "tool-fields";
    more.append(summary, extra);
    host.append(more);
    let count = 0;
    for (const [name, s] of Object.entries(schema?.properties || {})) {
      const important =
        !(options.secondary || []).includes(name) &&
        ((schema.required || []).includes(name) ||
          (own(value, name) &&
            JSON.stringify(value[name]) !== JSON.stringify(s.default)) ||
          count++ < 4);
      control(
        important ? main : extra,
        s,
        [name],
        (schema.required || []).includes(name),
      );
    }
    more.hidden = !extra.children.length;
    const api = {
      set(path, value) {
        set(path, clone(value));
        const input = host.querySelector('[data-arg="' + path.join(".") + '"]');
        if (input) input.value = value ?? "";
      },
      value: () => clone(state),
      errors: () => [
        ...new Set([
          ...errors.values(),
          ...(root.dtToolSchema?.validate(state, schema) || []).map(
            (e) => e.path + ": " + e.message,
          ),
        ]),
      ],
      destroy() {
        disposed = true;
        for (const cleanup of cleanups) cleanup();
      },
    };
    host._dtToolForm = api;
    return api;
  }
  root.dtToolForm = { mount, initial };
})(typeof window !== "undefined" ? window : globalThis);
