// Portalled, searchable indexed choices. Selecting a value never runs a tool.
(function (root) {
  let serial = 0,
    activeCombo;
  function attach(input, options = {}) {
    const wrapper = document.createElement("span");
    wrapper.className = "dt-combo";
    input.before(wrapper);
    wrapper.append(input);
    const prefix = document.createElement("span");
    prefix.className = "dt-combo-prefix";
    prefix.textContent = options.prefix || "Known";
    wrapper.prepend(prefix);
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "dt-combo-toggle";
    toggle.setAttribute(
      "aria-label",
      "Browse " +
        (options.label || input.getAttribute("aria-label") || "values"),
    );
    toggle.innerHTML =
      '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    wrapper.append(toggle);
    const popup = document.createElement("div"),
      id = "dt-choices-" + ++serial;
    popup.id = id;
    popup.className = "dt-combo-popup";
    popup.hidden = true;
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", "false");
    input.setAttribute("aria-controls", id);
    input.setAttribute("autocomplete", "off");
    let sequence = 0,
      disposed = false,
      active = -1,
      items = [],
      cursor = null,
      directory,
      query = "",
      timer,
      picking = false;
    const status = document.createElement("div");
    status.className = "dt-combo-status";
    status.setAttribute("role", "status");
    const list = document.createElement("div");
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", options.label || "Indexed values");
    const footer = document.createElement("div");
    footer.className = "dt-combo-footer";
    footer.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        input.focus();
      }
      if (e.key === "Tab") {
        e.preventDefault();
        close();
        (e.shiftKey ? input : toggle).focus();
      }
    });
    popup.append(status, list, footer);
    function position() {
      const r = wrapper.getBoundingClientRect(),
        width = Math.min(Math.max(r.width, 320), innerWidth - 24);
      popup.style.width = width + "px";
      popup.style.left =
        Math.max(12, Math.min(r.left, innerWidth - width - 12)) + "px";
      const below = innerHeight - r.bottom;
      popup.style.maxHeight =
        Math.max(160, Math.min(400, Math.max(below, r.top) - 20)) + "px";
      const height = Math.min(
        popup.scrollHeight || 300,
        parseFloat(popup.style.maxHeight),
      );
      popup.style.top =
        Math.max(
          12,
          Math.min(
            innerHeight - height - 12,
            below >= Math.min(280, r.top) ? r.bottom + 5 : r.top - height - 5,
          ),
        ) + "px";
    }
    function close() {
      clearTimeout(timer);
      if (activeCombo === api) activeCombo = null;
      sequence++;
      popup.hidden = true;
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    }
    function outside(e) {
      if (!wrapper.contains(e.target) && !popup.contains(e.target)) close();
    }
    function pick(item) {
      if (input.disabled || disposed) return;
      if (typeof item.browse === "string") {
        directory = item.browse;
        load("");
        return;
      }
      picking = true;
      if (options.apply) options.apply(item, input);
      else
        input.value =
          typeof item.value === "object"
            ? JSON.stringify(item.value)
            : String(item.value ?? "");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      picking = false;
      options.onPick?.(item);
      close();
      input.focus();
    }
    function highlight(n) {
      active = Math.max(0, Math.min(items.length - 1, n));
      [...list.children].forEach((b, i) =>
        b.setAttribute("aria-selected", String(i === active)),
      );
      const node = list.children[active];
      if (node) {
        input.setAttribute("aria-activedescendant", node.id);
        node.scrollIntoView({ block: "nearest" });
      }
    }
    function render() {
      list.replaceChildren();
      items.forEach((item, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.id = id + "-" + index;
        button.className = "dt-combo-option";
        button.setAttribute("role", "option");
        button.setAttribute("aria-selected", "false");
        button.tabIndex = -1;
        const text = document.createElement("span"),
          label = document.createElement("strong"),
          detail = document.createElement("small"),
          tag = document.createElement("span");
        label.textContent = item.label ?? String(item.value);
        detail.textContent = item.detail || "";
        tag.className = "dt-combo-kind";
        tag.textContent = item.prefix || options.prefix || "Value";
        text.append(label, detail);
        button.append(tag, text);
        button.onpointerdown = (e) => e.preventDefault();
        button.onclick = () => pick(item);
        list.append(button);
      });
      footer.replaceChildren();
      if (cursor) {
        const more = document.createElement("button");
        more.type = "button";
        more.textContent = "Load more choices";
        more.onclick = () => load(query, cursor, true);
        footer.append(more);
      }
      active = -1;
      input.removeAttribute("aria-activedescendant");
      position();
    }
    async function load(text = "", next = null, append = false) {
      const ticket = ++sequence,
        epoch = options.epoch?.();
      query = text;
      if (!append) {
        items = [];
        cursor = null;
        active = -1;
        list.replaceChildren();
        footer.replaceChildren();
        input.removeAttribute("aria-activedescendant");
      }
      status.textContent = "Loading indexed choices…";
      status.className = "dt-combo-status";
      try {
        const response = await options.load({
          query: text,
          cursor: next,
          ...(directory === undefined ? {} : { directory }),
        });
        if (
          disposed ||
          !input.isConnected ||
          ticket !== sequence ||
          epoch !== options.epoch?.()
        )
          return;
        items = append
          ? [...items, ...(response.choices || [])]
          : response.choices || [];
        cursor = response.nextCursor || null;
        status.textContent = [
          response.source
            ? response.source.replaceAll("-", " ")
            : "Known values",
          response.env,
          response.generation
            ? "generation " + response.generation.slice(0, 8)
            : "",
          items.length ? items.length + " choices" : "No matches",
          ...(response.gaps || []),
        ]
          .filter(Boolean)
          .join(" · ");
        render();
      } catch (error) {
        if (disposed || ticket !== sequence) return;
        status.textContent = error.message + " Your input is preserved.";
        status.className = "dt-combo-status dt-combo-error";
        footer.replaceChildren();
        const retry = document.createElement("button");
        retry.type = "button";
        retry.textContent = "Retry choices";
        retry.onclick = () => load(text, next, append);
        footer.append(retry);
      }
    }
    function open(text = "") {
      if (input.disabled || disposed) return;
      if (activeCombo !== api) activeCombo?.close();
      activeCombo = api;
      input.scrollIntoView({ block: "nearest" });
      input.focus({ preventScroll: true });
      if (!popup.isConnected) document.body.append(popup);
      popup.hidden = false;
      input.setAttribute("aria-expanded", "true");
      document.addEventListener("pointerdown", outside);
      window.addEventListener("resize", position);
      window.addEventListener("scroll", position, true);
      position();
      load(text);
    }
    toggle.onclick = () => (popup.hidden ? open("") : close());
    const changed = () => {
      if (picking || input.disabled) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (document.activeElement !== input) return;
        if (popup.hidden) open(input.value);
        else load(input.value);
      }, 180);
    };
    const keydown = (e) => {
      if (e.key === "Escape") {
        close();
        return;
      }
      if (e.key === "Tab") {
        const action =
          !e.shiftKey && !popup.hidden && footer.querySelector("button");
        if (action) {
          e.preventDefault();
          action.focus();
          return;
        }
        close();
        return;
      }
      if (["ArrowDown", "ArrowUp"].includes(e.key)) {
        e.preventDefault();
        if (popup.hidden) open("");
        else if (items.length)
          highlight(active + (e.key === "ArrowDown" ? 1 : -1));
      } else if (e.key === "Enter" && !popup.hidden && active >= 0) {
        e.preventDefault();
        pick(items[active]);
      }
    };
    input.addEventListener("input", changed);
    input.addEventListener("keydown", keydown);
    const api = {
      open,
      close,
      refresh: () => {
        if (!popup.hidden) load(query);
      },
      destroy() {
        disposed = true;
        clearTimeout(timer);
        close();
        popup.remove();
        input.removeEventListener("input", changed);
        input.removeEventListener("keydown", keydown);
      },
    };
    input._dtCombo = api;
    return api;
  }
  root.dtCombo = { attach };
})(typeof window !== "undefined" ? window : globalThis);
