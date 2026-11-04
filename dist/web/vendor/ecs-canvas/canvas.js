//#region canvas/constants.ts
var e = {
	Top: "top",
	Left: "left",
	Right: "right",
	Stage: "stage",
	Modal: "modal"
}, t = {
	Drag: "drag",
	Resize: "resize",
	Header: "header",
	HeaderStart: "header:start",
	HeaderEnd: "header:end",
	Title: "title",
	Start: "start",
	End: "end"
};
new Set([
	t.Drag,
	t.Resize,
	t.Header,
	t.HeaderStart,
	t.HeaderEnd,
	t.Title
]);
var n = [
	".created",
	".updated",
	".deleted",
	".switched",
	".selected",
	".focused",
	".changed"
], r = {
	io: !1,
	history: !1,
	palette: !1,
	presets: !1,
	ink: !1,
	marquee: !1,
	"ghost.node": !1,
	"item.toolbar": !1,
	"context.actions": !1,
	"node.visuals": !1,
	"node.autosize": !1,
	layout: !1,
	collections: !1,
	choose: !1,
	demo: !1,
	onboarding: !1,
	debug: !1,
	dx: !1,
	scenario: !1,
	log: !1,
	"perf.panel": !1,
	"telemetry.portal": !1,
	varflow: !1,
	"ability.draggable": !1,
	"ability.editable": !1,
	"ability.resizeable": !1,
	"ability.nudgeable": !1,
	"ability.configurable": !1,
	backend: !1,
	component: !1,
	gallery: !1,
	variables: !1,
	showcase: !1,
	boardNodes: !1,
	nodeLifecycle: !1,
	edgeLifecycle: !1,
	nodeToContainer: !1
};
//#endregion
//#region canvas/surface.ts
function i(e, t, n = {}, r = {}) {
	t.flags.set("view.fit.contain", n.fit === "contain"), t.contexts.commands.configureHotkeys(n.hotkeys, n.inheritHotkeys);
	let i = new Set(Object.keys(n.panels || {}));
	if (n.panels !== void 0 && !n.inheritPanels) for (let e of [
		"left.library",
		"outline",
		"item.toolbar",
		"context.actions"
	]) t.flags.set(e, !1);
	t.contexts.affordances.filterSystem((e) => e.surface === "dock" && n.panels !== void 0 && !n.inheritPanels || n.hiddenPanels?.includes(e.panel ?? e.command.replace(/\.[^.]+$/, "")) ? !1 : e.surface !== "top" || !i.has(e.panel ?? "top") || e.origin === "sdk.surface"), t.contexts.affordances.filterPanels((e) => !n.hiddenPanels?.includes(e.id) && (e.origin === "sdk.surface" || n.panels !== !1 && !i.has(e.id) && (n.panels === void 0 || n.inheritPanels === !0))), e("sdk.surface", ({ on: e, contexts: t, declarePanel: i, contribute: a }) => {
		let o = Object.entries(r).map(([e, t]) => ({
			id: e,
			label: t.label,
			event: "project.action",
			payload: () => ({ id: e })
		}));
		t.commands.register(o), e("project.action", ({ id: e }) => r[e]?.run());
		for (let [e, r] of Object.entries(n.panels || {})) i({
			id: e,
			anchor: r.anchor,
			layout: r.layout ?? "toolbar",
			presentation: "plain",
			movable: !1
		}), r.commands.forEach((n, r) => a({
			surface: "top",
			kind: "button",
			command: n,
			text: t.commands.get(n)?.label ?? n,
			panel: e,
			order: r
		}));
		e("app.start", () => {
			let e = [...Object.values(n.panels || {}).flatMap((e) => e.commands), ...Object.keys(n.hotkeys || {})];
			for (let n of e) if (!t.commands.get(n)) throw TypeError(`Unknown surface command: ${n}`);
		});
	});
}
//#endregion
//#region canvas/templates.html?raw
var a = "<template id=\"tpl-shell\">\n    <section class=\"shell\">\n      <header class=\"top\" data-place=\"top\"></header>\n      <main class=\"stage\" data-place=\"stage\"></main>\n      <div class=\"left\" data-place=\"left\"></div>\n      <div class=\"right\" data-place=\"right\"></div>\n      <div class=\"modal-slot\" data-place=\"modal\"></div>\n    </section>\n  </template>\n<template id=\"tpl-toolbar\">\n    <nav class=\"toolbar\" aria-label=\"App commands\">\n      <div class=\"toolbar-start\" data-slot=\"start\"></div>\n      <span class=\"toolbar-spacer\"></span>\n      <div class=\"toolbar-end\" data-slot=\"end\"></div>\n    </nav>\n  </template>\n<template id=\"tpl-log\">\n    <section>\n      <h2 class=\"panel-title\">Event log</h2>\n      <div class=\"log\" data-slot=\"rows\"></div>\n    </section>\n  </template>\n<template id=\"tpl-log-row\">\n    <div class=\"log-row\" data-text=\"name\"></div>\n  </template>\n<template id=\"tpl-nodes\">\n    <div class=\"nodes\">\n      <svg class=\"edges\" data-slot=\"edges\" overflow=\"visible\" aria-hidden=\"true\">\n        <defs>\n          <!-- Directional arrowhead shared by every edge. `orient=\"auto\"` aligns\n               with the line direction; `markerUnits=\"userSpaceOnUse\"` keeps the\n               arrow size fixed in graph space, independent of stroke width. -->\n          <marker id=\"edge-arrow\" viewBox=\"0 0 12 12\" refX=\"11\" refY=\"6\"\n                  markerWidth=\"12\" markerHeight=\"12\" orient=\"auto\" markerUnits=\"userSpaceOnUse\">\n            <path d=\"M0,0 L12,6 L0,12 Z\" />\n          </marker>\n        </defs>\n      </svg>\n    </div>\n  </template>\n<template id=\"tpl-empty\">\n    <div class=\"empty\" role=\"status\" aria-live=\"polite\">\n      <div class=\"empty-title\" data-text=\"title\"></div>\n      <div class=\"empty-hint\" data-slot=\"hint\"></div>\n    </div>\n  </template>\n<template id=\"tpl-node\">\n    <article class=\"node\">\n  \n      <div class=\"node-title\" data-editable-title data-slot=\"title\" data-text=\"title\"></div>\n      <div class=\"node-body\">\n        <div class=\"node-description\" data-slot=\"description\"></div>\n      </div>\n    </article>\n  </template>\n<template id=\"tpl-modal\">\n    <div class=\"modal-layer\">\n      <div class=\"backdrop\" data-command=\"modal.close\" aria-hidden=\"true\"></div>\n      <section class=\"modal\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"modal-title\">\n        <div class=\"modal-head\">\n          <span id=\"modal-title\" data-text=\"title\"></span>\n          <button class=\"modal-close icon\" data-command=\"modal.close\" aria-label=\"Close dialog\" title=\"Close\">×</button>\n        </div>\n        <div class=\"modal-body\" data-slot=\"body\"></div>\n      </section>\n    </div>\n  </template>\n<template id=\"tpl-palette\">\n    <section class=\"palette\">\n      <input class=\"palette-search\" placeholder=\"Search commands\" autocomplete=\"off\" autofocus>\n      <div class=\"command-list\" data-slot=\"commands\"></div>\n    </section>\n  </template>\n<template id=\"tpl-command-section\">\n    <section class=\"command-section\">\n      <h3 data-text=\"group\"></h3>\n      <div data-slot=\"rows\"></div>\n    </section>\n  </template>\n<template id=\"tpl-command-row\">\n    <button class=\"command-row\">\n      <span><b data-text=\"label\"></b><small data-text=\"id\"></small></span>\n      <kbd data-text=\"shortcut\"></kbd>\n    </button>\n  </template>\n<template id=\"tpl-help-row\">\n    <div class=\"help-row\">\n      <span><b data-text=\"label\"></b><small data-text=\"id\"></small></span>\n      <input class=\"shortcut-edit editable-inline\">\n    </div>\n  </template>\n<template id=\"tpl-properties\">\n    <section class=\"properties\">\n      <div data-slot=\"fields\"></div>\n    </section>\n  </template>\n", o = "http://www.w3.org/2000/svg", s = new Set([
	"svg",
	"path",
	"circle",
	"rect",
	"line",
	"g",
	"polyline",
	"polygon",
	"text",
	"ellipse",
	"defs",
	"marker",
	"use"
]), c = new Set([
	"value",
	"checked",
	"disabled",
	"tabIndex",
	"spellcheck",
	"contentEditable",
	"type",
	"htmlFor"
]), l = (e, t) => {
	(Array.isArray(t) ? t : [t]).forEach((t) => {
		t == null || t === !1 || e.append(t);
	});
};
function u(e, t, n) {
	let [r, ...i] = e.split("."), [a, u] = r.split("#"), d = a || "div", f = s.has(d) ? document.createElementNS(o, d) : document.createElement(d), p = !!t && !Array.isArray(t) && typeof t == "object" && !(t instanceof Node), m = p ? t : {}, h = p ? n : t;
	u && f.setAttribute("id", u);
	let g = [...i, ...m.class ? String(m.class).split(/\s+/) : []].filter(Boolean);
	return g.length && f.setAttribute("class", g.join(" ")), m.text !== void 0 && (f.textContent = String(m.text)), m.data && Object.entries(m.data).forEach(([e, t]) => {
		t !== void 0 && (f.dataset[e] = String(t));
	}), Object.entries(m).forEach(([e, t]) => {
		e === "text" || e === "data" || e === "class" || t == null || t === !1 || (c.has(e) ? f[e] = t : f.setAttribute(e, t === !0 ? "" : String(t)));
	}), h !== void 0 && l(f, h), f;
}
var d = (e, t) => {
	e.append(typeof t == "function" ? t() : t);
}, f = (e) => e?.length ? JSON.stringify(e) : "", p = (e) => {
	if (e) try {
		let t = JSON.parse(e);
		return Array.isArray(t) && t.every((e) => typeof e == "string") ? t : void 0;
	} catch {
		return;
	}
}, m = (e, t) => {
	e.setAttribute("data-item-kind", t.kind), e.setAttribute("data-item-id", t.id);
	let n = f(t.parent);
	n ? e.setAttribute("data-item-parent", n) : e.removeAttribute("data-item-parent");
}, h = (e) => e?.closest("[data-item-id]")?.getAttribute("data-item-id") ?? "", g = (e) => {
	let t = e?.closest("[data-item-kind][data-item-id]");
	if (!t) return null;
	let n = t.getAttribute("data-item-kind"), r = t.getAttribute("data-item-id");
	if (!n || !r) return null;
	let i = p(t.getAttribute("data-item-parent"));
	return i ? {
		kind: n,
		id: r,
		parent: i
	} : {
		kind: n,
		id: r
	};
}, _ = (e, t, n) => {
	let r = document.createElement(e);
	return t && (r.className = t), n != null && (r.textContent = n), r;
}, v = (e) => e("top")?.parentElement ?? e("stage")?.closest(".shell") ?? null, y = (e, t) => (e || t).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || t, b = (e) => /^(#{1,6})\s+(.+)$/.exec(e.trim()), x = (e) => /^\s*[-+*]\s+(.+)$/.exec(e), S = (e) => /^\s*\d+[.)]\s+(.+)$/.exec(e), C = (e) => /^\s*>\s?(.*)$/.exec(e), w = (e) => /^\s*```\s*([\w-]*)\s*$/.exec(e), T = (e) => /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(e), E = (e) => !e.trim() || !!b(e) || !!x(e) || !!S(e) || !!C(e) || !!w(e) || T(e);
function D(e) {
	let t = e.replace(/\r\n?/g, "\n").split("\n"), n = [], r = 0;
	for (; r < t.length;) {
		let e = t[r];
		if (!e.trim()) {
			r += 1;
			continue;
		}
		let i = w(e);
		if (i) {
			let e = [];
			for (r += 1; r < t.length && !w(t[r]);) e.push(t[r++]);
			r < t.length && (r += 1), n.push({
				kind: "code",
				text: e.join("\n"),
				language: i[1] || void 0
			});
			continue;
		}
		let a = b(e);
		if (a) {
			n.push({
				kind: "heading",
				level: a[1].length,
				text: a[2]
			}), r += 1;
			continue;
		}
		if (T(e)) {
			n.push({ kind: "rule" }), r += 1;
			continue;
		}
		if (C(e)) {
			let e = [];
			for (; r < t.length;) {
				let n = C(t[r]);
				if (!n) break;
				e.push(n[1]), r += 1;
			}
			n.push({
				kind: "quote",
				text: e.join(" ")
			});
			continue;
		}
		if (x(e)) {
			let e = [];
			for (; r < t.length;) {
				let n = x(t[r]);
				if (!n) break;
				e.push(n[1]), r += 1;
			}
			n.push({
				kind: "unordered-list",
				items: e
			});
			continue;
		}
		if (S(e)) {
			let e = [];
			for (; r < t.length;) {
				let n = S(t[r]);
				if (!n) break;
				e.push(n[1]), r += 1;
			}
			n.push({
				kind: "ordered-list",
				items: e
			});
			continue;
		}
		let o = [];
		for (; r < t.length && !E(t[r]);) o.push(t[r++].trim());
		o.length && n.push({
			kind: "paragraph",
			text: o.join(" ")
		});
	}
	return n;
}
var O = (e) => e.replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/(`|\*\*|__|~~|\*|_)/g, "").trim();
function k() {
	let e = [], t = (t) => {
		let n = e;
		return e = t.flatMap((e) => {
			try {
				let t = typeof e.pattern == "string" ? new RegExp(e.pattern, "g") : new RegExp(e.pattern.source, "g");
				return /^(https?:|mailto:)/i.test(e.url) ? [{
					pattern: t,
					url: e.url
				}] : [];
			} catch {
				return [];
			}
		}), () => {
			e = n;
		};
	}, n = /\bhttps?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/g, r = (e) => {
		try {
			let t = new URL(e), n = t.pathname === "/" ? "" : t.pathname, r = `${t.host.replace(/^www\./, "")}${n}`;
			return r.length > 48 ? `${r.slice(0, 47)}…` : r;
		} catch {
			return e;
		}
	}, i = (e, t, n) => u("a", {
		text: e,
		href: t,
		class: n,
		rel: "noopener noreferrer",
		target: "_blank",
		title: t
	}), a = (t, a) => {
		let o = [];
		for (let e of a.matchAll(n)) o.push({
			index: e.index ?? 0,
			length: e[0].length,
			node: () => i(r(e[0]), e[0], "md-url")
		});
		e.forEach((e) => {
			for (let t of a.matchAll(e.pattern)) {
				let n = e.url.replace(/\$(\d)/g, (e, n) => encodeURIComponent(t[Number(n)] ?? ""));
				o.push({
					index: t.index ?? 0,
					length: t[0].length,
					node: () => i(t[0], n, "md-autolink")
				});
			}
		}), o.sort((e, t) => e.index - t.index);
		let s = 0;
		o.forEach((e) => {
			e.index < s || (e.index > s && t.appendChild(document.createTextNode(a.slice(s, e.index))), t.appendChild(e.node()), s = e.index + e.length);
		}), s < a.length && t.appendChild(document.createTextNode(a.slice(s)));
	}, o = (e, t) => {
		let n = /(\[[^\]]+\]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\*[^*]+\*|_[^_]+_)/g, r = 0;
		for (let i of t.matchAll(n)) {
			let n = i[0], o = i.index ?? 0;
			o > r && a(e, t.slice(r, o));
			let s = n.startsWith("**") || n.startsWith("__") ? ["strong", 2] : n.startsWith("`") ? ["code", 1] : n.startsWith("~~") ? ["del", 2] : n.startsWith("*") || n.startsWith("_") ? ["em", 1] : null;
			if (s) {
				let [t, r] = s;
				e.appendChild(u(t, { text: n.slice(r, -r) }));
			} else {
				let [, t, r] = n.match(/^\[([^\]]+)\]\(([^)]+)\)$/) ?? [];
				e.appendChild(u("a", {
					text: t ?? n,
					href: r && /^(https?:|mailto:|#|\/)/i.test(r) ? r : "#",
					rel: "noopener noreferrer",
					target: "_blank"
				}));
			}
			r = o + n.length;
		}
		r < t.length && a(e, t.slice(r));
	};
	function s(e) {
		let t = document.createDocumentFragment();
		return D(e).forEach((e) => {
			if (e.kind === "rule") {
				t.append(u("hr"));
				return;
			}
			if (e.kind === "code") {
				t.append(u("pre", [u("code", {
					text: e.text,
					data: { language: e.language }
				})]));
				return;
			}
			if (e.kind === "unordered-list" || e.kind === "ordered-list") {
				t.append(u(e.kind === "ordered-list" ? "ol" : "ul", e.items.map((e) => {
					let t = /^\[( |x|X)\]\s+(.*)$/.exec(e), n = u(t ? "li.md-task" : "li");
					if (!t) return o(n, e), n;
					let r = t[1] !== " ";
					n.classList.toggle("md-task-done", r);
					let i = u("span.md-task-text");
					return o(i, t[2]), n.append(u("input", {
						type: "checkbox",
						checked: r,
						disabled: !0,
						"aria-label": r ? "Done" : "Not done"
					}), i), n;
				})));
				return;
			}
			if (e.kind === "heading") {
				let n = u(`h${e.level}`);
				o(n, e.text), t.append(n);
				return;
			}
			let n = u(e.kind === "quote" ? "blockquote" : "p");
			o(n, e.text), t.append(n);
		}), t;
	}
	return {
		renderMarkdown: s,
		setAutolinks: t
	};
}
var { renderMarkdown: A, setAutolinks: j } = k(), M = (e) => /^(\s*)[-+*]\s+(.+)$/.exec(e), N = (e) => /^(\s*)\d+[.)]\s+(.+)$/.exec(e);
function P(e) {
	let t = e.replace(/\r\n?/g, "\n").split("\n"), n = [], r = null, i = null, a = [], o = [], s = 0, c = () => {
		o.length && i && i.description === void 0 && (i.description = o.join(" ")), o = [];
	}, l = (e, t) => {
		for (r || (r = {
			kind: "items",
			items: []
		}, n.push(r)); a.length && a[a.length - 1].indent >= e;) a.pop();
		let o = {
			text: t,
			children: []
		};
		a.length ? a[a.length - 1].item.children.push(o) : r.items.push(o), a.push({
			indent: e,
			item: o
		}), i = o;
	};
	for (; s < t.length;) {
		let e = t[s];
		if (w(e)) {
			for (c(), s += 1; s < t.length && !w(t[s]);) s += 1;
			s < t.length && (s += 1);
			continue;
		}
		if (!e.trim()) {
			c(), s += 1;
			continue;
		}
		let u = b(e);
		if (u) {
			c();
			let e = {
				kind: "heading",
				level: u[1].length,
				text: u[2],
				items: []
			};
			n.push(e), r = e, a = [], i = e, s += 1;
			continue;
		}
		if (T(e) || C(e)) {
			c(), s += 1;
			continue;
		}
		let d = M(e) ?? N(e);
		if (d) {
			c(), l(d[1].replace(/\t/g, "  ").length, d[2].trim()), s += 1;
			continue;
		}
		o.push(e.trim()), s += 1;
	}
	return c(), n;
}
//#endregion
//#region canvas/model/component-registry.ts
function F() {
	let e = () => ({
		columns: [],
		rows: [],
		healthy: !0,
		loading: !0
	}), t = /* @__PURE__ */ new Map(), n = /* @__PURE__ */ new Map(), r = /* @__PURE__ */ new Map(), i = (e, n) => (t.set(e, n), () => {
		t.get(e) === n && t.delete(e);
	}), a = (e) => t.get(e), o = (t) => n.get(t) ?? e(), s = (e, t) => {
		let i = {
			...o(e),
			...t
		};
		n.set(e, i);
		let a = (r.get(e) ?? 0) + 1;
		return r.set(e, a), a;
	}, c = (e, t, n) => {
		let r = o(e), i = [...r.rows, ...t];
		return s(e, {
			rows: i.length > 500 ? i.slice(i.length - 500) : i,
			lastId: n ?? r.lastId,
			loading: !1,
			healthy: !0
		});
	}, l = (e) => r.get(e) ?? 0, u = (e) => {
		n.delete(e), r.delete(e);
	}, d = () => {
		t.clear(), n.clear(), r.clear();
	}, f = () => void 0, p = (e) => {
		let t = f;
		return f = e, () => {
			f = t;
		};
	}, m = (e) => f(e), h = () => ({}), g = (e) => {
		let t = h;
		return h = e, () => {
			h = t;
		};
	}, _ = () => h(), v = () => void 0, y = (e) => {
		let t = v;
		return v = e, () => {
			v = t;
		};
	}, b = (e) => v(e), x = () => void 0, S = (e) => {
		let t = x;
		return x = e, () => {
			x = t;
		};
	}, C = (e) => x(e);
	return {
		emptyComponentData: e,
		registerComponentBody: i,
		componentBody: a,
		componentData: o,
		setComponentData: s,
		MAX_LIVE_ROWS: 500,
		appendComponentRows: c,
		componentVersion: l,
		clearComponentData: u,
		resetComponentRegistry: d,
		setComponentBindingReader: p,
		componentBinding: m,
		setVariableReader: g,
		boardVariables: _,
		setSavedRequestReader: y,
		savedRequestReader: b,
		setComponentDefReader: S,
		componentDef: C,
		isRunComponent: (e) => !!C(e)?.capabilities.includes("run")
	};
}
var I = F(), { emptyComponentData: ee, registerComponentBody: te, componentBody: ne, componentData: re, setComponentData: ie, MAX_LIVE_ROWS: ae, appendComponentRows: oe, componentVersion: se, clearComponentData: ce, resetComponentRegistry: le, setComponentBindingReader: ue, componentBinding: de, setVariableReader: fe, boardVariables: pe, setSavedRequestReader: me, savedRequestReader: he, setComponentDefReader: ge, componentDef: _e, isRunComponent: ve } = I;
//#endregion
//#region canvas/model/contracts.ts
function ye() {
	let e = [], t = {}, n = (t) => {
		e = [...t];
	}, r = () => e, i = () => {
		e = [], t = {};
	}, a = (e) => {
		t = { ...e };
	}, o = (e) => t[e], s = (t, n = e) => n.filter((e) => e.appliesTo !== "both" && e.appliesTo !== t.kind ? !1 : e.when ? t.kind === "node" ? !e.when.nodeType || e.when.nodeType.includes(t.nodeType ?? "") : !e.when.edgeKind || e.when.edgeKind.includes(t.edgeKind ?? "plain") : !0), c = (e, t) => e?.Contract?.[t] ?? "", l = (e, t) => {
		let n = c(t, e.id);
		return n ? e.default && n === e.default ? "default" : "stated" : "blank";
	}, u = (e, t) => !!e.requiredWhen?.some((e) => c(t, e.slot) === e.equals), d = (e, t, n) => {
		let r = { ...e?.Contract ?? {} };
		return n ? r[t] = n : delete r[t], { Contract: r };
	}, f = /^[a-z][a-z0-9.-]{0,31}$/;
	return {
		setContractSlots: n,
		contractSlots: r,
		resetContractSlots: i,
		setTitleRoles: a,
		titleRole: o,
		slotsFor: s,
		slotValue: c,
		slotState: l,
		slotRequired: u,
		contractPatch: d,
		sanitizeContract: (e) => {
			if (!e || typeof e != "object" || Array.isArray(e)) return;
			let t = {}, n = 0;
			for (let [r, i] of Object.entries(e)) {
				if (n >= 24) break;
				!f.test(r) || typeof i != "string" || !i || (t[r] = i.slice(0, 200), n += 1);
			}
			return n ? t : void 0;
		},
		contractProperties: (t, n = e) => s(t, n).map((e) => ({
			id: `contract.${e.id}`,
			label: e.label,
			input: e.kind === "choice" ? "segments" : e.kind === "number" ? "number" : "text",
			group: "Contract",
			placeholder: e.hint,
			options: e.kind === "choice" ? [{
				value: "",
				label: "—"
			}, ...e.options ?? []] : void 0,
			value: (t) => c(t, e.id),
			patch: (t, n) => d(t, e.id, String(n ?? ""))
		}))
	};
}
var be = ye(), { setContractSlots: xe, contractSlots: Se, resetContractSlots: Ce, setTitleRoles: we, titleRole: Te, slotsFor: Ee, slotValue: De, slotState: Oe, slotRequired: ke, contractPatch: Ae, sanitizeContract: je, contractProperties: Me } = be;
//#endregion
//#region canvas/core/affordances.ts
function Ne(e) {
	let t = /* @__PURE__ */ new Map(), n = [], r = (e) => !0, i = (e) => !0;
	return {
		filterSystem(t) {
			r = t, e.emit("affordance.contributed", { surface: "top" });
		},
		filterPanels(t) {
			i = t, e.emit("affordance.contributed", { surface: "top" });
		},
		contribute(n) {
			let r = t.get(n.surface) ?? [];
			r.push(n), t.set(n.surface, r), e.emit("affordance.contributed", { surface: n.surface });
		},
		declarePanel(t) {
			n.push(t), e.emit("affordance.contributed", { surface: "top" });
		},
		panels() {
			return n.filter(i).sort((e, t) => (e.order ?? 0) - (t.order ?? 0));
		},
		system(e) {
			return (t.get(e) ?? []).filter(r).sort((e, t) => (e.order ?? 0) - (t.order ?? 0));
		},
		entity(e, t) {
			return e.abilities.flatMap((e) => e.actions.flatMap((e) => e.ui.filter((e) => e.surface === "entity" && (t == null || e.slot === t)).map((t) => ({
				action: e,
				ui: t
			}))));
		},
		owned() {
			return [...[...t].flatMap(([e, t]) => t.map((t) => ({
				category: "affordance",
				id: `${e}:${t.command}`,
				origin: t.origin
			}))), ...n.map((e) => ({
				category: "panel",
				id: e.id,
				origin: e.origin
			}))];
		},
		unregisterOrigin(r) {
			for (let [n, i] of t) {
				let a = i.filter((e) => e.origin !== r);
				t.set(n, a), a.length !== i.length && e.emit("affordance.contributed", { surface: n });
			}
			let i = n.filter((e) => e.origin !== r);
			i.length !== n.length && (n = i, e.emit("affordance.contributed", { surface: "top" }));
		}
	};
}
//#endregion
//#region src/bus.ts
var Pe = 256;
function Fe(e) {
	let t = /* @__PURE__ */ new Map(), n = [], r = /* @__PURE__ */ new Map(), i = /* @__PURE__ */ new Set(), a = /* @__PURE__ */ new Set(), o = /* @__PURE__ */ new Map(), s = /* @__PURE__ */ new Map(), c = /* @__PURE__ */ new Map(), l = /* @__PURE__ */ new Map(), u = (e) => {
		r.set(e, (r.get(e) ?? 0) + 1), i.add(e);
	}, d = (e) => {
		let t = (r.get(e) ?? 0) - 1;
		t > 0 ? r.set(e, t) : (r.delete(e), i.delete(e));
	}, f = 0, p = null, m = (r, i) => {
		if (a.add(r), ++f > Pe) throw f--, Error(`[bus] emit depth exceeded ${Pe} at "${String(r)}" — event cycle (a handler re-emitting what triggered it?)`);
		try {
			let a = {
				name: r,
				data: i,
				at: performance.now(),
				depth: f
			}, o = n, s = t.get(r), c = () => {
				if (!p) {
					for (let e of o) e(a);
					return;
				}
				for (let e of o) try {
					e(a);
				} catch (e) {
					p(e, a);
				}
			}, l = () => {
				if (s) {
					if (!p) {
						for (let e of s) e(a.data, a);
						return;
					}
					for (let e of s) try {
						e(a.data, a);
					} catch (e) {
						p(e, a);
					}
				}
			};
			e?.enabled() ? (e.count(`Bus.emit.${String(r)}`), e.measure(`Bus.any.${String(r)}`, c), e.measure(`Bus.listeners.${String(r)}`, l)) : (c(), l());
		} finally {
			f--;
		}
	};
	return {
		on(e, n) {
			let r = !0, i = ((e, t) => n(e, t));
			return u(e), t.set(e, [...t.get(e) ?? [], i]), () => {
				if (!r) return;
				r = !1;
				let n = (t.get(e) ?? []).filter((e) => e !== i);
				n.length ? t.set(e, n) : t.delete(e), d(e);
			};
		},
		onAny(e) {
			let t = !0, r = (t) => e(t);
			return n = [...n, r], () => {
				t && (t = !1, n = n.filter((e) => e !== r));
			};
		},
		emit(e, ...t) {
			m(e, t[0]);
		},
		forward(e, t) {
			m(e, t);
		},
		_subscribed: i,
		_emitted: a,
		_subscribersOf: (e) => [...o.get(e)?.keys() ?? []],
		_emittersOf: (e) => [...c.get(e) ?? []],
		_subscriptionsOf: (e) => [...s.get(e) ?? []],
		_emissionsOf: (e) => [...l.get(e) ?? []],
		_trackSubscribe(e, t) {
			let n = o.get(e) ?? o.set(e, /* @__PURE__ */ new Map()).get(e);
			n.set(t, (n.get(t) ?? 0) + 1), (s.get(t) ?? s.set(t, /* @__PURE__ */ new Set()).get(t)).add(e);
		},
		_untrackSubscribe(e, t) {
			let n = o.get(e);
			if (!n) return;
			let r = (n.get(t) ?? 0) - 1;
			if (r > 0) {
				n.set(t, r);
				return;
			}
			n.delete(t), n.size || o.delete(e);
			let i = s.get(t);
			i?.delete(e), i && !i.size && s.delete(t);
		},
		_onHandlerError(e) {
			return p = e, () => {
				p === e && (p = null);
			};
		},
		_trackEmit(e, t) {
			(c.get(e) ?? c.set(e, /* @__PURE__ */ new Set()).get(e)).add(t), (l.get(t) ?? l.set(t, /* @__PURE__ */ new Set()).get(t)).add(e);
		}
	};
}
//#endregion
//#region src/io.ts
var Ie = () => ({
	get(e, t) {
		try {
			let n = localStorage.getItem(e);
			return n ? JSON.parse(n) : t;
		} catch {
			return t;
		}
	},
	set(e, t) {
		try {
			return localStorage.setItem(e, JSON.stringify(t)), !0;
		} catch {
			return !1;
		}
	},
	del(e) {
		try {
			localStorage.removeItem(e);
		} catch {}
	},
	keys() {
		try {
			let e = [];
			for (let t = 0; t < localStorage.length; t++) {
				let n = localStorage.key(t);
				n && e.push(n);
			}
			return e;
		} catch {
			return [];
		}
	}
}), Le = () => {
	let e = /* @__PURE__ */ new Map();
	return {
		get(t, n) {
			return e.has(t) ? e.get(t) : n;
		},
		set(t, n) {
			return e.set(t, n), !0;
		},
		del(t) {
			e.delete(t);
		},
		keys: () => [...e.keys()]
	};
};
//#endregion
//#region src/registry.ts
function Re(e) {
	let t = /* @__PURE__ */ new Map();
	return {
		get: (e) => t.get(e),
		has: (e) => t.has(e),
		set(n, r) {
			if (t.has(n) && t.get(n) !== r && e) throw e(n);
			return t.set(n, r), () => {
				t.get(n) === r && t.delete(n);
			};
		},
		values: () => [...t.values()],
		entries: () => [...t.entries()]
	};
}
//#endregion
//#region src/geometry.ts
var ze = (e, t = {
	w: 0,
	h: 0
}) => {
	if (!e.Position) return null;
	let n = e.Size ?? t;
	return {
		x: e.Position.x - n.w / 2,
		y: e.Position.y - n.h / 2,
		w: n.w,
		h: n.h
	};
}, Be = (e, t) => {
	let n = Math.min(e.x, t.x), r = Math.min(e.y, t.y), i = Math.max(e.x + e.w, t.x + t.w), a = Math.max(e.y + e.h, t.y + t.h);
	return {
		x: n,
		y: r,
		w: i - n,
		h: a - r
	};
}, Ve = (e, t, n = 0) => ({
	x: e.x - t,
	y: e.y - t - n,
	w: e.w + t * 2,
	h: e.h + t * 2 + n
}), He = (e, t, n = 0) => e.x < t.x + t.w + n && e.x + e.w + n > t.x && e.y < t.y + t.h + n && e.y + e.h + n > t.y, Ue = (e, t) => {
	let n = Math.floor(e.x / t), r = Math.floor((e.x + e.w) / t), i = Math.floor(e.y / t), a = Math.floor((e.y + e.h) / t), o = [];
	for (let e = n; e <= r; e++) for (let t = i; t <= a; t++) o.push(`${e}:${t}`);
	return o;
}, We = (e, t) => {
	Ue(t.rect, e.cellSize).forEach((n) => (e.cells.get(n) ?? e.cells.set(n, /* @__PURE__ */ new Set()).get(n)).add(t));
}, Ge = (e, t = 256) => {
	let n = {
		cellSize: t,
		cells: /* @__PURE__ */ new Map()
	};
	return e.forEach((e) => We(n, e)), n;
}, Ke = (e, t, n = 0) => {
	let r = Ve(t, n), i = /* @__PURE__ */ new Set();
	return Ue(r, e.cellSize).forEach((t) => e.cells.get(t)?.forEach((e) => i.add(e))), [...i].filter((e) => He(e.rect, r));
}, qe = (e) => ({
	x: e.x + e.w / 2,
	y: e.y + e.h / 2
}), Je = (e, t, n) => {
	let { x: r, y: i } = t, a = e.x - r, o = e.y - i;
	if (a === 0 && o === 0) return {
		x: r,
		y: i
	};
	let s = a === 0 ? Infinity : Math.abs(n.w / a), c = o === 0 ? Infinity : Math.abs(n.h / o), l = Math.min(s, c);
	return {
		x: r + a * l,
		y: i + o * l
	};
}, Ye = (e, t) => {
	let n = (e, n) => e >= t.x && e <= t.x + t.w && n >= t.y && n <= t.y + t.h;
	if (n(e.ax, e.ay) || n(e.bx, e.by)) return !0;
	let r = (t, n, r, i) => {
		let a = (e.bx - e.ax) * (i - n) - (e.by - e.ay) * (r - t);
		if (!a) return !1;
		let o = ((t - e.ax) * (i - n) - (n - e.ay) * (r - t)) / a, s = ((t - e.ax) * (e.by - e.ay) - (n - e.ay) * (e.bx - e.ax)) / a;
		return o >= 0 && o <= 1 && s >= 0 && s <= 1;
	};
	return r(t.x, t.y, t.x + t.w, t.y) || r(t.x, t.y + t.h, t.x + t.w, t.y + t.h) || r(t.x, t.y, t.x, t.y + t.h) || r(t.x + t.w, t.y, t.x + t.w, t.y + t.h);
};
//#endregion
//#region src/flags.ts
function Xe(e = () => {}, t = {}, n = {}) {
	let r = n.io?.get(n.key ?? "flags", {}) ?? {}, i = {
		...t,
		...r
	}, a = /* @__PURE__ */ new Map(), o = /* @__PURE__ */ new Map();
	return {
		all: () => ({ ...i }),
		isOn: (e) => i[e] !== !1,
		declare(e, t = !0, n, r) {
			e in i || (i[e] = t), n?.length && a.set(e, [...n]), r && o.set(e, r);
		},
		set(t, n) {
			i[t] = n, e();
		},
		declared: (e) => e == null ? Object.keys(i) : Object.keys(i).filter((t) => o.get(t) === e),
		kind: (e) => o.get(e),
		requires: (e) => a.get(e) ?? []
	};
}
//#endregion
//#region src/plugins.ts
function Ze(e, t = "system") {
	let n = Re(), r = /* @__PURE__ */ new Map(), i = (e, i, a = {}) => {
		if (r.has(e)) throw Error(`Plugin already running: ${e}`);
		n.set(e, {
			name: e,
			setup: i,
			requires: a.requires ?? [],
			kind: a.kind ?? t
		});
	}, a = (t, n, r) => {
		let i, a = !1;
		for (let e of [...r].reverse()) try {
			e();
		} catch (e) {
			a = !0, i = e;
		}
		try {
			e.teardown?.(t, n);
		} catch (e) {
			a = !0, i = e;
		}
		if (a) throw i;
	};
	return Object.assign(i, {
		start(t) {
			for (let i of n.values()) {
				let n = e.flags(t);
				n.declare(i.name, !0, i.requires, i.kind);
				let o = r.get(i.name);
				if (o && o.host !== t) throw Error("A plugin registry belongs to one active host");
				if (!n.isOn(i.name) || o) continue;
				let s = [];
				r.set(i.name, {
					host: t,
					disposers: s
				});
				try {
					let n = e.scope(t, i.name, s), r = e.setup ? e.setup(t, i.name, i.setup, n) : i.setup(n);
					r && s.push(r);
				} catch (e) {
					r.delete(i.name);
					try {
						a(t, i.name, s);
					} catch {}
					throw e;
				}
			}
		},
		stop(e, t) {
			let n = r.get(t);
			if (n && n.host !== e) throw Error("Cannot stop another host’s plugin");
			r.delete(t), a(e, t, n?.disposers ?? []);
		},
		names: () => n.values().map((e) => e.name),
		enabledNames: (e) => n.values().map((e) => e.name).filter((t) => e.isOn(t)),
		requires: (e) => n.get(e)?.requires ?? [],
		setRequires(e, t) {
			let r = n.get(e);
			r && (r.requires = t);
		},
		kindOf: (e) => n.get(e)?.kind
	});
}
//#endregion
//#region src/scope.ts
function Qe(e, t, n, r) {
	let i = e, a = {
		on: (a, o) => {
			let s = e.on(a, ((e, n) => r?.enabled() ? r.measure(`Bus.listener.${t}.${String(a)}`, () => o(e, n)) : o(e, n)));
			i._trackSubscribe?.(a, t);
			let c = !0, l = () => {
				c && (c = !1, s(), i._untrackSubscribe?.(a, t));
			};
			return n.push(l), l;
		},
		onAny(t) {
			let r = e.onAny(t);
			return n.push(r), r;
		},
		emit: ((n, ...r) => (i._trackEmit?.(n, t), e.emit(n, ...r))),
		forward: (n, r) => (i._trackEmit?.(n, t), e.forward(n, r))
	}, o = a;
	return o._subscribersOf = i._subscribersOf, o._emittersOf = i._emittersOf, o._subscriptionsOf = i._subscriptionsOf, o._emissionsOf = i._emissionsOf, o._subscribed = e._subscribed, o._emitted = e._emitted, a._onHandlerError = (e) => {
		let t = i._onHandlerError?.(e) ?? (() => {});
		return n.push(t), t;
	}, a;
}
//#endregion
//#region src/endpoint.ts
function $e(e, t, n) {
	let r = !1, i = (t) => {
		try {
			if (typeof t.data != "string") throw TypeError("Expected a JSON text frame");
			let r = e.receive.parse(JSON.parse(t.data));
			n.message(r);
		} catch (e) {
			n.error(e);
		}
	}, a = (e) => n.error(e);
	return t.addEventListener("message", i), t.addEventListener("error", a), {
		send(n) {
			if (r || t.readyState !== 1) throw Error("Endpoint is not open");
			t.send(JSON.stringify(e.send.parse(n)));
		},
		close() {
			r || (r = !0, t.removeEventListener("message", i), t.removeEventListener("error", a), t.close());
		}
	};
}
//#endregion
//#region canvas/core/bus.ts
var et = (e) => Fe(e), tt = (e, t) => typeof e == "function" ? e(t) : e ?? [], L = {
	shortcuts: "frontend.shortcuts",
	flags: "frontend.flags",
	disabledCommands: "frontend.commands.disabled",
	graphs: "frontend.graphs",
	graphsBackup: "frontend.graphs.backup",
	telemetry: "frontend.telemetry.spans",
	telemetryConfig: "frontend.telemetry.config"
}, nt = (e) => {
	let t = e.split("+").map((e) => e.trim()).filter(Boolean), n = {
		key: "",
		ctrl: !1,
		shift: !1,
		alt: !1,
		meta: !1
	}, r = t.pop() ?? "";
	n.key = r.toLowerCase() === "esc" ? "Escape" : r;
	for (let e of t) {
		let t = e.toLowerCase();
		t === "ctrl" || t === "control" ? n.ctrl = !0 : t === "shift" ? n.shift = !0 : t === "alt" || t === "option" ? n.alt = !0 : (t === "meta" || t === "cmd" || t === "command") && (n.meta = !0);
	}
	return n;
}, rt = (e) => [
	e.ctrl ? "Ctrl" : null,
	e.meta ? "Cmd" : null,
	e.alt ? "Alt" : null,
	e.shift ? "Shift" : null,
	e.key
].filter(Boolean).join("+"), it = (e) => e.shortcut ?? (e.input?.key ? rt(e.input) : ""), at = (e, t) => {
	let n = e.get(t);
	return n ? it(n) : null;
}, ot = (e, t) => {
	if (!(e instanceof KeyboardEvent) || e.ctrlKey !== t.ctrl || e.altKey !== t.alt || e.metaKey !== t.meta) return !1;
	let n = /^[a-z]$/i.test(t.key), r = t.key.length > 1;
	return n && e.shiftKey !== t.shift || r && e.shiftKey !== t.shift || !n && t.shift && !e.shiftKey ? !1 : e.key.toLowerCase() === t.key.toLowerCase();
}, st = (e) => ({
	key: e.key ?? "",
	ctrl: !!e.ctrl,
	shift: !!e.shift,
	alt: !!e.alt,
	meta: !!e.meta
}), ct = new Set([
	"click",
	"contextmenu",
	"pointerdown",
	"pointermove",
	"pointerup",
	"wheel"
]), lt = (e) => e ? /^(input|textarea|select)$/i.test(e.tagName) || e.closest?.(".monaco-editor") ? !0 : e instanceof HTMLElement ? e.isContentEditable || e.contentEditable === "true" || e.contentEditable === "plaintext-only" : !1 : !1, ut = (e, t = !1) => t || lt(e) || lt(typeof document > "u" ? null : document.activeElement), dt = (e) => e ? e instanceof KeyboardEvent ? "keyboard" : ct.has(e.type) ? "pointer" : "programmatic" : "programmatic";
function ft(e, t, n) {
	let r = /* @__PURE__ */ new Map(), i = n.get(L.shortcuts, {}), a = new Set(n.get(L.disabledCommands, [])), o, s = !0, c = null, l = /* @__PURE__ */ new Map(), u = /* @__PURE__ */ new Map(), d = () => {
		c = null, l.clear();
	};
	e.on("flag.changed", d);
	let f = (e) => e.enabled !== !1 && !a.has(e.id) && t(e.origin), p = (e) => {
		let t = nt(e);
		return [
			t.ctrl && "ctrl",
			t.meta && "meta",
			t.alt && "alt",
			t.shift && "shift",
			t.key.toLowerCase()
		].filter(Boolean).join("+");
	}, m = (e, t) => {
		let n = p(t);
		if (!(!n.endsWith("+") && !nt(t).key)) return [...r.values()].find((t) => t.id !== e && f(t) && p(it(t)) === n);
	}, h = (e, t) => {
		if (e.shortcut = t, e.input?.on === "keydown") {
			let n = nt(t);
			e.input.key = n.key, e.input.ctrl = n.ctrl, e.input.shift = n.shift, e.input.alt = n.alt, e.input.meta = n.meta;
		}
	}, g = (e) => {
		let t = i[e.id];
		t != null && h(e, t);
		let n = o === !1 ? !1 : o?.[e.id];
		n === !1 || n === void 0 && !s ? (e.shortcut = "", e.input?.on === "keydown" && (e.input = void 0)) : typeof n == "string" && (e.input = {
			...e.input,
			on: "keydown",
			prevent: !0
		}, h(e, n));
	};
	return {
		configureHotkeys(e, t = !0) {
			o = e, s = t && e !== !1, r.forEach(g), d();
		},
		register: (e, t) => {
			e.forEach((e) => {
				let n = {
					...e,
					...e.input ? { input: { ...e.input } } : {}
				};
				n.event ||= n.id, t && !n.origin && (n.origin = t), g(n), r.set(n.id, n);
			}), d();
		},
		unregister(e) {
			r.delete(e), d();
		},
		unregisterOrigin(e) {
			for (let [t, n] of r) n.origin === e && r.delete(t);
			u.delete(e), d();
		},
		registerGuard(e, t) {
			return u.set(e, t), () => {
				u.get(e) === t && u.delete(e);
			};
		},
		get: (e) => r.get(e),
		all: () => [...r.values()],
		userVisible: () => [...r.values()].filter((e) => !e.hidden),
		bindings: () => [...r.values()].filter((e) => e.hidden && !!e.input),
		enabled: () => c ??= [...r.values()].filter(f),
		enabledForInput(e) {
			let t = l.get(e);
			return t || (t = (c ??= [...r.values()].filter(f)).filter((t) => t.input?.on === e).map((e, t) => ({
				command: e,
				index: t
			})).sort((e, t) => (e.command.input.priority ?? 0) - (t.command.input.priority ?? 0) || e.index - t.index).map((e) => e.command), l.set(e, t)), t;
		},
		isEnabled: f,
		shortcutConflict: m,
		setShortcut(t, n) {
			let a = r.get(t);
			if (!a) return !1;
			let o = n.trim();
			return m(t, o) ? !1 : (h(a, o), i[t] = o, d(), e.emit("command.shortcut.changed", {
				id: t,
				shortcut: o
			}), !0);
		},
		setEnabled(t, n) {
			return r.get(t) ? (n ? a.delete(t) : a.add(t), e.emit("command.enabled.changed", {
				id: t,
				enabled: n
			}), d(), !0) : !1;
		},
		run: (t, n = {}) => {
			let i = typeof t == "string" ? t : t.kind === "command" ? t.action : "";
			if (typeof t != "string") {
				if (t.kind === "query") return !1;
				n = t.source ?? {};
			}
			let a = r.get(i);
			if (!a) return e.emit("command.missing", {
				id: i,
				origin: n.origin ?? "programmatic"
			}), !1;
			if (!f(a) || a.available?.(n) === !1) return !1;
			let o = n.origin ? n : {
				...n,
				origin: dt(n.event)
			};
			for (let t of u.values()) {
				let n = t(a, o);
				if (n !== !0) return n && e.emit("app.notice", {
					message: n,
					level: "warn"
				}), !1;
			}
			let s = a.payload?.(o);
			return a.picker ? (e.emit("commandPicker.open", {
				commandId: i,
				source: o
			}), !0) : a.form && (a.form.shouldOpen?.(s, o) ?? !0) ? (e.emit("commandForm.open", {
				commandId: i,
				seed: a.form.seed?.(s, o) ?? {}
			}), !0) : (e.forward(a.event, s), !0);
		}
	};
}
function pt(t, n, r, i, a = () => !1) {
	let o = new Set([
		"wheel",
		"pointermove",
		"click"
	]);
	return { start(s = document) {
		let c = s instanceof HTMLElement ? s.getAttribute("tabindex") : null;
		s instanceof HTMLElement && c === null && (s.tabIndex = -1);
		let l = (e) => {
			if (!(s instanceof HTMLElement) || !(e.target instanceof Element)) return;
			let t = e.target.closest("input, textarea, select, button, a[href], [contenteditable], [tabindex]");
			(t && s.contains(t) && typeof t.focus == "function" ? t : s).focus({ preventScroll: !0 });
		};
		s.addEventListener("pointerdown", l, !0);
		let u = () => {
			let e = (s instanceof Document, s).querySelector("[data-place=\"modal\"]");
			return e?.querySelector(".modal-layer") ? e : null;
		}, d = (e, t) => !!t && !!e && t.contains(e), f = (e) => {
			let r = e.target instanceof Element ? e.target : null, o = n?.beginInput(e.type, e, r), s = [], c = [], l = (r, a) => {
				c.push(r), i && i.commands++;
				let o = () => t.run(r, {
					event: e,
					target: a
				});
				return n?.enabled() ? n.measure(`Command.run.${r}`, o) : o();
			};
			try {
				let n = e instanceof KeyboardEvent && ut(r, a()), i = u(), o = d(r, i), c = e.type === "click" ? r?.closest("[data-command]") : null;
				if (c instanceof HTMLElement) {
					if (i && !i.contains(c)) return;
					let t = c.dataset.command;
					s.push(t), e.preventDefault(), l(t, c);
					return;
				}
				let f = t.enabledForInput(e.type);
				s.push(...f.map((e) => e.id));
				for (let t of f) {
					let a = t.input;
					if (!a || a.on !== e.type || e instanceof KeyboardEvent && (!a.key || !ot(e, st(a)))) continue;
					let s = r && a.selector ? r.closest(a.selector) : r;
					if (!(s instanceof Element) || a.selector && !s || n && !a.global && !a.selector || i && !a.global && !o || a.when && !a.when(e, s)) continue;
					a.prevent && e.preventDefault();
					let c = l(t.id, s);
					if (a.stop && c !== !1) break;
				}
			} finally {
				o?.end({
					candidates: s,
					matched: c
				});
			}
		}, p = /* @__PURE__ */ new Map(), m = () => {
			p.forEach((e) => f(e)), p.clear();
		}, h = `[data-place="${e.Stage}"]`, g = (e) => {
			if (i && i.events++, r && o.has(e.type)) {
				if (e.type === "wheel") {
					let t = e.target instanceof Element ? e.target : null;
					t?.closest(h) && !t.closest("[data-native-scroll]") && e.preventDefault();
				}
				if ((e.type === "click" || e.type === "dblclick") && (e.target instanceof Element ? e.target : null)?.closest("[data-command]")) {
					f(e);
					return;
				}
				p.set(e.type, e), r.schedule("input.batch", m, 0);
				return;
			}
			f(e);
		}, _ = [
			"click",
			"dblclick",
			"contextmenu",
			"keydown",
			"pointerdown",
			"pointermove",
			"pointerup",
			"wheel",
			"input",
			"change",
			"focusout",
			"paste"
		];
		return _.forEach((e) => s.addEventListener(e, g, e === "wheel" ? { passive: !1 } : void 0)), () => {
			_.forEach((e) => s.removeEventListener(e, g)), s.removeEventListener("pointerdown", l, !0), s instanceof HTMLElement && c === null && s.removeAttribute("tabindex");
		};
	} };
}
//#endregion
//#region canvas/core/item-ref.ts
var mt = (e) => JSON.stringify([
	e.parent ?? [],
	e.kind,
	e.id
]), R = (e) => `${e.kind}:${e.id}`, z = (e, t) => e === t || !!e && !!t && mt(e) === mt(t), B = (e) => ({
	kind: "node",
	id: e
}), ht = (e) => ({
	kind: "edge",
	id: e
}), gt = (e, t) => {
	let n = t.trim().toLowerCase();
	return !n || e.toLowerCase().includes(n);
};
//#endregion
//#region canvas/core/decorations.ts
function _t(e) {
	let t = /* @__PURE__ */ new Map(), n = /* @__PURE__ */ new Map(), r = (t, n, r) => e.emit("decoration.changed", {
		facet: t,
		source: n,
		refs: r
	}), i = (e, t) => R(e) === R(t), a = (e) => [...t.values()].flat().filter((t) => i(t.ref, e)), o = (e, t) => {
		let n = !1;
		for (let [r, a] of e) {
			let o = a.filter((e) => !i(e.ref, t));
			o.length !== a.length && (n = !0, o.length ? e.set(r, o) : e.delete(r));
		}
		return n;
	}, s = (e) => {
		o(t, e) && r("modes", void 0, [e]), o(n, e) && r("overlays", void 0, [e]);
	}, c = {
		set(e, n, i, a = n) {
			let o = t.get(e)?.map((e) => e.ref) ?? [];
			!i.length && !o.length || (i.length ? t.set(e, i.map((t) => ({
				source: e,
				mode: n,
				ref: t,
				className: a
			}))) : t.delete(e), r("modes", e, [...o, ...i]));
		},
		for: a,
		has(e, t) {
			return a(e).some((e) => e.mode === t);
		},
		all() {
			return [...t.values()].flat().sort((e, t) => mt(e.ref).localeCompare(mt(t.ref)));
		}
	};
	return e.on("graph.node.deleted", ({ id: e }) => s(B(e))), e.on("graph.edge.deleted", ({ id: e }) => s(ht(e))), {
		modes: c,
		overlays: {
			set(e, t) {
				let i = n.get(e)?.map((e) => e.ref) ?? [];
				!t.length && !i.length || (t.length ? n.set(e, t) : n.delete(e), r("overlays", e, [...i, ...t.map((e) => e.ref)]));
			},
			all() {
				return [...n.values()].flat();
			}
		},
		remove: s,
		owned: () => [...[...t].flatMap(([e, t]) => t.map((t) => ({
			category: "decoration-mode",
			id: `${t.mode}:${R(t.ref)}`,
			origin: e
		}))), ...[...n].flatMap(([e, t]) => t.map((t) => ({
			category: "decoration-overlay",
			id: `${t.id ?? t.text}:${R(t.ref)}`,
			origin: e
		})))],
		unregisterOrigin(e) {
			let i = [...t.get(e)?.map((e) => e.ref) ?? [], ...n.get(e)?.map((e) => e.ref) ?? []], a = t.delete(e), o = n.delete(e);
			a && r("modes", e, i), o && r("overlays", e, i);
		}
	};
}
//#endregion
//#region canvas/core/flags.ts
var vt = (e, t = {}, n = Ie()) => Xe(() => e.emit("flag.changed"), t, {
	io: n,
	key: L.flags
});
//#endregion
//#region canvas/core/hierarchy.ts
function yt() {
	let e = /* @__PURE__ */ new Map(), t = /* @__PURE__ */ new Map(), n = (e, t) => (e.order ?? 0) - (t.order ?? 0), r = () => [...e.values()].flatMap((e) => e()), i = (e) => {
		for (let n of t.values()) {
			let t = n.parentRefOf(e);
			if (t) return t;
		}
	}, a = (e) => {
		let t = [], n = /* @__PURE__ */ new Set(), r = i(e);
		for (; r;) {
			let e = R(r);
			if (n.has(e)) break;
			n.add(e), t.unshift(r), r = i(r);
		}
		return t;
	}, o = (e) => {
		let t = a(e);
		return t.length ? t.map((e) => e.id) : void 0;
	}, s = (e) => r().find((t) => z(t.ref, e));
	return {
		sources: { register(t, n) {
			return e.set(t, n), () => {
				e.get(t) === n && e.delete(t);
			};
		} },
		parents: { register(e, n) {
			return t.set(e, n), () => {
				t.get(e) === n && t.delete(e);
			};
		} },
		parentRefOf: i,
		parentChain: a,
		parentIds: o,
		ancestors: a,
		items: r,
		targets: r,
		get: s,
		anchor: (e) => s(e)?.anchor ?? null,
		childrenOf: (e) => r().filter((t) => {
			let n = i(t.ref);
			return !!n && z(n, e);
		}).sort(n),
		roots: () => r().filter((e) => !i(e.ref)).sort(n),
		tree: () => {
			let e = r(), t = /* @__PURE__ */ new Map(), a = [];
			for (let n of e) {
				let e = i(n.ref);
				if (e) {
					let r = R(e);
					(t.get(r) ?? t.set(r, []).get(r)).push(n);
				} else a.push(n);
			}
			let o = (e, r) => {
				let i = R(e.ref), a = r.has(i) ? [] : (t.get(i) ?? []).slice().sort(n), s = new Set(r).add(i);
				return {
					...e,
					children: a.map((e) => o(e, s))
				};
			};
			return a.sort(n).map((e) => o(e, /* @__PURE__ */ new Set()));
		},
		owned: () => [...[...e.keys()].map((e) => ({
			category: "hierarchy-source",
			id: "items",
			origin: e
		})), ...[...t.keys()].map((e) => ({
			category: "hierarchy-parent",
			id: "parents",
			origin: e
		}))],
		unregisterOrigin(n) {
			e.delete(n), t.delete(n);
		}
	};
}
function bt(e) {
	let { parents: t, parentKind: n, onChange: r } = e, i = /* @__PURE__ */ new Map(), a = (e) => {
		let r = i.get(R(e));
		return r && t.has(r) ? {
			kind: n,
			id: r
		} : void 0;
	}, o = (e, t) => {
		let r = t, a = /* @__PURE__ */ new Set();
		for (; r;) {
			let t = R(r);
			if (a.has(t)) return !1;
			if (a.add(t), z(r, e)) return !0;
			let o = i.get(t);
			r = o ? {
				kind: n,
				id: o
			} : void 0;
		}
		return !1;
	}, s = (e) => {
		let n = R(e), a = i.get(n);
		if (!a) return;
		let o = t.get(a);
		return o && (o.Children = o.Children.filter((t) => !z(t, e))), i.delete(n), r?.(a), a;
	};
	return {
		parentRefOf: a,
		isAncestorOrSelf: o,
		remove: s,
		add(e, a) {
			let c = t.get(e);
			if (!c) return "noop";
			if (o(a, {
				kind: n,
				id: e
			})) return "cycle";
			let l = i.get(R(a));
			return l === e ? "noop" : (l && s(a), c.Children.some((e) => z(e, a)) || c.Children.push(a), i.set(R(a), e), r?.(e), "ok");
		}
	};
}
//#endregion
//#region canvas/core/pointer-gesture.ts
function xt() {
	let e = {
		pointers: /* @__PURE__ */ new Set(),
		points: /* @__PURE__ */ new Map(),
		space: !1
	};
	return {
		state: e,
		down(t) {
			e.pointers.add(t.pointerId), t.pointerType === "touch" && e.points.set(t.pointerId, {
				x: t.clientX,
				y: t.clientY
			});
		},
		move(t) {
			e.points.has(t.pointerId) && e.points.set(t.pointerId, {
				x: t.clientX,
				y: t.clientY
			});
		},
		up(t) {
			e.pointers.delete(t.pointerId), e.points.delete(t.pointerId);
		},
		key(t) {
			t.code === "Space" && (e.space = t.type === "keydown");
		},
		isMoveIntent(t) {
			return t.button === 1 || t.altKey || e.space || t.pointerType === "touch" && e.pointers.size >= 2;
		},
		clear() {
			e.pointers.clear(), e.points.clear(), e.space = !1;
		}
	};
}
//#endregion
//#region canvas/core/cancellation.ts
function St(e) {
	let t = [], n = () => t.map((e, t) => ({
		handler: e,
		index: t
	})).filter(({ handler: e }) => e.active()).sort((e, t) => (t.handler.priority ?? 0) - (e.handler.priority ?? 0) || t.index - e.index);
	return e.on("app.cancel", (e) => {
		let n = e?.source === "background", r = null;
		for (let e = t.length - 1; e >= 0; e--) {
			let i = t[e];
			i.active() && (n && i.background === !1 || (!r || (i.priority ?? 0) > (r.priority ?? 0)) && (r = i));
		}
		r?.cancel();
	}), {
		register(e) {
			return t.push(e), () => {
				let n = t.indexOf(e);
				n >= 0 && t.splice(n, 1);
			};
		},
		cancelPointerModes() {
			n().filter(({ handler: e }) => e.blocksPointer).forEach(({ handler: e }) => {
				e.active() && e.cancel();
			});
		},
		unregisterOrigin(e) {
			for (let n = t.length - 1; n >= 0; n--) t[n].origin === e && t.splice(n, 1);
		},
		active: () => t.filter((e) => e.active()).map((e) => e.origin),
		all: () => t.map((e) => e.origin),
		blocksPointer: () => t.some((e) => e.blocksPointer && e.active()),
		blocksBackground: () => t.some((e) => e.background === !1 && e.active())
	};
}
//#endregion
//#region canvas/core/keyboard.ts
function Ct(e) {
	let t = null, n = /* @__PURE__ */ new WeakMap(), r = (e) => {
		e && (n.get(e)?.(), n.delete(e), e.input.remove());
	};
	return {
		active: () => t?.id ?? null,
		capture(i, a = {}) {
			r(t);
			let o = document.createElement("input");
			o.type = "text", o.autocomplete = "off", o.dataset.keyboardMode = i, o.setAttribute("aria-hidden", "true"), o.className = ["keyboard-capture", a.className].filter(Boolean).join(" "), (e ?? document.body).append(o);
			let s = {
				id: i,
				input: o,
				focus: () => o.focus({ preventScroll: !0 }),
				clear: () => {
					o.value = "";
				},
				value: () => o.value,
				stop: () => {
					t === s && (t = null), r(s);
				}
			}, c = a.onKey ? (e) => a.onKey(e, s) : null, l = a.onInput ? (e) => a.onInput(e, s) : null, u = () => {
				setTimeout(() => {
					t === s && (!e || e.contains(document.activeElement) || document.activeElement === document.body) && s.focus();
				}, 0);
			};
			return c && o.addEventListener("keydown", c), l && o.addEventListener("input", l), o.addEventListener("blur", u), n.set(s, () => {
				c && o.removeEventListener("keydown", c), l && o.removeEventListener("input", l), o.removeEventListener("blur", u);
			}), t = s, s.focus(), s;
		},
		unregisterOrigin(e) {
			t?.id === e && (r(t), t = null);
		}
	};
}
//#endregion
//#region canvas/core/interaction.ts
function wt(e, t) {
	let n = Ct(t), r = St(e), i = /* @__PURE__ */ new Map();
	return {
		keys: n,
		pointer: xt(),
		editing: {
			claim(e, t) {
				return i.set(e, t), () => {
					i.get(e) === t && i.delete(e);
				};
			},
			active: () => {
				for (let e of i.values()) if (e()) return !0;
				return !1;
			},
			owners: () => [...i].filter(([, e]) => e()).map(([e]) => e)
		},
		cancel: r,
		owned: () => [
			...n.active() ? [{
				category: "keyboard-capture",
				id: "active",
				origin: n.active()
			}] : [],
			...[...i.keys()].map((e) => ({
				category: "editing-claim",
				id: "editing",
				origin: e
			})),
			...r.all().map((e, t) => ({
				category: "cancellation",
				id: `${t}`,
				origin: e
			}))
		],
		unregisterOrigin(e) {
			n.unregisterOrigin(e), r.unregisterOrigin(e), i.delete(e);
		}
	};
}
//#endregion
//#region canvas/core/collection-commands.ts
var Tt = (e) => e.endsWith("s") ? e.slice(0, -1) : e, Et = (e) => e.kind || e.entity?.kind || Tt(e.id), Dt = (e) => {
	let t = Et(e);
	return t === "graph" ? "graph.create" : `editing.${t}.create`;
}, Ot = /^[a-z0-9]+(?:[-.][a-z0-9]+)*$/, kt = (e) => "click" in e || "dblclick" in e || "type" in e || "press" in e || "drag" in e, At = (e, t) => {
	if (!e) return [`${t} has no journey. Declare one beside it: { id, intent, steps, expect } — see core/journey.ts.`];
	let n = [], r = `${t} journey "${e.id || "(unnamed)"}"`;
	Ot.test(e.id ?? "") || n.push(`${r}: id must be kebab-case, e.g. "place-environment-switcher".`), (e.intent ?? "").trim().length < 12 && n.push(`${r}: intent must be a sentence saying what someone is trying to do, in their words.`), e.steps?.length || n.push(`${r}: steps is empty — there is nothing being claimed.`), e.expect?.length || n.push(`${r}: expect is empty — a journey with no assertion always passes.`), (e.steps ?? []).filter((e) => "arrange" in e).length && n.push(`${r}: \`arrange\` appears in steps. Arranging belongs in \`given\` — a journey that reaches into the app during the acting half can make its own assertion true without any of it being reachable.`);
	let i = (e.steps ?? []).some(kt);
	return !i && !e.headless && n.push(`${r}: steps only emit events or run commands, which proves the handler exists and not that anyone can reach it — the exact hole that hid the environment switcher. Click the affordance instead, or set \`headless\` to a sentence explaining why there is none.`), e.headless && i && n.push(`${r}: declares headless but does act through the UI — drop headless, it is now a false excuse.`), e.headless && e.headless.trim().length < 20 && n.push(`${r}: headless must argue the case in a sentence, not assert it.`), n;
}, jt = (e, t) => {
	let n = At(e, t);
	if (n.length) throw Error(n.join("\n"));
	return e;
}, Mt = (e, t) => {
	let n = Re(), r = Re(), i = Re((e) => /* @__PURE__ */ Error(`Node type "${e}" already registered`)), a = (e) => {
		let t = e.id;
		return typeof t == "string" ? t : "";
	}, o = (e) => {
		let t = e.kind ?? e.entity?.kind ?? Tt(e.id), r = e.entity, i = e.itemId ?? a, o = () => r ?? n.get(t), s = e.itemLabel ?? ((e) => o()?.labelOf(e) ?? i(e)), { entity: c, ...l } = e, u = {
			...l,
			kind: t,
			itemId: i,
			itemLabel: s,
			search: e.search ?? !0,
			order: e.order ?? "created"
		};
		return Object.defineProperty(u, "entity", {
			get: () => o(),
			enumerable: !0,
			configurable: !0
		}), u;
	}, s = (e) => n.set(e.kind, e), c = (e) => {
		let t = o(e);
		return r.set(t.id, t);
	}, l = (e) => i.set(e.id, e), u = (e) => (jt(e.journey, `node type "${e.id}"`), l(e));
	e.entities.forEach((e) => s(e)), e.collections.forEach((e) => c(e)), e.nodeTypes?.forEach(l);
	let d = (e) => {
		if (!t) return e;
		let n = e.abilities.filter((e) => t.isOn(`ability.${e.id}`));
		return n.length === e.abilities.length ? e : {
			...e,
			abilities: n
		};
	}, f = () => n.values().sort((e, t) => (e.order ?? 0) - (t.order ?? 0));
	return {
		entity(e) {
			let t = n.get(e);
			return t ? d(t) : void 0;
		},
		collection(e) {
			return r.get(e);
		},
		entities: () => f().map((e) => d(e)),
		collections: () => r.values(),
		nodeType: (e) => i.get(e),
		nodeTypes: () => i.values(),
		rawEntities: () => f(),
		registerEntity: s,
		registerCollection: c,
		registerNodeType: u
	};
}, Nt = [
	"idea",
	"todo",
	"doing",
	"blocked",
	"review",
	"done"
], Pt = {
	idea: "Idea",
	todo: "To do",
	doing: "In progress",
	blocked: "Blocked",
	review: "In review",
	done: "Done"
}, Ft = (e) => typeof e == "string" && Nt.includes(e), It = [
	"depends-on",
	"requires",
	"blocks",
	"produces",
	"derived-from",
	"uses",
	"validated-by",
	"related-to"
], Lt = {
	"depends-on": "depends on",
	requires: "requires",
	blocks: "blocks",
	produces: "produces",
	"derived-from": "derived from",
	uses: "uses",
	"validated-by": "validated by",
	"related-to": "related to"
}, Rt = ["depends-on", "requires"], zt = (e) => typeof e == "string" && It.includes(e), V = (e) => e.trim().replace(/^#+/, "").replace(/\s+/g, "-").toLowerCase().slice(0, 32), H = (e) => {
	let t = /* @__PURE__ */ new Set();
	return (e ?? []).map(V).filter((e) => !!e && !t.has(e) && (t.add(e), !0));
}, Bt = (e) => {
	let t = /^([^:]+):(-?\d+(?:\.\d+)?)$/.exec(V(e));
	if (!t) return null;
	let n = Number(t[2]);
	return Number.isFinite(n) ? {
		key: t[1],
		value: n
	} : null;
}, Vt = [
	"blue",
	"purple",
	"green",
	"orange",
	"pink",
	"red",
	"yellow",
	"gray"
], Ht = (e) => {
	let t = V(e), n = Bt(t)?.key ?? t, r = 0;
	for (let e = 0; e < n.length; e += 1) r = r * 31 + n.charCodeAt(e) | 0;
	return Vt[Math.abs(r) % Vt.length];
}, Ut = (e) => {
	if (typeof e != "object" || !e) return e;
	try {
		return typeof structuredClone == "function" ? structuredClone(e) : JSON.parse(JSON.stringify(e));
	} catch {
		return e;
	}
}, Wt = (e) => JSON.stringify(e ?? []), Gt = class {
	graph;
	id;
	kind = "node";
	visualVersion = 0;
	Label;
	Size;
	Position;
	NodeType;
	Status;
	Tags;
	Color;
	Fill;
	BorderColor;
	ToggleState;
	Description;
	LinkUrl;
	ImageSource;
	ImageAlt;
	DescriptionPlacement;
	ComputeMs;
	ExpectedRps;
	LatencyMs;
	Contract;
	Purpose;
	Assumptions;
	Limits;
	WhatThen;
	Observability;
	FailureMode;
	DataScale;
	FreshnessMs;
	constructor(e, t, n = {}) {
		this.graph = e, this.id = t, this.Label = n.Label ?? { text: t }, this.Size = n.Size ?? {
			w: 150,
			h: 64
		}, this.Position = n.Position, this.NodeType = n.NodeType ?? "text", this.Status = n.Status, this.Tags = n.Tags?.length ? H(n.Tags) : void 0, this.Color = n.Color, this.Fill = n.Fill, this.BorderColor = n.BorderColor, this.ToggleState = n.ToggleState, this.Description = n.Description ?? "", this.LinkUrl = n.LinkUrl, this.ImageSource = n.ImageSource, this.ImageAlt = n.ImageAlt, this.DescriptionPlacement = n.DescriptionPlacement, this.ComputeMs = n.ComputeMs, this.ExpectedRps = n.ExpectedRps, this.LatencyMs = n.LatencyMs, this.Contract = je(n.Contract), this.Purpose = n.Purpose, this.Assumptions = n.Assumptions, this.Limits = n.Limits, this.WhatThen = n.WhatThen, this.Observability = n.Observability, this.FailureMode = n.FailureMode, this.DataScale = n.DataScale, this.FreshnessMs = n.FreshnessMs;
	}
}, Kt = class {
	graph;
	id;
	kind = "edge";
	visualVersion = 0;
	Label;
	EdgeKind;
	Relation;
	Color;
	LatencyMs;
	ThroughputRps;
	PayloadKb;
	Contract;
	Purpose;
	Assumptions;
	Limits;
	WhatThen;
	Observability;
	FailureMode;
	DataScale;
	FreshnessMs;
	constructor(e, t, n) {
		this.graph = e, this.id = t, this.From = n.From, this.To = n.To, this.Label = n.Label, this.EdgeKind = n.EdgeKind ?? n.Label?.text, this.Relation = n.Relation, this.Color = n.Color, this.LatencyMs = n.LatencyMs, this.ThroughputRps = n.ThroughputRps, this.PayloadKb = n.PayloadKb, this.Contract = je(n.Contract), this.Purpose = n.Purpose, this.Assumptions = n.Assumptions, this.Limits = n.Limits, this.WhatThen = n.WhatThen, this.Observability = n.Observability, this.FailureMode = n.FailureMode, this.DataScale = n.DataScale, this.FreshnessMs = n.FreshnessMs;
	}
	From;
	To;
}, qt = class e {
	id;
	static new(t) {
		return new e(t);
	}
	nextNode = 1;
	nextEdge = 1;
	items = /* @__PURE__ */ new Map();
	edgeMap = /* @__PURE__ */ new Map();
	itemStores = /* @__PURE__ */ new Map();
	snapshotExtensions = /* @__PURE__ */ new Map();
	storedExtensions = {};
	nodeArr = null;
	edgeArr = null;
	nonNodeEdgeArr = null;
	adjacency = /* @__PURE__ */ new Map();
	static CELL = 256;
	grid = /* @__PURE__ */ new Map();
	nodeCell = /* @__PURE__ */ new Map();
	static packCell(e, t) {
		return (e + 32768) * 65536 + (t + 32768);
	}
	cellKey(t, n) {
		return e.packCell(Math.floor(t / e.CELL), Math.floor(n / e.CELL));
	}
	indexNode(e) {
		let t = e.Position;
		if (!t) return;
		let n = this.cellKey(t.x, t.y), r = this.nodeCell.get(e.id);
		r !== n && (r && this.grid.get(r)?.delete(e.id), (this.grid.get(n) ?? this.grid.set(n, /* @__PURE__ */ new Set()).get(n)).add(e.id), this.nodeCell.set(e.id, n));
	}
	unindexNode(e) {
		let t = this.nodeCell.get(e);
		t && (this.grid.get(t)?.delete(e), this.nodeCell.delete(e));
	}
	nodeIdsInRect(t) {
		let n = Math.floor(t.x / e.CELL), r = Math.floor((t.x + t.w) / e.CELL), i = Math.floor(t.y / e.CELL), a = Math.floor((t.y + t.h) / e.CELL), o = [];
		for (let t = n; t <= r; t++) for (let n = i; n <= a; n++) this.grid.get(e.packCell(t, n))?.forEach((e) => o.push(e));
		return o;
	}
	addAdj(e) {
		(this.adjacency.get(e.From) ?? this.adjacency.set(e.From, /* @__PURE__ */ new Set()).get(e.From)).add(e.id), (this.adjacency.get(e.To) ?? this.adjacency.set(e.To, /* @__PURE__ */ new Set()).get(e.To)).add(e.id);
	}
	removeAdj(e) {
		this.adjacency.get(e.From)?.delete(e.id), this.adjacency.get(e.To)?.delete(e.id);
	}
	name;
	constructor(e) {
		this.id = e, this.name = `Graph ${e.replace(/^g/i, "") || e}`, this.registerItemStore("node", () => this.nodes()), this.registerItemStore("edge", () => this.edges());
	}
	rename(e) {
		let t = e.trim();
		return !t || t === this.name ? !1 : (this.name = t, !0);
	}
	registerItemStore(e, t) {
		return this.itemStores.set(e, t), () => {
			this.itemStores.get(e) === t && this.itemStores.delete(e);
		};
	}
	registerSnapshotExtension(e, t, n) {
		let r = {
			snapshot: t,
			restore: n ? (e) => n(e) : void 0
		};
		return this.snapshotExtensions.set(e, r), () => {
			this.snapshotExtensions.get(e) === r && this.snapshotExtensions.delete(e);
		};
	}
	snapshotExtension(e) {
		let t = this.snapshotExtensions.get(e);
		return t ? t.snapshot() : this.storedExtensions[e];
	}
	itemsOfKind(e) {
		let t = this.itemStores.get(e);
		return t ? e === "node" || e === "edge" ? t() : [...t()] : [];
	}
	getItem(e) {
		return e.kind === "node" ? this.items.get(e.id) : e.kind === "edge" ? this.edgeMap.get(e.id) : this.itemsOfKind(e.kind).find((t) => {
			if (!t || typeof t != "object") return !1;
			let n = t;
			return n.id === e.id ? n.parent == null ? !0 : Wt(n.parent) === Wt(e.parent) : !1;
		});
	}
	refById(e) {
		for (let t of this.itemStores.keys()) {
			if (t === "edge") continue;
			let n = {
				kind: t,
				id: e
			};
			if (this.getItem(n)) return n;
		}
	}
	createEdge(e) {
		let t = `r${this.nextEdge++}`, n = new Kt(this, t, e);
		return this.edgeMap.set(t, n), this.addAdj(n), this.edgeArr = null, this.nonNodeEdgeArr = null, n;
	}
	getEdge(e) {
		return this.edgeMap.get(e);
	}
	edges() {
		return this.edgeArr ??= [...this.edgeMap.values()];
	}
	edgesOutsideNodes() {
		return this.nonNodeEdgeArr ??= this.edges().filter((e) => !this.items.has(e.From) || !this.items.has(e.To));
	}
	edgesOf(e) {
		let t = this.adjacency.get(e);
		if (!t) return [];
		let n = [];
		return t.forEach((e) => {
			let t = this.edgeMap.get(e);
			t && n.push(t);
		}), n;
	}
	updateEdge(e, t) {
		let n = this.edgeMap.get(e);
		if (!n) return !1;
		let r = "From" in t || "To" in t;
		return r && this.removeAdj(n), Object.assign(n, t), n.visualVersion++, r && (this.addAdj(n), this.nonNodeEdgeArr = null), !0;
	}
	deleteEdge(e) {
		let t = this.edgeMap.get(e);
		return t ? (this.removeAdj(t), this.edgeMap.delete(e), this.edgeArr = null, this.nonNodeEdgeArr = null, !0) : !1;
	}
	getNode(e) {
		return this.items.get(e);
	}
	createNode(e = {}, t = {}) {
		let n = `e${this.nextNode++}`, r = new Gt(this, n, this.withDefaults(e, t));
		return this.items.set(n, r), this.indexNode(r), this.nodeArr = null, this.nonNodeEdgeArr = null, r;
	}
	node(e = {}, t = {}) {
		return typeof e == "string" ? this.items.get(e) : this.createNode(e, t);
	}
	nodes() {
		return this.nodeArr ??= [...this.items.values()];
	}
	updateNode(e, t) {
		let n = this.items.get(e);
		if (!n) return !1;
		Object.assign(n, t), t.Tags && (n.Tags = H(t.Tags).length ? H(t.Tags) : void 0);
		for (let e in t) if (e !== "Position") {
			n.visualVersion++;
			break;
		}
		return "Position" in t && this.indexNode(n), !0;
	}
	deleteNode(e) {
		let t = this.adjacency.get(e);
		t && ([...t].forEach((e) => {
			let t = this.edgeMap.get(e);
			t && (this.removeAdj(t), this.edgeMap.delete(e));
		}), this.adjacency.delete(e), this.edgeArr = null, this.nonNodeEdgeArr = null);
		let n = this.items.delete(e);
		return n && (this.unindexNode(e), this.nodeArr = null, this.nonNodeEdgeArr = null), n;
	}
	withDefaults(e, t) {
		let n = t.nearPosition ?? t.at ?? {
			x: 0,
			y: 0
		}, r = t.nearPosition != null, i = this.items.size;
		if (!r && i === 0) return {
			...e,
			Position: e.Position ?? { ...n }
		};
		if (r) {
			let t = i % 3;
			return {
				...e,
				Position: e.Position ?? {
					x: n.x + 220,
					y: n.y + t * 100
				}
			};
		}
		let a = i % 3, o = Math.floor(i / 3);
		return {
			...e,
			Position: e.Position ?? {
				x: n.x + (a - 2 / 2) * 240,
				y: n.y + o * 100
			}
		};
	}
	snapshot() {
		let e = Ut({ ...this.storedExtensions });
		return this.snapshotExtensions.forEach((t, n) => {
			e[n] = Ut(t.snapshot());
		}), {
			schemaVersion: 1,
			name: this.name,
			nodes: this.nodes().map(({ id: e, Label: t, Position: n, Size: r, NodeType: i, Status: a, Tags: o, Color: s, Fill: c, BorderColor: l, ToggleState: u, Description: d, LinkUrl: f, ImageSource: p, ImageAlt: m, DescriptionPlacement: h, ComputeMs: g, ExpectedRps: _, LatencyMs: v, Contract: y, Purpose: b, Assumptions: x, Limits: S, WhatThen: C, Observability: w, FailureMode: T, DataScale: E, FreshnessMs: D }) => ({
				id: e,
				Label: t,
				Position: n,
				Size: r,
				NodeType: i,
				Status: a,
				Tags: o,
				Color: s,
				Fill: c,
				BorderColor: l,
				ToggleState: u,
				Description: d,
				LinkUrl: f,
				ImageSource: p,
				ImageAlt: m,
				DescriptionPlacement: h,
				ComputeMs: g,
				ExpectedRps: _,
				LatencyMs: v,
				Contract: y,
				Purpose: b,
				Assumptions: x,
				Limits: S,
				WhatThen: C,
				Observability: w,
				FailureMode: T,
				DataScale: E,
				FreshnessMs: D
			})),
			edges: this.edges().map(({ id: e, From: t, To: n, Label: r, EdgeKind: i, Relation: a, Color: o, LatencyMs: s, ThroughputRps: c, PayloadKb: l, Contract: u, Purpose: d, Assumptions: f, Limits: p, WhatThen: m, Observability: h, FailureMode: g, DataScale: _, FreshnessMs: v }) => ({
				id: e,
				From: t,
				To: n,
				Label: r,
				EdgeKind: i,
				Relation: a,
				Color: o,
				LatencyMs: s,
				ThroughputRps: c,
				PayloadKb: l,
				Contract: u,
				Purpose: d,
				Assumptions: f,
				Limits: p,
				WhatThen: m,
				Observability: h,
				FailureMode: g,
				DataScale: _,
				FreshnessMs: v
			})),
			...Object.keys(e).length ? { extensions: e } : {}
		};
	}
	replace(e) {
		e.name?.trim() && (this.name = e.name.trim()), this.storedExtensions = { ...e.extensions ?? {} }, this.items.clear(), this.edgeMap.clear(), this.adjacency.clear(), this.grid.clear(), this.nodeCell.clear();
		let t = 0, n = 0;
		e.nodes.forEach((e) => {
			let n = new Gt(this, e.id, e);
			this.items.set(n.id, n), this.indexNode(n);
			let r = parseInt(n.id.replace(/^\D+/, ""), 10);
			Number.isFinite(r) && (t = Math.max(t, r));
		}), e.edges.forEach((e) => {
			if (!e.From || !e.To || e.From === e.To) return;
			let t = new Kt(this, e.id, e);
			this.edgeMap.set(t.id, t), this.addAdj(t);
			let r = parseInt(t.id.replace(/^\D+/, ""), 10);
			Number.isFinite(r) && (n = Math.max(n, r));
		}), this.nextNode = t + 1, this.nextEdge = n + 1, this.nodeArr = null, this.edgeArr = null, this.nonNodeEdgeArr = null, this.snapshotExtensions.forEach((e, t) => e.restore?.(this.storedExtensions[t]));
	}
}, Jt = class {
	next = 1;
	graphs = /* @__PURE__ */ new Map();
	active;
	constructor() {
		this.active = this.create();
	}
	nextId() {
		let e = `g${this.next++}`;
		for (; this.graphs.has(e);) e = `g${this.next++}`;
		return e;
	}
	get current() {
		return this.active;
	}
	all() {
		return [...this.graphs.values()];
	}
	get(e) {
		return this.graphs.get(e);
	}
	create = (e = this.nextId()) => {
		let t = this.graphs.get(e);
		if (t) return t;
		let n = qt.new(e);
		return this.graphs.set(e, n), n;
	};
	delete(e) {
		return this.graphs.size <= 1 ? this.active : (this.graphs.delete(e), this.active.id === e && (this.active = this.graphs.values().next().value ?? this.create()), this.active);
	}
	switch = (e) => (this.active = this.graphs.get(e) ?? this.create(e), this.active);
}, Yt = () => new Jt(), Xt = () => {
	let e = performance.memory;
	if (typeof e?.usedJSHeapSize == "number") return e.usedJSHeapSize;
	let t = globalThis.process;
	return typeof t?.memoryUsage == "function" ? t.memoryUsage().heapUsed : null;
}, Zt = () => performance.now(), Qt = 2e3, $t = 500, en = 200, tn = 1e3, nn = (e, t, n) => {
	e.push(t), e.length > n && e.splice(0, e.length - n);
}, rn = (e) => {
	let t = e.id ? `#${e.id}` : "", n = [...e.classList].slice(0, 3).map((e) => `.${e}`).join(""), r = e instanceof HTMLElement && e.dataset.itemKind && e.dataset.itemId ? `[${e.dataset.itemKind}:${e.dataset.itemId}]` : "";
	return `${e.localName}${t}${n}${r}`;
}, an = (e, t = 4) => {
	if (!e) return [];
	let n = [], r = e;
	for (; r && n.length < t;) n.unshift(rn(r)), r = r.parentElement;
	return n;
}, on = (e) => an(e).join(" > "), sn = (e, t) => {
	let n = (typeof e?.composedPath == "function" ? e.composedPath() : []).filter((e) => e instanceof Element).slice(0, 8).map(rn);
	return n.length ? n : an(t, 8).reverse();
}, cn = (e, t) => {
	let n = e?.timeStamp ?? t, r = t - n;
	return Number.isFinite(r) && r >= -1 && r < 6e4 ? n : t;
};
function ln(e = !1) {
	let t = e, n = /* @__PURE__ */ new Map(), r = /* @__PURE__ */ new Map(), i = /* @__PURE__ */ new Map(), a = [], o = [], s = [], c = [], l = [], u = /* @__PURE__ */ new Map(), d = 1, f = (e, t) => {
		let r = n.get(e) ?? n.set(e, {
			calls: 0,
			totalMs: 0,
			maxMs: 0
		}).get(e);
		r.calls++, r.totalMs += t, r.maxMs = Math.max(r.maxMs, t);
	}, p = (e, t) => {
		if (nn(o, e, Qt), !t) return;
		let n = `${t.label}=>${e.label}`, r = u.get(n) ?? u.set(n, {
			from: t.label,
			to: e.label,
			calls: 0,
			totalMs: 0,
			maxMs: 0
		}).get(n);
		r.calls++, r.totalMs += e.duration, r.maxMs = Math.max(r.maxMs, e.duration);
	};
	return {
		enabled: () => t,
		setEnabled(e) {
			t = e;
		},
		reset() {
			n.clear(), r.clear(), i.clear(), a.length = 0, o.length = 0, s.length = 0, c.length = 0, l.length = 0, u.clear();
		},
		count(e, n = 1) {
			t && r.set(e, (r.get(e) ?? 0) + n);
		},
		sample(e, n) {
			if (!t || !Number.isFinite(n)) return;
			let r = i.get(e) ?? i.set(e, {
				samples: 0,
				total: 0,
				min: Infinity,
				max: -Infinity,
				last: n
			}).get(e);
			r.samples++, r.total += n, r.min = Math.min(r.min, n), r.max = Math.max(r.max, n), r.last = n;
		},
		mark(e) {
			t && nn(a, {
				label: e,
				at: Zt()
			}, tn);
		},
		measure(e, n) {
			if (!t) return n();
			let r = Zt(), i = l[l.length - 1], a = {
				id: d++,
				label: e
			};
			l.push(a);
			try {
				return n();
			} finally {
				let t = Zt(), n = t - r;
				l.pop(), f(e, n), p({
					id: a.id,
					label: e,
					start: r,
					end: t,
					duration: n,
					parentId: i?.id
				}, i);
			}
		},
		beginInput(e, n, r) {
			if (!t) return;
			let i = Zt(), a = cn(n, i), o = Math.max(0, i - a), c = l[l.length - 1], u = {
				id: d++,
				label: `Input.${e}`
			};
			l.push(u);
			let f = !1;
			return { end(t = {}) {
				if (f) return;
				f = !0;
				let m = Zt(), h = Math.max(0, m - i);
				l[l.length - 1]?.id === u.id && l.pop(), p({
					id: u.id,
					label: u.label,
					start: i,
					end: m,
					duration: h,
					parentId: c?.id
				}, c), nn(s, {
					id: d++,
					source: "router",
					name: e,
					target: on(r),
					startTime: a,
					processingStart: i,
					processingEnd: m,
					duration: o + h,
					inputDelay: o,
					processingDuration: h,
					presentationDelay: 0,
					path: sn(n, r),
					candidates: t.candidates,
					matched: t.matched
				}, $t);
			} };
		},
		recordInput(e) {
			t && nn(s, {
				id: d++,
				...e
			}, $t);
		},
		recordLongTask(e) {
			t && nn(c, {
				id: d++,
				...e
			}, en);
		},
		snapshot() {
			let e = [...n.entries()].map(([e, t]) => ({
				label: e,
				calls: t.calls,
				totalMs: t.totalMs,
				avgMs: t.totalMs / Math.max(1, t.calls),
				maxMs: t.maxMs
			})).sort((e, t) => t.totalMs - e.totalMs), l = [...r.entries()].map(([e, t]) => ({
				label: e,
				count: t
			})).sort((e, t) => t.count - e.count), d = [...i.entries()].map(([e, t]) => ({
				label: e,
				samples: t.samples,
				min: t.min,
				max: t.max,
				avg: t.total / Math.max(1, t.samples),
				last: t.last
			})).sort((e, t) => t.max - e.max), f = [...u.values()].map((e) => ({ ...e })).sort((e, t) => t.totalMs - e.totalMs);
			return {
				enabled: t,
				timings: e,
				counts: l,
				samples: d,
				marks: [...a],
				timeline: [...o],
				callGraph: f,
				inputs: [...s],
				longTasks: [...c],
				heapUsedBytes: Xt()
			};
		}
	};
}
var un = Symbol("ecg.perf.wrapped"), dn = /* @__PURE__ */ new WeakMap();
function fn(e, t) {
	dn.set(e, t);
}
function pn(e, t, n) {
	let r = e;
	n.forEach((e) => {
		let n = r[e];
		if (typeof n != "function" || n[un]) return;
		let i = n, a = function(...n) {
			let r = dn.get(this);
			return r?.enabled() ? r.measure(`${t}.${e}`, () => i.apply(this, n)) : i.apply(this, n);
		};
		a[un] = !0, r[e] = a;
	});
}
var mn = (e) => {
	let t = typeof location > "u" ? "" : location.search, n = new URLSearchParams(t), r = globalThis.process?.env;
	return e.perf === !0 || n.get("perf") === "1" || n.has("perf") || r?.PERF === "1";
}, hn = (e) => ln(mn(e));
function gn(e, t) {
	pn(qt.prototype, "Graph", [
		"itemsOfKind",
		"getItem",
		"nodes",
		"edges",
		"edgesOf",
		"deleteNode",
		"createNode",
		"createEdge",
		"getNode",
		"updateNode",
		"updateEdge",
		"replace",
		"snapshot",
		"nodeIdsInRect"
	]), e.all().forEach((e) => fn(e, t));
	let n = e.create.bind(e);
	e.create = ((e) => {
		let r = n(e);
		return fn(r, t), r;
	});
	let r = e.switch.bind(e);
	e.switch = ((e) => {
		let n = r(e);
		return fn(n, t), n;
	});
}
//#endregion
//#region canvas/core/icons.ts
var _n = "http://www.w3.org/2000/svg", vn = {
	menu: [
		"M4 7h16",
		"M4 12h16",
		"M4 17h16"
	],
	fit: [
		"M8 3H3v5",
		"M16 3h5v5",
		"M8 21H3v-5",
		"M16 21h5v-5"
	],
	more: [
		"M5 12h.01",
		"M12 12h.01",
		"M19 12h.01"
	],
	commands: [
		"M4 6h16",
		"M4 12h16",
		"M4 18h10",
		"M8 3v6",
		"M16 9v6",
		"M10 15v6"
	],
	select: ["m5 3 14 9-6 2-3 6z"],
	draw: ["m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10z", "m13.5 7.5 3 3"],
	erase: ["m7 20-4-4 10-10a2.8 2.8 0 0 1 4 0l3 3a2.8 2.8 0 0 1 0 4l-7 7z", "M10 20h11"],
	node: ["M5 5h14v14H5z"],
	connect: [
		"M6 12h12",
		"m14 8 4 4-4 4",
		"M4 9v6"
	],
	container: ["M4 5h16v14H4z", "M4 9h16"],
	group: ["M5 8h8v8H5z", "M11 5h8v8"],
	undo: ["m9 7-5 5 5 5", "M4 12h9a6 6 0 0 1 6 6"],
	redo: ["m15 7 5 5-5 5", "M20 12h-9a6 6 0 0 0-6 6"],
	export: [
		"M12 3v12",
		"m7 8 5-5 5 5",
		"M5 14v6h14v-6"
	],
	import: [
		"M12 15V3",
		"m7 10 5 5 5-5",
		"M5 14v6h14v-6"
	],
	share: [
		"M8 12 16 7",
		"M8 12l8 5",
		"M6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6",
		"M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6",
		"M18 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6"
	],
	help: [
		"M9.5 9a2.7 2.7 0 1 1 4.6 2c-1.1 1-2.1 1.4-2.1 3",
		"M12 18h.01",
		"M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20"
	],
	theme: ["M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9"],
	star: ["m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z"],
	"star-filled": ["m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z"],
	close: ["M6 6l12 12", "M18 6 6 18"],
	trash: [
		"M4 7h16",
		"M9 3h6l1 4H8z",
		"M6 7l1 14h10l1-14",
		"M10 11v6",
		"M14 11v6"
	],
	text: [
		"M5 5h14",
		"M12 5v14",
		"M9 19h6"
	],
	circle: ["M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0"],
	toggle: ["M8 7h8a5 5 0 0 1 0 10H8A5 5 0 0 1 8 7", "M8 12h.01"],
	reverse: [
		"M7 7h11",
		"m15 4 3 3-3 3",
		"M17 17H6",
		"m3-3-3 3 3 3"
	],
	collapse: ["M5 12h14"],
	ungroup: [
		"M4 8h8v8H4z",
		"M12 5h8v8h-3",
		"M15 19H8v-3"
	],
	"move-out": [
		"M5 19h10V9",
		"m11 7 4-4 4 4",
		"M19 3v10"
	],
	check: ["m5 12 4 4L19 6"],
	"placement-inside": [
		"M4 4h16v16H4z",
		"M8 9h8",
		"M8 13h6"
	],
	"placement-top": [
		"M5 11h14v10H5z",
		"M7 7h10",
		"M8 3h8"
	],
	"placement-below": [
		"M5 3h14v10H5z",
		"M7 17h10",
		"M8 21h8"
	],
	"placement-left": [
		"M11 5h10v14H11z",
		"M8 8H3",
		"M8 12H3",
		"M7 16H3"
	],
	"placement-right": [
		"M3 5h10v14H3z",
		"M16 8h5",
		"M16 12h5",
		"M16 16h4"
	],
	"placement-hidden": ["M4 4h16v16H4z", "M3 21 21 3"],
	"layout-columns": ["M4 5h7v14H4z", "M13 5h7v14h-7z"],
	"layout-rows": ["M4 5h16v6H4z", "M4 13h16v6H4z"],
	pulse: ["M3 12h4l3-7 4 14 3-7h4"]
}, yn = (e, t = "ui-icon") => {
	let n = document.createElementNS(_n, "svg");
	return n.setAttribute("viewBox", "0 0 24 24"), n.setAttribute("aria-hidden", "true"), n.setAttribute("focusable", "false"), n.classList.add(...t.split(/\s+/).filter(Boolean)), vn[e].forEach((t) => {
		let r = document.createElementNS(_n, "path");
		r.setAttribute("d", t), r.setAttribute("fill", e === "star-filled" ? "currentColor" : "none"), r.setAttribute("stroke", "currentColor"), r.setAttribute("stroke-width", "1.8"), r.setAttribute("stroke-linecap", "round"), r.setAttribute("stroke-linejoin", "round"), n.append(r);
	}), n;
}, bn = (e, t) => e.replaceChildren(yn(t)), xn = (e) => u(`fieldset.property-choice.property-choice-${e.kind}`, { class: e.className }, [u("legend", {
	text: e.label,
	...e.labelHidden ? { class: "is-visually-hidden" } : {}
}), u(".property-choice-options", e.options.map((t) => u("button", {
	type: "button",
	class: t.className,
	"aria-label": `${e.label}: ${t.label}`,
	"aria-pressed": t.value === (e.current ?? "") ? "true" : "false",
	data: {
		command: t.command,
		optionValue: t.value || "automatic",
		...t.data
	}
}, [(t.icon || t.glyph) && u("span.property-choice-icon", {
	"aria-hidden": "true",
	...t.glyph ? { text: t.glyph } : {}
}, t.icon ? [yn(t.icon)] : void 0), !t.labelHidden && u("span.property-choice-label", { text: t.label })])))]), Sn = {
	inside: "placement-inside",
	top: "placement-top",
	below: "placement-below",
	left: "placement-left",
	right: "placement-right",
	hidden: "placement-hidden"
};
function Cn() {
	let e = /* @__PURE__ */ new Map(), t = (e) => (t, n) => xn({
		label: t.label,
		kind: e,
		current: String(t.value(n)),
		options: (t.options ?? []).map((n) => ({
			value: n.value,
			label: n.label,
			command: "properties.item.choice",
			data: {
				field: t.id,
				value: n.value
			},
			...e === "placement" && Sn[n.value] ? { icon: Sn[n.value] } : n.icon ? { glyph: n.icon } : {}
		}))
	}), n = (e, t) => {
		let n = u("label");
		if (e.input === "textarea") {
			let r = u("textarea");
			return r.dataset.field = e.id, r.rows = e.rows ?? 5, r.value = String(e.value(t)), e.placeholder && (r.placeholder = e.placeholder), e.hideLabel ? (r.setAttribute("aria-label", e.label), n.className = "property-label-hidden", n.append(r)) : n.append(e.label, r), n;
		}
		if (e.input === "select") {
			let r = String(e.value(t)), i = u("select", { data: { field: e.id } }, (e.options ?? []).map((e) => u("option", {
				value: e.value,
				text: e.label,
				selected: e.value === r
			})));
			return n.append(e.label, i), n;
		}
		let r = u("input", { data: { field: e.id } });
		return r.type = e.input, e.placeholder && (r.placeholder = e.placeholder), e.min != null && (r.min = `${e.min}`), e.step != null && (r.step = `${e.step}`), e.input === "checkbox" ? (n.className = "check-row", r.checked = !!e.value(t), n.append(r, e.label)) : (e.input === "text" && r.classList.add("editable-inline"), r.value = String(e.value(t)), n.append(e.label, r)), n;
	};
	return e.set("text", n), e.set("number", n), e.set("checkbox", n), e.set("textarea", n), e.set("select", n), e.set("swatches", t("swatches")), e.set("segments", t("segments")), e.set("placement", t("placement")), {
		register(t, n) {
			e.set(t, n);
		},
		has(t) {
			return e.has(t);
		},
		render(t, r) {
			return (e.get(t.input) ?? n)(t, r);
		},
		names: () => [...e.keys()]
	};
}
//#endregion
//#region canvas/core/selection.ts
function wn(e, t) {
	let n = /* @__PURE__ */ new Map(), r = /* @__PURE__ */ new Map(), i = (t) => t ?? e.current.id, a = (e) => n.get(e) ?? [], o = (e) => {
		let n = a(e), r = n[n.length - 1] ?? null;
		t.emit("selection.item.selected", r), t.emit("selection.node.selected", { id: r?.kind === "node" ? r.id : null }), t.emit("selection.changed", { refs: n });
	}, s = (e, t) => {
		let r = a(e);
		r.length === t.length && r.every((e, n) => z(e, t[n])) || (n.set(e, t), o(e));
	}, c = (e) => {
		r.set(e, null), t.emit("focus.item.focused", null), t.emit("focus.node.focused", { id: null });
	}, l = (e, t) => {
		let n = a(e), i = n.filter((e) => !z(e, t));
		i.length !== n.length && s(e, i), z(r.get(e) ?? null, t) && c(e);
	};
	t.on("graph.node.deleted", ({ graphId: e, id: t }) => l(e, B(t))), t.on("graph.edge.deleted", ({ graphId: e, id: t }) => l(e, ht(t))), t.on("graph.deleted", ({ id: e }) => {
		n.delete(e), r.delete(e);
	});
	let u = (t, n) => {
		if (!(!t || t.kind !== "node")) return e.get(i(n))?.node(t.id);
	};
	return {
		selected: (e) => {
			let t = a(i(e));
			return t[t.length - 1] ?? null;
		},
		selectedAll: (e) => [...a(i(e))],
		has: (e, t) => a(i(t)).some((t) => z(t, e)),
		focused: (e) => r.get(i(e)) ?? null,
		selectedNode: (e) => {
			let t = a(i(e));
			return u(t[t.length - 1] ?? null, e);
		},
		focusedNode: (e) => u(r.get(i(e)) ?? null, e),
		select(e, t) {
			s(i(t), e ? [e] : []);
		},
		choose(e, t) {
			let n = /* @__PURE__ */ new Set(), r = [];
			for (let t of e) {
				let e = `${t.kind}:${t.id}:${(t.parent ?? []).join("/")}`;
				n.has(e) || (n.add(e), r.push(t));
			}
			s(i(t), r);
		},
		add(e, t) {
			let n = i(t);
			if (a(n).some((t) => z(t, e))) {
				s(n, [...a(n).filter((t) => !z(t, e)), e]);
				return;
			}
			s(n, [...a(n), e]);
		},
		remove(e, t) {
			let n = i(t);
			s(n, a(n).filter((t) => !z(t, e)));
		},
		toggle(e, t) {
			let n = i(t);
			s(n, a(n).some((t) => z(t, e)) ? a(n).filter((t) => !z(t, e)) : [...a(n), e]);
		},
		focus(e, t) {
			r.set(i(t), e);
		}
	};
}
//#endregion
//#region canvas/core/sim.ts
function Tn(e) {
	let t = e;
	return {
		record() {
			let t = [], n = !1;
			return e.onAny((e) => {
				n && t.push({
					name: e.name,
					data: e.data,
					at: e.at
				});
			}), {
				start() {
					t = [], n = !0;
				},
				stop() {
					return n = !1, t;
				},
				current() {
					return t.slice();
				},
				byName(e) {
					return t.filter((t) => t.name === e);
				}
			};
		},
		replay(t) {
			t.forEach((t) => e.forward(t.name, t.data));
		},
		emitMany(t) {
			t.forEach((t) => e.forward(t.name, t.data));
		},
		orphanEmits: () => [...t._emitted].filter((e) => !t._subscribed.has(e)),
		silentListeners: () => [...t._subscribed].filter((e) => !t._emitted.has(e))
	};
}
//#endregion
//#region canvas/core/storage.ts
function En(e) {
	let t = Re(), n = Re((e) => /* @__PURE__ */ Error(`Default owner conflict for "${e}"`)), r = ({ ref: e, patch: n }) => t.get(e.kind)?.apply(e, n);
	return e.on("item.update", r), e.on("item.update.batch", ({ updates: e }) => e.forEach(r)), {
		register: (e, n, r) => t.set(e, {
			origin: n,
			apply: r
		}),
		kinds: () => t.entries().map(([e]) => e),
		has: (e) => t.has(e),
		claimDefaults: (e, t) => n.set(e, t),
		defaultOwners: () => n.entries().map(([e, t]) => ({
			kind: e,
			origin: t
		})),
		owned: () => [...t.entries().map(([e, t]) => ({
			category: "storage-handler",
			id: e,
			origin: t.origin
		})), ...n.entries().map(([e, t]) => ({
			category: "storage-default",
			id: e,
			origin: t
		}))],
		unregisterOrigin(e) {
			t.entries().forEach(([n, r]) => {
				r.origin === e && t.set(n, r)();
			}), n.entries().forEach(([t, r]) => {
				r === e && n.set(t, r)();
			});
		}
	};
}
//#endregion
//#region canvas/core/fold.ts
var U = (e, t) => `fold:${t}:${e.kind}:${e.id}`, Dn = (e, t, n, r) => t(e).some((e) => n.folded(U(e, r)));
function On(e, t) {
	let n = t.get("frontend.fold", {}), r = (e, t = !0) => Object.prototype.hasOwnProperty.call(n, e) ? n[e] : t, i = (t, r) => {
		n[t] = r, e.emit("fold.changed", {
			id: t,
			open: r
		});
	};
	return e.on("graph.deleted", ({ id: t }) => {
		let r = `fold:${t}:`, i = Object.keys(n).filter((e) => e.startsWith(r));
		i.length && (i.forEach((e) => {
			delete n[e];
		}), e.emit("fold.changed", {
			id: r,
			open: !0
		}));
	}), {
		isOpen: r,
		folded: (e) => !r(e, !0),
		set: i,
		toggle: (e, t = !0) => i(e, !r(e, t)),
		all: () => ({ ...n })
	};
}
//#endregion
//#region canvas/core/frame-loop.ts
function kn(e = () => !1) {
	let t = /* @__PURE__ */ new Map(), n = !1, r = !1, i = 0, a = 0, o = (s) => {
		if (r) return;
		let c = [...t.entries()].sort(([, e], [, t]) => e.priority - t.priority || 0).map(([e, t]) => ({
			id: e,
			...t
		}));
		t.clear(), n = !1;
		let l = a ? s - a : 0;
		a = s, l > 50 && e() && console.debug(`[frameLoop] gap=${l.toFixed(1)}ms queue=${c.length} [${c.map((e) => e.id).join(",")}]`);
		for (let { id: e, callback: t } of c) try {
			t(s);
		} catch (t) {
			console.error(`[frameLoop] ${e} threw:`, t);
		}
		t.size > 0 && (n = !0, i = requestAnimationFrame(o));
	};
	return {
		schedule(e, a, s = 0) {
			r || (t.set(e, {
				callback: a,
				priority: s
			}), n || (n = !0, i = requestAnimationFrame(o)));
		},
		cancel(e) {
			t.delete(e);
		},
		hasPending() {
			return t.size > 0;
		},
		dispose() {
			r = !0, t.clear(), cancelAnimationFrame(i);
		},
		flushNow() {
			t.size && (n = !1, o(performance.now()));
		}
	};
}
//#endregion
//#region canvas/core/templates.ts
function An(e = document, t = "") {
	let n = (e, t) => e instanceof Element && e.matches(t) ? e : e.querySelector(t), r = (e) => t ? `${t}-${e}` : e, i = /* @__PURE__ */ new Set();
	return {
		id: r,
		clone: (n) => {
			i.add(n);
			let a = e.querySelector(`#tpl-${n}`), o = a instanceof HTMLTemplateElement ? a.content.firstElementChild?.cloneNode(!0) : null;
			if (!(o instanceof HTMLElement)) throw Error(`Missing template: ${n}`);
			if (t) for (let e of [o, ...o.querySelectorAll("[id], [aria-labelledby]")]) {
				e.id &&= r(e.id);
				let t = e.getAttribute("aria-labelledby");
				t && e.setAttribute("aria-labelledby", t.split(" ").map(r).join(" "));
			}
			return o;
		},
		text: (e, t, r) => {
			let i = n(e, `[data-text="${t}"]`);
			return i && (i.textContent = String(r ?? "")), e;
		},
		slot: (e, t) => {
			let r = n(e, `[data-slot="${t}"]`);
			if (!(r instanceof Element)) throw Error(`Missing slot: ${t}`);
			return r;
		},
		_cloned: i
	};
}
var jn = (e, t, n, r) => {
	try {
		let i = e.clone("empty");
		return e.text(i, "title", t), n && e.slot(i, "hint").append(n), r && (i.classList.add("empty-action"), i.dataset.command = r, i.tabIndex = 0, i.setAttribute("role", "button"), i.setAttribute("aria-label", `${t}. Activate to continue.`)), i;
	} catch {
		return null;
	}
}, Mn = (e) => u(".empty-note", {
	text: e,
	role: "status",
	"aria-live": "polite"
}), W = (e, t, n) => Math.max(t, Math.min(n, e)), Nn = (e, t) => e.x < t.x + t.w && e.x + e.w > t.x && e.y < t.y + t.h && e.y + e.h > t.y, Pn = (e) => {
	let t = e.Position ?? {
		x: 0,
		y: 0
	};
	return {
		x: t.x - e.Size.w / 2,
		y: t.y - e.Size.h / 2,
		w: e.Size.w,
		h: e.Size.h
	};
}, Fn = (e) => ({
	x: e.clientX,
	y: e.clientY
}), In = (e, t) => e.target === t || e.target instanceof Element && e.target.classList.contains("nodes");
function Ln(e) {
	let t = {
		x: 0,
		y: 0,
		scale: 1
	}, n = (t) => e.get(t)?.getBoundingClientRect(), r = () => ({ ...t }), i = (e) => (t = {
		x: e.x ?? t.x,
		y: e.y ?? t.y,
		scale: W(e.scale ?? t.scale, .05, 5)
	}, r()), a = (e, n) => {
		let r = s(e), a = W(t.scale * n, .05, 5);
		return i({
			scale: a,
			x: r.x - e.x / a,
			y: r.y - e.y / a
		});
	}, o = (e, t) => {
		let r = n(e);
		return r ? {
			x: t.x - r.left,
			y: t.y - r.top
		} : t;
	}, s = (e) => ({
		x: t.x + e.x / t.scale,
		y: t.y + e.y / t.scale
	}), c = (e) => ({
		x: (e.x - t.x) * t.scale,
		y: (e.y - t.y) * t.scale
	}), l = (e, t) => s(o(e, t)), u = (e) => {
		let t = n(e);
		return t ? {
			x: t.width / 2,
			y: t.height / 2
		} : {
			x: innerWidth / 2,
			y: innerHeight / 2
		};
	}, d = (e) => s(u(e)), f = (e, r = 0) => {
		let i = n(e);
		return i ? {
			x: t.x - r,
			y: t.y - r,
			w: i.width / t.scale + r * 2,
			h: i.height / t.scale + r * 2
		} : null;
	};
	return {
		get: r,
		set: i,
		clientToScreen: o,
		screenToSpace: s,
		spaceToScreen: c,
		clientToSpace: l,
		screenCenter: u,
		spaceCenter: d,
		visibleRect: f,
		isVisible: (e, t, n = 0) => {
			let r = f(e, n);
			return !r || Nn(r, t);
		},
		zoomAtScreen: a
	};
}
//#endregion
//#region canvas/core/context-registry.ts
function Rn(e, t, n = []) {
	let r = {}, i = new Set(Object.keys(t));
	for (; i.size;) {
		let n = !1;
		for (let a of i) {
			let o = t[a];
			o.requires?.some((e) => i.has(e)) || (r[a] = o.create({
				...e,
				...r
			}), i.delete(a), n = !0);
		}
		if (!n) throw Error(`Context dependency cycle: ${[...i].join(", ")}`);
	}
	return Object.assign(r, { teardown: n.flatMap((e) => {
		let t = r[e];
		return t && typeof t == "object" && "unregisterOrigin" in t ? [t] : [];
	}) });
}
//#endregion
//#region canvas/core/intents.ts
var zn = (e, t, n) => ({
	kind: "command",
	action: e,
	source: t,
	args: n
}), Bn = (e, t, n) => ({
	kind: "query",
	query: e,
	source: t,
	selection: n
}), Vn = ({ label: e, command: t, data: n }, r) => u(r ? `button.${r}` : "button", {
	type: "button",
	text: e,
	data: {
		command: t,
		...n
	}
}), Hn = (e) => () => u("section.delete-preview", { data: { confirm: e.destroy.command.split(".")[0] } }, [
	u("p", { text: e.question }),
	e.note ? u("small", { text: e.note }) : !1,
	u(".import-actions", [Vn(e.keep), Vn(e.destroy, "danger")])
]), Un = "›", Wn = (e) => {
	let t = u("button.fold-section-toggle", {
		type: "button",
		"aria-expanded": e.open ? "true" : "false",
		"aria-label": `${e.open ? "Collapse" : "Expand"} ${e.label}`,
		data: {
			command: "fold.toggle",
			foldId: e.id,
			...e.defaultOpen === void 0 ? {} : { foldDefaultOpen: String(e.defaultOpen) }
		}
	}, [u("span.fold-section-marker", {
		text: Un,
		"aria-hidden": "true"
	}), u("span.fold-section-label", { text: e.label })]);
	if (e.note !== void 0) {
		let n = u("span.fold-section-note");
		typeof e.note == "string" ? n.textContent = e.note : n.append(e.note), t.append(n);
	}
	if (e.summary !== void 0) {
		let n = u("span.fold-section-summary", { hidden: e.open });
		typeof e.summary == "string" ? n.textContent = e.summary : n.append(e.summary), t.append(n);
	}
	return u("section.fold-section", { data: {
		foldSection: e.id,
		open: e.open ? "true" : "false"
	} }, [t, !!e.body && e.open && u(".fold-section-body", e.body())]);
}, Gn = (e) => {
	let t = u("button.list-row-action", {
		type: "button",
		class: e.className,
		"aria-label": e.label,
		data: {
			command: e.command,
			...e.data
		}
	});
	return e.icon ? t.append(yn(e.icon)) : t.textContent = e.glyph ?? e.label, t;
}, Kn = (e) => {
	let t = u("button.list-row-open", {
		type: "button",
		class: e.className,
		...e.active ? { "aria-current": "page" } : {},
		data: {
			...e.command ? { command: e.command } : {},
			...e.data
		}
	}, [e.marker && u("span.list-row-marker", { class: `list-row-marker-${e.marker} ${e.markerClassName ?? ""}`.trim() }), u("span.list-row-copy", [u("strong", { text: e.title }), e.detail !== void 0 && u("small", { text: e.detail })])]);
	return e.actions?.length ? u("div.list-row", { data: e.data }, [t, ...e.actions.map((e) => e instanceof HTMLElement ? e : Gn(e))]) : t;
}, qn = (e) => {
	let t = u("input.search-field-input", {
		type: "text",
		value: e.value,
		placeholder: e.placeholder ?? `Search ${e.label}`,
		"aria-label": `Search ${e.label}`,
		data: {
			...e.searchCommand ? { command: e.searchCommand } : {},
			...e.data
		}
	}), n = e.value.trim();
	return u(".search-field", { class: e.className }, [
		t,
		e.clearCommand && n !== "" && u("button.search-field-clear", {
			type: "button",
			"aria-label": `Clear ${e.label} search`,
			data: { command: e.clearCommand }
		}, [yn("close")]),
		e.create && u("button.search-field-create", {
			type: "button",
			text: n ? `+ ${n}` : `+ ${e.create.label}`,
			"aria-label": n ? `${e.create.label}: ${n}` : e.create.label,
			title: n ? `${e.create.label}: ${n}` : e.create.label,
			data: {
				command: e.create.command,
				searchValue: n,
				...e.create.data
			}
		})
	]);
}, Jn = (e) => {
	let t = e.items.filter((e) => !!e);
	return u(".collection", {
		class: e.className,
		role: "list",
		"aria-label": e.label,
		data: e.scroll ? { nativeScroll: "" } : void 0
	}, t.length ? t : [e.empty === void 0 ? !1 : typeof e.empty == "string" ? Mn(e.empty) : e.empty]);
}, Yn = (e, t) => {
	let n = /* @__PURE__ */ new Map(), r = /* @__PURE__ */ new Map(), i = (i) => {
		let a = n.get(i);
		if (a) return a;
		let o = e(i), s = t.create(o, i);
		return n.set(i, s), r.set(i, o.registerSnapshotExtension(t.key, () => t.serialize(s), (e) => t.restore(s, e))), s;
	}, a = (e) => {
		let i = n.get(e);
		i && (t.release?.(i), r.get(e)?.(), r.delete(e), n.delete(e));
	};
	return {
		of: i,
		forget: a,
		dispose: () => [...n.keys()].forEach(a),
		all: () => n
	};
}, Xn = (e, t) => {
	let n = /* @__PURE__ */ new Map();
	return e.forEach((e) => (n.get(t(e)) || n.set(t(e), []).get(t(e))).push(e)), [...n.entries()];
}, Zn = (e) => {
	if (e === "view.changed") return "camera";
	for (let t of n) if (e.endsWith(t)) return t === ".changed" ? "nodes" : t === ".focused" || t === ".selected" ? "nodes.visual" : "both";
	return null;
}, Qn = (e, t) => {
	if (e === "history.changed" || e === "io.saved") return null;
	if (e === "graph.node.updated") {
		let e = t;
		if (e?.patch && !("Label" in e.patch)) return e.visual ? "nodes.visual" : "nodes";
	}
	return e === "selection.changed" || e === "decoration.changed" ? "nodes.visual" : Zn(e);
}, $n = (e) => [
	e.Purpose && `Purpose: ${e.Purpose}`,
	e.Assumptions && `Assumptions: ${e.Assumptions}`,
	e.Limits && `Limits: ${e.Limits}`,
	e.WhatThen && `What then: ${e.WhatThen}`,
	e.Observability && `Observe: ${e.Observability}`,
	e.FailureMode && `If fails: ${e.FailureMode}`,
	e.DataScale && `Data scale: ${e.DataScale}`,
	e.FreshnessMs != null && `Freshness: ${e.FreshnessMs}ms`
].filter(Boolean).join("\n"), er = (e) => e.split(".")[0] || "app", tr = (e, t, n = "") => typeof e == "function" ? e(t) : e ?? n;
function nr(e, t, n, r, i, a = {}) {
	let o = /* @__PURE__ */ new Map(), s = {
		root: () => a.root,
		width: () => a.root?.getBoundingClientRect().width ?? globalThis.innerWidth,
		set: (e, t) => {
			t && o.set(e, t);
		},
		el: (e) => o.get(e) ?? null
	}, c = [], l = () => c, u = {
		issues: () => c,
		run: () => l(),
		setIssues(e) {
			c = e;
		},
		setRunner(e) {
			l = e;
		}
	};
	return Rn({
		bus: e,
		flags: t,
		io: n,
		perf: r,
		frameLoop: i
	}, {
		places: { create: () => s },
		templates: { create: () => An(a.templates, a.namespace) },
		view: {
			requires: ["places"],
			create: () => Ln(o)
		},
		properties: { create: () => Cn() },
		affordances: { create: ({ bus: e }) => Ne(e) },
		decorations: { create: ({ bus: e }) => _t(e) },
		hierarchy: { create: () => yt() },
		interaction: { create: ({ bus: e }) => wt(e, a.root) },
		commands: { create: ({ bus: e, flags: t, io: n }) => ft(e, (e) => !e || t.isOn(e), n) },
		input: {
			requires: ["commands", "interaction"],
			create: ({ commands: e, perf: t, frameLoop: n, interaction: r }) => pt(e, t, n, void 0, r.editing.active)
		},
		storage: { create: ({ bus: e }) => En(e) },
		fold: { create: ({ bus: e, io: t }) => On(e, t) },
		dx: { create: () => u }
	}, [
		"commands",
		"affordances",
		"decorations",
		"hierarchy",
		"interaction",
		"storage"
	]);
}
function rr(e = "system") {
	return Ze({
		flags: (e) => e.flags,
		teardown: (e, t) => e.contexts.teardown.forEach((e) => e.unregisterOrigin(t)),
		scope(e, t, n) {
			let r = Qe(e.bus, t, n, e.perf);
			return {
				...e,
				bus: r,
				on: r.on,
				emit: r.emit,
				forward: r.forward,
				origin: t,
				contribute: (n) => e.contexts.affordances.contribute({
					...n,
					origin: n.origin ?? t
				}),
				declarePanel: (n) => e.contexts.affordances.declarePanel({
					...n,
					origin: n.origin ?? t
				}),
				expose: (t, n) => {
					e[t] = n;
				}
			};
		},
		setup(e, t, n, r) {
			let i = e.contexts.commands.register, a = (e) => i(e, t), o = e.contexts.commands.register;
			e.contexts.commands.register = a;
			try {
				return n(r);
			} finally {
				e.contexts.commands.register = o;
			}
		}
	}, e);
}
function ir(e, t) {
	let n = ((n, r, i = {}) => e(n, r, {
		...i,
		kind: t
	}));
	return Object.assign(n, {
		start: e.start,
		stop: e.stop,
		names: e.names,
		enabledNames: e.enabledNames,
		requires: e.requires,
		setRequires: e.setRequires,
		kindOf: e.kindOf
	}), n;
}
function ar(e, t, n = {}, r = Ie(), i = {}) {
	let a = hn(n);
	gn(e, a);
	let o = et(a), s = vt(o, n, r), c = wn(e, o), l = kn(() => a.enabled());
	return {
		bus: o,
		graphs: e,
		flags: s,
		selection: c,
		io: r,
		perf: a,
		frameLoop: l,
		sim: Tn(o),
		contexts: nr(o, s, r, a, l, i),
		model: Object.assign(Mt(t, s), {
			components: i.components ?? I,
			contracts: i.contracts ?? be
		})
	};
}
//#endregion
//#region canvas/model/collections.ts
var or = (e) => e, sr = [
	or({
		id: "graphs",
		label: "Graphs",
		kind: "graph",
		items: (e) => e.graphs.all(),
		toolbar: !1
	}),
	or({
		id: "nodes",
		label: "Nodes",
		kind: "node",
		items: (e) => e.graphs.current.nodes(),
		toolbar: !1
	}),
	or({
		id: "edges",
		label: "Edges",
		kind: "edge",
		items: (e) => e.graphs.current.edges(),
		toolbar: {
			text: "Connect",
			icon: "connect",
			order: 15
		}
	})
], cr = (e) => ({
	ui: [],
	...e
}), lr = (e, t, n) => ({
	id: e,
	actions: t,
	journey: jt(n, `ability "${e}"`)
}), ur = (e = () => !0) => lr("collapsible", [cr({
	id: "item.collapse",
	label: "Fold",
	paletteCommand: "item.collapse.toggle",
	ui: [{
		surface: "entity",
		command: "item.collapse.toggle",
		kind: "button",
		when: e,
		slot: t.HeaderStart,
		className: "node-action node-toggle",
		icon: "collapse",
		label: "Toggle fold"
	}]
})], {
	id: "fold-a-card-down-to-its-title",
	intent: "I select a card and collapse it so the board shows less detail.",
	given: [{
		emit: "graph.node.create",
		data: {
			Label: { text: "Journey" },
			Description: "Body worth folding",
			Position: {
				x: 0,
				y: 0
			}
		}
	}],
	steps: [{ click: "[data-place=\"stage\"] .node[data-item-kind=\"node\"][data-item-id]" }, { press: "c" }],
	expect: [{ css: "[data-item-kind=\"node\"].collapsed" }]
});
function dr(e) {
	e("ability.collapsible", ({ on: e, emit: t, contexts: n, graphs: r, selection: i, model: a }) => {
		let o = (e) => g(e.target) ?? i.selected(), s = (e) => e ? e.kind === "node" ? !!r.current.getNode(e.id)?.Description?.trim() || !!a.components.componentBinding(e.id) : !0 : !1;
		n.commands.register([
			{
				id: "item.collapse.toggle",
				label: "Toggle fold",
				event: "fold.toggle",
				group: "item",
				shortcut: "C",
				input: {
					on: "keydown",
					key: "c",
					prevent: !0
				},
				available: (e) => s(o(e ?? {})),
				payload: (e) => {
					let t = o(e);
					return s(t) ? { id: U(t, r.current.id) } : void 0;
				}
			},
			{
				id: "item.collapse.all",
				label: "Collapse all and fit",
				event: "item.collapse.all",
				group: "item",
				available: () => c().length > 0
			},
			{
				id: "item.collapse.open.dblclick",
				label: "Unfold item on double-click",
				event: "fold.toggle",
				group: "item",
				hidden: !0,
				input: {
					on: "dblclick",
					selector: "[data-item-kind].collapsed",
					prevent: !0,
					stop: !0
				},
				payload: (e) => {
					let t = g(e.target);
					return t ? { id: U(t, r.current.id) } : void 0;
				}
			}
		]);
		let c = () => r.current.nodes().filter((e) => !!e.Description?.trim() || !!a.components.componentBinding(e.id)).map((e) => U({
			kind: "node",
			id: e.id
		}, r.current.id));
		e("item.collapse.all", () => {
			let e = c(), r = e.every((e) => n.fold.folded(e));
			e.forEach((e) => n.fold.set(e, r)), t("view.fit.all");
		}), e("graph.node.updated", ({ id: e, patch: t }) => {
			if (!t || !("Description" in t) || r.current.getNode(e)?.Description?.trim()) return;
			let i = U({
				kind: "node",
				id: e
			}, r.current.id);
			n.fold.folded(i) && n.fold.set(i, !0);
		});
	}, { requires: ["ability.selectable"] });
}
//#endregion
//#region canvas/abilities/configurable-inspector.ts
var fr = ({ contexts: t, entityDef: n, groupFoldId: r, groupOpen: i, graphs: a, item: o, model: s, selection: c, emit: l }) => {
	let d = (e, t, n, r = {}, i) => u("button.context-action.context-action-card", {
		type: "button",
		class: [i ? "active" : "", t.includes("delete") ? "danger" : ""].filter(Boolean).join(" ") || void 0,
		"aria-label": e,
		"aria-pressed": i === void 0 ? void 0 : i ? "true" : "false",
		data: {
			command: t,
			...r
		}
	}, [u("span.context-action-icon", [yn(n)]), u("span.context-action-label", { text: e })]), p = (e, t) => u("section.context-action-group", { class: t.some((e) => e.classList.contains("danger")) ? "danger" : void 0 }, [u("h3", { text: e }), u(".context-action-grid", t)]), m = (e, n) => {
		let r = u("section.context-actions.context-actions-combined");
		if (e.kind === "node" && s.components.componentBinding(e.id)) r.append(p("Card", [d("Run now", "component.run", "check"), d("Collapse / expand", "item.collapse.toggle", "collapse")])), r.append(p("Danger", [d("Delete", "selection.item.delete", "trash")]));
		else if (e.kind === "node") {
			let e = n.NodeType ?? "text", i = [d("Convert to container", "node.convert.container", "container"), d("Group", "selection.group", "group")];
			a.current.itemsOfKind("ink").length && i.unshift(d("Select drawings", "ink.select.all", "draw")), e === "toggle" && i.unshift(d(n.ToggleState ? "Turn off" : "Turn on", "node.toggle.state", "toggle")), t.commands.get("palette.custom-type.create") && i.push(d("Save as type", "palette.custom-type.create", "star")), r.append(p(`Selected ${s.nodeType(e)?.label ?? e}`, i)), r.append(p("Danger", [d("Delete", "selection.item.delete", "trash")]));
		}
		if (e.kind === "edge" && (r.append(p("Connection", [d("Reverse direction", "graph.edge.reverse", "reverse")])), r.append(p("Danger", [d("Delete connection", "graph.edge.delete", "trash")]))), e.kind === "container") {
			let t = [d("Convert to node", "container.convert.node", "node"), d("Fold / unfold", "item.collapse.toggle", "collapse")];
			a.current.getItem(e)?.Children?.length && t.unshift(d("Ungroup, keep contents", "container.ungroup", "ungroup")), r.append(p("Boundary", t)), r.append(p("Danger", [d("Delete…", "container.delete.request", "trash")]));
		}
		let i = t.hierarchy.parentRefOf(e), o = i?.kind === "container" ? a.current.getItem(i) : null;
		if (i?.kind === "container" && o) {
			let t = [d("Move out", "container.remove-child", "move-out")];
			o.Sections?.forEach((n) => {
				let r = o.ChildSections?.[R(e)] === n.id;
				t.push(d(n.title, "container.child.section.set", r ? "check" : "move-out", {
					containerId: i.id,
					childKind: e.kind,
					childId: e.id,
					sectionId: n.id
				}, r));
			}), r.append(p("Placement", t));
		}
		return r;
	}, h = (e, t) => {
		let r = t.Label?.text?.trim(), i = (e) => {
			let t = e ? a.current.refById(e) : void 0;
			return t ? a.current.getItem(t)?.Label?.text : void 0;
		}, o = t, s = i(o.From), c = i(o.To), l = n(e)?.titlePlaceholder?.();
		return u("input.item-modal-title", {
			type: "text",
			...l ? { placeholder: l } : {},
			value: e.kind === "edge" && !r ? s && c ? `${s} → ${c}` : "Connection" : r || "Untitled",
			spellcheck: !1,
			"aria-label": "Item title",
			data: {
				itemModalTitle: "",
				itemKind: e.kind,
				itemId: e.id
			}
		});
	}, g = (e) => {
		let t = e ? a.current.refById(e) : void 0;
		return t ? a.current.getItem(t)?.Label?.text?.trim() || t.id : "Missing endpoint";
	}, _ = (e) => {
		let t = e, n = g(t.From), r = g(t.To);
		return u(".properties-edge-route", { "aria-label": `${n} to ${r}` }, [
			u("span", { text: n }),
			u("b", {
				text: "→",
				"aria-hidden": "true"
			}),
			u("span", { text: r })
		]);
	}, v = (e) => {
		let t = e.NodeType ?? "text", n = s.nodeType(t)?.label ?? t;
		return u("section.property-type-control", [u("span", { text: "Type" }), u("button", {
			type: "button",
			"aria-label": `Change node type. Current type: ${n}`,
			data: { command: "node.type.open" }
		}, [u("strong", { text: n }), u("small", { text: "Search node types" })])]);
	}, y = (e = "", t = 0) => {
		let n = u("button", {
			type: "button",
			"aria-label": `Remove section ${t + 1}`,
			data: {
				command: "properties.sections.remove",
				sectionIndex: t
			}
		});
		return bn(n, "trash"), u(".property-section-row", { data: { sectionRow: t } }, [
			u("span", { text: t + 1 }),
			u("input", {
				type: "text",
				value: e,
				"aria-label": `Section ${t + 1} name`,
				data: { sectionInput: "" }
			}),
			n
		]);
	}, b = [[
		"columns",
		"layout-columns",
		"Side by side"
	], [
		"rows",
		"layout-rows",
		"Stacked"
	]], x = (e, t, n) => {
		let r = String(n.find((e) => e.id === "sectionAxis")?.value(t) ?? "rows"), i = t.Sections ?? [];
		return u("section.property-structure-editor", { data: {
			itemKind: e.kind,
			itemId: e.id
		} }, [
			u("header", [u("span", { text: "Container structure" }), u("small", { text: "Choose how named regions divide the container." })]),
			u(".property-axis-choice", b.map(([e, t, n]) => u("button", {
				type: "button",
				class: r === e ? "active" : void 0,
				"aria-pressed": r === e ? "true" : "false",
				data: {
					command: "properties.structure.axis",
					axis: e
				}
			}, [u("b", [yn(t)]), u("span", { text: n })]))),
			u(".property-section-list", { data: { sectionList: "" } }, (i.length ? i : [{ title: "Section 1" }]).map((e, t) => y(e.title, t))),
			u("button.property-section-add", {
				type: "button",
				text: "+ Add region",
				data: { command: "properties.sections.add" }
			})
		]);
	}, S = (e, n, a) => {
		let o = t.templates.clone("properties");
		o.dataset.itemKind = e.kind, o.dataset.itemId = e.id;
		let s = f(e.parent);
		s && (o.dataset.itemParent = s);
		let c = t.templates.slot(o, "fields"), l = e.kind === "container" ? a.filter((e) => e.id === "sectionAxis" || e.id === "sections") : [];
		l.length && c.append(x(e, n, l));
		let u = e.kind === "node" && !!t.commands.get("node.type.open");
		u && c.append(v(n));
		let d = /* @__PURE__ */ new Map();
		return a.filter((t) => ![
			"title",
			...u ? ["nodeType"] : [],
			...e.kind === "edge" ? ["label"] : []
		].includes(t.id) && !l.includes(t)).forEach((t) => {
			let n = e.kind === "node" ? [
				"color",
				"fill",
				"borderColor",
				"descPlacement",
				"width",
				"height"
			].includes(t.id) ? "Appearance" : ["linkUrl", "imageAlt"].includes(t.id) ? "Media" : void 0 : e.kind === "edge" && ["edgeKind", "color"].includes(t.id) ? "Appearance" : void 0, r = t.group ?? n ?? "default";
			(d.get(r) ?? d.set(r, []).get(r)).push(t);
		}), [
			...d.has("default") ? ["default"] : [],
			...[...d.keys()].filter((e) => e !== "default" && e !== "Appearance"),
			...d.has("Appearance") ? ["Appearance"] : []
		].forEach((a) => {
			let o = d.get(a) ?? [];
			if (a !== "default") {
				let s = i(e, a), l = o.filter((e) => !!e.options?.length).map((e) => {
					let t = String(e.value(n) ?? "");
					return e.options?.find((e) => e.value === t)?.label ?? t;
				}).filter((e) => e && e !== "undefined").slice(0, 3).join(" · "), u = Wn({
					id: r(e, a),
					label: a,
					open: s,
					defaultOpen: !1,
					...l ? { summary: l } : {},
					body: () => o.map((e) => t.properties.render(e, n))
				});
				u.dataset.propertyGroup = a, c.append(u);
				return;
			}
			o.forEach((e) => c.append(t.properties.render(e, n)));
		}), c.append(m(e, n)), o;
	}, C = (e, t, r) => {
		let i = o(e);
		if (!i) return;
		let a = tt(n(e)?.properties, i).find((e) => e.id === t)?.patch(i, r);
		a && l("item.update", {
			ref: e,
			patch: a
		});
	}, w = () => c.selected(), T = !1, E = () => {
		T || (T = !0, queueMicrotask(() => {
			T = !1, l("tool.panel.redraw", { id: "properties" });
		}));
	}, D = () => t.places.el(e.Right)?.querySelector("[data-panel-id=\"properties\"]"), O = () => {
		if (c.selectedAll().length !== 1) return;
		let e = w();
		if (!e) return;
		let t = o(e), r = n(e), i = t ? tt(r?.properties, t) : [];
		if (!(!t || !r || !i.length)) return {
			ref: e,
			current: t,
			entity: r,
			properties: i
		};
	};
	return {
		applyProperty: C,
		inspectable: O,
		inspectorRoot: D,
		queueInspectorRedraw: E,
		renderInspector: () => {
			let e = O();
			if (!e) return u("div");
			let t = e.ref.kind === "node" ? s.nodeType(e.current.NodeType ?? "text")?.label : void 0, n = u("aside.properties-inspector", { "aria-label": `${e.entity.label} properties` }), r = u("header.properties-context-header", [u("span", { text: t ?? e.entity.label })]);
			e.ref.kind === "edge" && r.append(_(e.current)), r.append(h(e.ref, e.current));
			let i = u(".properties-inspector-scroll");
			i.dataset.nativeScroll = "", i.append(r, S(e.ref, e.current, e.properties));
			let a = u("p.properties-autosave-note", { text: "Changes save automatically" });
			return n.append(i, a), n;
		},
		sectionRow: y,
		selected: w
	};
}, pr = () => lr("configurable", [cr({
	id: "item.configure",
	label: "Edit details",
	paletteCommand: "item.properties.open",
	ui: [{
		surface: "entity",
		command: "item.properties.open",
		kind: "button",
		slot: t.HeaderEnd,
		className: "node-action node-config",
		text: "Edit",
		label: "Edit title, description, and shape"
	}]
})], {
	id: "edit-a-cards-details-in-the-inspector",
	intent: "I select a card and change its details in the panel beside the board.",
	given: [{
		emit: "graph.node.create",
		data: {
			Label: { text: "Journey" },
			Position: {
				x: 0,
				y: 0
			}
		}
	}],
	steps: [{ click: "[data-place=\"stage\"] .node[data-item-kind=\"node\"][data-item-id]" }],
	expect: [{ css: ".properties [data-field]" }]
});
function mr(t) {
	t("ability.configurable", ({ on: t, emit: n, contexts: r, graphs: i, model: a, selection: o, declarePanel: s }) => {
		let c = (e) => g(e?.closest(".properties")) ?? {
			kind: "node",
			id: ""
		}, l = (e) => i.current.getItem(e), u = (e) => a.entity(e.kind), d = (e) => [...e.querySelectorAll("[data-section-input]")].map((e) => e.value.trim()).filter(Boolean), f = (e, t) => `properties.group:${e.kind}:${e.id}:${t}`, { applyProperty: p, inspectable: m, inspectorRoot: h, queueInspectorRedraw: _, renderInspector: v, sectionRow: y, selected: b } = fr({
			contexts: r,
			emit: n,
			entityDef: u,
			groupFoldId: f,
			groupOpen: (e, t) => r.fold.isOpen(f(e, t), !1),
			graphs: i,
			item: l,
			model: a,
			selection: o
		});
		s({
			id: "properties",
			anchor: "top-right",
			place: e.Right,
			movable: !1,
			layout: "custom",
			render: v,
			order: 1,
			dock: {
				command: "item.properties.open",
				label: "Properties",
				icon: "more"
			},
			mountWhen: () => !!m()
		});
		let x = 0, S = (t) => {
			!t || t.kind === "edge" || r.places.width() <= 680 || (cancelAnimationFrame(x), x = requestAnimationFrame(() => {
				let i = r.places.el(e.Stage), a = r.places.el(e.Right), o = i?.querySelector(`[data-item-kind="${t.kind}"][data-item-id="${t.id}"]`);
				if (!o || !a?.childElementCount) return;
				let s = o.getBoundingClientRect(), c = a.getBoundingClientRect();
				s.left < c.right && s.right > c.left && s.top < c.bottom && s.bottom > c.top && n("view.fit.item", t);
			}));
		};
		r.commands.register([
			{
				id: "item.properties.open",
				label: "Open item inspector",
				group: "item",
				available: (e) => !!g(e?.target) || !!b(),
				payload: (e) => g(e.target) ?? b() ?? void 0
			},
			{
				id: "properties.title.input",
				label: "Rename item from inspector",
				group: "properties",
				hidden: !0,
				input: {
					on: "input",
					selector: "[data-item-modal-title]"
				},
				payload: ({ target: e }) => ({
					ref: g(e) ?? {
						kind: "node",
						id: ""
					},
					value: e.value
				})
			},
			{
				id: "properties.title.finish.enter",
				label: "Finish inspector title (Enter)",
				event: "properties.title.finish",
				group: "properties",
				hidden: !0,
				input: {
					on: "keydown",
					key: "Enter",
					selector: "[data-item-modal-title]",
					prevent: !0,
					stop: !0
				},
				payload: ({ target: e }) => ({ ref: g(e) ?? {
					kind: "node",
					id: ""
				} })
			},
			{
				id: "properties.structure.axis",
				label: "Change container section direction",
				group: "properties",
				hidden: !0,
				payload: ({ target: e }) => ({
					ref: c(e),
					value: e.closest("[data-axis]")?.getAttribute("data-axis") ?? "rows"
				})
			},
			{
				id: "properties.sections.input",
				label: "Rename container section",
				group: "properties",
				hidden: !0,
				input: {
					on: "input",
					selector: ".properties [data-section-input]"
				},
				payload: ({ target: e }) => ({
					ref: c(e),
					value: d(e?.closest(".properties") ?? document.body).join("\n")
				})
			},
			{
				id: "properties.sections.add",
				label: "Add container section",
				group: "properties",
				hidden: !0,
				payload: ({ target: e }) => ({ ref: c(e) })
			},
			{
				id: "properties.sections.remove",
				label: "Remove container section",
				group: "properties",
				hidden: !0,
				payload: ({ target: e }) => ({
					ref: c(e),
					index: Number(e.closest("[data-section-index]")?.getAttribute("data-section-index") ?? -1)
				})
			},
			{
				id: "properties.item.choice",
				label: "Choose item property",
				group: "properties",
				hidden: !0,
				payload: ({ target: e }) => {
					let t = e.closest("[data-field][data-value]");
					return {
						ref: c(t),
						field: t?.dataset.field ?? "",
						value: t?.dataset.value ?? ""
					};
				}
			},
			{
				id: "properties.item.input",
				label: "Edit item property",
				group: "properties",
				hidden: !0,
				input: {
					on: "input",
					selector: ".properties input[data-field]:not([type=\"checkbox\"]), .properties textarea[data-field]"
				},
				payload: ({ target: e }) => ({
					ref: c(e),
					field: e?.getAttribute("data-field") ?? "",
					value: e.value
				})
			},
			{
				id: "properties.item.select",
				label: "Select item property",
				event: "properties.item.input",
				group: "properties",
				hidden: !0,
				input: {
					on: "change",
					selector: ".properties select[data-field]"
				},
				payload: ({ target: e }) => ({
					ref: c(e),
					field: e?.getAttribute("data-field") ?? "",
					value: e.value
				})
			},
			{
				id: "properties.item.toggle",
				label: "Toggle item property",
				group: "properties",
				hidden: !0,
				input: {
					on: "change",
					selector: ".properties input[type=\"checkbox\"][data-field]"
				},
				payload: ({ target: e }) => ({
					ref: c(e),
					field: e?.getAttribute("data-field") ?? "",
					checked: e.checked
				})
			}
		]), t("item.properties.open", (e) => {
			let t = l(e), r = u(e), i = t ? tt(r?.properties, t) : [];
			!t || !r || !i.length || ((b()?.kind !== e.kind || b()?.id !== e.id) && n("selection.item.select", e), n("tool.panel.redraw", { id: "properties" }), S(e), queueMicrotask(() => h()?.querySelector("[data-item-modal-title]")?.focus()));
		}), t("properties.title.input", ({ ref: e, value: t }) => p(e, e.kind === "edge" ? "label" : "title", t)), t("properties.title.finish", ({ ref: e }) => {
			let t = h()?.querySelector("[data-item-modal-title]"), n = g(t);
			n?.kind === e.kind && n.id === e.id && t?.blur();
		}), t("properties.item.input", ({ ref: e, field: t, value: n }) => p(e, t, n)), t("properties.item.choice", ({ ref: e, field: t, value: n }) => {
			p(e, t, n), h()?.querySelectorAll(`[data-field="${t}"][data-value]`).forEach((e) => {
				e.setAttribute("aria-pressed", e.dataset.value === n ? "true" : "false");
			});
		}), t("properties.item.toggle", ({ ref: e, field: t, checked: n }) => p(e, t, n)), t("properties.structure.axis", ({ ref: e, value: t }) => {
			p(e, "sectionAxis", t), h()?.querySelectorAll("[data-axis]").forEach((e) => {
				let n = e.dataset.axis === t;
				e.classList.toggle("active", n), e.setAttribute("aria-pressed", n ? "true" : "false");
			});
		}), t("properties.sections.input", ({ ref: e, value: t }) => p(e, "sections", t)), t("properties.sections.add", ({ ref: e }) => {
			let t = h()?.querySelector("[data-section-list]");
			t && (t.append(y(`Section ${t.children.length + 1}`, t.children.length)), p(e, "sections", d(t).join("\n")), t.querySelectorAll("[data-section-row]").forEach((e, t) => {
				e.dataset.sectionRow = `${t}`;
			}), t.lastElementChild?.querySelector("input")?.focus());
		}), t("properties.sections.remove", ({ ref: e, index: t }) => {
			let n = h()?.querySelector("[data-section-list]");
			!n || n.children.length <= 1 || t < 0 || (n.children[t]?.remove(), [...n.children].forEach((e, t) => {
				e.dataset.sectionRow = `${t}`;
				let n = e.querySelector("span");
				n && (n.textContent = `${t + 1}`);
				let r = e.querySelector("[data-section-index]");
				r && (r.dataset.sectionIndex = `${t}`);
			}), p(e, "sections", d(n).join("\n")));
		}), t("selection.changed", () => {
			_(), S(b());
		}), t("fold.changed", ({ id: e }) => {
			e.startsWith("properties.group:") && n("tool.panel.redraw", { id: "properties" });
		}), t("ink.stroke.completed", () => n("tool.panel.redraw", { id: "properties" })), t("ink.stroke.deleted", () => n("tool.panel.redraw", { id: "properties" })), t("graph.switched", () => {
			n("tool.panel.redraw", { id: "properties" });
		});
	}, { requires: ["ability.selectable", "tool.panel"] });
}
var hr = ({ travel: e, swipe: t }) => Math.max(0, Math.min(e, t)), gr = (e, t) => {
	let { travel: n, swipe: r } = e;
	if (n <= r) return null;
	let i = t({
		...e,
		travel: r
	}), a = i - t({
		...e,
		travel: r - 1
	});
	return i + (n - r) * a;
}, _r = (e) => hr(e) / e.scale, vr = (e) => {
	let t = hr(e);
	return t / e.scale + Math.max(0, e.reach - e.swipe / e.scale) * (t / e.swipe) ** 3;
}, yr = (e) => {
	let t = hr(e), { swipe: n, scale: r, reach: i } = e, a = i * r;
	if (a <= n) return t / r;
	let o = Math.log(a / n) / n;
	for (let e = 0; e < 24; e += 1) {
		let e = Math.exp(o * n), t = (e - 1) / o - a, r = n * e / o - (e - 1) / (o * o);
		if (!Number.isFinite(r) || r === 0) break;
		let i = o - t / r;
		if (!Number.isFinite(i) || i <= 0) break;
		if (Math.abs(i - o) < 1e-12) {
			o = i;
			break;
		}
		o = i;
	}
	return (Math.exp(o * t) - 1) / (o * r);
}, br = .7, xr = (e) => {
	let t = e[e.length - 1], n = Math.min(12, e.length), r = [];
	for (let t = 1; t <= n; t += 1) r.push(e[Math.min(e.length - 1, Math.round(t / n * e.length) - 1)]);
	let i = [], a = 0;
	r.forEach((e, o) => {
		let s = e - (o === 0 ? 0 : r[o - 1]);
		a += br / n + (1 - br) * (s / t), i.push(a);
	});
	let o = a || 1;
	return (e) => {
		let t = Math.max(0, Math.min(1, e)) * o, n = i.findIndex((e) => e >= t);
		n < 0 && (n = i.length - 1);
		let a = n === 0 ? 0 : i[n - 1], s = i[n], c = s > a ? (t - a) / (s - a) : 1, l = n === 0 ? 0 : r[n - 1];
		return l + (r[n] - l) * Math.max(0, Math.min(1, c));
	};
}, Sr = {
	linear: _r,
	power: vr,
	exponential: yr,
	quantile: (e) => {
		let t = (e.ahead ?? []).filter((e) => Number.isFinite(e) && e > 0).sort((e, t) => e - t);
		if (!t.length || t[t.length - 1] <= 0) return vr(e);
		let n = t[t.length - 1], r = vr({
			...e,
			reach: n
		}) / n;
		return xr(t)(r);
	}
}, Cr = (e, t) => {
	let n = Sr[e], r = gr(t, n) ?? n(t);
	return Math.max(r, gr(t, _r) ?? _r(t));
}, wr = (e, t, n) => {
	let r = [], i = 0;
	return n.forEach((n) => {
		let a = (n.x - e.x) * t.x + (n.y - e.y) * t.y;
		a <= 0 || (r.push(a), i = Math.max(i, a));
	}), {
		ahead: r,
		reach: i
	};
}, Tr = ({ travel: e, swipe: t, rate: n, from: r, to: i, dir: a }) => {
	let o = Math.log(i) - Math.log(r), s = Math.sign(o) === a ? Math.abs(o) : 0, c = Math.min(Math.max(0, e), t), l = Math.max(0, s - n * t), u = n * c + l * (c / t) ** 3, d = s > 0 ? Math.min(s, u) : u, f = Math.max(0, e - t) * n;
	return r * Math.exp(a * (d + f));
}, Er = ".stage.ink-erasing, .tool-panel, .item-toolbar, .modal-layer, [data-command], [data-resize-handle], [data-container-section-title], [data-container-section-resize], .component-rows, .component-json-body, .component-form-fields, .monaco-editor, [data-interactive], .editing, [contenteditable=\"true\"], [contenteditable=\"plaintext-only\"], input, textarea, select, button, label", Dr = () => lr("draggable", [cr({
	id: "item.drag",
	label: "Drag item directly",
	ui: [{
		surface: "entity",
		command: "drag.item.surface.start",
		kind: "handler",
		slot: t.Drag,
		attrs: { "data-drag-surface": "" }
	}]
})], {
	id: "drag-a-card-across-the-board",
	intent: "I press on a card and move it somewhere else on the board.",
	given: [{
		emit: "graph.node.create",
		data: {
			Label: { text: "Journey" },
			Position: {
				x: 0,
				y: 0
			}
		}
	}],
	steps: [{
		drag: "[data-drag-surface]",
		by: {
			x: 80,
			y: 40
		}
	}],
	expect: [{ emitted: "graph.node.updated" }]
});
function Or(t) {
	t("ability.draggable", ({ on: t, emit: n, contexts: r, graphs: i, perf: a }) => {
		let o = null, s = !0;
		t("view.turbo.toggle", () => {
			s = !s;
		});
		let c = null, l = null, u = () => {
			let t = o, u = c;
			if (!t || !u) return;
			c = null;
			let d = a.enabled() ? performance.now() : 0, f = {
				x: u.x - t.client.x,
				y: u.y - t.client.y
			}, p = Math.hypot(f.x, f.y);
			if (!t.moved && p < 4) return;
			let m = r.view.get().scale;
			if (s && !t.gesture && p >= 4 && (t.gesture = wr(t.start, {
				x: f.x / p,
				y: f.y / p
			}, i.current.nodes().filter((e) => e.id !== t.ref.id).map((e) => e.Position).filter((e) => !!e))), s && t.gesture && t.gesture.reach > 0 && p >= 1) {
				let e = Cr("quantile", {
					travel: p,
					swipe: 600,
					scale: m,
					reach: t.gesture.reach,
					ahead: t.gesture.ahead
				}) - p / m;
				(e > 0 || t.panned) && (r.view.set({
					x: t.view.x + f.x / p * Math.max(0, e),
					y: t.view.y + f.y / p * Math.max(0, e)
				}), t.panned = !0);
			}
			let h = r.view.clientToSpace(e.Stage, u), g = {
				x: t.start.x + h.x - t.pointer.x,
				y: t.start.y + h.y - t.pointer.y
			};
			if (!t.moved && (t.moved = !0, t.el && typeof t.el.setPointerCapture == "function")) try {
				t.el.setPointerCapture(t.pointerId), l = {
					el: t.el,
					id: t.pointerId
				};
			} catch {}
			t.ref.kind === "node" ? (i.current.updateNode(t.ref.id, { Position: g }), n("graph.node.updated", {
				graphId: i.current.id,
				id: t.ref.id,
				patch: { Position: g },
				visual: !0
			})) : n("item.update", {
				ref: t.ref,
				patch: { Position: g }
			}), t.panned && n("view.changed", r.view.get()), a.enabled() && (a.count("Drag.move"), a.sample("Drag.move.ms", performance.now() - d));
		}, d = ({ event: e, target: t }) => {
			let n = e;
			f = {
				el: t instanceof Element ? t : null,
				id: n.pointerId
			};
			let r = g(t);
			return r ? {
				ref: r,
				x: n.clientX,
				y: n.clientY
			} : void 0;
		}, f = {
			el: null,
			id: 0
		};
		r.commands.register([
			{
				id: "drag.item.surface.start",
				label: "Start drag from item body",
				event: "drag.item.start",
				group: "drag",
				hidden: !0,
				input: {
					on: "pointerdown",
					selector: "[data-drag-surface]",
					priority: -10,
					when: (e) => !e.target.closest(Er)
				},
				payload: d
			},
			{
				id: "drag.item.move",
				label: "Move dragged item",
				group: "drag",
				hidden: !0,
				input: {
					on: "pointermove",
					when: () => !!o,
					prevent: !0
				},
				payload: ({ event: e }) => ({
					x: e.clientX,
					y: e.clientY
				})
			},
			{
				id: "drag.item.end",
				label: "End drag",
				group: "drag",
				hidden: !0,
				input: {
					on: "pointerup",
					when: () => !!o
				}
			}
		]), t("drag.item.start", ({ ref: t, x: n, y: a }) => {
			let s = i.current.getItem(t);
			s?.Position && (o = {
				ref: t,
				pointer: r.view.clientToSpace(e.Stage, {
					x: n,
					y: a
				}),
				start: { ...s.Position },
				client: {
					x: n,
					y: a
				},
				moved: !1,
				el: f.el,
				pointerId: f.id,
				gesture: null,
				view: {
					x: r.view.get().x,
					y: r.view.get().y
				},
				panned: !1
			});
		}), t("drag.item.move", ({ x: e, y: t }) => {
			o && (c = {
				x: e,
				y: t
			}, u());
		}), t("drag.item.end", () => {
			let e = o;
			if (c && e && u(), l) {
				try {
					l.el.releasePointerCapture?.(l.id);
				} catch {}
				l = null;
			}
			if (e?.moved) {
				let t = i.current.getItem(e.ref);
				t?.Position && e.ref.kind === "node" && n("item.update", {
					ref: e.ref,
					patch: { Position: t.Position }
				}), t?.Position && n("drag.item.moved", { ref: e.ref });
			}
			o = null, c = null;
		});
	});
}
//#endregion
//#region canvas/abilities/editable.ts
var kr = () => lr("editable", [cr({
	id: "item.title.edit",
	label: "Rename item",
	paletteCommand: "item.title.edit",
	ui: [{
		surface: "entity",
		command: "item.title.edit",
		kind: "button",
		slot: t.HeaderEnd,
		className: "node-config node-rename",
		text: "Rename",
		label: "Rename item"
	}]
})], {
	id: "rename-a-card-in-place",
	intent: "I double-click a card’s title and type a new name straight into the board.",
	given: [{
		emit: "graph.node.create",
		data: {
			Label: { text: "Journey" },
			Position: {
				x: 0,
				y: 0
			}
		}
	}],
	steps: [{ dblclick: "[data-item-kind=\"node\"].selected [data-editable-title]" }],
	expect: [{ css: "[data-editable-title].editing" }]
});
function Ar(t) {
	t("ability.editable", ({ on: t, emit: n, contexts: r, graphs: i, selection: a, origin: o, frameLoop: s }) => {
		let c = "editable.title.finish.focus", l = (t) => [...r.places.el(e.Stage)?.querySelectorAll(`[data-item-kind="${t.kind}"][data-item-id="${t.id}"]`) ?? []].filter((e) => !e.closest(".tool-panel, .item-toolbar")), u = (e) => l(e)[0], d = (e, t) => {
			for (let n of l(e)) {
				let e = n.querySelector(t);
				if (e instanceof HTMLElement) return e;
			}
			return null;
		}, f = (e) => d(e, "[data-editable-title]"), p = (e) => d(e, "[data-editable-description]"), m = (e) => g(e.target) ?? a.selected(), h = (e, t = !1) => {
			let n = g(e);
			return n ? {
				ref: n,
				text: e?.textContent?.trim() ?? "",
				finish: t
			} : void 0;
		}, _ = null, v = null, y = null, b = 0, x = "", S = /* @__PURE__ */ new WeakMap(), C = (e) => {
			e.contentEditable = "plaintext-only", e.setAttribute("role", "textbox"), e.setAttribute("aria-label", "Item title"), e.hasAttribute("tabindex") || (e.dataset.editableManagedTabindex = "true", e.tabIndex = -1), e.classList.add("editing"), e.focus();
			let t = document.createRange();
			t.selectNodeContents(e);
			let n = getSelection();
			n?.removeAllRanges(), n?.addRange(t);
		}, w = (e) => {
			e.contentEditable = "inherit", e.removeAttribute("role"), e.removeAttribute("aria-label"), e.dataset.editableManagedTabindex && (delete e.dataset.editableManagedTabindex, e.removeAttribute("tabindex")), e.classList.remove("editing");
		}, T = (e, t) => {
			S.set(e, [...e.childNodes].map((e) => e.cloneNode(!0))), e.replaceChildren(document.createTextNode(t)), C(e), e.setAttribute("aria-label", "Markdown description");
		}, E = (e) => {
			let t = S.get(e);
			t && e.replaceChildren(...t.map((e) => e.cloneNode(!0))), S.delete(e);
		};
		r.commands.register([
			{
				id: "item.title.edit",
				label: "Rename item",
				group: "item",
				shortcut: "Enter",
				input: {
					on: "keydown",
					key: "Enter",
					prevent: !0,
					when: (e) => !e.target.closest(".modal-layer, button, [role=\"menuitem\"]")
				},
				available: (e) => !!m(e ?? {}),
				payload: (e) => {
					let t = m(e);
					return t ? { ref: t } : void 0;
				}
			},
			{
				id: "item.title.edit.dblclick",
				label: "Edit title on double-click",
				event: "item.title.edit",
				group: "item",
				hidden: !0,
				input: {
					on: "dblclick",
					selector: "[data-editable-title], [data-edge-label-trigger]",
					when: (e) => {
						let t = e.target instanceof Element ? e.target : null;
						return t?.closest(".collapsed") ? !1 : !t?.closest(".edge-label-wrap") || performance.now() >= b;
					},
					prevent: !0
				},
				payload: ({ target: e }) => {
					let t = g(e);
					return t ? { ref: t } : void 0;
				}
			},
			{
				id: "item.title.edit.multiclick",
				label: "Edit title on second click",
				event: "item.title.pointer",
				group: "item",
				hidden: !0,
				input: {
					on: "pointerdown",
					selector: ".edge-label, [data-edge-label-trigger]",
					priority: -10
				},
				payload: ({ target: e }) => {
					let t = g(e);
					return t ? { ref: t } : void 0;
				}
			},
			{
				id: "item.title.commit.enter",
				label: "Commit title (Enter)",
				event: "item.title.commit",
				group: "item",
				hidden: !0,
				input: {
					on: "keydown",
					key: "Enter",
					selector: "[data-editable-title].editing",
					prevent: !0,
					stop: !0
				},
				payload: ({ target: e }) => h(e, !0)
			},
			{
				id: "item.title.commit.focusout",
				label: "Commit title on focusout",
				event: "item.title.commit",
				group: "item",
				hidden: !0,
				input: {
					on: "focusout",
					selector: "[data-editable-title].editing"
				},
				payload: ({ target: e }) => h(e)
			},
			{
				id: "item.description.edit",
				label: "Edit item description",
				group: "item",
				shortcut: "Shift+Enter",
				input: {
					on: "keydown",
					key: "Enter",
					shift: !0,
					prevent: !0,
					when: (e) => !e.target.closest(".modal-layer, button, [role=\"menuitem\"]")
				},
				available: (e) => {
					let t = m(e ?? {});
					return !!t && !!p(t);
				},
				payload: (e) => {
					let t = m(e);
					return t ? { ref: t } : void 0;
				}
			},
			{
				id: "item.description.edit.dblclick",
				label: "Edit description on double-click",
				event: "item.description.edit",
				group: "item",
				hidden: !0,
				input: {
					on: "dblclick",
					selector: "[data-editable-description]",
					prevent: !0
				},
				payload: ({ target: e }) => {
					let t = g(e);
					return t ? { ref: t } : void 0;
				}
			},
			{
				id: "item.description.commit.ctrl-enter",
				label: "Commit description (Ctrl+Enter)",
				event: "item.description.commit",
				group: "item",
				hidden: !0,
				input: {
					on: "keydown",
					key: "Enter",
					ctrl: !0,
					selector: "[data-editable-description].editing",
					prevent: !0,
					stop: !0
				},
				payload: ({ target: e }) => h(e, !0)
			},
			{
				id: "item.description.commit.meta-enter",
				label: "Commit description (Command+Enter)",
				event: "item.description.commit",
				group: "item",
				hidden: !0,
				input: {
					on: "keydown",
					key: "Enter",
					meta: !0,
					selector: "[data-editable-description].editing",
					prevent: !0,
					stop: !0
				},
				payload: ({ target: e }) => h(e, !0)
			},
			{
				id: "item.description.commit.focusout",
				label: "Commit description on focusout",
				event: "item.description.commit",
				group: "item",
				hidden: !0,
				input: {
					on: "focusout",
					selector: "[data-editable-description].editing"
				},
				payload: ({ target: e }) => h(e)
			}
		]), t("item.title.pointer", ({ ref: e }) => {
			let t = performance.now(), r = y && y.ref.kind === e.kind && y.ref.id === e.id && t - y.at <= 500;
			y = r ? null : {
				ref: e,
				at: t
			}, r && (b = t + 200, setTimeout(() => n("item.title.edit", { ref: e }), 0));
		}), t("item.title.edit", ({ ref: e }) => {
			s.cancel(c), queueMicrotask(() => {
				let t = f(e);
				t && (_ = e, x = i.current.getItem(e)?.Label?.text ?? "", C(t));
			});
		}), t("item.title.commit", ({ ref: e, text: t, finish: r }) => {
			let a = i.current.getItem(e);
			if (!a) return;
			let o = a.Label?.text ?? "";
			if (t && t !== o && n("item.update", {
				ref: e,
				patch: { Label: { text: t } }
			}), !t) {
				let t = f(e);
				t && (t.textContent = o);
			}
			let l = f(e);
			l && w(l), r && s.schedule(c, () => queueMicrotask(() => {
				let t = f(e), n = t?.closest("[data-item-kind][data-item-id]");
				t?.blur(), n?.focus({ preventScroll: !0 });
			}), 30), _ && _.kind === e.kind && _.id === e.id && (_ = null);
		}), t("item.description.edit", ({ ref: e }) => {
			s.cancel(c), queueMicrotask(() => {
				let t = p(e), n = i.current.getItem(e);
				!t || !n || (v = e, T(t, n.Description ?? ""));
			});
		}), t("item.description.commit", ({ ref: e, text: t, finish: r }) => {
			let a = i.current.getItem(e), o = p(e);
			if (!a || !o) return;
			let l = t.trim();
			l === (a.Description ?? "") ? E(o) : n("item.update", {
				ref: e,
				patch: { Description: l }
			}), w(o), r && s.schedule(c, () => queueMicrotask(() => {
				let t = u(e);
				p(e)?.blur(), t?.focus({ preventScroll: !0 });
			}), 30), v && v.kind === e.kind && v.id === e.id && (v = null);
		});
		let D = () => {
			let e = v ?? _;
			if (!e) return null;
			let t = v ? p(e) : f(e);
			return t?.isConnected && t.classList.contains("editing") ? t : null;
		};
		r.interaction.editing.claim(o, () => !!D()), r.commands.registerGuard(o, (e, t) => t.origin !== "keyboard" || !D() || e.input?.global || e.input?.selector ? !0 : ""), t("item.edit.cancel", ({ ref: e, field: t }) => {
			let n = t === "description", r = n ? p(e) : f(e);
			r && (n ? E(r) : r.textContent = x, w(r)), n ? v = null : _ = null, s.schedule(c, () => queueMicrotask(() => {
				u(e)?.focus({ preventScroll: !0 });
			}), 30);
		}), r.interaction.cancel.register({
			origin: o,
			active: () => !!_ || !!v,
			cancel: () => {
				let e = !!v, t = v ?? _;
				t && n("item.edit.cancel", {
					ref: t,
					field: e ? "description" : "title"
				});
			}
		});
	}, { requires: ["ability.selectable"] });
}
//#endregion
//#region canvas/abilities/nudgeable.ts
var jr = [
	{
		dir: "right",
		key: "ArrowRight",
		dx: 24,
		dy: 0
	},
	{
		dir: "left",
		key: "ArrowLeft",
		dx: -24,
		dy: 0
	},
	{
		dir: "up",
		key: "ArrowUp",
		dx: 0,
		dy: -24
	},
	{
		dir: "down",
		key: "ArrowDown",
		dx: 0,
		dy: 24
	}
], Mr = () => lr("nudgeable", jr.map(({ dir: e }) => cr({
	id: `item.nudge.${e}`,
	label: `Nudge ${e}`,
	paletteCommand: `item.nudge.${e}`
})), {
	id: "nudge-the-selection-with-arrow-keys",
	intent: "With a card selected I tap an arrow key and it steps that way.",
	given: [{
		emit: "graph.node.create",
		data: {
			Label: { text: "Journey" },
			Position: {
				x: 0,
				y: 0
			}
		}
	}],
	steps: [{ click: "[data-place=\"stage\"] .node[data-item-kind=\"node\"][data-item-id]" }, { press: "ArrowRight" }],
	expect: [{ emitted: "graph.node.updated" }]
});
function Nr(e) {
	e("ability.nudgeable", ({ on: e, emit: t, contexts: n, graphs: r, selection: i }) => {
		let a = () => i.selectedAll().some((e) => !!r.current.getItem(e)?.Position);
		n.commands.register(jr.map(({ dir: e, key: t, dx: n, dy: r }) => ({
			id: `item.nudge.${e}`,
			label: `Nudge ${e}`,
			event: "item.nudge",
			group: "item",
			shortcut: t,
			input: {
				on: "keydown",
				key: t,
				prevent: !0
			},
			available: () => a(),
			payload: () => ({
				dx: n,
				dy: r
			})
		}))), e("item.nudge", ({ dx: e, dy: a }) => {
			let o = i.selectedAll(), s = (e) => o.some((t) => z(t, e)), c = [];
			o.forEach((t) => {
				if (n.hierarchy.parentChain(t).some(s)) return;
				let i = r.current.getItem(t);
				i?.Position && c.push({
					ref: t,
					patch: { Position: {
						x: i.Position.x + e,
						y: i.Position.y + a
					} }
				});
			}), c.length === 1 ? t("item.update", c[0]) : c.length && t("item.update.batch", { updates: c });
		});
	}, { requires: ["ability.selectable"] });
}
//#endregion
//#region canvas/abilities/resizeable.ts
var Pr = () => lr("resizeable", [cr({
	id: "item.resize",
	label: "Resize",
	ui: [{
		surface: "entity",
		command: "resize.item.start",
		kind: "handler",
		slot: t.Resize,
		attrs: {
			"data-resize-handle": "",
			role: "button",
			"aria-label": "Resize item",
			title: "Resize item"
		}
	}]
})], {
	id: "resize-a-container-by-its-corner",
	intent: "I drag the corner of a group to give it more room.",
	given: [{
		emit: "editing.container.create",
		data: {
			Label: { text: "Journey" },
			at: {
				x: 0,
				y: 0
			}
		}
	}],
	steps: [{ click: "[data-place=\"stage\"] .container[data-item-kind=\"container\"][data-item-id]" }, {
		drag: "[data-resize-handle]",
		by: {
			x: 60,
			y: 60
		}
	}],
	expect: [{ emitted: "container.updated" }]
});
function Fr(t) {
	t("ability.resizeable", ({ on: t, emit: n, contexts: r, graphs: i, model: a }) => {
		let o = null, s = (e, t) => a.entity(e.kind)?.render?.bounds?.(t) || (t.Position ? {
			x: t.Position.x - t.Size.w / 2,
			y: t.Position.y - t.Size.h / 2,
			w: t.Size.w,
			h: t.Size.h
		} : null);
		r.commands.register([
			{
				id: "resize.item.start",
				label: "Start resize",
				group: "resize",
				hidden: !0,
				input: {
					on: "pointerdown",
					selector: "[data-resize-handle]",
					prevent: !0,
					stop: !0
				},
				payload: ({ event: e, target: t }) => {
					let n = g(t);
					return n ? {
						ref: n,
						x: e.clientX,
						y: e.clientY
					} : void 0;
				}
			},
			{
				id: "resize.item.move",
				label: "Resize item",
				group: "resize",
				hidden: !0,
				input: {
					on: "pointermove",
					when: () => !!o,
					prevent: !0
				},
				payload: ({ event: e }) => ({
					x: e.clientX,
					y: e.clientY
				})
			},
			{
				id: "resize.item.end",
				label: "End resize",
				group: "resize",
				hidden: !0,
				input: {
					on: "pointerup",
					when: () => !!o
				}
			}
		]), t("resize.item.start", ({ ref: t, x: n, y: a }) => {
			let c = i.current.getItem(t);
			if (!c?.Size) return;
			let l = s(t, c);
			l && (o = {
				ref: t,
				pointer: r.view.clientToSpace(e.Stage, {
					x: n,
					y: a
				}),
				topLeft: {
					x: l.x,
					y: l.y
				}
			});
		}), t("resize.item.move", ({ x: t, y: i }) => {
			if (!o) return;
			let a = r.view.clientToSpace(e.Stage, {
				x: t,
				y: i
			}), s = Math.max(40, a.x - o.topLeft.x), c = Math.max(40, a.y - o.topLeft.y), l = {
				x: o.topLeft.x + s / 2,
				y: o.topLeft.y + c / 2
			};
			n("item.update", {
				ref: o.ref,
				patch: {
					Size: {
						w: s,
						h: c
					},
					Position: l,
					AutoFit: !1
				}
			}), n("resize.item.changed", { ref: o.ref });
		}), t("resize.item.end", () => {
			o = null;
		});
	}, { requires: ["ability.selectable"] });
}
//#endregion
//#region canvas/abilities/selectable.ts
var Ir = () => lr("selectable", [cr({
	id: "item.select",
	label: "Select item",
	ui: [{
		surface: "entity",
		command: "selection.item.select",
		kind: "handler"
	}]
})], {
	id: "select-an-item-by-clicking-it",
	intent: "I click a card on the board and it becomes the thing my next action applies to.",
	given: [{
		emit: "graph.node.create",
		data: {
			Label: { text: "Journey" },
			Position: {
				x: 0,
				y: 0
			}
		}
	}],
	steps: [{ click: "[data-place=\"stage\"] .node[data-item-kind=\"node\"][data-item-id]" }],
	expect: [{ css: "[data-item-kind=\"node\"].selected" }]
}), Lr = ".stage.ink-erasing, .tool-panel, .item-toolbar, [data-command], [data-resize-handle], [data-container-section-title], [data-container-section-resize], .modal-layer, .monaco-editor, input, textarea, select, label";
function Rr(e) {
	e("ability.selectable", ({ on: e, emit: t, contexts: n, graphs: r, selection: i, origin: a }) => {
		let o = () => i.selectedNode()?.id ?? null, s = (e) => h(e.target) || o() || "", c = () => r.current.nodes().filter((e) => !Dn(B(e.id), n.hierarchy.parentChain, n.fold, r.current.id)), l = () => {
			let e = c();
			return e[(Math.max(0, e.findIndex((e) => e.id === o())) + 1) % e.length]?.id ?? e[0]?.id ?? "";
		}, u = () => {
			let e = c(), t = e.findIndex((e) => e.id === o());
			return e[(t <= 0 ? e.length : t) - 1]?.id ?? e[0]?.id ?? "";
		};
		n.commands.register([
			{
				id: "selection.item.select",
				label: "Select item",
				group: "selection",
				hidden: !0,
				input: {
					on: "pointerdown",
					selector: "[data-item-kind][data-item-id]",
					when: (e) => !e.target.closest(Lr),
					prevent: !0,
					stop: !0
				},
				payload: (e) => g(e.target) ?? B(s(e))
			},
			{
				id: "selection.item.toggle",
				label: "Toggle item in selection",
				group: "selection",
				hidden: !0,
				input: {
					on: "pointerdown",
					selector: "[data-item-kind][data-item-id]",
					shift: !0,
					when: (e) => !e.target.closest(Lr),
					prevent: !0,
					stop: !0
				},
				payload: (e) => g(e.target) ?? B(s(e))
			},
			{
				id: "selection.node.select",
				label: "Select node",
				group: "selection",
				hidden: !0,
				payload: (e) => ({ id: s(e) })
			},
			{
				id: "selection.node.next",
				label: "Select next node",
				event: "selection.node.select",
				group: "selection",
				shortcut: "Tab",
				input: {
					on: "keydown",
					key: "Tab",
					prevent: !0,
					when: (e) => !!e.target.closest("[data-place=\"stage\"] [data-item-kind=\"node\"]")
				},
				available: () => r.current.nodes().length > 0,
				payload: () => ({ id: l() })
			},
			{
				id: "selection.node.previous",
				label: "Select previous node",
				event: "selection.node.select",
				group: "selection",
				shortcut: "Shift+Tab",
				input: {
					on: "keydown",
					key: "Tab",
					shift: !0,
					prevent: !0,
					when: (e) => !!e.target.closest("[data-place=\"stage\"] [data-item-kind=\"node\"]")
				},
				available: () => r.current.nodes().length > 0,
				payload: () => ({ id: u() })
			},
			{
				id: "selection.node.clear",
				label: "Clear selection",
				group: "selection",
				available: () => !!i.selected()
			},
			{
				id: "selection.item.delete",
				label: "Delete selection",
				group: "selection",
				shortcut: "X",
				input: {
					on: "keydown",
					key: "x",
					prevent: !0
				},
				available: () => !!i.selected()
			}
		]), e("selection.node.select", ({ id: e }) => t("selection.item.select", B(e))), e("selection.node.clear", () => t("selection.item.clear")), e("selection.item.select", (e) => i.select(e)), e("selection.item.toggle", (e) => i.toggle(e)), e("selection.item.clear", () => i.select(null)), e("selection.choose", ({ refs: e, mode: t }) => {
			t === "add" ? e.forEach((e) => i.add(e)) : t === "remove" ? e.forEach((e) => i.remove(e)) : t === "toggle" ? e.forEach((e) => i.toggle(e)) : i.choose(e);
		}), e("selection.changed", ({ refs: e }) => {
			e.length ? n.decorations.modes.set(a, "selected", e) : n.decorations.unregisterOrigin(a);
			let r = e[e.length - 1] ?? null;
			r ? t("focus.item.focus", r) : t("focus.item.clear");
		}), e("selection.item.delete", () => {
			let e = i.selectedAll();
			i.select(null), e.forEach((e) => {
				e.kind === "node" && t("graph.node.delete", { id: e.id }), e.kind === "edge" && t("graph.edge.delete", { id: e.id });
			});
		}), n.interaction.cancel.register({
			origin: a,
			priority: -10,
			active: () => i.selectedAll().length > 0,
			cancel: () => t("selection.item.clear")
		});
	});
}
//#endregion
//#region canvas/abilities/index.ts
function zr(e) {
	Rr(e), Or(e), Nr(e), dr(e), Ar(e), mr(e), Fr(e);
}
var Br = ((e) => e)([
	{
		id: "text",
		label: "Text",
		category: "Basics",
		keywords: ["note", "label"],
		visual: "card",
		defaultSize: {
			w: 170,
			h: 76
		},
		defaultFill: "none",
		defaultBorder: "none"
	},
	{
		id: "link",
		label: "Link",
		category: "Basics",
		keywords: [
			"url",
			"hyperlink",
			"bookmark"
		],
		visual: "card",
		defaultSize: {
			w: 260,
			h: 88
		}
	},
	{
		id: "image",
		label: "Image",
		category: "Basics",
		keywords: [
			"photo",
			"picture",
			"clipboard"
		],
		visual: "card",
		defaultSize: {
			w: 320,
			h: 260
		},
		autoSize: !1
	},
	{
		id: "square",
		label: "Box",
		category: "Basics",
		keywords: ["rectangle", "card"],
		visual: "card"
	},
	{
		id: "rounded",
		label: "Rounded box",
		category: "Basics",
		keywords: ["card"],
		visual: "rounded"
	},
	{
		id: "pill",
		label: "Pill",
		category: "Basics",
		keywords: [
			"start",
			"end",
			"status"
		],
		visual: "pill"
	},
	{
		id: "circle",
		label: "Circle",
		category: "Basics",
		keywords: ["state", "start"],
		visual: "circle",
		defaultSize: {
			w: 112,
			h: 112
		}
	},
	{
		id: "diamond",
		label: "Diamond",
		category: "Basics",
		keywords: ["decision", "gate"],
		visual: "diamond",
		defaultSize: {
			w: 112,
			h: 112
		}
	},
	{
		id: "parallelogram",
		label: "Parallelogram",
		category: "Basics",
		keywords: ["input", "output"],
		visual: "parallelogram",
		defaultSize: {
			w: 150,
			h: 80
		}
	},
	{
		id: "service",
		label: "Service",
		category: "Architecture",
		keywords: ["api", "component"],
		visual: "rounded"
	},
	{
		id: "api-endpoint",
		label: "API endpoint",
		category: "Architecture",
		keywords: [
			"route",
			"http",
			"port"
		],
		visual: "port",
		defaultSize: {
			w: 260,
			h: 56
		}
	},
	{
		id: "application-handler",
		label: "Application handler",
		category: "Architecture",
		keywords: [
			"use case",
			"command",
			"query"
		],
		visual: "rounded",
		defaultSize: {
			w: 190,
			h: 64
		}
	},
	{
		id: "domain-model",
		label: "Domain model",
		category: "Architecture",
		keywords: ["aggregate", "entity"],
		visual: "table",
		defaultSize: {
			w: 170,
			h: 72
		}
	},
	{
		id: "repository",
		label: "Repository",
		category: "Architecture",
		keywords: ["persistence", "adapter"],
		visual: "card",
		defaultSize: {
			w: 190,
			h: 64
		}
	},
	{
		id: "outbox-relay",
		label: "Outbox relay",
		category: "Architecture",
		keywords: [
			"publisher",
			"cdc",
			"worker"
		],
		visual: "rounded",
		defaultSize: {
			w: 180,
			h: 60
		}
	},
	{
		id: "database",
		label: "Database",
		category: "Architecture",
		keywords: ["storage", "data"],
		visual: "card"
	},
	{
		id: "postgres-table",
		label: "PostgreSQL table",
		category: "Architecture",
		keywords: [
			"sql",
			"schema",
			"relation"
		],
		visual: "table",
		defaultSize: {
			w: 210,
			h: 64
		}
	},
	{
		id: "kafka",
		label: "Kafka",
		category: "Architecture",
		keywords: [
			"queue",
			"event",
			"stream"
		],
		visual: "card"
	},
	{
		id: "kafka-topic",
		label: "Kafka topic",
		category: "Architecture",
		keywords: [
			"event",
			"stream",
			"partition"
		],
		visual: "topic",
		defaultSize: {
			w: 230,
			h: 64
		}
	},
	{
		id: "consumer-port",
		label: "Consumer port",
		category: "Architecture",
		keywords: [
			"subscription",
			"handler",
			"input"
		],
		visual: "port",
		defaultSize: {
			w: 230,
			h: 56
		}
	},
	{
		id: "index",
		label: "Index",
		category: "Architecture",
		keywords: ["search"],
		visual: "card"
	},
	{
		id: "user-input",
		label: "User input",
		category: "Architecture",
		keywords: ["actor", "request"],
		visual: "parallelogram",
		defaultSize: {
			w: 220,
			h: 72
		}
	},
	{
		id: "gateway",
		label: "Gateway",
		category: "Architecture",
		keywords: ["proxy", "edge"],
		visual: "diamond"
	},
	{
		id: "cache",
		label: "Cache",
		category: "Architecture",
		keywords: ["memory"],
		visual: "card"
	},
	{
		id: "rate-limit",
		label: "Rate limiter",
		category: "Architecture",
		keywords: ["throttle"],
		visual: "card"
	},
	{
		id: "circuit-breaker",
		label: "Circuit breaker",
		category: "Architecture",
		keywords: ["resilience", "failure"],
		visual: "card"
	},
	{
		id: "input",
		label: "ML · Input",
		category: "Data & AI",
		keywords: ["tokens", "features"],
		visual: "parallelogram"
	},
	{
		id: "embedding",
		label: "ML · Embedding",
		category: "Data & AI",
		keywords: ["vector"],
		visual: "card"
	},
	{
		id: "dense",
		label: "ML · Dense / Linear",
		category: "Data & AI",
		keywords: ["layer"],
		visual: "card"
	},
	{
		id: "attention",
		label: "ML · Attention",
		category: "Data & AI",
		keywords: ["transformer"],
		visual: "card"
	},
	{
		id: "moe",
		label: "ML · MoE",
		category: "Data & AI",
		keywords: ["experts", "router"],
		visual: "card"
	},
	{
		id: "norm",
		label: "ML · Norm",
		category: "Data & AI",
		keywords: ["normalize"],
		visual: "pill"
	},
	{
		id: "output",
		label: "ML · Output",
		category: "Data & AI",
		keywords: ["result"],
		visual: "parallelogram"
	},
	{
		id: "operator",
		label: "Operator",
		category: "Diagram",
		keywords: [
			"merge",
			"sum",
			"connector"
		],
		visual: "operator",
		defaultSize: {
			w: 44,
			h: 44
		}
	},
	{
		id: "caption",
		label: "Caption",
		category: "Diagram",
		keywords: ["annotation", "legend"],
		visual: "caption"
	},
	{
		id: "uml-class",
		label: "UML class",
		category: "Diagram",
		keywords: ["model", "members"],
		visual: "table",
		defaultSize: {
			w: 260,
			h: 170
		}
	},
	{
		id: "milestone",
		label: "Milestone",
		category: "Planning",
		keywords: ["date", "release"],
		visual: "timeline"
	},
	{
		id: "list-item",
		label: "List item",
		category: "Planning",
		keywords: ["task", "outline"],
		visual: "list"
	},
	{
		id: "section-header",
		label: "Section header",
		category: "Planning",
		keywords: ["heading", "outline"],
		visual: "section"
	},
	{
		id: "agent",
		label: "Agent",
		category: "Autonomous systems",
		keywords: [
			"sub-agent",
			"worker",
			"role"
		],
		visual: "agent",
		defaultSize: {
			w: 210,
			h: 96
		},
		autoSize: !1
	},
	{
		id: "timeline-step",
		label: "Timeline step",
		category: "Autonomous systems",
		keywords: [
			"lane",
			"task",
			"duration"
		],
		visual: "timeline",
		defaultSize: {
			w: 240,
			h: 88
		},
		autoSize: !1
	},
	{
		id: "data-table",
		label: "Data table",
		category: "Autonomous systems",
		keywords: [
			"report",
			"rows",
			"metrics"
		],
		visual: "table",
		defaultSize: {
			w: 300,
			h: 190
		},
		autoSize: !1
	},
	{
		id: "toggle",
		label: "Button switch",
		category: "Autonomous systems",
		keywords: [
			"control",
			"flag",
			"on",
			"off"
		],
		visual: "switch",
		defaultSize: {
			w: 210,
			h: 84
		},
		autoSize: !1
	},
	{
		id: "artifact",
		label: "Artifact",
		category: "Autonomous systems",
		keywords: [
			"markdown",
			"file",
			"output",
			"handoff"
		],
		visual: "artifact",
		defaultSize: {
			w: 230,
			h: 100
		},
		autoSize: !1
	},
	{
		id: "approval-gate",
		label: "Approval gate",
		category: "Autonomous systems",
		keywords: [
			"human",
			"blocked",
			"decision"
		],
		visual: "approval",
		defaultSize: {
			w: 180,
			h: 118
		},
		autoSize: !1
	},
	{
		id: "issue",
		label: "Issue",
		category: "Workbench",
		keywords: [
			"jira",
			"ticket",
			"bug",
			"story"
		],
		visual: "card",
		defaultSize: {
			w: 280,
			h: 72
		}
	},
	{
		id: "pull-request",
		label: "Pull request",
		category: "Workbench",
		keywords: [
			"bitbucket",
			"github",
			"gitlab",
			"pr",
			"merge request",
			"review"
		],
		visual: "card",
		defaultSize: {
			w: 280,
			h: 72
		}
	},
	{
		id: "stack-trace",
		label: "Stack trace",
		category: "Workbench",
		keywords: [
			"exception",
			"error",
			"traceback",
			"panic",
			"log"
		],
		visual: "card",
		defaultSize: {
			w: 380,
			h: 72
		}
	},
	{
		id: "json-doc",
		label: "JSON document",
		category: "Workbench",
		keywords: [
			"json",
			"payload",
			"webhook",
			"fixture",
			"response"
		],
		visual: "card",
		defaultSize: {
			w: 320,
			h: 72
		}
	}
]), Vr = Br.map(({ id: e, label: t }) => ({
	value: e,
	label: t
})), Hr = [...new Set(Br.map((e) => e.category))], G = (e) => typeof e == "string" ? Br.find((t) => t.id === e) : void 0, Ur = (e) => !!G(e), Wr = (e) => G(e)?.label ?? e, Gr = (e, t) => t ?? G(e)?.defaultFill, Kr = (e, t) => t ?? G(e)?.defaultBorder, qr = (e) => e.w === 150 && e.h === 64 || Br.some((t) => t.defaultSize?.w === e.w && t.defaultSize?.h === e.h), Jr = "http://www.w3.org/2000/svg", Yr = (e, t) => {
	let n = document.createElementNS(Jr, e);
	return Object.entries(t).forEach(([e, t]) => n.setAttribute(e, String(t))), n;
}, K = (e) => e, Xr = (e, t) => ({
	kind: e,
	...t
}), Zr = [
	{
		value: "gray",
		label: "Gray"
	},
	{
		value: "red",
		label: "Red"
	},
	{
		value: "orange",
		label: "Orange"
	},
	{
		value: "yellow",
		label: "Yellow"
	},
	{
		value: "green",
		label: "Green"
	},
	{
		value: "blue",
		label: "Blue"
	},
	{
		value: "purple",
		label: "Purple"
	},
	{
		value: "pink",
		label: "Pink"
	}
], q = (e) => Zr.some((t) => t.value === e), Qr = [
	{
		value: "soft",
		label: "Soft tint"
	},
	{
		value: "solid",
		label: "Solid"
	},
	{
		value: "none",
		label: "None"
	}
], $r = (e) => Qr.some((t) => t.value === e), ei = [
	{
		value: "sync",
		label: "Dotted arrow"
	},
	{
		value: "async",
		label: "Dashed arrow"
	},
	{
		value: "read",
		label: "Subtle arrow"
	},
	{
		value: "write",
		label: "Strong arrow"
	},
	{
		value: "plain",
		label: "Solid line"
	},
	{
		value: "dashed",
		label: "Dashed line"
	},
	{
		value: "residual",
		label: "Light arrow"
	}
], ti = (e) => ei.some((t) => t.value === e), ni = ["plain", "dashed"], ri = [
	{
		value: "inside",
		label: "Inside",
		icon: "placement-inside"
	},
	{
		value: "top",
		label: "Top",
		icon: "placement-top"
	},
	{
		value: "right",
		label: "Right",
		icon: "placement-right"
	},
	{
		value: "below",
		label: "Below",
		icon: "placement-below"
	},
	{
		value: "left",
		label: "Left",
		icon: "placement-left"
	},
	{
		value: "hidden",
		label: "Hidden",
		icon: "placement-hidden"
	}
], ii = (e) => ri.some((t) => t.value === e), ai = Wr, oi = /* @__PURE__ */ new WeakMap(), si = (e) => {
	let t = Math.max(1, e.Label.text.split(/\r?\n/).length), n = Math.max(8, Math.floor((e.Size.w - 24) / 7.2)), r = e.Label.text.split(/\r?\n/).reduce((e, t) => e + Math.max(1, Math.ceil(t.length / n)), 0);
	return {
		w: e.Size.w,
		h: W(Math.max(t, r) * 22 + 20, 56, 120)
	};
}, ci = (e) => {
	let t = si(e);
	return {
		w: e.Size.w,
		h: t.h + 34
	};
}, li = (e) => {
	let t = e.Position ?? {
		x: 0,
		y: 0
	}, n = oi.get(e) ?? e.Size;
	return {
		x: t.x - n.w / 2,
		y: t.y - n.h / 2,
		w: n.w,
		h: n.h
	};
}, ui = /* @__PURE__ */ new WeakMap(), di = "node-component-body";
function fi(e = I, n = be, r = A) {
	let { componentBinding: i, componentBody: a, componentData: o, componentVersion: s } = e, { contractProperties: c, titleRole: l } = n, d = (e) => a(i(e.id)?.component ?? e.NodeType ?? ""), f = (e, t, n = {}) => {
		let r = d(t);
		if (!r) return !1;
		let a = i(t.id) ?? {
			component: t.NodeType ?? "",
			datasourceId: "",
			config: {}
		}, s = {
			nodeId: t.id,
			binding: a,
			data: o(t.id),
			label: t.Label.text
		};
		if (n.patch) {
			let t = e.querySelector(`.${di}`);
			return !!t && !!r.update && r.update(t, s);
		}
		let c = u("div", { class: di }), l = r.draw(s);
		return c.append(typeof l == "function" ? l() : l), e.append(c), !0;
	}, p = Xr("node", {
		label: "Node",
		labelOf: (e) => e.Label.text,
		render: {
			layer: "html",
			bounds: li,
			collect(e, t, n) {
				let r = e;
				return (n ? [...n].map((e) => r.node(e)).filter((e) => !!e) : r.nodes()).filter((e) => !t({
					kind: "node",
					id: e.id
				}));
			},
			draw(e, n) {
				let i = n.cloneTemplate("node"), a = e.Position ?? {
					x: 0,
					y: 0
				}, o = n.refOf(e.id), s = e.NodeType ?? "text", c = n.nodeType(s), l = c?.visual ?? "card", d = e.Description?.trim() ?? "", p = [
					e.ExpectedRps == null ? "" : `${e.ExpectedRps}/s`,
					e.LatencyMs == null ? "" : `${e.LatencyMs}ms`,
					e.ComputeMs == null ? "" : `${e.ComputeMs}ms cpu`
				].filter(Boolean).join(" · ");
				n.tagItem(i, o), i.tabIndex = -1, i.dataset.slot = t.Drag, i.setAttribute("role", l === "switch" ? "group" : "button");
				let m = n.editable === !1 ? "" : (n.viewportWidth ?? globalThis.innerWidth) <= 680 ? "Hold for actions." : "Press Enter to edit.";
				i.setAttribute("aria-label", `${e.Label.text || "Untitled"}; ${ai(s)} node. ${m}`), n.applyItemModes(i, o);
				let h = l === "component", g = (!!d || h) && n.isFolded(o), _ = g ? h ? ci(e) : si(e) : e.Size;
				if (oi.set(e, _), i.classList.toggle("collapsed", g), i.classList.add(`node-type-${s}`), i.classList.add(`node-visual-${l}`), i.classList.toggle("has-description", !!d), i.classList.toggle("has-link", !!e.LinkUrl), i.classList.toggle("has-image", !!e.ImageSource), (d || h) && i.setAttribute("aria-expanded", g ? "false" : "true"), i.classList.toggle("semantic-big-data", e.DataScale === "big" || e.DataScale === "huge"), i.classList.toggle("semantic-stale-risk", e.FreshnessMs != null && e.FreshnessMs > 6e4), i.dataset.nodeType = s, i.dataset.nodeVisual = l, l === "switch" && (i.dataset.toggleState = e.ToggleState ? "on" : "off", i.append(u("button.node-switch-control", {
					type: "button",
					role: "switch",
					"aria-checked": e.ToggleState ? "true" : "false",
					"aria-label": `${e.ToggleState ? "Turn off" : "Turn on"} ${e.Label.text || "switch"}`,
					data: { command: "node.toggle.state" }
				}, [u("span")]))), l === "component" && f(i, e), e.Status && (i.dataset.status = e.Status, i.append(u("span.node-status", { text: Pt[e.Status] }))), e.Tags?.length) {
					i.dataset.tags = e.Tags.join(" ");
					let t = u("span.node-tags");
					e.Tags.forEach((e) => {
						let n = u("b.node-tag", { data: {
							tag: e,
							tagColor: Ht(e)
						} }), r = Bt(e);
						r && (n.dataset.metricKey = r.key, n.dataset.metricValue = `${r.value}`), n.textContent = e, t.append(n);
					}), i.append(t);
				}
				e.Color && (i.dataset.nodeColor = e.Color);
				let v = Gr(s, e.Fill), y = Kr(s, e.BorderColor);
				v && (i.dataset.fill = v), y && (i.dataset.borderColor = y), e.DescriptionPlacement && (i.dataset.descPlacement = e.DescriptionPlacement), e.DataScale && (i.dataset.dataScale = e.DataScale);
				let b = $n(e);
				b && (i.title = b), i.style.left = `${a.x}px`, i.style.top = `${a.y}px`, i.style.width = `${_.w}px`, i.style.height = `${_.h}px`, n.templateText(i, "type", c?.label ?? ai(s)), n.templateText(i, "metrics", p), n.templateText(i, "title", e.Label.text), n.editable === !1 && i.querySelectorAll("[data-editable-title], [data-editable-description]").forEach((e) => {
					e.removeAttribute("data-editable-title"), e.removeAttribute("data-editable-description");
				});
				let x = n.templateSlot(i, "title");
				if (x.setAttribute("data-type-label", c?.label ?? ai(s)), e.LinkUrl && /^(https?:|mailto:)/i.test(e.LinkUrl)) {
					let t = u("a.node-link", {
						href: e.LinkUrl,
						target: "_blank",
						rel: "noopener noreferrer",
						text: e.Label.text || e.LinkUrl
					});
					t.title = e.LinkUrl, x.replaceChildren(t);
				}
				e.ImageSource && /^(data:image\/|https?:\/\/)/i.test(e.ImageSource) && i.prepend(u("img.node-image", {
					src: e.ImageSource,
					alt: e.ImageAlt || e.Label.text || "Pasted image",
					loading: "lazy",
					decoding: "async",
					draggable: "false",
					referrerpolicy: "no-referrer"
				}));
				let S = n.templateSlot(i, "description");
				return n.editable !== !1 && S.setAttribute("data-editable-description", ""), S.setAttribute("aria-label", n.editable === !1 ? "Description" : d ? "Description. Double-click to edit." : "Empty description. Press Shift+Enter to edit."), S.replaceChildren(r(d)), n.wireAffordances(i), ui.set(e, e.visualVersion), i;
			},
			reposition(e, t) {
				let n = t.Position ?? {
					x: 0,
					y: 0
				};
				e.style.left = `${n.x}px`, e.style.top = `${n.y}px`;
			},
			update(e, t, n) {
				return !d(t) || ui.get(t) !== t.visualVersion || n && e.classList.contains("collapsed") !== n.isFolded(n.refOf(t.id)) ? !1 : f(e, t, { patch: !0 });
			},
			signature(e) {
				return d(e) ? `v${e.visualVersion}:c${s(e.id)}` : `v${e.visualVersion}`;
			}
		},
		abilities: [
			Ir(),
			Dr(),
			Mr(),
			ur((e) => !!e.Description?.trim()),
			kr(),
			pr()
		],
		titlePlaceholder: () => l("node"),
		properties: (e) => [...m(), ...c({
			kind: "node",
			nodeType: e.NodeType
		})]
	}), m = () => {
		let e = l("node");
		return e ? h.map((t) => t.id === "title" ? {
			...t,
			placeholder: e
		} : t) : h;
	}, h = [
		K({
			id: "title",
			label: "Title",
			input: "text",
			value: (e) => e.Label.text,
			patch: (e, t) => ({ Label: { text: String(t) } })
		}),
		K({
			id: "nodeType",
			label: "Type",
			input: "select",
			options: Vr,
			value: (e) => e.NodeType ?? "text",
			patch: (e, t) => Ur(t) ? { NodeType: t } : void 0
		}),
		K({
			id: "status",
			label: "Status",
			input: "segments",
			group: "Status",
			options: [{
				value: "",
				label: "Not tracked"
			}, ...Nt.map((e) => ({
				value: e,
				label: Pt[e]
			}))],
			value: (e) => e.Status ?? "",
			patch: (e, t) => t === "" ? { Status: void 0 } : Ft(t) ? { Status: t } : void 0
		}),
		K({
			id: "tags",
			label: "Tags",
			input: "text",
			value: (e) => (e.Tags ?? []).join(" "),
			patch: (e, t) => ({ Tags: H(String(t).split(/[\s,]+/)) })
		}),
		K({
			id: "color",
			label: "Color",
			input: "swatches",
			options: [{
				value: "",
				label: "Default (by type)"
			}, ...Zr],
			value: (e) => e.Color ?? "",
			patch: (e, t) => t === "" ? { Color: void 0 } : q(t) ? { Color: t } : void 0
		}),
		K({
			id: "fill",
			label: "Fill",
			input: "segments",
			options: Qr,
			value: (e) => Gr(e.NodeType, e.Fill) ?? "soft",
			patch: (e, t) => $r(t) ? { Fill: t } : void 0
		}),
		K({
			id: "borderColor",
			label: "Border",
			input: "swatches",
			options: [
				{
					value: "",
					label: "Match color"
				},
				{
					value: "none",
					label: "None"
				},
				...Zr
			],
			value: (e) => Kr(e.NodeType, e.BorderColor) ?? "",
			patch: (e, t) => t === "" ? { BorderColor: void 0 } : t === "none" ? { BorderColor: "none" } : q(t) ? { BorderColor: t } : void 0
		}),
		K({
			id: "description",
			label: "Description",
			input: "textarea",
			rows: 6,
			placeholder: "Description",
			hideLabel: !0,
			value: (e) => e.Description ?? "",
			patch: (e, t) => ({ Description: String(t) })
		}),
		K({
			id: "linkUrl",
			label: "Link URL",
			input: "text",
			value: (e) => e.LinkUrl ?? "",
			patch: (e, t) => ({ LinkUrl: String(t).trim() || void 0 })
		}),
		K({
			id: "imageAlt",
			label: "Image description",
			input: "text",
			value: (e) => e.ImageAlt ?? "",
			patch: (e, t) => ({ ImageAlt: String(t).trim() || void 0 })
		}),
		K({
			id: "descPlacement",
			label: "Description placement",
			input: "placement",
			options: ri,
			value: (e) => e.DescriptionPlacement ?? "inside",
			patch: (e, t) => t === "inside" ? { DescriptionPlacement: void 0 } : ii(t) ? { DescriptionPlacement: t } : void 0
		}),
		K({
			id: "width",
			label: "Width",
			input: "number",
			min: 96,
			step: 8,
			value: (e) => e.Size.w,
			patch: (e, t) => {
				let n = Number(t);
				return Number.isFinite(n) ? { Size: {
					...e.Size,
					w: W(n, 96, 900)
				} } : void 0;
			}
		}),
		K({
			id: "height",
			label: "Height",
			input: "number",
			min: 40,
			step: 8,
			value: (e) => e.Size.h,
			patch: (e, t) => {
				let n = Number(t);
				return Number.isFinite(n) ? { Size: {
					...e.Size,
					h: W(n, 40, 900)
				} } : void 0;
			}
		})
	];
	return p;
}
var pi = fi(), mi = (e, t) => {
	let n = t.graph.refById(e);
	if (!n) return null;
	let r = t.parentChain(n).find((e) => t.isFolded(e));
	if (r) {
		let e = t.boundsOf(r);
		return e ? {
			ref: r,
			center: {
				x: e.x + e.w / 2,
				y: e.y + e.h / 2
			},
			half: {
				w: e.w / 2,
				h: e.h / 2
			}
		} : null;
	}
	let i = t.boundsOf(n);
	return i ? {
		ref: n,
		center: {
			x: i.x + i.w / 2,
			y: i.y + i.h / 2
		},
		half: {
			w: i.w / 2,
			h: i.h / 2
		}
	} : null;
}, hi = 8, gi = 4, _i = 72, vi = 28, yi = 12, bi = 10, xi = 12, Si = "label", Ci = (e) => {
	let t = e.split(/\r?\n/);
	return {
		w: Math.max(_i, Math.max(1, ...t.map((e) => e.length)) * 9 + hi * 2),
		h: Math.max(vi, (t.length - 1) * 18 + 14 + gi * 2)
	};
}, wi = (e, t, n, r = "", i = [], a = []) => {
	let o = e.split(/\r?\n/), s = Ci(e), c = n.x - t.x, l = n.y - t.y, u = Math.hypot(c, l) || 1, d = -l / u, f = c / u, p = .36 + [...r].reduce((e, t) => e * 33 + t.charCodeAt(0) >>> 0, 5381) % 5 * .04, m = c / u, h = l / u, g = Math.abs(m) * s.w / 2 + Math.abs(h) * s.h / 2, _ = (g + 8) / u, v = 1 - (g + 18) / u, y = _ <= v ? W(p, _, v) : .5, b = Math.abs(d) * s.w / 2 + Math.abs(f) * s.h / 2 + bi, x = {
		x: t.x + c * y + d * b,
		y: t.y + l * y + f * b
	}, S = {
		x: x.x - s.w / 2,
		y: x.y - s.h / 2,
		w: s.w,
		h: s.h
	}, C = (e, t) => e.x < t.x + t.w && e.x + e.w > t.x && e.y < t.y + t.h && e.y + e.h > t.y, w = () => i.some((e) => C(S, e)) || a.some((e) => Ye(e, S));
	for (let e = 0; e < 480 / xi && w(); e++) b += xi, x = {
		x: t.x + c * y + d * b,
		y: t.y + l * y + f * b
	}, S = {
		x: x.x - s.w / 2,
		y: x.y - s.h / 2,
		w: s.w,
		h: s.h
	};
	return {
		lines: o,
		size: s,
		rect: S,
		anchor: x,
		textStartY: -((o.length - 1) * 18) / 2 + 14 * .35,
		transform: `translate(${x.x}, ${x.y})`
	};
}, Ti = (e) => e.Label?.text ? e.Label.text : !e.Relation || e.Relation === "related-to" ? "" : Lt[e.Relation], Ei = (e, t, n, r, i) => {
	let a = wi(e, t, n, r);
	return wi(e, t, n, r, i.boundsInRect("node", Ve(a.rect, 480)), i.linesOfKind("edge", r));
}, Di = {
	layer: "svg",
	collect(e, t, n) {
		let r = e, i = n ?? new Set(r.nodes().map((e) => e.id)), a = /* @__PURE__ */ new Set(), o = [];
		for (let e of i) for (let t of r.edgesOf(e)) {
			let e = t.id;
			a.has(e) || (a.add(e), o.push(t));
		}
		return r.edgesOutsideNodes().forEach((e) => {
			a.has(e.id) || (a.add(e.id), o.push(e));
		}), o;
	},
	draw(e, t) {
		let n = mi(e.From, t), r = mi(e.To, t);
		if (!n || !r || n.ref.kind === r.ref.kind && n.ref.id === r.ref.id) return null;
		let i = t.refOf(e.id), a = Je(n.center, r.center, r.half), o = Je(r.center, n.center, n.half), s = Yr("g", {}), c = ti(e.EdgeKind) ? e.EdgeKind : "sync";
		s.setAttribute("class", `edge edge-kind-${c}`), t.applyItemModes(s, i), e.Relation && s.setAttribute("data-relation", e.Relation), e.Color && (s.dataset.edgeColor = e.Color);
		let l = $n(e);
		if (l) {
			let e = Yr("title", {});
			e.textContent = l, s.append(e);
		}
		let u = (e, n, r, a, o, s = {}) => {
			let l = Yr("line", {
				x1: n,
				y1: r,
				x2: a,
				y2: o,
				class: `${e} edge-kind-${c}`,
				...s
			});
			return t.tagItem(l, i), t.applyItemModes(l, i), l;
		};
		s.append(u("edge-hit", n.center.x, n.center.y, r.center.x, r.center.y, { tabindex: -1 })), s.append(u("edge-line", o.x, o.y, a.x, a.y, ni.includes(c) ? {} : { "marker-end": `url(#${t.elementId?.("edge-arrow") ?? "edge-arrow"})` }));
		let d = Ti(e);
		if (!d && t.editable === !1) return s;
		let f = d ? Ei(d, o, a, e.id, t) : wi(Si, o, a, e.id), p = Yr("g", {
			class: `edge-label-wrap${d ? "" : " is-empty"}`,
			transform: f.transform,
			"data-label-width": f.size.w,
			"data-label-height": f.size.h
		}), m = Yr("rect", {
			class: "edge-label-target",
			x: -f.size.w / 2 - yi,
			y: -f.size.h / 2 - yi,
			width: f.size.w + yi * 2,
			height: f.size.h + yi * 2,
			rx: 8
		});
		t.tagItem(m, i), m.dataset.edgeLabelTrigger = "", p.append(m), d && p.append(Yr("rect", {
			class: "edge-label-bg",
			x: -f.size.w / 2,
			y: -f.size.h / 2,
			width: f.size.w,
			height: f.size.h,
			rx: 3
		}));
		let h = Yr("foreignObject", {
			x: -f.size.w / 2,
			y: -f.size.h / 2,
			width: f.size.w,
			height: f.size.h,
			class: "edge-label-host"
		});
		t.tagItem(h, i);
		let g = document.createElement("div");
		return g.className = `edge-label edge-kind-${c}`, t.editable !== !1 && (g.dataset.editableTitle = ""), g.setAttribute("aria-label", t.editable === !1 ? d : d ? "Edge label. Double-click to edit." : "Unlabelled edge. Double-click to add a label."), g.style.fontSize = "14px", g.style.lineHeight = "18px", g.textContent = d, h.append(g), p.append(h), s.append(p), s;
	},
	reposition(e, t, n) {
		let r = mi(t.From, n), i = mi(t.To, n);
		if (!r || !i || r.ref.kind === i.ref.kind && r.ref.id === i.ref.id) return;
		let a = Je(r.center, i.center, i.half), o = Je(i.center, r.center, r.half), s = (t, n, r, i, a) => {
			let o = e.querySelector(t);
			o && (o.setAttribute("x1", String(n)), o.setAttribute("y1", String(r)), o.setAttribute("x2", String(i)), o.setAttribute("y2", String(a)));
		};
		s(".edge-hit", r.center.x, r.center.y, i.center.x, i.center.y), s(".edge-line", o.x, o.y, a.x, a.y);
		let c = e.querySelector(".edge-label-wrap"), l = Ti(t);
		c && c.setAttribute("transform", l ? Ei(l, o, a, t.id, n).transform : wi(Si, o, a, t.id).transform);
	},
	signature(e) {
		return `v${e.visualVersion}`;
	}
};
function Oi(e = be) {
	let { contractProperties: t, titleRole: n } = e, r = Xr("edge", {
		label: "Edge",
		labelOf: (e) => e.Label?.text?.trim() || "Connection",
		abilities: [
			Ir(),
			kr(),
			pr()
		],
		render: Di,
		titlePlaceholder: () => n("edge"),
		properties: (e) => [...i(), ...t({
			kind: "edge",
			edgeKind: e.EdgeKind
		})]
	}), i = () => {
		let e = n("edge");
		return e ? a.map((t) => t.id === "label" ? {
			...t,
			placeholder: e
		} : t) : a;
	}, a = [
		K({
			id: "label",
			label: "Label",
			input: "text",
			value: (e) => e.Label?.text ?? "",
			patch: (e, t) => ({ Label: { text: String(t) } })
		}),
		K({
			id: "relation",
			label: "Relationship",
			input: "select",
			options: [{
				value: "",
				label: "None"
			}, ...It.map((e) => ({
				value: e,
				label: Lt[e]
			}))],
			value: (e) => e.Relation ?? "",
			patch: (e, t) => t === "" || zt(t) ? { Relation: t || void 0 } : void 0
		}),
		K({
			id: "edgeKind",
			label: "Appearance",
			input: "segments",
			options: ei,
			value: (e) => ti(e.EdgeKind) ? e.EdgeKind : "sync",
			patch: (e, t) => ti(t) ? { EdgeKind: t } : void 0
		}),
		K({
			id: "color",
			label: "Color",
			input: "swatches",
			options: [{
				value: "",
				label: "Default"
			}, ...Zr],
			value: (e) => e.Color ?? "",
			patch: (e, t) => t === "" || q(t) ? { Color: t || void 0 } : void 0
		})
	];
	return r;
}
//#endregion
//#region canvas/model/app.ts
var ki = {
	entities: [
		{
			kind: "graph",
			label: "Graph",
			labelOf: (e) => e.name,
			abilities: []
		},
		pi,
		Oi()
	],
	collections: sr,
	nodeTypes: Br
}, Ai = new Set([
	"tag",
	"status",
	"type",
	"relation",
	"is",
	"text"
]), ji = (e) => {
	let t = [], n = "", r = !1;
	for (let i of e) {
		if (i === "\"") {
			r = !r;
			continue;
		}
		if (!r && /\s/.test(i)) {
			n && t.push(n), n = "";
			continue;
		}
		n += i;
	}
	return n && t.push(n), t;
}, Mi = (e) => {
	let t = [];
	for (let n of ji(e)) {
		let e = n.startsWith("-") && n.length > 1, r = e ? n.slice(1) : n;
		if (!r) continue;
		if (r.startsWith("#")) {
			let n = r.slice(1).split(",").map(V).filter(Boolean);
			n.length && t.push({
				field: "tag",
				values: n,
				negated: e
			});
			continue;
		}
		let i = r.indexOf(":"), a = i > 0 ? r.slice(0, i).toLowerCase() : "";
		if (Ai.has(a)) {
			let n = r.slice(i + 1).split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
			n.length && t.push({
				field: a,
				values: n,
				negated: e
			});
			continue;
		}
		let o = /^(>=|<=|>|<|=)?(-?\d+(?:\.\d+)?)$/.exec(i > 0 ? r.slice(i + 1) : "");
		if (a && o) {
			t.push({
				field: "metric",
				values: [o[2]],
				negated: e,
				metric: {
					key: V(a),
					operator: o[1] || "=",
					value: Number(o[2])
				}
			});
			continue;
		}
		t.push({
			field: "text",
			values: [r.toLowerCase()],
			negated: e
		});
	}
	return {
		terms: t,
		source: e
	};
}, Ni = (e) => e.terms.length === 0, Pi = (e) => {
	let t = /* @__PURE__ */ new Map(), n = /* @__PURE__ */ new Map();
	return e.edges.forEach((e) => {
		if (n.set(e.From, (n.get(e.From) ?? 0) + 1), n.set(e.To, (n.get(e.To) ?? 0) + 1), !e.Relation) return;
		let r = e.Relation.toLowerCase();
		[e.From, e.To].forEach((e) => {
			let n = t.get(e) ?? /* @__PURE__ */ new Set();
			n.add(r), t.set(e, n);
		});
	}), {
		relations: t,
		degree: n
	};
}, Fi = (e, t, n, r, i) => {
	switch (e) {
		case "blocked": return r.has(t.id);
		case "ready": return i.has(t.id);
		case "done": return t.status === "done";
		case "tracked": return !!t.status;
		case "untracked": return !t.status;
		case "tagged": return !!t.tags?.length;
		case "untagged": return !t.tags?.length;
		case "orphan": return (n.degree.get(t.id) ?? 0) === 0;
		default: return Ft(e) ? t.status === e : !1;
	}
}, Ii = (e, t, n, r, i) => {
	let a = (() => {
		switch (e.field) {
			case "tag": {
				let n = t.tags ?? [];
				return e.values.some((e) => n.includes(V(e)));
			}
			case "status": return e.values.some((e) => (t.status ?? "none") === e);
			case "type": return e.values.some((e) => (t.type ?? "").toLowerCase() === e);
			case "relation": {
				let r = n.relations.get(t.id);
				return !!r && e.values.some((e) => r.has(e));
			}
			case "is": return e.values.some((e) => Fi(e, t, n, r, i));
			case "text": {
				let n = `${t.title} ${t.description ?? ""} ${(t.tags ?? []).join(" ")}`.toLowerCase();
				return e.values.some((e) => n.includes(e));
			}
			case "metric": {
				if (!e.metric) return !1;
				let { key: n, operator: r, value: i } = e.metric;
				return (t.tags ?? []).some((e) => {
					let t = Bt(e);
					return !t || t.key !== n ? !1 : r === ">=" ? t.value >= i : r === "<=" ? t.value <= i : r === ">" ? t.value > i : r === "<" ? t.value < i : t.value === i;
				});
			}
		}
	})();
	return e.negated ? !a : a;
}, Li = (e, t, n = {}) => {
	let r = Pi(e), i = new Set(n.blocked ?? []), a = new Set(n.ready ?? []), o = /* @__PURE__ */ new Set();
	return e.nodes.forEach((e) => {
		t.terms.every((t) => Ii(t, e, r, i, a)) && o.add(e.id);
	}), o;
}, Ri = (e) => {
	let t = /* @__PURE__ */ new Map();
	return e.nodes.forEach((e) => (e.tags ?? []).forEach((e) => t.set(e, (t.get(e) ?? 0) + 1))), [...t.entries()].map(([e, t]) => ({
		tag: e,
		count: t
	})).sort((e, t) => t.count - e.count || e.tag.localeCompare(t.tag));
}, zi = (e, t, n) => {
	if (t === "none") return [{
		key: "all",
		label: "All",
		nodes: e
	}];
	let r = /* @__PURE__ */ new Map(), i = (e, t) => r.set(e, [...r.get(e) ?? [], t]);
	e.forEach((e) => {
		t === "status" ? i(e.status ?? "", e) : t === "type" ? i(e.type ?? "", e) : e.tags?.length ? e.tags.forEach((t) => i(t, e)) : i("", e);
	});
	let a = [...r.keys()];
	return (t === "status" ? [...n.filter((e) => r.has(e)), ...a.filter((e) => !n.includes(e))] : a.sort((e, t) => e === "" ? 1 : t === "" ? -1 : e.localeCompare(t))).map((e) => ({
		key: e,
		label: e === "" ? "No value" : e,
		nodes: r.get(e) ?? []
	}));
};
//#endregion
//#region canvas/systems/cancellation.ts
function Bi(t) {
	t("cancellation", ({ contexts: t }) => {
		t.commands.register([{
			id: "app.cancel.escape",
			label: "Cancel current action",
			event: "app.cancel",
			group: "app",
			shortcut: "Esc",
			input: {
				on: "keydown",
				key: "Escape",
				global: !0,
				prevent: !0
			},
			payload: () => ({ source: "escape" })
		}, {
			id: "app.cancel.background",
			label: "Cancel on canvas background click",
			event: "app.cancel",
			group: "app",
			hidden: !0,
			input: {
				on: "pointerdown",
				selector: `[data-place="${e.Stage}"]`,
				when: (e, n) => In(e, n) && !t.interaction.cancel.blocksBackground()
			},
			payload: () => ({ source: "background" })
		}]);
	}, { requires: ["input"] });
}
//#endregion
//#region canvas/systems/choose.ts
var Vi = 240;
function Hi(e) {
	e("choose", ({ on: e, emit: t, contexts: n, graphs: r, selection: i, flags: a, contribute: o }) => {
		let s;
		e("mode.changed", ({ fields: e }) => {
			s = e.group;
		});
		let c = () => n.hierarchy.items().map((e) => e.ref), l = () => i.selectedAll().filter((e) => e.kind === "node");
		n.commands.register([
			{
				id: "choose.all",
				label: "Select all",
				group: "choose",
				shortcut: "Ctrl+A",
				input: {
					on: "keydown",
					key: "a",
					ctrl: !0,
					prevent: !0
				},
				available: () => c().length > 0
			},
			{
				id: "choose.all.cmd",
				label: "Select all (Cmd+A)",
				event: "choose.all",
				group: "choose",
				hidden: !0,
				shortcut: "Cmd+A",
				input: {
					on: "keydown",
					key: "a",
					meta: !0,
					prevent: !0
				},
				available: () => c().length > 0
			},
			{
				id: "choose.none",
				label: "Clear selection",
				group: "choose",
				available: () => i.selectedAll().length > 0
			},
			{
				id: "choose.invert",
				label: "Invert selection",
				group: "choose",
				available: () => c().length > 0,
				shortcut: "I",
				input: {
					on: "keydown",
					key: "i",
					prevent: !0
				}
			},
			{
				id: "choose.follow",
				label: "Expand selection along connections",
				group: "choose",
				available: () => l().length > 0
			},
			{
				id: "choose.radius",
				label: "Expand selection by proximity",
				group: "choose",
				available: () => l().length > 0
			},
			{
				id: "choose.search",
				label: "Select by search",
				group: "choose",
				form: {
					title: "Select by search",
					submitLabel: "Select",
					shouldOpen: () => !0,
					fields: [{
						id: "q",
						label: "Label contains",
						autofocus: !0
					}],
					payload: (e) => ({ q: e.q ?? "" })
				},
				available: () => c().length > 0
			},
			{
				id: "selection.group",
				label: "Create container or group selection",
				group: "choose",
				shortcut: "Ctrl+G",
				input: {
					on: "keydown",
					key: "g",
					ctrl: !0,
					prevent: !0
				},
				available: () => a.isOn("containers")
			}
		]), e("choose.all", () => t("selection.choose", {
			refs: c(),
			mode: "replace"
		})), e("choose.none", () => t("selection.item.clear")), e("choose.invert", () => t("selection.choose", {
			refs: c().filter((e) => !i.has(e)),
			mode: "replace"
		})), e("choose.follow", () => {
			let e = new Set(l().map((e) => e.id)), n = [];
			r.current.edges().forEach((t) => {
				e.has(t.From) && n.push(B(t.To)), e.has(t.To) && n.push(B(t.From));
			}), n.length && t("selection.choose", {
				refs: n,
				mode: "add"
			});
		}), e("choose.radius", () => {
			let e = i.selectedAll().map((e) => r.current.getItem(e)?.Position).filter((e) => !!e);
			if (!e.length) return;
			let n = r.current.nodes().filter((t) => t.Position && e.some((e) => Math.hypot(t.Position.x - e.x, t.Position.y - e.y) <= Vi)).map((e) => B(e.id));
			n.length && t("selection.choose", {
				refs: n,
				mode: "add"
			});
		}), e("choose.search", ({ q: e }) => {
			let r = e.trim().toLowerCase();
			r && t("selection.choose", {
				refs: n.hierarchy.items().filter((e) => (e.label ?? "").toLowerCase().includes(r)).map((e) => e.ref),
				mode: "replace"
			});
		});
		let u = (n = {}) => {
			let r = s?.label, a = {
				...n,
				label: n.label ?? (r ? r[0].toUpperCase() + r.slice(1) : void 0),
				containerType: n.containerType ?? s?.containerType
			}, o = i.selectedAll().filter((e) => e.kind === "node" || e.kind === "container");
			if (!o.length) {
				t("editing.container.create", {
					...a.label ? { Label: { text: a.label } } : {},
					ContainerType: a.containerType,
					Color: a.color
				});
				return;
			}
			let c = e("container.created", ({ id: e }) => {
				c(), o.forEach((n) => t("container.add-child", {
					containerId: e,
					childRef: n
				})), t("selection.item.select", {
					kind: "container",
					id: e
				});
			});
			t("editing.container.create", {
				...a.label ? { Label: { text: a.label } } : {},
				ContainerType: a.containerType,
				Color: a.color
			});
		};
		e("selection.group", () => u()), e("selection.group.as", (e) => u(e)), o({
			surface: "top",
			command: "selection.group",
			kind: "button",
			icon: "group",
			label: "Create container or group selection",
			order: 17,
			group: "edit"
		});
	}, { requires: ["ability.selectable", "graph"] });
}
//#endregion
//#region canvas/systems/collections.ts
function Ui(e) {
	e("collections", (e) => {
		e.model.collections().forEach((t) => {
			if (t.toolbar === !1) return;
			let n = {
				surface: t.toolbar?.surface ?? "top",
				command: Dt(t),
				kind: "button",
				text: t.toolbar?.text ?? `+ ${t.entity?.label ?? t.kind}`,
				icon: t.toolbar?.icon,
				label: t.kind === "node" ? "Add node" : t.kind === "edge" ? "Connect" : void 0,
				order: t.toolbar?.order,
				group: t.kind === "graph" ? void 0 : "edit"
			};
			e.contribute(n);
		});
	}, { requires: ["graph"] });
}
//#endregion
//#region canvas/systems/command-help-view.ts
var Wi = [
	["Move", "Drag with two fingers"],
	["Zoom", "Pinch anywhere on canvas"],
	["Item actions", "Hold an item"],
	["Connect", "Hold node → Connect → tap target"],
	["Rename", "Hold item → Rename"],
	["Reframe", "Tap Fit"]
], Gi = [
	[
		"Add",
		"Create a node",
		"A"
	],
	[
		"Connect",
		"Choose two nodes",
		"E"
	],
	[
		"Move",
		"Drag the node itself",
		"Drag"
	],
	[
		"Edit",
		"Rename the selected item",
		"Enter"
	],
	[
		"Find anything",
		"Search commands and items",
		"P"
	],
	[
		"Undo",
		"Reverse the last change",
		"Ctrl Z"
	]
], Ki = ({ compactViewport: e, contexts: t }) => {
	let n = () => u("section.touch-guide", [...Wi.map(([e, t]) => u("div", [u("strong", { text: e }), u("span", { text: t })])), u("button.help-start-guide", {
		type: "button",
		text: "Open getting-started guide",
		data: { command: "onboarding.open" }
	})]), r = () => {
		let e = document.createDocumentFragment();
		return [...Xn(t.commands.all().filter((e) => !e.hidden && t.commands.isEnabled(e)).filter((e) => !!it(e)).filter((e) => ![
			"debug",
			"perf",
			"scenario",
			"dx"
		].includes(e.group ?? "")).sort((e, t) => e.label.localeCompare(t.label)), (e) => e.group ?? er(e.id))].sort(([e], [t]) => e.localeCompare(t)).forEach(([n, r]) => {
			let i = t.templates.clone("command-section");
			t.templates.text(i, "group", n);
			let a = t.templates.slot(i, "rows");
			r.forEach((e) => {
				let n = t.templates.clone("help-row");
				t.templates.text(n, "label", e.label), t.templates.text(n, "id", e.id);
				let r = n.querySelector(".shortcut-edit");
				r && (r.value = it(e), r.dataset.shortcutCommand = e.id, r.setAttribute("aria-label", `Shortcut for ${e.label}`)), a.append(n);
			}), e.append(i);
		}), e;
	};
	return (() => {
		if (e()) return n();
		let t = u(".help-reference-rows");
		return t.append(r()), u("section.help-guide", [
			u("header.help-intro", [u("h2", { text: "Make, connect, arrange." }), u("p", { text: "Most work needs six moves. Everything else can wait." })]),
			u(".help-task-grid", Gi.map(([e, t, n]) => u("div", [u("span", [u("strong", { text: e }), u("small", { text: t })]), u("kbd", { text: n })]))),
			u("button.help-start-guide", {
				type: "button",
				text: "Open getting-started guide",
				data: { command: "onboarding.open" }
			}),
			u("details.help-reference", [u("summary", { text: "All keyboard shortcuts" }), t])
		]);
	})();
}, qi = "Search commands and graph items", Ji = "abcdefghijklmnopqrstuvwxyz0123456789".split("");
function Yi(n) {
	n("commandModal", (n) => {
		let { on: r, emit: i, contexts: a, contribute: o } = n, s = () => a.places.width() <= 680 || globalThis.matchMedia?.("(pointer: coarse)").matches === !0;
		o({
			surface: "top",
			command: "help.open",
			kind: "button",
			icon: "help",
			text: "Help",
			label: "Commands and shortcuts",
			slot: t.End,
			order: 99,
			group: "overflow"
		}), o({
			surface: "top",
			command: "palette.open",
			kind: "button",
			icon: "commands",
			text: "Commands",
			label: "Open commands and graph search",
			slot: t.End,
			order: 100,
			group: "overflow"
		});
		let c = "", l = 0, d = [], f = /* @__PURE__ */ new Map(), p = /* @__PURE__ */ new Map(), m = () => a.places.el(e.Modal), h = () => !!m()?.querySelector("[data-command-modal=\"palette\"]"), g = (e) => {
			let t = e.input?.on ?? "";
			return t.startsWith("pointer") || t === "wheel" || t === "dblclick" || /\.(start|move|end)$/.test(e.id);
		}, _ = (e) => {
			if (e.picker) {
				let t = {}, n = { origin: "palette" }, r = 2;
				return e.picker.steps.forEach((e) => {
					let i = e.seed?.(t, n);
					i ? t[e.id] = i : r += 1;
				}), r;
			}
			return e.form ? 3 : 2;
		}, v = (e) => e.id === "editing.edge.create" ? n.graphs.current.nodes().length >= 2 : e.id === "container.add-child" ? n.graphs.current.itemsOfKind("container").length > 0 : !0, y = (e = "") => {
			let t = e.trim().toLowerCase();
			return a.commands.all().filter((e) => !e.hidden || !!t && g(e)).filter((e) => a.commands.isEnabled(e)).filter((e) => !!t || e.available?.() !== !1).filter((e) => !s() || v(e)).filter((e) => !s() || _(e) <= 3).filter((e) => !t || `${e.id} ${e.label} ${e.group ?? ""} ${it(e)} ${e.input?.on ?? ""}`.toLowerCase().includes(t));
		}, b = new Set([
			"item",
			"selection",
			"choose",
			"editing",
			"edge",
			"container"
		]), x = (e) => b.has(e) === n.selection.selectedAll().length > 0 ? 0 : 1, S = (e = "") => {
			let t = [];
			return [...Xn(y(e), (e) => e.group ?? er(e.id))].sort((e, t) => x(e[0]) - x(t[0])).forEach(([, e]) => t.push(...e)), t;
		}, C = (e) => {
			let t = e.trim().toLowerCase();
			return t ? a.hierarchy.targets().filter((e) => e.label.toLowerCase().includes(t)).slice(0, 8) : [];
		}, w = (e) => {
			let t = [];
			return C(e).forEach((e) => t.push({
				kind: "goto",
				ref: e.ref,
				label: e.label,
				group: "go to",
				shortcut: ""
			})), S(e).forEach((e) => t.push({
				kind: "command",
				id: e.id,
				label: e.label,
				group: e.group ?? er(e.id),
				shortcut: it(e)
			})), t;
		}, T = (e, t) => {
			f = /* @__PURE__ */ new Map(), p = /* @__PURE__ */ new Map();
			let n = t.trim().toLowerCase();
			if (!n) return;
			let r = /* @__PURE__ */ new Set();
			e.forEach((e, t) => {
				let i = e.label.toLowerCase(), a = i.indexOf(n), o = a >= 0 ? a + n.length : 0, s = i.slice(o) + i.slice(0, o);
				for (let e of s) if (!(!Ji.includes(e) || r.has(e))) {
					r.add(e), f.set(t, e), p.set(e, t);
					break;
				}
			});
		}, E = (e, t) => {
			let n = a.templates.clone("command-row");
			if (n.dataset.index = String(t), t === l && n.classList.add("is-selected"), e.kind === "command") {
				if (n.dataset.command = "commandModal.run", n.dataset.commandId = e.id, s()) {
					let t = a.commands.get(e.id);
					n.dataset.interactionCost = String(t ? _(t) : 2);
				}
				a.templates.text(n, "id", e.id);
			} else n.dataset.command = "palette.goto", n.dataset.gotoKind = e.ref.kind, n.dataset.gotoId = e.ref.id, s() && (n.dataset.interactionCost = "2"), a.templates.text(n, "id", e.ref.kind);
			a.templates.text(n, "label", e.label);
			let r = f.get(t), i = s() ? "" : [r ? `⌥${r.toUpperCase()}` : "", e.shortcut].filter(Boolean).join(" · ");
			return i ? a.templates.text(n, "shortcut", i) : n.querySelector("kbd")?.remove(), n;
		}, D = (e = "") => {
			d = w(e), T(d, e), l >= d.length && (l = Math.max(0, d.length - 1));
			let t = document.createDocumentFragment(), n = 0, r = /* @__PURE__ */ new Map(), i = (e) => {
				let n = r.get(e);
				return n || (n = a.templates.clone("command-section"), a.templates.text(n, "group", e), r.set(e, n), t.append(n)), a.templates.slot(n, "rows");
			};
			return d.forEach((e) => i(e.group).append(E(e, n++))), d.length || t.append(u("section.palette-empty", { role: "status" }, [u("p", { text: `No commands or graph items match “${e.trim()}”.` }), u("button", {
				type: "button",
				text: "Clear search",
				data: { command: "commandModal.search.clear" }
			})])), t;
		}, O = () => {
			let e = u("section.palette-quick"), t = u("h3", { text: n.selection.selected() ? "For selection" : "Quick actions" }), r = u(".palette-quick-grid");
			return [
				[
					"editing.node.create",
					"+",
					n.selection.selectedNode() ? "Add connected" : "Add node"
				],
				[
					"editing.edge.create",
					"↗",
					"Connect"
				],
				[
					"view.fit.all",
					"⌗",
					"Fit canvas"
				],
				[
					"history.undo",
					"↶",
					"Undo"
				],
				[
					"history.redo",
					"↷",
					"Redo"
				]
			].forEach(([e, t, n]) => {
				let i = a.commands.get(e);
				!i || !a.commands.isEnabled(i) || i.available?.() === !1 || v(i) && (_(i) > 3 || r.append(u("button", {
					type: "button",
					data: {
						command: "commandModal.run",
						commandId: e,
						interactionCost: String(_(i))
					}
				}, [u("b", { text: t }), u("span", { text: n })])));
			}), e.append(t, r), e;
		}, k = () => {
			let e = a.templates.clone("palette");
			e.dataset.commandModal = "palette";
			let t = e.querySelector(".palette-search");
			if (t instanceof HTMLInputElement) {
				let e = s() ? "Find an action or item" : qi;
				t.placeholder = e, t.setAttribute("aria-label", e), s() && t.removeAttribute("autofocus");
			}
			return s() && (e.classList.add("palette-mobile"), e.prepend(O())), a.templates.slot(e, "commands").append(D()), e;
		}, A = () => {
			let e = m()?.querySelector("[data-command-modal=\"palette\"] [data-slot=\"commands\"]");
			e && (e.replaceChildren(D(c)), e.querySelector(".is-selected")?.scrollIntoView?.({ block: "nearest" }));
		}, j = (e) => {
			if (e) if (i("modal.close"), e.kind === "command") a.commands.run(zn(e.id, { origin: "palette" }));
			else {
				let t = Bn(c, { origin: "palette" }, e.ref);
				t.kind === "query" && t.selection && (i("selection.item.select", t.selection), i("view.fit.item", t.selection));
			}
		};
		a.commands.register([
			{
				id: "palette.open",
				label: "Open palette",
				group: "modal",
				shortcut: "P",
				input: {
					on: "keydown",
					key: "p",
					prevent: !0
				}
			},
			{
				id: "help.open",
				label: "Open help",
				group: "modal"
			},
			{
				id: "palette.open.alt",
				label: "Open palette (?)",
				event: "palette.open",
				group: "modal",
				hidden: !0,
				shortcut: "?",
				input: {
					on: "keydown",
					key: "?",
					prevent: !0
				}
			},
			{
				id: "palette.nav.down",
				label: "Palette: next row",
				event: "palette.nav",
				group: "modal",
				hidden: !0,
				input: {
					on: "keydown",
					key: "ArrowDown",
					global: !0,
					prevent: !0,
					stop: !0,
					when: h
				},
				payload: () => ({ delta: 1 })
			},
			{
				id: "palette.nav.up",
				label: "Palette: previous row",
				event: "palette.nav",
				group: "modal",
				hidden: !0,
				input: {
					on: "keydown",
					key: "ArrowUp",
					global: !0,
					prevent: !0,
					stop: !0,
					when: h
				},
				payload: () => ({ delta: -1 })
			},
			{
				id: "palette.activate",
				label: "Palette: run highlighted",
				group: "modal",
				hidden: !0,
				input: {
					on: "keydown",
					key: "Enter",
					global: !0,
					prevent: !0,
					stop: !0,
					when: h
				}
			},
			...Ji.map((e) => ({
				id: `palette.alt.${e}`,
				label: `Palette: Alt+${e}`,
				event: "palette.alt",
				group: "modal",
				hidden: !0,
				input: {
					on: "keydown",
					key: e,
					alt: !0,
					global: !0,
					prevent: !0,
					stop: !0,
					when: h
				},
				payload: () => ({ char: e })
			})),
			{
				id: "commandModal.run",
				label: "Run command modal item",
				group: "modal",
				hidden: !0,
				payload: ({ target: e }) => ({ commandId: e?.closest("[data-command-id]")?.getAttribute("data-command-id") ?? "" })
			},
			{
				id: "palette.goto",
				label: "Go to item",
				group: "modal",
				hidden: !0,
				payload: ({ target: e }) => {
					let t = e?.closest("[data-goto-id]") ?? null;
					return t ? {
						kind: t.getAttribute("data-goto-kind"),
						id: t.getAttribute("data-goto-id")
					} : void 0;
				}
			},
			{
				id: "commandModal.search.change",
				label: "Search command modal",
				event: "commandModal.search.changed",
				group: "modal",
				hidden: !0,
				input: {
					on: "input",
					selector: ".palette-search"
				},
				payload: ({ target: e }) => ({ query: e.value })
			},
			{
				id: "commandModal.search.clear",
				label: "Clear palette search",
				group: "modal",
				hidden: !0
			},
			{
				id: "shortcut.edit.preview",
				label: "Preview shortcut edit",
				group: "modal",
				hidden: !0,
				input: {
					on: "input",
					selector: ".shortcut-edit"
				},
				payload: ({ target: e }) => ({
					id: e.dataset.shortcutCommand ?? "",
					shortcut: e.value
				})
			},
			{
				id: "shortcut.edit.commit",
				label: "Commit shortcut edit",
				group: "modal",
				hidden: !0,
				input: {
					on: "focusout",
					selector: ".shortcut-edit"
				},
				payload: ({ target: e }) => ({
					id: e.dataset.shortcutCommand ?? "",
					shortcut: e.value
				})
			}
		]);
		let M = () => i("modal.open", {
			title: s() ? "Commands" : "Palette",
			visual: "command",
			body: () => k()
		});
		r("palette.open", () => {
			c = "", l = 0, M();
		}), r("help.open", () => i("modal.open", {
			title: s() ? "Touch guide" : "Commands and shortcuts",
			visual: "command",
			body: () => Ki({
				compactViewport: s,
				contexts: a
			})
		})), r("palette.nav", ({ delta: e }) => {
			d.length && (l = (l + e + d.length) % d.length, A());
		}), r("palette.activate", () => j(d[l])), r("palette.alt", ({ char: e }) => {
			let t = p.get(e);
			t != null && j(d[t]);
		}), r("commandModal.run", ({ commandId: e }) => {
			i("modal.close"), a.commands.run(zn(e, { origin: "palette" }));
		}), r("palette.goto", (e) => {
			e?.id && (i("modal.close"), i("selection.item.select", e), i("view.fit.item", e));
		}), r("commandModal.search.changed", ({ query: e }) => {
			c = e, l = 0, A();
		}), r("commandModal.search.clear", () => {
			c = "", l = 0;
			let e = m()?.querySelector(".palette-search");
			e && (e.value = ""), A(), e?.focus();
		});
		let N = (e) => m()?.querySelector(`.shortcut-edit[data-shortcut-command="${CSS.escape(e)}"]`), P = (e, t) => {
			let n = N(e);
			if (!n) return !1;
			let r = !!a.commands.shortcutConflict(e, t ?? n.value);
			return n.classList.toggle("is-conflict", r), n.closest(".help-row")?.classList.toggle("has-conflict", r), r;
		};
		r("shortcut.edit.preview", ({ id: e, shortcut: t }) => {
			a.commands.get(e) && P(e, t);
		}), r("shortcut.edit.commit", ({ id: e, shortcut: t }) => {
			let n = a.commands.get(e);
			if (!n) return;
			if (P(e, t)) {
				let t = N(e);
				t && (t.value = it(n));
				return;
			}
			a.commands.setShortcut(e, t ?? "");
			let r = N(e);
			r && (r.value = it(n));
		});
	}, { requires: ["modal"] });
}
//#endregion
//#region canvas/systems/command-form.ts
var Xi = (e, t) => `form-${e.replace(/[^a-z0-9_-]/gi, "-")}-${t.id}`;
function Zi(t) {
	t("commandForm", ({ on: t, emit: n, forward: r, contexts: i }) => {
		let a = (e) => {
			let t = {};
			return e.querySelectorAll("[data-form-field]").forEach((e) => {
				e.closest("[data-form-field-wrap]")?.hidden || (t[e.dataset.formField] = e.value.trim());
			}), t;
		}, o = (e) => e.querySelector("[data-form-error]"), s = (e, t = "") => {
			let n = e ? o(e) : null;
			n && (n.textContent = t);
		}, c = (e, t, n = "") => {
			let r = u("label", { data: { formFieldWrap: t.id } }), i = t.options?.() ?? [], a = {
				name: t.id,
				value: n,
				required: t.required !== !1,
				placeholder: t.placeholder ?? "",
				autofocus: t.autofocus || void 0,
				data: { formField: t.id }
			};
			if (t.input === "hidden") return u("input", {
				type: "hidden",
				name: t.id,
				value: n,
				data: { formField: t.id }
			});
			if (t.input === "textarea") {
				let e = u("textarea", a);
				return e.style.minHeight = "120px", e.style.maxHeight = "240px", r.append(t.label, e), r;
			}
			if (t.input === "select") {
				let e = u("select", {
					name: t.id,
					required: t.required !== !1,
					autofocus: t.autofocus || void 0,
					data: { formField: t.id }
				}, i.map((e) => u("option", {
					value: e.value,
					text: e.label
				})));
				return n && (e.value = n), r.append(t.label, e), r;
			}
			let o = u("input", a);
			if (r.append(t.label, o), !i.length) return r;
			let s = u("datalist", { id: Xi(e, t) });
			return i.forEach((e) => {
				s.append(u("option", {
					value: e.value,
					label: e.label
				}));
			}), o.setAttribute("list", s.id), r.append(s), r;
		}, l = (e, t, n = "") => {
			let r = i.commands.get(e), o = r?.form;
			if (!r || !o) return document.createDocumentFragment();
			let s = u("section.command-form.properties", { data: { commandForm: e } });
			s.style.display = "grid", s.style.gap = "var(--space-1)";
			let l = u("div", { data: { slot: "fields" } });
			Object.assign(l.style, {
				display: "grid",
				gap: "var(--space-1)",
				maxHeight: "calc(100dvh - 190px)",
				overflow: "auto"
			}), o.fields.forEach((n) => l.append(c(e, n, t[n.id] ?? "")));
			let f = u(".form-error", {
				text: n,
				data: { formError: "" }
			}), p = u(".form-actions");
			Object.assign(p.style, {
				position: "sticky",
				bottom: "0",
				background: "var(--panel)"
			});
			let m = document.createElement("button");
			return m.type = "button", m.className = "primary", m.dataset.command = "commandForm.submit", m.textContent = o.submitLabel ?? "Apply", p.append(m), s.append(l, f, p), d(s, o.fields, a(s)), s;
		}, d = (e, t, n) => {
			t.forEach((t) => {
				let r = e.querySelector(`[data-form-field-wrap="${t.id}"]`), i = e.querySelector(`[data-form-field="${t.id}"]`), a = t.visibleWhen?.(n) !== !1;
				r && (r.hidden = !a, r.style.display = a ? "" : "none"), i && (i.required = a && t.required !== !1);
			});
		};
		i.commands.register([{
			id: "commandForm.submit",
			label: "Submit command form",
			group: "modal",
			hidden: !0,
			input: {
				on: "keydown",
				key: "Enter",
				selector: ".command-form input, .command-form select",
				prevent: !0,
				stop: !0
			},
			payload: ({ target: e }) => {
				let t = e?.closest("[data-command-form]");
				return {
					commandId: t?.dataset.commandForm ?? "",
					values: t ? a(t) : {}
				};
			}
		}, {
			id: "commandForm.change",
			label: "Update command form fields",
			group: "modal",
			hidden: !0,
			input: {
				on: "change",
				selector: ".command-form [data-form-field]"
			},
			payload: ({ target: e }) => {
				let t = e?.closest("[data-command-form]");
				return {
					commandId: t?.dataset.commandForm ?? "",
					values: t ? a(t) : {}
				};
			}
		}]), t("commandForm.open", ({ commandId: e, seed: t = {} }) => {
			let r = i.commands.get(e);
			if (!r?.form) return;
			let a = r.form.validate?.(t, {}) ?? "";
			n("modal.open", {
				title: typeof r.form.title == "function" ? r.form.title() : r.form.title ?? r.label,
				visual: "properties",
				body: () => l(e, t, a)
			}), a && n("app.notice", {
				message: a,
				level: "warn"
			});
		}), t("commandForm.change", ({ commandId: t, values: n }) => {
			let r = i.commands.get(t), a = i.places.el(e.Modal)?.querySelector(`[data-command-form="${t}"]`);
			a && r?.form && d(a, r.form.fields, n);
		}), t("commandForm.submit", ({ commandId: t, values: a }) => {
			let o = i.commands.get(t), c = o?.form, l = i.places.el(e.Modal)?.querySelector(`[data-command-form="${t}"]`);
			if (!o || !c) return;
			let u = c.validate?.(a, {});
			if (u) {
				s(l, u), n("app.notice", {
					message: u,
					level: "warn"
				});
				return;
			}
			let d = c.payload(a, {});
			if (d == null) {
				let e = "Fill the required fields.";
				s(l, e), n("app.notice", {
					message: e,
					level: "warn"
				});
				return;
			}
			r(o.event, d), n("modal.close");
		});
	}, { requires: ["modal"] });
}
//#endregion
//#region canvas/systems/command-picker.ts
var Qi = "asdfghjklqwertyuiopzxcvbnm";
function $i(t) {
	t("commandPicker", ({ on: t, emit: n, forward: r, contexts: i, graphs: a, origin: o, frameLoop: s }) => {
		let c = () => i.places.width() <= 680 || globalThis.matchMedia?.("(pointer: coarse)").matches === !0, l = null, d = (t = null, r = "") => {
			i.decorations.unregisterOrigin("commandPicker"), i.interaction.keys.unregisterOrigin("commandPicker"), n("render.view.clear", {
				place: e.Stage,
				key: "picker-prompt"
			}), i.places.el(e.Stage)?.classList.remove("picker-canvas-target");
			let a = () => {
				let n = r.replace(/\\/g, "\\\\").replace(/"/g, "\\\""), a = i.places.el(e.Top)?.parentElement, o = n ? a?.querySelector(`[data-command="${n}"]`) ?? null : null, s = !!i.places.el(e.Stage)?.getClientRects().length, c = (e) => {
					if (!e?.isConnected || s && !e.getClientRects().length || e.closest("[hidden], [inert]")) return !1;
					let t = e.closest("details:not([open])"), n = t?.querySelector(":scope > summary");
					return !t || !!n?.contains(e);
				}, l = [
					a?.querySelector("[aria-label=\"Current graph name\"]"),
					a?.querySelector("[aria-label=\"More actions\"]"),
					a?.querySelector("[data-place=\"top\"] button"),
					a?.querySelector("[data-place=\"top\"] input")
				].find(c) ?? null, u = c(t) ? t : c(o) ? o : l, d = document.activeElement;
				(!d || d === document.body) && u?.focus({ preventScroll: !0 });
			};
			a(), s.schedule("commandPicker.restoreFocus.prepare", () => {
				let e = 16, t = () => {
					a(), --e > 0 && s.schedule("commandPicker.restoreFocus.commit", t, 40);
				};
				s.schedule("commandPicker.restoreFocus.commit", t, 40);
			}, 40);
		}, f = () => {
			if (!l) return;
			let e = l.restoreFocus, t = l.restoreCommand;
			l = null, d(e, t);
		}, p = () => {
			if (!l) return;
			let e = l;
			l = null, d(e.restoreFocus, e.restoreCommand);
			let t = e.picker.validate?.(e.values, e.source);
			if (t) {
				n("app.notice", {
					message: t,
					level: "warn"
				});
				return;
			}
			let i = e.picker.payload(e.values, e.source);
			i != null && (n("commandPicker.submit", {
				commandId: e.commandId,
				values: e.values
			}), r(e.command.event, i));
		}, m = (e, t, n) => {
			let r = u(".picker-prompt", {
				role: "status",
				"aria-live": "polite"
			}, [
				u("strong", { text: e.prompt ?? `Pick ${e.id}` }),
				u("span", { text: n > 1 ? ` (${t + 1}/${n})` : "" }),
				u("em", { text: c() ? " · Tap a highlighted item" : " · Click a highlighted item or press its letter · Esc to cancel" })
			]);
			if (l?.canvasRef) {
				let t = u("button.picker-canvas-option", {
					type: "button",
					text: `${l.canvasLetter.toUpperCase()} · ${e.canvasLabel ?? "Canvas"}`,
					data: {
						command: "commandPicker.pick.canvas",
						pickerCanvas: ""
					}
				});
				t.setAttribute("aria-label", `Move to ${e.canvasLabel ?? "Canvas"}`), r.append(t);
			}
			return r;
		}, h = () => {
			if (!l) return;
			let t = l.picker.steps[l.stepIndex];
			if (!t) {
				p();
				return;
			}
			let r = t.seed?.(l.values, l.source);
			if (r) {
				l.values[t.id] = r, l.stepIndex++, h();
				return;
			}
			let o = t.filter?.(l.values, l.source) ?? (() => !0), s = t.canvas?.(l.values, l.source) ? {
				kind: "graph",
				id: a.current.id
			} : null, c = 26 - !!s, u = i.hierarchy.items().filter((e) => o(e.ref)).slice(0, c), d = s ? [{
				ref: s,
				label: t.canvasLabel ?? "Canvas"
			}, ...u] : u;
			if (!d.length) {
				n("app.notice", {
					message: `Nothing to pick for ${t.prompt ?? t.id}`,
					level: "warn"
				}), f();
				return;
			}
			let g = /* @__PURE__ */ new Map(), _ = d.map((e, t) => {
				let n = Qi[t];
				return g.set(n, e.ref), e.ref.kind === "graph" ? null : {
					ref: e.ref,
					text: n.toUpperCase(),
					className: "picker-letter",
					id: `picker-${n}`
				};
			}).filter((e) => !!e);
			i.decorations.overlays.set("commandPicker", _), i.decorations.modes.set("commandPicker", "candidate", u.map((e) => e.ref), "picker-candidate"), l.candidates = new Set(d.map((e) => R(e.ref))), l.canvasRef = s, l.canvasLetter = s ? Qi[0] : "", i.places.el(e.Stage)?.classList.toggle("picker-canvas-target", !!s), n("render.view.set", {
				place: e.Stage,
				key: "picker-prompt",
				view: () => m(t, l.stepIndex, l.picker.steps.length)
			}), i.interaction.keys.capture("commandPicker", { onKey(e) {
				if (e.key === "Escape") return;
				let t = e.key.toLowerCase();
				if (!/^[a-z]$/.test(t)) return;
				e.preventDefault();
				let r = g.get(t);
				if (!r || !l) {
					n("commandPicker.cancel");
					return;
				}
				n("commandPicker.pick", { ref: r });
			} });
		}, _ = (e) => {
			if (!l || !l.candidates.has(R(e))) return;
			let t = l.picker.steps[l.stepIndex];
			t && (l.values[t.id] = e, l.stepIndex++, n("commandPicker.step", {
				commandId: l.commandId,
				step: t.id,
				ref: e
			}), i.interaction.keys.unregisterOrigin("commandPicker"), i.decorations.unregisterOrigin("commandPicker"), h());
		};
		return i.commands.register([
			{
				id: "commandPicker.pick.pointer",
				label: "Pick item with pointer",
				event: "commandPicker.pick",
				group: "modal",
				hidden: !0,
				input: {
					on: "pointerdown",
					selector: "[data-item-kind][data-item-id]",
					when: (e, t) => {
						let n = g(t);
						return !!l && !!n && l.candidates.has(R(n));
					},
					prevent: !0,
					stop: !0
				},
				payload: ({ target: e }) => {
					let t = g(e);
					return t ? { ref: t } : void 0;
				}
			},
			{
				id: "commandPicker.pick.canvas",
				label: "Pick canvas destination",
				event: "commandPicker.pick",
				group: "modal",
				hidden: !0,
				payload: () => l?.canvasRef ? { ref: l.canvasRef } : void 0
			},
			{
				id: "commandPicker.pick.canvas.pointer",
				label: "Pick canvas destination with pointer",
				event: "commandPicker.pick",
				group: "modal",
				hidden: !0,
				input: {
					on: "pointerdown",
					selector: "[data-place=\"stage\"]",
					prevent: !0,
					stop: !0,
					when: (e) => !!l?.canvasRef && !e.target?.closest("[data-item-kind][data-item-id], .tool-panel, .item-toolbar, .picker-prompt, .modal-layer")
				},
				payload: () => l?.canvasRef ? { ref: l.canvasRef } : void 0
			}
		]), t("commandPicker.open", ({ commandId: e, source: t }) => {
			let n = i.commands.get(e);
			if (!n?.picker) return;
			let r = t ?? { origin: "keyboard" };
			f(), i.interaction.cancel.cancelPointerModes(), s.cancel("commandPicker.restoreFocus.prepare"), s.cancel("commandPicker.restoreFocus.commit");
			let a = (r.target instanceof Element ? r.target : null)?.closest("[data-command], button, [href], input, select, textarea, [tabindex]") ?? null, o = document.activeElement instanceof HTMLElement ? document.activeElement : null, c = a ?? o;
			l = {
				commandId: e,
				command: n,
				picker: n.picker,
				source: r,
				values: {},
				stepIndex: 0,
				candidates: /* @__PURE__ */ new Set(),
				restoreFocus: c,
				restoreCommand: c?.closest("[data-command]")?.dataset.command ?? "",
				canvasRef: null,
				canvasLetter: ""
			}, h();
		}), t("commandPicker.pick", (e) => {
			e?.ref && _(e.ref);
		}), t("commandPicker.cancel", f), t("graph.switched", f), t("modal.open", f), i.interaction.cancel.register({
			origin: o,
			active: () => !!l,
			cancel: () => n("commandPicker.cancel")
		}), () => {
			s.cancel("commandPicker.restoreFocus.prepare"), s.cancel("commandPicker.restoreFocus.commit"), f(), s.cancel("commandPicker.restoreFocus.prepare"), s.cancel("commandPicker.restoreFocus.commit");
		};
	}, { requires: ["render.stage", "graph"] });
}
//#endregion
//#region canvas/systems/container-entity.ts
var ea = {
	w: 320,
	h: 200
}, ta = (e) => e === "c4-system" ? {
	w: 560,
	h: 360
} : e === "c4-container" ? {
	w: 400,
	h: 240
} : { ...ea }, na = (e) => e.Sections?.[0]?.id, ra = (e) => {
	e.Sections = e.Sections?.map((e, t) => ({
		id: e.id || `s${t + 1}`,
		title: e.title || `Section ${t + 1}`,
		weight: Math.max(.15, Number(e.weight) || 1)
	})) ?? [], e.SectionAxis = e.SectionAxis ?? "rows";
	let t = new Set(e.Sections.map((e) => e.id)), n = new Set(e.Children.map(R)), r = na(e), i = {};
	Object.entries(e.ChildSections ?? {}).forEach(([e, a]) => {
		n.has(e) && (t.has(a) ? i[e] = a : r && (i[e] = r));
	}), e.Children.forEach((e) => {
		let t = R(e);
		r && !i[t] && (i[t] = r);
	}), e.ChildSections = i;
}, ia = (e, t = []) => String(e).split(/\r?\n/).map((e) => e.trim()).filter(Boolean).map((e, n) => ({
	id: t[n]?.id ?? `s${n + 1}`,
	title: e,
	weight: t[n]?.weight ?? 1
})), aa = (e) => String(e).split(/\r?\n/).map((e) => e.trim()).filter(Boolean).flatMap((e) => {
	let [t, ...n] = e.split(/\s+/), r = n.join(" ").trim();
	return q(t) && r ? [{
		color: t,
		label: r
	}] : [];
}), oa = (e) => Array.isArray(e) ? e.filter((e) => !!e && q(e.color) && typeof e.label == "string" && !!e.label) : [], sa = (e) => e === "rows" || e === "columns", ca = (e, n) => {
	let r = {
		layer: "html",
		bounds: e,
		draw(r, i) {
			let a = e(r), o = u(".container");
			if (n(r) && o.classList.add("collapsed"), r.AutoFit === !1 && o.classList.add("manual"), o.dataset.sectionAxis = r.SectionAxis ?? "rows", o.dataset.containerType = r.ContainerType ?? "group", r.Color && (o.dataset.containerColor = r.Color), r.Tags?.length) {
				o.dataset.tags = r.Tags.join(" ");
				let e = u("span.container-tags");
				r.Tags.forEach((t) => {
					let n = Bt(t), r = u("b.container-tag", {
						text: t,
						data: {
							tag: t,
							tagColor: Ht(t),
							metricKey: n?.key,
							metricValue: n ? `${n.value}` : void 0
						}
					});
					e.append(r);
				}), o.append(e);
			}
			o.style.left = `${a.x + a.w / 2}px`, o.style.top = `${a.y + a.h / 2}px`, o.style.width = `${a.w}px`, o.style.height = `${a.h}px`;
			let s = i.refOf(r.id);
			if (i.tagItem(o, s), i.applyItemModes(o, s), !n(r) && r.Sections?.length) {
				o.classList.add("has-sections");
				let e = u(".container-sections", { data: { axis: r.SectionAxis ?? "rows" } });
				r.Sections.forEach((t, n) => {
					let i = u(".container-section", { data: { sectionId: t.id } }, [u("span", {
						text: t.title,
						tabIndex: 0,
						data: {
							containerSectionTitle: "",
							containerId: r.id,
							sectionId: t.id
						}
					})]);
					i.style.flexGrow = `${Math.max(.15, t.weight ?? 1)}`, e.append(i), n < r.Sections.length - 1 && e.append(u("button.container-section-divider", {
						type: "button",
						"aria-label": "Resize container sections",
						data: {
							containerSectionResize: "",
							containerId: r.id,
							sectionIndex: n
						}
					}));
				}), o.append(e);
			}
			!n(r) && r.Legend?.length && o.append(u(".container-legend", r.Legend.map((e) => u(".container-legend-entry", [u("span.container-legend-swatch", { data: { legendColor: e.color } }), u("span", { text: e.label })])))), r.Multiplier?.trim() && o.append(u(".container-multiplier", { text: r.Multiplier.trim() }));
			let c = u(".container-label", { data: { editableTitle: "" } });
			c.dataset.slot = t.Drag, c.textContent = r.Label.text;
			let l = u(".container-resize", { data: { slot: t.Resize } });
			return o.append(c, l), i.wireAffordances(o), o;
		}
	};
	return {
		kind: "container",
		label: "Container",
		labelOf: (e) => e.Label.text || e.id,
		order: -10,
		abilities: [
			Ir(),
			Dr(),
			Mr(),
			kr(),
			ur(),
			pr(),
			Pr()
		],
		properties: [
			{
				id: "title",
				label: "Title",
				input: "text",
				value: (e) => e.Label.text,
				patch: (e, t) => ({ Label: { text: String(t) } })
			},
			{
				id: "width",
				label: "Width",
				input: "number",
				min: 120,
				step: 8,
				value: (e) => e.Size.w,
				patch: (e, t) => Number.isFinite(Number(t)) ? { Size: {
					...e.Size,
					w: Math.max(120, Number(t))
				} } : void 0
			},
			{
				id: "height",
				label: "Height",
				input: "number",
				min: 80,
				step: 8,
				value: (e) => e.Size.h,
				patch: (e, t) => Number.isFinite(Number(t)) ? { Size: {
					...e.Size,
					h: Math.max(80, Number(t))
				} } : void 0
			},
			{
				id: "containerType",
				label: "Container type",
				input: "select",
				value: (e) => e.ContainerType ?? "group",
				options: [
					{
						value: "group",
						label: "Group"
					},
					{
						value: "c4-system",
						label: "C4 system"
					},
					{
						value: "c4-container",
						label: "C4 container"
					}
				],
				patch: (e, t) => t === "group" || t === "c4-system" || t === "c4-container" ? { ContainerType: t } : void 0
			},
			{
				id: "tags",
				label: "Tags",
				input: "text",
				value: (e) => (e.Tags ?? []).join(" "),
				patch: (e, t) => ({ Tags: H(String(t).split(/[\s,]+/)) })
			},
			{
				id: "sectionAxis",
				label: "Section axis",
				input: "select",
				group: "Structure",
				options: [{
					value: "rows",
					label: "Rows"
				}, {
					value: "columns",
					label: "Columns"
				}],
				value: (e) => e.SectionAxis ?? "rows",
				patch: (e, t) => sa(t) ? { SectionAxis: t } : void 0
			},
			{
				id: "sections",
				label: "Sections",
				input: "textarea",
				rows: 4,
				group: "Structure",
				value: (e) => e.Sections?.map((e) => e.title).join("\n") ?? "",
				patch: (e, t) => ({ Sections: ia(t, e.Sections) })
			},
			{
				id: "legend",
				label: "Legend (color label, one per line)",
				input: "textarea",
				rows: 3,
				group: "Structure",
				value: (e) => e.Legend?.map((e) => `${e.color} ${e.label}`).join("\n") ?? "",
				patch: (e, t) => ({ Legend: aa(t) })
			},
			{
				id: "multiplier",
				label: "Repeat badge (e.g. 3×)",
				input: "text",
				group: "Structure",
				value: (e) => e.Multiplier ?? "",
				patch: (e, t) => ({ Multiplier: String(t).trim() || void 0 })
			}
		],
		render: r
	};
}, la = ({ emit: e, graphs: t }) => {
	let n = 1, r = /* @__PURE__ */ new Map(), i = (i) => {
		let a = r.get(i);
		if (a) return a;
		let o = /* @__PURE__ */ new Map(), s = !1, c = bt({
			parents: o,
			parentKind: "container",
			onChange: (t) => {
				s || e("container.children.changed", { id: t });
			}
		}), l = t.get(i) ?? t.current, u = l.registerItemStore("container", () => [...o.values()]), d = () => [...o.values()].map((e) => ({
			id: e.id,
			Label: { ...e.Label },
			Position: { ...e.Position },
			Size: { ...e.Size },
			AutoFit: e.AutoFit,
			ContainerType: e.ContainerType,
			Color: e.Color,
			Tags: e.Tags ? [...e.Tags] : void 0,
			Sections: e.Sections?.map((e) => ({ ...e })),
			SectionAxis: e.SectionAxis,
			ChildSections: { ...e.ChildSections ?? {} },
			Children: e.Children.map((e) => ({
				...e,
				parent: e.parent ? [...e.parent] : void 0
			})),
			Legend: e.Legend?.map((e) => ({ ...e })),
			Multiplier: e.Multiplier
		})), f = (e) => {
			s = !0;
			try {
				[...o.values()].forEach((e) => e.Children.forEach((e) => c.remove(e))), o.clear();
				let t = Array.isArray(e) ? e : [];
				t.forEach((e) => {
					if (!e?.id || !e.Label || !e.Position || !e.Size) return;
					o.set(e.id, {
						id: e.id,
						kind: "container",
						Label: { ...e.Label },
						Position: { ...e.Position },
						Size: { ...e.Size },
						AutoFit: e.AutoFit,
						ContainerType: e.ContainerType,
						Color: e.Color,
						Tags: H(e.Tags).length ? H(e.Tags) : void 0,
						Sections: e.Sections?.map((e) => ({ ...e })) ?? [],
						SectionAxis: e.SectionAxis ?? "rows",
						ChildSections: { ...e.ChildSections ?? {} },
						Children: [],
						Legend: oa(e.Legend).length ? oa(e.Legend) : void 0,
						Multiplier: typeof e.Multiplier == "string" && e.Multiplier.trim() ? e.Multiplier : void 0
					});
					let t = Number.parseInt(e.id.replace(/^\D+/, ""), 10);
					Number.isFinite(t) && (n = Math.max(n, t + 1));
				}), t.forEach((e) => {
					if (!o.has(e.id)) return;
					e.Children?.forEach((t) => {
						t?.id && (t.kind === "node" || t.kind === "container") && l.getItem(t) && c.add(e.id, {
							...t,
							parent: t.parent ? [...t.parent] : void 0
						});
					});
					let t = o.get(e.id);
					t && ra(t);
				});
			} finally {
				s = !1;
			}
		};
		f(l.snapshotExtension("containers"));
		let p = {
			containers: o,
			nest: c,
			storeOff: u,
			snapshotOff: l.registerSnapshotExtension("containers", d, f)
		};
		return r.set(i, p), p;
	};
	return {
		current: () => i(t.current.id),
		delete: (e) => {
			let t = r.get(e);
			t && (t.storeOff(), t.snapshotOff(), r.delete(e));
		},
		dispose: () => {
			r.forEach((e) => {
				e.storeOff(), e.snapshotOff();
			}), r.clear();
		},
		ensure: i,
		nextId: () => `c${n++}`
	};
}, ua = ({ containerOfChild: t, containersHere: n, contexts: r, isSectionResizing: i, nestHere: a, sectionTitleTarget: o, selection: s }) => [
	{
		id: "editing.container.create",
		label: "Create container",
		group: "container",
		shortcut: "Y",
		input: {
			on: "keydown",
			key: "y",
			prevent: !0
		},
		payload: () => ({
			Label: { text: `Container ${n().size + 1}` },
			at: r.view.spaceCenter(e.Stage)
		})
	},
	{
		id: "graph.container.delete",
		label: "Delete container immediately",
		group: "container",
		hidden: !0,
		available: (e) => {
			let t = !!e?.target?.closest("[data-item-kind=\"container\"]") && !!h(e?.target), n = s.selected();
			return t || n?.kind === "container";
		},
		payload: (e) => {
			let t = e.target?.closest("[data-item-kind=\"container\"]")?.getAttribute("data-item-id");
			if (t) return { id: t };
			let n = s.selected();
			return n?.kind === "container" ? { id: n.id } : void 0;
		}
	},
	{
		id: "container.delete.request",
		label: "Delete container…",
		group: "container",
		available: (e) => {
			let t = !!e?.target?.closest("[data-item-kind=\"container\"]") && !!h(e?.target), n = s.selected();
			return t || n?.kind === "container";
		},
		payload: (e) => {
			let t = e.target?.closest("[data-item-kind=\"container\"]")?.getAttribute("data-item-id");
			if (t) return {
				id: t,
				confirm: e.origin !== "programmatic"
			};
			let n = s.selected();
			return n?.kind === "container" ? {
				id: n.id,
				confirm: e.origin !== "programmatic"
			} : void 0;
		}
	},
	{
		id: "container.ungroup",
		label: "Ungroup and keep contents",
		group: "container",
		available: (e) => {
			let t = e?.target?.closest("[data-item-kind=\"container\"]")?.getAttribute("data-item-id"), r = s.selected(), i = t ?? (r?.kind === "container" ? r.id : void 0);
			return !!i && (n().get(i)?.Children.length ?? 0) > 0;
		},
		payload: (e) => {
			let t = e.target?.closest("[data-item-kind=\"container\"]")?.getAttribute("data-item-id");
			if (t) return { id: t };
			let n = s.selected();
			return n?.kind === "container" ? { id: n.id } : void 0;
		}
	},
	{
		id: "container.delete.confirm",
		label: "Confirm container deletion",
		group: "container",
		hidden: !0,
		input: {
			on: "click",
			selector: "[data-container-delete-confirm]"
		}
	},
	{
		id: "container.delete.cancel",
		label: "Cancel container deletion",
		group: "container",
		hidden: !0,
		input: {
			on: "click",
			selector: "[data-container-delete-cancel]"
		}
	},
	{
		id: "container.add-child",
		label: "Move item",
		event: "container.move-child",
		group: "container",
		shortcut: "M",
		input: {
			on: "keydown",
			key: "m",
			prevent: !0
		},
		picker: {
			title: "Move item",
			steps: [{
				id: "child",
				prompt: "Pick a node or container to move",
				filter: () => (e) => e.kind === "node" || e.kind === "container",
				seed: () => {
					let e = s.selected();
					return e && (e.kind === "node" || e.kind === "container") ? e : null;
				}
			}, {
				id: "container",
				prompt: "Pick a destination",
				canvasLabel: "Canvas",
				canvas: (e) => !!e.child && !!a().parentRefOf(e.child),
				filter: (e) => (t) => t.kind === "container" && !!e.child && !a().isAncestorOrSelf(e.child, t)
			}],
			validate: (e) => !e.child || !e.container ? "Pick an item and a destination." : void 0,
			payload: (e) => ({
				destination: e.container,
				childRef: e.child
			})
		}
	},
	{
		id: "container.remove-child",
		label: "Remove from container",
		group: "container",
		available: () => {
			let e = s.selected();
			return !!e && !!a().parentRefOf(e);
		},
		payload: () => {
			let e = s.selected();
			return e ? { childRef: e } : void 0;
		}
	},
	{
		id: "container.child.section.set",
		label: "Move item to container section",
		group: "container",
		hidden: !0,
		payload: (e) => {
			let t = e.target, n = t?.dataset.childKind, r = t?.dataset.childId, i = n && r ? {
				kind: n,
				id: r
			} : s.selected() ?? void 0;
			return {
				containerId: t?.dataset.containerId,
				childRef: i,
				sectionId: t?.dataset.sectionId
			};
		}
	},
	{
		id: "container.child.section.next",
		label: "Move to next section",
		event: "container.child.section.set",
		group: "container",
		available: () => {
			let e = s.selected();
			return ((e ? t(e) : null)?.Sections?.length ?? 0) > 1;
		},
		payload: () => {
			let e = s.selected() ?? void 0, n = e ? t(e) : null;
			if (!e || !n?.Sections?.length) return;
			let r = n.ChildSections?.[R(e)] ?? na(n), i = Math.max(0, n.Sections.findIndex((e) => e.id === r));
			return {
				containerId: n.id,
				childRef: e,
				sectionId: n.Sections[(i + 1) % n.Sections.length].id
			};
		}
	},
	{
		id: "container.section.title.edit.dblclick",
		label: "Edit section title",
		event: "container.section.title.edit",
		group: "container",
		hidden: !0,
		input: {
			on: "dblclick",
			selector: "[data-container-section-title]",
			prevent: !0,
			stop: !0
		},
		payload: ({ target: e }) => {
			let t = o(e);
			return t ? {
				containerId: t.containerId,
				sectionId: t.sectionId
			} : void 0;
		}
	},
	{
		id: "container.section.title.commit.enter",
		label: "Commit section title",
		event: "container.section.title.commit",
		group: "container",
		hidden: !0,
		input: {
			on: "keydown",
			key: "Enter",
			selector: "[data-container-section-title].editing",
			prevent: !0,
			stop: !0
		},
		payload: ({ target: e }) => {
			let t = o(e);
			return t ? {
				containerId: t.containerId,
				sectionId: t.sectionId,
				title: t.el.textContent?.trim() ?? "",
				finish: !0
			} : void 0;
		}
	},
	{
		id: "container.section.title.commit.focusout",
		label: "Commit section title on blur",
		event: "container.section.title.commit",
		group: "container",
		hidden: !0,
		input: {
			on: "focusout",
			selector: "[data-container-section-title].editing"
		},
		payload: ({ target: e }) => {
			let t = o(e);
			return t ? {
				containerId: t.containerId,
				sectionId: t.sectionId,
				title: t.el.textContent?.trim() ?? ""
			} : void 0;
		}
	},
	{
		id: "container.section.resize.start",
		label: "Start section resize",
		group: "container",
		hidden: !0,
		input: {
			on: "pointerdown",
			selector: "[data-container-section-resize]",
			prevent: !0,
			stop: !0
		},
		payload: ({ event: e, target: t }) => ({
			containerId: t.dataset.containerId ?? "",
			index: Number(t.dataset.sectionIndex ?? 0),
			x: e.clientX,
			y: e.clientY
		})
	},
	{
		id: "container.section.resize.move",
		label: "Resize sections",
		group: "container",
		hidden: !0,
		input: {
			on: "pointermove",
			when: () => i(),
			prevent: !0,
			stop: !0
		},
		payload: ({ event: e }) => ({
			x: e.clientX,
			y: e.clientY
		})
	},
	{
		id: "container.section.resize.end",
		label: "End section resize",
		group: "container",
		hidden: !0,
		input: {
			on: "pointerup",
			when: () => i(),
			stop: !0
		}
	}
], da = (e) => {
	let t = (t) => {
		let n = /* @__PURE__ */ new Set(), r = 0, i = 0, a = (t) => {
			n.has(t) || (n.add(t), e().get(t)?.Children.forEach((e) => {
				e.kind === "node" ? r += 1 : e.kind === "container" && (i += 1, a(e.id));
			}));
		};
		return a(t), {
			nodes: r,
			containers: i
		};
	};
	return {
		body: (n) => {
			let r = e().get(n), i = t(n), a = [i.nodes ? `${i.nodes} node${i.nodes === 1 ? "" : "s"}` : "", i.containers ? `${i.containers} nested container${i.containers === 1 ? "" : "s"}` : ""].filter(Boolean), o = r?.Label.text ?? n;
			return Hn({
				question: a.length ? `Delete “${o}” and its ${a.join(" and ")}? This cannot be undone.` : `Delete empty container “${o}”?`,
				note: a.length ? "To remove only the boundary, choose Ungroup and keep contents." : void 0,
				keep: {
					label: "Keep container",
					command: "container.delete.cancel",
					data: { containerDeleteCancel: "" }
				},
				destroy: {
					label: a.length ? "Delete contents" : "Delete container",
					command: "container.delete.confirm",
					data: { containerDeleteConfirm: "" }
				}
			});
		},
		counts: t
	};
}, fa = {
	w: 140,
	h: 36
}, pa = 24, ma = 18;
function ha(t) {
	t("containers", (t) => {
		let { on: n, emit: r, contexts: i, graphs: a, selection: o, contribute: s, origin: c } = t, l = null, u = la({
			emit: r,
			graphs: a
		}), d = () => u.current(), f = () => d().containers, p = () => d().nest, m = null, h = null, g = null, _ = null, v = (e) => {
			let t = p().parentRefOf(e);
			return t?.kind === "container" ? f().get(t.id) ?? null : null;
		}, y = (t) => {
			_ !== t && (_ = t, i.places.el(e.Stage)?.querySelectorAll(".container[data-item-id]").forEach((e) => e.classList.toggle("drop-target", e.dataset.itemId === t)));
		}, b = (e, t) => [...f().values()].filter((t) => !(e.kind === "container" && t.id === e.id)).filter((t) => !p().isAncestorOrSelf(e, {
			kind: "container",
			id: t.id
		})).map((e) => ({
			container: e,
			rect: A(e)
		})).filter(({ rect: e }) => t.x >= e.x && t.x <= e.x + e.w && t.y >= e.y && t.y <= e.y + e.h).sort((e, t) => e.rect.w * e.rect.h - t.rect.w * t.rect.h)[0]?.container ?? null, x = (e, t, n) => {
			if (ra(e), !e.Sections?.length) return !1;
			let r = new Set(e.Sections.map((e) => e.id)), i = n && r.has(n) ? n : na(e);
			if (!i) return !1;
			let a = R(t), o = e.ChildSections?.[a];
			return e.ChildSections = {
				...e.ChildSections ?? {},
				[a]: i
			}, o !== i;
		}, S = (e, t) => {
			(t ? [f().get(t)] : [...f().values()]).forEach((t) => {
				t?.ChildSections && delete t.ChildSections[R(e)];
			});
		}, C = (e) => {
			let t = e?.closest("[data-container-section-title]"), n = t?.dataset.containerId ?? "", r = t?.dataset.sectionId ?? "";
			return t && n && r ? {
				el: t,
				containerId: n,
				sectionId: r
			} : null;
		}, w = (e) => {
			e.contentEditable = "plaintext-only", e.classList.add("editing"), e.focus();
			let t = document.createRange();
			t.selectNodeContents(e);
			let n = getSelection();
			n?.removeAllRanges(), n?.addRange(t);
		}, T = (e) => {
			e.contentEditable = "inherit", e.classList.remove("editing");
		};
		n("graph.switched", ({ id: e }) => {
			u.ensure(e);
		}), n("graph.deleted", ({ id: e }) => u.delete(e)), i.hierarchy.parents.register(c, { parentRefOf: (e) => d().nest.parentRefOf(e) }), i.hierarchy.sources.register(c, () => [...f().values()].map((e) => {
			let t = A(e);
			return {
				ref: {
					kind: "container",
					id: e.id
				},
				label: e.Label.text || e.id,
				anchor: {
					x: t.x + t.w / 2,
					y: t.y + t.h / 2
				}
			};
		}));
		let E = (e) => e.kind === "container" ? A(f().get(e.id) ?? null) : ze(a.current.getItem(e) ?? {}, {
			w: 80,
			h: 40
		}), D = (e) => i.fold.folded(U({
			kind: "container",
			id: e.id
		}, a.current.id)), O = (e, t) => {
			let n = qe(e), r = Math.max(e.w, t.w), i = Math.max(e.h, t.h);
			return {
				x: n.x - r / 2,
				y: n.y - i / 2,
				w: r,
				h: i
			};
		}, k = (e) => {
			if (e.AutoFit === !1 || e.Sections?.length) return ze(e);
			let t = e.Children.map(E).filter((e) => !!e), n = ta(e.ContainerType);
			return t.length ? O(Ve(t.reduce(Be), pa, ma), n) : ze({
				Position: e.Position,
				Size: n
			});
		}, A = (e) => e ? D(e) ? ze({
			Position: qe(k(e)),
			Size: fa
		}) : k(e) : ze({
			Position: {
				x: 0,
				y: 0
			},
			Size: ea
		}), j = t.model.registerEntity(ca(A, D)), M = t.model.registerCollection({
			id: "containers",
			label: "Containers",
			kind: "container",
			items: () => [...f().values()],
			toolbar: !1,
			section: !1
		});
		i.commands.register(ua({
			containerOfChild: v,
			containersHere: f,
			contexts: i,
			isSectionResizing: () => !!h,
			nestHere: p,
			sectionTitleTarget: C,
			selection: o
		})), n("editing.container.create", (e) => {
			let t = u.nextId();
			f().set(t, {
				id: t,
				kind: "container",
				Label: e.Label ?? { text: t },
				Position: e.at ?? {
					x: 0,
					y: 0
				},
				...e.Size ? { Size: { ...e.Size } } : { Size: ta(e.ContainerType) },
				AutoFit: e.AutoFit,
				ContainerType: e.ContainerType,
				Color: e.Color,
				Tags: H(e.Tags).length ? H(e.Tags) : void 0,
				Sections: [],
				SectionAxis: "rows",
				ChildSections: {},
				Children: []
			}), r("container.created", { id: t }), r("selection.item.select", {
				kind: "container",
				id: t
			});
		}), n("container.import.snapshot", ({ containers: e }) => {
			let t = f(), n = p();
			[...t.values()].forEach((e) => e.Children.forEach((e) => n.remove(e))), t.clear(), e.forEach((e) => {
				t.set(e.id, {
					id: e.id,
					kind: "container",
					Label: { text: e.label },
					Position: {
						x: 0,
						y: 0
					},
					Size: { ...ea },
					AutoFit: !0,
					Sections: [],
					SectionAxis: "rows",
					ChildSections: {},
					Children: []
				}), e.children.forEach((t) => n.add(e.id, {
					kind: "node",
					id: t
				})), r("container.created", { id: e.id });
			}), r("selection.item.clear");
		});
		let N = da(f);
		return n("container.delete.request", ({ id: e, confirm: t }) => {
			if (!f().get(e)) return;
			let n = N.counts(e);
			if (!t || !n.nodes && !n.containers) {
				r("graph.container.delete", { id: e });
				return;
			}
			l = e, r("modal.open", {
				title: "Delete container?",
				visual: "properties",
				body: N.body(e)
			});
		}), n("container.delete.confirm", () => {
			let e = l;
			e && (l = null, r("graph.container.delete", { id: e }), r("modal.close"));
		}), n("container.delete.cancel", () => {
			l = null, r("modal.close");
		}), n("modal.closed", () => {
			l = null;
		}), n("container.ungroup", ({ id: e }) => {
			let t = f(), n = p(), i = t.get(e);
			if (!i || !i.Children.length) return;
			let a = n.parentRefOf({
				kind: "container",
				id: e
			}), s = [...i.Children];
			s.forEach((r) => {
				if (n.remove(r), S(r, e), a?.kind === "container") {
					n.add(a.id, r);
					let e = t.get(a.id);
					e && x(e, r);
				}
			}), n.remove({
				kind: "container",
				id: e
			}), t.delete(e), o.select(null), r("container.deleted", { id: e }), r("app.notice", { message: `Removed “${i.Label.text}” and kept ${s.length} item${s.length === 1 ? "" : "s"}.` });
		}), n("graph.container.delete", ({ id: e }) => {
			let t = f(), n = p(), i = t.get(e);
			i && (a.current.edgesOf(e).forEach((e) => r("graph.edge.delete", { id: e.id })), [...i.Children].forEach((e) => {
				e.kind === "container" ? r("graph.container.delete", { id: e.id }) : e.kind === "node" ? r("graph.node.delete", { id: e.id }) : n.remove(e);
			}), n.remove({
				kind: "container",
				id: e
			}), t.delete(e), r("container.deleted", { id: e }));
		}), n("container.add-child", ({ containerId: e, childRef: t, sectionId: n }) => {
			if (!a.current.getItem(t)) return;
			let i = p().add(e, t), o = f().get(e), s = o ? x(o, t, n) : !1;
			i === "cycle" ? r("app.notice", {
				message: "Cannot nest a container into its own descendant.",
				level: "warn"
			}) : s && (r("container.children.changed", { id: e }), r("container.updated", { id: e }));
		}), n("container.move-child", ({ destination: e, childRef: t }) => {
			if (e.kind === "graph") {
				r("container.remove-child", { childRef: t }), r("app.notice", { message: "Moved to Canvas." });
				return;
			}
			if (e.kind !== "container") return;
			r("container.add-child", {
				containerId: e.id,
				childRef: t
			});
			let n = f().get(e.id);
			n && r("app.notice", { message: `Moved into “${n.Label.text}”.` });
		}), n("container.remove-child", ({ childRef: e }) => {
			S(e, p().remove(e));
		}), n("container.child.section.set", ({ containerId: e, childRef: t, sectionId: n }) => {
			if (!t) return;
			let i = e ? f().get(e) ?? null : v(t);
			!i || !n || x(i, t, n) && (r("container.children.changed", { id: i.id }), r("container.updated", { id: i.id }));
		}), n("container.section.title.edit", ({ containerId: t, sectionId: n }) => queueMicrotask(() => {
			let r = i.places.el(e.Stage)?.querySelector(`[data-container-section-title][data-container-id="${t}"][data-section-id="${n}"]`);
			r instanceof HTMLElement && (m = {
				containerId: t,
				sectionId: n
			}, w(r));
		})), n("container.section.title.commit", ({ containerId: t, sectionId: n, title: a, finish: o }) => {
			let s = f().get(t), c = s?.Sections?.find((e) => e.id === n);
			if (!s || !c) return;
			let l = a || c.title;
			c.title !== l && (c.title = l, r("container.updated", { id: s.id }));
			let u = i.places.el(e.Stage)?.querySelector(`[data-container-section-title][data-container-id="${t}"][data-section-id="${n}"]`);
			u instanceof HTMLElement && (u.textContent = c.title, T(u), o && queueMicrotask(() => u.blur())), m?.containerId === t && m.sectionId === n && (m = null);
		}), n("container.section.resize.start", ({ containerId: t, index: n, x: r, y: a }) => {
			let o = f().get(t);
			if (!o?.Sections || n < 0 || n >= o.Sections.length - 1) return;
			let s = A(o);
			h = {
				containerId: t,
				index: n,
				axis: o.SectionAxis ?? "rows",
				pointer: i.view.clientToSpace(e.Stage, {
					x: r,
					y: a
				}),
				rect: s,
				weights: o.Sections.map((e) => Math.max(.15, e.weight ?? 1))
			};
		}), n("container.section.resize.move", ({ x: t, y: n }) => {
			if (!h) return;
			let a = f().get(h.containerId);
			if (!a?.Sections) return;
			let o = i.view.clientToSpace(e.Stage, {
				x: t,
				y: n
			}), s = h.axis === "columns" ? h.rect.w : h.rect.h, c = h.axis === "columns" ? o.x - h.pointer.x : o.y - h.pointer.y, l = h.weights.reduce((e, t) => e + t, 0), u = s > 0 ? c / s * l : 0, d = [...h.weights], p = h.index, m = p + 1, g = .15, _ = Math.max(g - d[p], Math.min(u, d[m] - g));
			d[p] += _, d[m] -= _, a.Sections = a.Sections.map((e, t) => ({
				...e,
				weight: d[t] ?? e.weight ?? 1
			})), r("container.updated", { id: a.id }), r("container.children.changed", { id: a.id });
		}), n("container.section.resize.end", () => {
			h = null;
		}), n("drag.item.start", ({ ref: e }) => {
			e.kind !== "node" && e.kind !== "container" || (g = e, y(null));
		}), n("drag.item.move", ({ x: t, y: n }) => {
			if (!g) return;
			let r = i.view.clientToSpace(e.Stage, {
				x: t,
				y: n
			});
			y(b(g, r)?.id ?? null);
		}), n("drag.item.end", () => {
			let e = g, t = _;
			if (g = null, y(null), !e || !t) return;
			let n = p().parentRefOf(e);
			if (n?.kind === "container" && n.id === t) return;
			r("container.add-child", {
				containerId: t,
				childRef: e
			});
			let i = f().get(t);
			i && r("app.notice", { message: `Moved into “${i.Label.text}”.` });
		}), n("graph.node.deleted", ({ id: e }) => {
			let t = {
				kind: "node",
				id: e
			};
			S(t, p().remove(t));
		}), n("selection.item.delete", () => {
			o.selectedAll().forEach((e) => {
				e.kind === "container" && r("container.delete.request", {
					id: e.id,
					confirm: !0
				});
			});
		}), i.storage.register("container", c, (e, t) => {
			let n = f().get(e.id);
			if (!n) return;
			let i = t, o = { ...n.Position };
			if (Object.assign(n, i), "Tags" in i && (n.Tags = H(i.Tags).length ? H(i.Tags) : void 0), (i.Sections || i.SectionAxis || i.ChildSections) && ra(n), "Legend" in i) {
				let e = oa(i.Legend);
				n.Legend = e.length ? e : void 0;
			}
			if (i.Position && (i.Position.x !== o.x || i.Position.y !== o.y)) {
				let e = i.Position.x - o.x, t = i.Position.y - o.y;
				n.Children.forEach((n) => {
					let i = a.current.getItem(n);
					i?.Position && r("item.update", {
						ref: n,
						patch: { Position: {
							x: i.Position.x + e,
							y: i.Position.y + t
						} }
					});
				});
			}
			r("container.updated", { id: n.id }), (i.Sections || i.SectionAxis || i.ChildSections) && r("container.children.changed", { id: n.id });
		}), () => {
			j(), M(), u.dispose();
		};
	}, { requires: ["render.stage", "graph"] });
}
//#endregion
//#region canvas/systems/context-actions.ts
function ga(t) {
	t("context.actions", ({ on: t, emit: n, bus: r, contexts: i, graphs: a, selection: o, declarePanel: s }) => {
		let c = (e) => g(e) ?? o.selected() ?? void 0, l = !1, d = !1, f = !1, p = {};
		t("mode.changed", ({ fields: e }) => {
			p = e.titles ?? {}, h();
		});
		let m = (e) => (e.kind === "node" ? p.node : e.kind === "edge" ? p.edge : p.container) ?? e.kind, h = () => {
			l || (l = !0, queueMicrotask(() => {
				l = !1, d || n("tool.panel.redraw", { id: "context" });
			}));
		}, _ = (e) => {
			let t = a.current.getItem(e), n = t?.Label?.text?.trim();
			if (n) return n;
			if (e.kind === "edge") {
				let e = (e) => {
					let t = e ? a.current.refById(e) : void 0;
					return t ? a.current.getItem(t)?.Label?.text : void 0;
				}, n = e(t?.From), r = e(t?.To);
				if (n && r) return `${n} → ${r}`;
			}
			return e.id;
		}, v = (e, t, n) => u("button.context-panel-action", {
			type: "button",
			class: n,
			text: t,
			title: [i.commands.get(e)?.label, at(i.commands, e)].filter(Boolean).join(" · "),
			data: { command: e }
		}), y = (e) => u(".context-title-editor", { data: {
			contextItemKind: e.kind,
			contextItemId: e.id
		} }, [
			u("small", { text: m(e) }),
			u("input", {
				type: "text",
				value: _(e),
				placeholder: m(e),
				"aria-label": `Rename ${e.kind}`,
				data: {
					contextTitle: "",
					contextItemKind: e.kind,
					contextItemId: e.id
				}
			}),
			u("button.context-title-pencil", {
				type: "button",
				icon: "draw",
				"aria-label": `Edit ${e.kind} name`,
				data: { command: "context.title.focus" }
			})
		]), b = (e) => Jn({
			label: "Selected items",
			className: "context-selection-list",
			scroll: !0,
			items: [...e.slice(0, 8).map((t, n) => Kn({
				command: "context.selection.primary",
				title: _(t),
				detail: t.kind,
				active: n === e.length - 1,
				className: "context-selection-item",
				data: {
					contextItemKind: t.kind,
					contextItemId: t.id
				}
			})), e.length > 8 && u("p.context-selection-more", { text: `+ ${e.length - 8} more selected` })]
		});
		s({
			id: "context",
			anchor: "top-right",
			place: e.Right,
			movable: !1,
			layout: "custom",
			render: () => {
				let e = o.selectedAll(), t = /* @__PURE__ */ new Map();
				e.forEach((e) => t.set(e.kind, (t.get(e.kind) ?? 0) + 1));
				let n = (e, t) => `${t} ${e}${t === 1 ? "" : e === "ink" ? " strokes" : "s"}`, r = e.filter((e) => e.kind === "node" || e.kind === "container").length, s = e.length === 1 && (e[0].kind === "node" || e[0].kind === "container"), c = v("choose.none", "Clear");
				c.classList.add("context-clear-selection");
				let l = e[e.length - 1], d = e.filter((e) => e.kind === "node" || e.kind === "container"), p = e.length > 0 && e.every((e) => e.kind === "node") && !!i.commands.get("palette.custom-type.create"), m = a.current.itemsOfKind("container").length, h = a.current.itemsOfKind("ink").length > 0, g = l?.kind === "container" ? a.current.getItem(l) : void 0, _ = l?.kind === "node" ? a.current.getNode(l.id) : void 0, x = e.length ? e.length === 1 && l ? [
					v("item.properties.open", "Edit"),
					_?.NodeType === "toggle" && v("node.toggle.state", _.ToggleState ? "Turn off" : "Turn on"),
					d.length && v("selection.group", "Wrap in group"),
					d.length && m && v("container.add-child", "Move into…"),
					i.hierarchy.parentRefOf(l)?.kind === "container" && v("container.remove-child", "Move out"),
					l.kind === "edge" && v("graph.edge.reverse", "Reverse"),
					g && v("item.collapse.toggle", i.fold.folded(U(l, a.current.id)) ? "Unfold" : "Fold"),
					g?.Children?.length && v("container.ungroup", "Ungroup"),
					p && v("palette.custom-type.create", "Create type from selection"),
					v("selection.item.delete", "Delete", "danger")
				] : [
					d.length && v("selection.group", d.length === e.length ? "Group selected" : `Group ${d.length} eligible`),
					d.length && v("tags.open", `Tag ${d.length} eligible`),
					p && v("palette.custom-type.create", "Create type from selection"),
					v("selection.item.delete", "Delete selected", "danger")
				] : [v("editing.node.create", "New node"), v("editing.container.create", "New empty group")];
				return u(".context-panel", { data: {
					selectionCount: e.length,
					mobileOpen: f ? "true" : "false"
				} }, [
					u("header.context-selection-header", [
						u("div", [u("span", { text: "Selection" }), u("strong", { text: `${e.length} items` })]),
						u("button.context-mobile-toggle", {
							type: "button",
							icon: f ? "collapse" : "more",
							"aria-label": f ? "Collapse selection actions" : "Expand selection actions",
							"aria-expanded": String(f),
							data: { command: "context.mobile.toggle" }
						}),
						c
					]),
					u("p.context-selection-summary", { text: [...t].map(([e, t]) => n(e, t)).join(" + ") }),
					u("p.context-selection-scope", { text: r === e.length ? `Bulk changes apply to all ${e.length} selected items.` : `${r} support tags and grouping; ${e.length - r} connection or drawing item${e.length - r === 1 ? "" : "s"} stay unchanged.` }),
					e.length ? s ? y(e[0]) : b(e) : Mn("Nothing selected. Create on canvas."),
					u(".context-panel-actions", [...x, h && v("ink.select.all", "Select all drawings")])
				]);
			},
			order: 2,
			mountWhen: () => o.selectedAll().length > 1
		}), i.commands.register([
			{
				id: "item.context.open",
				label: "Open item actions",
				group: "item",
				shortcut: ".",
				input: {
					on: "keydown",
					key: ".",
					prevent: !0
				},
				available: (e) => !!c(e?.target),
				payload: (e) => c(e.target)
			},
			{
				id: "context.selection.primary",
				label: "Make selected item primary",
				group: "item",
				hidden: !0,
				payload: ({ target: e }) => {
					let t = e?.closest("[data-context-item-id]"), n = t?.dataset.contextItemKind, r = t?.dataset.contextItemId;
					return n && r ? {
						kind: n,
						id: r
					} : void 0;
				}
			},
			{
				id: "context.mobile.toggle",
				label: "Toggle Context panel actions",
				group: "item",
				hidden: !0
			},
			{
				id: "context.title.focus",
				label: "Edit selected item name",
				group: "item",
				hidden: !0
			},
			{
				id: "context.title.commit",
				label: "Rename selected item",
				group: "item",
				hidden: !0,
				input: {
					on: "change",
					selector: "[data-context-title]"
				},
				payload: ({ target: e }) => {
					let t = e?.closest("[data-context-title]"), n = t?.dataset.contextItemKind, r = t?.dataset.contextItemId;
					return n && r ? {
						ref: {
							kind: n,
							id: r
						},
						name: t.value
					} : void 0;
				}
			}
		]), t("item.context.open", (e) => n("item.properties.open", e)), t("context.selection.primary", (e) => n("selection.item.select", e)), t("context.mobile.toggle", () => {
			f = !f, h();
		}), t("context.title.focus", () => {
			queueMicrotask(() => {
				let e = i.places.el("stage")?.querySelector("[data-context-title]");
				e?.focus(), e?.select();
			});
		}), t("context.title.commit", ({ ref: e, name: t }) => {
			let r = t.trim();
			!r || r === _(e) || n("item.update", {
				ref: e,
				patch: { Label: { text: r } }
			});
		}), t("selection.changed", h), t("graph.switched", h), t("fold.changed", h);
		let x = r.onAny(({ name: e }) => {
			(e.startsWith("graph.") || e.startsWith("container.") || e.startsWith("ink.")) && /\.(created|updated|deleted|changed)$/.test(e) && h();
		});
		return () => {
			d = !0, x();
		};
	}, { requires: ["ability.selectable"] });
}
//#endregion
//#region canvas/systems/dark-theme.ts
var _a = "theme";
function va(e) {
	e("dark.theme", (e) => {
		let { io: t, contexts: n, on: r, contribute: i } = e, a = () => v((e) => n.places.el(e)), o = (e) => e === "light" || e === "dark" ? e : "light", s = () => {
			let e = a();
			if (!e) return;
			let n = o(t.get(_a, "light"));
			e.setAttribute("data-theme", n), e.dataset.colorscheme = n;
		};
		n.commands.register([{
			id: "theme.toggle",
			label: "Toggle dark mode",
			group: "view",
			event: "theme.toggle",
			shortcut: "Shift+D",
			input: {
				on: "keydown",
				key: "d",
				shift: !0,
				prevent: !0
			},
			payload: () => void 0
		}]), r("theme.toggle", () => {
			let e = o(t.get(_a, "light")) === "dark" ? "light" : "dark";
			t.set(_a, e), s();
		}), e.state?.register("dark.theme", {
			capture: () => t.get(_a, "light"),
			restore: (e) => {
				t.set(_a, o(e ?? "light")), s();
			}
		}), r("app.start", () => {
			queueMicrotask(s);
		}), i({
			origin: "dark.theme",
			surface: "top",
			command: "theme.toggle",
			kind: "button",
			icon: "theme",
			text: "Theme",
			label: "Toggle theme",
			className: "theme-toggle",
			slot: "end",
			group: "overflow",
			order: 78
		});
	}, { requires: ["render"] });
}
//#endregion
//#region canvas/systems/detail.ts
function ya(e) {
	e("detail", ({ on: e, emit: t, contexts: n, selection: r, graphs: i }) => {
		n.commands.register([{
			id: "detail.less",
			label: "Less detail (fold / zoom out)",
			group: "view",
			shortcut: "[",
			input: {
				on: "keydown",
				key: "[",
				prevent: !0
			}
		}, {
			id: "detail.more",
			label: "More detail (unfold / zoom in)",
			group: "view",
			shortcut: "]",
			input: {
				on: "keydown",
				key: "]",
				prevent: !0
			}
		}]);
		let a = (e) => r.selectedAll().forEach((t) => n.fold.set(U(t, i.current.id), e));
		e("detail.less", () => r.selectedAll().length ? a(!1) : t("view.zoom.out")), e("detail.more", () => r.selectedAll().length ? a(!0) : t("view.zoom.in"));
	}, { requires: ["view.zoom"] });
}
//#endregion
//#region canvas/systems/foldable.ts
function ba(e) {
	e("foldable", ({ on: e, contexts: t }) => {
		t.commands.register([{
			id: "fold.toggle",
			label: "Toggle fold",
			group: "ui",
			hidden: !0,
			input: {
				on: "click",
				selector: "[data-fold-id]",
				prevent: !0,
				stop: !0
			},
			payload: ({ target: e }) => {
				let t = e?.closest("[data-fold-id]");
				if (!t) return;
				let n = t.dataset.foldDefaultOpen;
				return {
					id: t.dataset.foldId ?? "",
					...n === void 0 ? {} : { defaultOpen: n !== "false" }
				};
			}
		}]), e("fold.toggle", ({ id: e, defaultOpen: n }) => {
			e && t.fold.toggle(e, n);
		});
	}, { requires: ["input"] });
}
//#endregion
//#region canvas/systems/focus.ts
function xa(e) {
	e("focus", ({ on: e, emit: t, selection: n, contexts: r, origin: i }) => {
		e("focus.node.focus", ({ id: e }) => t("focus.item.focus", B(e))), e("focus.node.clear", () => t("focus.item.clear")), e("focus.item.focus", (e) => {
			z(n.focused() ?? null, e) || (n.focus(e), r.decorations.modes.set(i, "focused", [e]), t("focus.item.focused", e), t("focus.node.focused", { id: e.kind === "node" ? e.id : null }));
		}), e("focus.item.clear", () => {
			n.focused() && (n.focus(null), r.decorations.unregisterOrigin(i), t("focus.item.focused", null), t("focus.node.focused", { id: null }));
		});
	}, { requires: ["graph"] });
}
//#endregion
//#region canvas/systems/ghost-node.ts
var Sa = {
	w: 150,
	h: 64
}, Ca = "ghost-node", wa = (e) => {
	let t = typeof e == "string" ? e : "";
	return !t.includes(".") && t !== "note";
};
function Ta(t) {
	t("ghost.node", ({ on: t, emit: n, contexts: r, graphs: i, selection: a, layout: o }) => {
		let s = null, c = !0, l = () => {
			if (a.selectedAll().length !== 1) return null;
			let e = a.selected();
			if (!e || e.kind !== "node") return null;
			let t = i.current.getNode(e.id);
			if (!t?.Position || !wa(t.NodeType)) return null;
			let n = o?.creation(t.id, !1)?.Position;
			return n ? {
				id: t.id,
				at: s ?? n
			} : null;
		}, d = () => {
			s = null, p = null, n("render.view.clear", {
				place: e.Stage,
				key: Ca
			});
		}, f = () => {
			let t = l();
			if (!t) return d();
			let i = r.view.get().scale, a = r.view.spaceToScreen(t.at);
			n("render.view.set", {
				place: e.Stage,
				key: Ca,
				view: () => {
					let e = (e, n, r) => u("button.ghost-node-half", {
						type: "button",
						title: `${r} · drag to place it exactly`,
						"aria-label": r,
						data: {
							command: e,
							ghostNode: "",
							ghostX: String(t.at.x),
							ghostY: String(t.at.y)
						}
					}, [u("b", { text: "+" }), u("span", { text: n })]), n = u(".ghost-node", {
						role: "group",
						"aria-label": "Add a node here",
						class: s ? "dragging" : void 0
					}, [e("ghost.node.create", "connected", "Add a connected node"), e("ghost.node.create.loose", "node", "Add a node with no connection")]);
					return n.style.left = `${a.x - Sa.w * i / 2}px`, n.style.top = `${a.y - Sa.h * i / 2}px`, n.style.width = `${Sa.w * i}px`, n.style.height = `${Sa.h * i}px`, n;
				}
			});
		};
		r.commands.register([
			{
				id: "ghost.node.create",
				label: "Add connected node",
				group: "editing",
				hidden: !0,
				input: {
					on: "click",
					selector: "[data-command=\"ghost.node.create\"]",
					prevent: !0,
					stop: !0
				}
			},
			{
				id: "ghost.node.create.loose",
				label: "Add node here, unconnected",
				group: "editing",
				hidden: !0,
				input: {
					on: "click",
					selector: "[data-command=\"ghost.node.create.loose\"]",
					prevent: !0,
					stop: !0
				}
			},
			{
				id: "ghost.node.drag.start",
				label: "Grab the placeholder",
				event: "ghost.node.drag.start",
				group: "editing",
				hidden: !0,
				input: {
					on: "pointerdown",
					selector: "[data-ghost-node]",
					prevent: !0,
					stop: !0
				},
				payload: ({ event: t, target: n }) => ({
					...r.view.clientToSpace(e.Stage, Fn(t)),
					connect: n?.closest("[data-command=\"ghost.node.create\"]") !== null
				})
			},
			{
				id: "ghost.node.drag.move",
				label: "Move the placeholder",
				event: "ghost.node.drag.move",
				group: "editing",
				hidden: !0,
				input: {
					on: "pointermove",
					when: () => !!p,
					prevent: !0,
					stop: !0
				},
				payload: ({ event: t }) => r.view.clientToSpace(e.Stage, Fn(t))
			},
			{
				id: "ghost.node.drag.end",
				label: "Drop the placeholder",
				event: "ghost.node.drag.end",
				group: "editing",
				hidden: !0,
				input: {
					on: "pointerup",
					when: () => !!p,
					stop: !0
				},
				payload: ({ event: t }) => r.view.clientToSpace(e.Stage, Fn(t))
			}
		]);
		let p = null;
		t("ghost.node.drag.start", ({ x: e, y: t, connect: n }) => {
			let r = l();
			r && (p = {
				from: {
					x: e,
					y: t
				},
				origin: r.at
			}, c = n);
		}), t("ghost.node.drag.move", ({ x: e, y: t }) => {
			p && (Math.hypot(e - p.from.x, t - p.from.y) * r.view.get().scale < 6 && !s || (s = {
				x: p.origin.x + (e - p.from.x),
				y: p.origin.y + (t - p.from.y)
			}, f()));
		}), t("ghost.node.drag.end", () => {
			let e = s;
			p = null, e && (m(c, e), s = null);
		});
		let m = (e, t) => {
			let r = l();
			r && n("graph.node.create", {
				Label: { text: `Node ${i.current.nodes().length + 1}` },
				Position: t ?? r.at,
				relativeTo: r.id,
				...e ? { connectFrom: r.id } : {},
				keepView: !0
			});
		};
		return t("ghost.node.create", () => m(!0)), t("ghost.node.create.loose", () => m(!1)), t("render.stage.draw", f), t("render.stage.camera", f), d;
	}, { requires: ["render.stage", "graph"] });
}
//#endregion
//#region canvas/systems/graph-export.ts
var Ea = ({ contexts: t, graphs: n }) => {
	let r = (e) => () => {
		let n = u("section.export-json"), r = u("p", { text: "Export an editable graph file, Mermaid text, or an image of the current canvas view." }), i = (e, t, n, r = !1) => u("button.export-option", {
			type: "button",
			class: r ? "primary" : void 0,
			data: { command: t }
		}, [u("strong", { text: e }), u("small", { text: n })]), a = u(".export-actions", [
			i("Canvas Graph JSON", "graph.export.file.json", "Editable backup", !0),
			i("SVG", "graph.export.svg", "Current view · vector"),
			i("PNG", "graph.export.png", "Current view · 2×")
		]);
		return t.commands.get("graph.export.mermaid") && a.append(i("Mermaid", "graph.export.mermaid", "Copy as text · re-importable"), i("Graphviz DOT", "graph.export.dot", "Copy as text · re-importable")), n.append(r, a, u("details.export-raw", [u("summary", { text: "View raw JSON" }), u("textarea", {
			readOnly: !0,
			value: e,
			"aria-label": "Exported graph JSON"
		})])), n;
	}, i = () => y(n.current.name, "canvas-graph");
	return {
		currentViewPng: () => new Promise((r) => {
			let i = t.places.el(e.Stage);
			if (!i) {
				r(null);
				return;
			}
			let a = i.getBoundingClientRect(), o = Math.max(1, Math.round(a.width)), s = Math.max(1, Math.round(a.height)), c = document.createElement("canvas");
			c.width = o * 2, c.height = s * 2;
			let l = c.getContext("2d");
			if (!l) {
				r(null);
				return;
			}
			l.scale(2, 2);
			let u = getComputedStyle(i), d = (e, t) => u.getPropertyValue(e).trim() || t, f = d("--bg", "#f5f5f5"), p = d("--panel", "#fbfbfb"), m = d("--ink", "#242424"), h = d("--text-muted", "#6e6e6e"), g = d("--line-strong", "#aeaeae"), _ = d("--accent", "#424242"), v = d("--edge", "#787878");
			l.fillStyle = f, l.fillRect(0, 0, o, s), l.fillStyle = d("--line", "#dedede");
			for (let e = 0; e < o; e += 32) for (let t = 0; t < s; t += 32) l.fillRect(e, t, 1, 1);
			let y = t.view.get(), b = (e) => ({
				x: (e.x - y.x) * y.scale,
				y: (e.y - y.y) * y.scale
			}), x = n.current.snapshot();
			(x.extensions?.containers ?? []).forEach((e) => {
				if (!e.Position || !e.Size) return;
				let t = b(e.Position), n = e.Size.w * y.scale, r = e.Size.h * y.scale;
				l.fillStyle = _, l.globalAlpha = .06, l.strokeStyle = _, l.setLineDash([5, 4]), l.fillRect(t.x - n / 2, t.y - r / 2, n, r), l.globalAlpha = 1, l.strokeRect(t.x - n / 2, t.y - r / 2, n, r), l.setLineDash([]), l.fillStyle = m, l.font = "700 10px monospace", l.fillText(e.Label?.text ?? "Container", t.x - n / 2 + 8, t.y - r / 2 + 15);
			});
			let S = new Map(x.nodes.map((e) => [e.id, e]));
			l.strokeStyle = v, l.fillStyle = v, l.lineWidth = 2, x.edges.forEach((e) => {
				let t = S.get(e.From), n = S.get(e.To);
				if (!t?.Position || !n?.Position) return;
				let r = b(t.Position), i = b(n.Position);
				l.beginPath(), l.moveTo(r.x, r.y), l.lineTo(i.x, i.y), l.stroke();
				let a = Math.atan2(i.y - r.y, i.x - r.x);
				l.beginPath(), l.moveTo(i.x, i.y), l.lineTo(i.x - 10 * Math.cos(a - Math.PI / 6), i.y - 10 * Math.sin(a - Math.PI / 6)), l.lineTo(i.x - 10 * Math.cos(a + Math.PI / 6), i.y - 10 * Math.sin(a + Math.PI / 6)), l.closePath(), l.fill(), e.Label?.text && (l.fillStyle = h, l.font = "10px monospace", l.fillText(e.Label.text, (r.x + i.x) / 2 + 5, (r.y + i.y) / 2 - 6), l.fillStyle = v);
			}), x.nodes.forEach((e) => {
				if (!e.Position) return;
				let t = b(e.Position), n = (e.Size?.w ?? 200) * y.scale, r = (e.Size?.h ?? 80) * y.scale;
				l.fillStyle = p, l.strokeStyle = g, l.lineWidth = 1.5, l.beginPath(), e.NodeType === "circle" ? l.ellipse(t.x, t.y, n / 2, r / 2, 0, 0, Math.PI * 2) : l.rect(t.x - n / 2, t.y - r / 2, n, r), l.fill(), l.stroke(), l.fillStyle = m, l.textAlign = "center", l.font = `700 ${Math.max(9, Math.round(14 * y.scale))}px sans-serif`, l.fillText(e.Label?.text ?? e.id, t.x, t.y - (e.Description ? 4 : -4), Math.max(20, n - 14)), e.Description && r >= 38 && (l.fillStyle = h, l.font = `${Math.max(7, Math.round(10 * y.scale))}px sans-serif`, l.fillText(e.Description, t.x, t.y + 13, Math.max(20, n - 14))), l.textAlign = "start";
			}), c.toBlob(r, "image/png");
		}),
		currentViewSvg: () => {
			let n = t.places.el(e.Stage);
			if (!n) return null;
			let r = n.getBoundingClientRect(), i = Math.max(1, Math.round(r.width)), a = Math.max(1, Math.round(r.height)), o = n.cloneNode(!0);
			o.querySelectorAll(".tool-panel, .item-overlays, .item-toolbar, .picker-prompt").forEach((e) => e.remove()), o.removeAttribute("data-place"), o.style.width = `${i}px`, o.style.height = `${a}px`, o.style.position = "relative", o.style.overflow = "hidden";
			let s = [...document.styleSheets].flatMap((e) => {
				try {
					return [...e.cssRules].map((e) => e.cssText);
				} catch {
					return [];
				}
			}).join("\n"), c = document.createElement("div");
			c.setAttribute("xmlns", "http://www.w3.org/1999/xhtml"), c.className = "shell";
			let l = n.closest(".shell")?.getAttribute("data-theme");
			l && c.setAttribute("data-theme", l);
			let u = document.createElement("style");
			u.textContent = s, c.append(u, o);
			let d = document.createElementNS("http://www.w3.org/2000/svg", "svg");
			d.setAttribute("xmlns", "http://www.w3.org/2000/svg"), d.setAttribute("width", String(i)), d.setAttribute("height", String(a)), d.setAttribute("viewBox", `0 0 ${i} ${a}`);
			let f = document.createElementNS("http://www.w3.org/2000/svg", "foreignObject");
			return f.setAttribute("width", "100%"), f.setAttribute("height", "100%"), f.append(c), d.append(f), {
				source: new XMLSerializer().serializeToString(d),
				width: i,
				height: a
			};
		},
		download: (e, t) => {
			let n = URL.createObjectURL(e), r = document.createElement("a");
			r.href = n, r.download = `${i()}.${t}`, r.hidden = !0, document.body.append(r), r.click(), r.remove(), setTimeout(() => URL.revokeObjectURL(n), 1e3);
		},
		exportBody: r
	};
}, Da = (e) => e.all().find((t) => t.id !== e.current.id)?.id ?? `g${e.all().length + 1}`;
function Oa(t) {
	t("graph", ({ on: t, emit: n, graphs: r, contexts: i, model: a, selection: o, origin: s, contribute: c }) => {
		let l = null, u = null, d = () => {
			if (!u) return;
			let { id: e, timer: t } = u;
			u = null, clearTimeout(t);
			let i = r.get(e);
			i && n("graph.renamed", {
				id: e,
				name: i.name
			});
		};
		i.storage.register("node", s, (e, t) => {
			r.current.updateNode(e.id, t) && n("graph.node.updated", {
				graphId: r.current.id,
				id: e.id,
				patch: t
			});
		}), i.storage.register("edge", s, (e, t) => {
			r.current.updateEdge(e.id, t) && n("graph.edge.updated", {
				graphId: r.current.id,
				id: e.id
			});
		});
		let f = () => {
			let e = o.selected();
			return e?.kind === "edge" ? e.id : "";
		}, p = Ea({
			contexts: i,
			graphs: r
		});
		i.commands.register([
			{
				id: "graph.export.json",
				label: "Export graph",
				group: "graph"
			},
			{
				id: "graph.export.file.json",
				label: "Download Canvas Graph JSON",
				group: "graph",
				hidden: !0
			},
			{
				id: "graph.export.svg",
				label: "Download canvas as SVG",
				group: "graph",
				hidden: !0
			},
			{
				id: "graph.export.png",
				label: "Download canvas as PNG",
				group: "graph",
				hidden: !0
			},
			{
				id: "graph.edge.reverse",
				label: "Reverse edge",
				group: "edge",
				shortcut: "Shift+E",
				input: {
					on: "keydown",
					key: "e",
					shift: !0,
					prevent: !0,
					stop: !0
				},
				available: () => !!f(),
				payload: () => ({ id: f() })
			},
			{
				id: "graph.create",
				label: "Create graph",
				group: "graph",
				shortcut: "N",
				input: {
					on: "keydown",
					key: "n",
					prevent: !0
				},
				payload: ({ target: e }) => ({ name: e?.closest("[data-search-value]")?.dataset.searchValue })
			},
			{
				id: "graph.switch.next",
				label: "Switch graph",
				event: "graph.switch",
				group: "graph",
				shortcut: "Alt+G",
				input: {
					on: "keydown",
					key: "g",
					alt: !0,
					prevent: !0
				},
				payload: () => ({ id: Da(r) })
			},
			{
				id: "graph.switch",
				label: "Switch graph",
				group: "graph",
				hidden: !0,
				payload: (e) => ({ id: h(e.target) || r.current.id })
			},
			{
				id: "graph.duplicate",
				label: "Duplicate graph",
				group: "graph",
				payload: (e) => ({ id: h(e.target) || r.current.id })
			},
			{
				id: "graph.rename.input",
				label: "Type graph name",
				group: "graph",
				hidden: !0,
				input: {
					on: "input",
					selector: "[data-graph-title]"
				},
				payload: ({ target: e }) => ({
					id: e.dataset.graphId ?? r.current.id,
					name: e.value
				})
			},
			{
				id: "graph.rename.commit",
				label: "Save graph name",
				group: "graph",
				hidden: !0,
				input: {
					on: "change",
					selector: "[data-graph-title]"
				}
			},
			{
				id: "graph.rename",
				label: "Rename graph",
				group: "graph",
				hidden: !0,
				payload: ({ target: e }) => ({
					id: e.dataset.graphId ?? r.current.id,
					name: e.value
				})
			},
			{
				id: "graph.delete",
				label: "Delete graph",
				event: "graph.delete.request",
				group: "graph",
				available: (e) => r.all().length > 1 && (!!h(e?.target) || !!r.current.id),
				payload: (e) => ({
					id: h(e.target) || r.current.id,
					confirm: e.origin !== "programmatic"
				})
			},
			{
				id: "graph.delete.confirm",
				label: "Confirm graph deletion",
				group: "graph",
				hidden: !0,
				input: {
					on: "click",
					selector: "[data-graph-delete-confirm]"
				}
			},
			{
				id: "graph.delete.cancel",
				label: "Cancel graph deletion",
				group: "graph",
				hidden: !0,
				input: {
					on: "click",
					selector: "[data-graph-delete-cancel]"
				}
			},
			{
				id: "graph.node.delete",
				label: "Delete node",
				group: "graph",
				available: (e) => !!h(e?.target) || !!o.selectedNode(),
				payload: (e) => ({ id: h(e.target) || o.selectedNode()?.id || "" })
			},
			{
				id: "graph.edge.delete",
				label: "Delete edge",
				group: "edge",
				available: (e) => !!h(e?.target) || !!f(),
				payload: (e) => ({ id: h(e.target) || f() })
			}
		]), t("graph.export.json", () => {
			let e = JSON.stringify(r.current.snapshot());
			n("modal.open", {
				title: "Export graph",
				visual: "properties",
				body: p.exportBody(e)
			}), n("graph.exported", { json: e });
		}), t("graph.export.file.json", () => {
			let e = JSON.stringify(r.current.snapshot(), null, 2);
			p.download(new Blob([e], { type: "application/json" }), "json"), n("app.notice", { message: "Graph backup downloaded." });
		}), t("graph.export.svg", () => {
			let e = p.currentViewSvg();
			e && (p.download(new Blob([e.source], { type: "image/svg+xml;charset=utf-8" }), "svg"), n("app.notice", { message: "SVG view downloaded." }));
		}), t("graph.export.png", () => {
			p.currentViewPng().then((e) => {
				e && p.download(e, "png"), n("app.notice", {
					message: e ? "PNG view downloaded." : "PNG export failed.",
					level: e ? void 0 : "warn"
				});
			});
		}), t("graph.import.snapshot", (e) => {
			n("history.replace.start"), r.current.replace(e), n("graph.imported", { graphId: r.current.id }), n("graph.switched", { id: r.current.id }), queueMicrotask(() => n("history.replace.end"));
		}), t("graph.edge.reverse", ({ id: e }) => {
			let t = r.current.getEdge(e);
			t && r.current.updateEdge(e, {
				From: t.To,
				To: t.From
			}) && n("graph.edge.updated", {
				graphId: r.current.id,
				id: e
			});
		}), t("graph.create", (e) => {
			d();
			let t = r.create(), i = e?.name?.trim();
			i && t.rename(i) && n("graph.renamed", {
				id: t.id,
				name: t.name
			}), r.switch(t.id), n("graph.created", { id: t.id }), n("graph.switched", { id: t.id });
		}), t("graph.duplicate", ({ id: e }) => {
			d();
			let t = r.get(e);
			if (!t) return;
			let i = r.create();
			i.replace(t.snapshot()), i.rename(`${t.name} copy`), r.switch(i.id), n("graph.duplicated", {
				id: i.id,
				sourceId: t.id
			}), n("graph.switched", { id: i.id }), n("app.notice", { message: `Duplicated “${t.name}”.` });
		});
		let m = (e) => {
			let t = r.get(e), n = t?.nodes().length ?? 0;
			return Hn({
				question: `Delete “${t?.name ?? e}” and its ${n} nodes? This cannot be undone.`,
				keep: {
					label: "Keep graph",
					command: "graph.delete.cancel",
					data: { graphDeleteCancel: "" }
				},
				destroy: {
					label: "Delete graph",
					command: "graph.delete.confirm",
					data: { graphDeleteConfirm: "" }
				}
			});
		};
		t("graph.delete.request", ({ id: e, confirm: t }) => {
			if (d(), !t) {
				n("graph.delete", { id: e });
				return;
			}
			l = e, n("modal.open", {
				title: "Delete graph?",
				visual: "properties",
				body: m(e)
			});
		}), t("graph.delete.confirm", () => {
			let e = l;
			e && (l = null, n("graph.delete", { id: e }), n("modal.close"));
		}), t("graph.delete.cancel", () => {
			l = null, n("modal.close");
		}), t("modal.closed", () => {
			l = null;
		}), t("graph.switch", ({ id: e }) => {
			e !== r.current.id && (d(), n("graph.switched", { id: r.switch(e).id }));
		}), t("graph.rename.input", ({ id: e, name: t }) => {
			if (!r.get(e)?.rename(t)) return;
			u && clearTimeout(u.timer);
			let n = setTimeout(() => {
				u?.timer === n && d();
			}, 180);
			u = {
				id: e,
				timer: n
			};
		}), t("graph.rename.commit", d), t("graph.rename", ({ id: e, name: t }) => {
			d();
			let i = r.get(e);
			i?.rename(t) && n("graph.renamed", {
				id: e,
				name: i.name
			});
		});
		let g = () => i.view.spaceCenter(e.Stage);
		t("graph.node.create", (e) => {
			let { relativeTo: t, keepFocus: i, connectFrom: s, connectKind: c, keepView: l, ...u } = e, d = a.nodeType(u.NodeType ?? "text");
			!u.Size && d?.defaultSize && (u.Size = { ...d.defaultSize });
			let f = u.NodeType !== void 0 || u.Color !== void 0 || u.Fill !== void 0 || u.BorderColor !== void 0, p = t ? r.current.getNode(t) : o.selectedNode(), m = r.current.createNode(u, {
				at: g(),
				nearPosition: p?.Position
			});
			n("graph.node.created", {
				graphId: r.current.id,
				id: m.id,
				styleExplicit: f,
				hints: {
					keepFocus: i,
					connectFrom: s,
					connectKind: c,
					relativeTo: t,
					keepView: l
				}
			});
		}), t("graph.node.update", ({ id: e, patch: t }) => {
			r.current.updateNode(e, t) && n("graph.node.updated", {
				graphId: r.current.id,
				id: e,
				patch: t
			});
		}), t("graph.node.delete", ({ id: e }) => {
			let t = r.current.edgesOf(e).map((e) => e.id);
			r.current.deleteNode(e) && (t.forEach((e) => n("graph.edge.deleted", {
				graphId: r.current.id,
				id: e
			})), n("graph.node.deleted", {
				graphId: r.current.id,
				id: e
			}));
		}), t("graph.edge.create", (e) => {
			if (!e.From || !e.To || e.From === e.To || !r.current.refById(e.From) || !r.current.refById(e.To)) return;
			let t = r.current.createEdge(e);
			n("graph.edge.created", {
				graphId: r.current.id,
				id: t.id,
				edge: t
			});
		}), t("graph.edge.update", ({ id: e, patch: t }) => {
			r.current.updateEdge(e, t) && n("graph.edge.updated", {
				graphId: r.current.id,
				id: e
			});
		}), t("graph.edge.delete", ({ id: e }) => {
			r.current.deleteEdge(e) && n("graph.edge.deleted", {
				graphId: r.current.id,
				id: e
			});
		}), t("graph.delete", ({ id: e }) => {
			let t = r.delete(e);
			n("graph.deleted", {
				id: e,
				nextId: t.id
			}), n("graph.switched", { id: t.id });
		});
		let _ = i.hierarchy.sources.register(s, () => {
			let e = r.current.nodes().map((e) => ({
				ref: B(e.id),
				label: e.Label.text || e.id,
				anchor: e.Position ?? {
					x: 0,
					y: 0
				}
			})), t = r.current.edges().flatMap((e) => {
				let t = r.current.refById(e.From), n = r.current.refById(e.To), i = (e) => {
					if (!e) return null;
					let t = r.current.getItem(e), n = t && a.entity(e.kind)?.render?.bounds?.(t);
					return n ? {
						x: n.x + n.w / 2,
						y: n.y + n.h / 2
					} : t?.Position ?? null;
				}, o = i(t), s = i(n);
				if (!o || !s) return [];
				let c = t && r.current.getItem(t)?.Label?.text || e.From, l = n && r.current.getItem(n)?.Label?.text || e.To;
				return [{
					ref: ht(e.id),
					label: e.Label?.text || `${c} to ${l}`,
					anchor: {
						x: (o.x + s.x) / 2,
						y: (o.y + s.y) / 2
					}
				}];
			});
			return [...e, ...t];
		});
		return c({
			surface: "top",
			command: "graph.export.json",
			kind: "button",
			icon: "export",
			text: "Export",
			order: 22,
			group: "overflow"
		}), () => {
			u && clearTimeout(u.timer), _();
		};
	});
}
//#endregion
//#region canvas/systems/history.ts
var ka = (e) => JSON.parse(JSON.stringify(e));
function Aa(e) {
	e("history", ({ on: e, emit: t, bus: n, contexts: r, graphs: i, selection: a, contribute: o }) => {
		let s = /* @__PURE__ */ new Map(), c, l = !1, u = 0, d = () => {
			let e = ka(i.current.snapshot());
			return {
				json: JSON.stringify(e),
				snapshot: e
			};
		}, f = (e = i.current.id) => {
			let t = s.get(e);
			return t || (t = {
				entries: [d()],
				index: 0
			}, s.set(e, t)), t;
		}, p = () => {
			let e = f();
			t("history.changed", {
				graphId: i.current.id,
				canUndo: e.index > 0,
				canRedo: e.index < e.entries.length - 1
			});
		}, m = () => {
			if (clearTimeout(c), c = void 0, l || u) return;
			let e = f(), t = d();
			e.entries[e.index]?.json !== t.json && (e.entries.splice(e.index + 1), e.entries.push(t), e.entries.length > 100 && e.entries.shift(), e.index = e.entries.length - 1, p());
		}, h = () => {
			l || u || (clearTimeout(c), c = setTimeout(m, 120));
		}, g = () => {
			c !== void 0 && m();
		}, _ = (e) => {
			g();
			let n = f(), r = n.index + e;
			r < 0 || r >= n.entries.length || (n.index = r, l = !0, i.current.replace(ka(n.entries[r].snapshot)), a.select(null), a.focus(null), t("graph.imported", { graphId: i.current.id }), t("graph.switched", { id: i.current.id }), queueMicrotask(() => {
				l = !1, p();
			}));
		};
		r.commands.register([
			{
				id: "history.undo",
				label: "Undo",
				group: "history",
				shortcut: "Ctrl+Z",
				input: {
					on: "keydown",
					key: "z",
					ctrl: !0,
					prevent: !0
				},
				available: () => (g(), f().index > 0)
			},
			{
				id: "history.undo.meta",
				label: "Undo",
				event: "history.undo",
				group: "history",
				hidden: !0,
				shortcut: "Cmd+Z",
				input: {
					on: "keydown",
					key: "z",
					meta: !0,
					prevent: !0
				}
			},
			{
				id: "history.redo",
				label: "Redo",
				group: "history",
				shortcut: "Ctrl+Shift+Z",
				input: {
					on: "keydown",
					key: "Z",
					ctrl: !0,
					shift: !0,
					prevent: !0
				},
				available: () => {
					g();
					let e = f();
					return e.index < e.entries.length - 1;
				}
			},
			{
				id: "history.redo.meta",
				label: "Redo",
				event: "history.redo",
				group: "history",
				hidden: !0,
				shortcut: "Cmd+Shift+Z",
				input: {
					on: "keydown",
					key: "Z",
					meta: !0,
					shift: !0,
					prevent: !0
				}
			}
		]), o({
			surface: "top",
			command: "history.undo",
			kind: "button",
			icon: "undo",
			label: "Undo",
			order: 26,
			group: "history"
		}), o({
			surface: "top",
			command: "history.redo",
			kind: "button",
			icon: "redo",
			label: "Redo",
			order: 27,
			group: "history"
		}), e("history.undo", () => _(-1)), e("history.redo", () => _(1)), e("history.replace.start", () => {
			u++ === 0 && g();
		}), e("history.replace.end", () => {
			u = Math.max(0, u - 1), u || m();
		}), e("app.start", () => {
			f(), p();
		}), e("graph.switched", ({ id: e }) => {
			clearTimeout(c), c = void 0, f(e), p();
		}), e("graph.deleted", ({ id: e }) => {
			s.delete(e);
		});
		let v = n.onAny(({ name: e, data: t }) => {
			let n = e.startsWith("graph.") && /\.(created|updated|deleted|renamed|imported)$/.test(e), r = e.startsWith("container.") && /\.(created|updated|deleted|changed)$/.test(e), i = e === "ink.stroke.completed" || e === "ink.stroke.deleted" || e === "ink.stroke.updated" && !t?.gesture;
			(n || r || i) && h();
		});
		return () => {
			clearTimeout(c), v(), s.clear();
		};
	}, { requires: ["graph"] });
}
//#endregion
//#region canvas/systems/ink.ts
var ja = 3, Ma = 10, Na = (e) => {
	if (!e.length) return "";
	let t = e.map((e) => ({
		x: Math.round(e.x * 100) / 100,
		y: Math.round(e.y * 100) / 100
	})), [n, ...r] = t;
	if (r.length === 0) return `M ${n.x} ${n.y} L ${n.x + .01} ${n.y}`;
	if (r.length === 1) return `M ${n.x} ${n.y} L ${r[0].x} ${r[0].y}`;
	let i = `M ${n.x} ${n.y}`;
	for (let e = 1; e < t.length - 1; e += 1) {
		let n = t[e], r = {
			x: (n.x + t[e + 1].x) / 2,
			y: (n.y + t[e + 1].y) / 2
		};
		i += ` Q ${n.x} ${n.y} ${r.x} ${r.y}`;
	}
	let a = t[t.length - 1];
	return `${i} L ${a.x} ${a.y}`;
}, Pa = (e) => {
	if (!e.length) return {
		x: 0,
		y: 0,
		w: 0,
		h: 0
	};
	let t = e[0].x, n = e[0].x, r = e[0].y, i = e[0].y;
	for (let a of e) t = Math.min(t, a.x), n = Math.max(n, a.x), r = Math.min(r, a.y), i = Math.max(i, a.y);
	return {
		x: t,
		y: r,
		w: n - t,
		h: i - r
	};
}, Fa = {
	color: "pink",
	width: ja,
	opacity: 1
}, Ia = (e) => {
	let t = Pa(e.Points);
	e.Position = {
		x: t.x + t.w / 2,
		y: t.y + t.h / 2
	}, e.Size = {
		w: t.w,
		h: t.h
	};
};
function La(t) {
	t("ink", (t) => {
		let { on: n, emit: r, contexts: i, graphs: a, selection: o, contribute: s, origin: c } = t, l = !1, u = !1, d = { ...Fa }, f = /* @__PURE__ */ new Map(), p = (e) => {
			let t = f.get(e);
			if (t) return t;
			let n = /* @__PURE__ */ new Map(), r = a.get(e) ?? a.current, i = {
				strokes: n,
				next: 1,
				storeOff: r.registerItemStore("ink", () => [...n.values()]),
				snapshotOff: () => {}
			}, o = () => [...n.values()].map((e) => ({
				id: e.id,
				Points: e.Points.map((e) => ({ ...e })),
				Color: e.Color,
				Width: e.Width,
				Opacity: e.Opacity,
				Label: { ...e.Label }
			})), s = (e) => {
				n.clear(), (Array.isArray(e) ? e : []).forEach((e) => {
					if (!e?.id || !Array.isArray(e.Points) || e.Points.length === 0) return;
					let t = {
						id: e.id,
						kind: "ink",
						Label: { text: e.Label?.text ?? "Ink stroke" },
						Points: e.Points.filter((e) => Number.isFinite(e?.x) && Number.isFinite(e?.y)).map((e) => ({
							x: e.x,
							y: e.y
						})),
						Color: q(e.Color) ? e.Color : "pink",
						Width: Number.isFinite(e.Width) && e.Width > 0 ? e.Width : ja,
						Opacity: Number.isFinite(e.Opacity) ? Math.max(.1, Math.min(1, e.Opacity)) : 1,
						Position: {
							x: 0,
							y: 0
						},
						Size: {
							w: 0,
							h: 0
						}
					};
					if (!t.Points.length) return;
					Ia(t), n.set(t.id, t);
					let r = Number.parseInt(e.id.replace(/^\D+/, ""), 10);
					Number.isFinite(r) && (i.next = Math.max(i.next, r + 1));
				});
			};
			return s(r.snapshotExtension("ink")), i.snapshotOff = r.registerSnapshotExtension("ink", o, s), f.set(e, i), i;
		}, m = () => p(a.current.id).strokes, h = {
			kind: "ink",
			label: "Ink stroke",
			labelOf: (e) => e.Label.text,
			abilities: [Ir(), pr()],
			render: {
				layer: "svg",
				bounds: (e) => ({
					x: e.Position.x - e.Size.w / 2,
					y: e.Position.y - e.Size.h / 2,
					w: e.Size.w,
					h: e.Size.h
				}),
				draw(e, t) {
					let n = "http://www.w3.org/2000/svg", r = document.createElementNS(n, "g");
					r.setAttribute("class", "ink"), r.dataset.inkColor = e.Color, r.style.opacity = String(e.Opacity);
					let i = t.refOf(e.id), a = Na(e.Points), o = document.createElementNS(n, "path");
					o.setAttribute("class", "ink-hit"), o.setAttribute("d", a), o.setAttribute("stroke-width", String(e.Width + Ma)), t.tagItem(o, i);
					let s = document.createElementNS(n, "path");
					return s.setAttribute("class", "ink-path"), s.setAttribute("d", a), s.setAttribute("stroke-width", String(e.Width)), t.tagItem(s, i), t.applyItemModes(s, i), r.append(o, s), r;
				},
				signature: (e) => `${e.Points.length}:${e.Color}:${e.Width}:${e.Opacity}`
			},
			properties: [
				{
					id: "color",
					label: "Color",
					input: "select",
					options: [
						{
							value: "pink",
							label: "Pink"
						},
						{
							value: "red",
							label: "Red"
						},
						{
							value: "orange",
							label: "Orange"
						},
						{
							value: "yellow",
							label: "Yellow"
						},
						{
							value: "green",
							label: "Green"
						},
						{
							value: "blue",
							label: "Blue"
						},
						{
							value: "purple",
							label: "Purple"
						},
						{
							value: "gray",
							label: "Gray"
						}
					],
					value: (e) => e.Color,
					patch: (e, t) => q(t) ? { Color: t } : void 0
				},
				{
					id: "width",
					label: "Stroke width",
					input: "number",
					min: 1,
					step: 1,
					value: (e) => e.Width,
					patch: (e, t) => {
						let n = Number(t);
						return Number.isFinite(n) && n > 0 ? { Width: Math.min(24, n) } : void 0;
					}
				},
				{
					id: "opacity",
					label: "Opacity",
					input: "number",
					min: .1,
					step: .1,
					value: (e) => e.Opacity,
					patch: (e, t) => {
						let n = Number(t);
						return Number.isFinite(n) ? { Opacity: Math.max(.1, Math.min(1, n)) } : void 0;
					}
				}
			]
		}, _ = t.model.registerEntity(h);
		i.storage.register("ink", c, (e, t) => {
			let n = m().get(e.id);
			if (!n) return;
			let i = t;
			i.Label && (n.Label = { text: i.Label.text }), i.Color && q(i.Color) && (n.Color = i.Color), Number.isFinite(i.Width) && i.Width > 0 && (n.Width = Math.min(24, i.Width)), Number.isFinite(i.Opacity) && (n.Opacity = Math.max(.1, Math.min(1, i.Opacity))), Array.isArray(i.Points) && i.Points.length && (n.Points = i.Points.map((e) => ({
				x: e.x,
				y: e.y
			})), Ia(n)), r("ink.stroke.updated", {
				id: n.id,
				gesture: e.id === v && Array.isArray(i.Points)
			});
		});
		let v = null, y = () => i.places.el(e.Stage), b = (e) => {
			l !== e && (e && u && x(!1), l = e, e || (v = null), y()?.classList.toggle("ink-drawing", e), r("ink.mode.changed", { drawing: e }), r("tool.panel.redraw", { id: "top" }));
		}, x = (e) => {
			u !== e && (e && l && b(!1), u = e, y()?.classList.toggle("ink-erasing", e), r("ink.erase.mode.changed", { erasing: e }), r("tool.panel.redraw", { id: "top" }));
		}, S = (e) => {
			m().delete(e) && (o.remove({
				kind: "ink",
				id: e
			}), r("ink.stroke.deleted", { id: e }));
		};
		i.commands.register([
			{
				id: "ink.toggle",
				label: "Draw ink annotations",
				group: "edit"
			},
			{
				id: "ink.erase.toggle",
				label: "Erase ink annotations",
				group: "edit"
			},
			{
				id: "ink.item.erase",
				label: "Erase canvas item",
				group: "edit",
				hidden: !0,
				input: {
					on: "pointerdown",
					selector: "[data-item-kind][data-item-id]",
					prevent: !0,
					stop: !0,
					priority: -30,
					when: (e) => u && e.isPrimary && e.button === 0 && !e.target.closest(".tool-panel, .item-toolbar, .modal-layer")
				},
				payload: ({ target: e }) => g(e)
			},
			{
				id: "ink.select.all",
				label: "Select all drawings",
				group: "selection",
				available: () => m().size > 0
			},
			...[
				"pink",
				"red",
				"orange",
				"yellow",
				"green",
				"blue",
				"purple",
				"gray"
			].map((e) => ({
				id: `ink.arm.color.${e}`,
				label: `Arm draw color: ${e}`,
				event: "ink.arm.color",
				group: "edit",
				payload: () => ({ color: e })
			})),
			...[
				1.5,
				3,
				6
			].map((e) => ({
				id: `ink.arm.width.${String(e).replace(".", "-")}`,
				label: `Arm draw width: ${e}`,
				event: "ink.arm.width",
				group: "edit",
				payload: () => ({ width: e })
			})),
			...[
				.25,
				.5,
				.75,
				1
			].map((e) => ({
				id: `ink.arm.opacity.${Math.round(e * 100)}`,
				label: `Arm draw opacity: ${Math.round(e * 100)}%`,
				event: "ink.arm.opacity",
				group: "edit",
				payload: () => ({ opacity: e })
			})),
			{
				id: "ink.stroke.start",
				label: "Start ink stroke",
				event: "ink.stroke.start",
				group: "edit",
				hidden: !0,
				input: {
					on: "pointerdown",
					selector: `[data-place="${e.Stage}"]`,
					when: (e) => l && e.isPrimary && e.button === 0 && !e.target.closest("[data-item-id], .tool-panel, .item-toolbar, .modal-layer, .empty-action"),
					prevent: !0,
					stop: !0,
					priority: -30
				},
				payload: ({ event: t }) => ({ point: i.view.clientToSpace(e.Stage, Fn(t)) })
			},
			{
				id: "ink.stroke.move",
				label: "Extend ink stroke",
				event: "ink.stroke.move",
				group: "edit",
				hidden: !0,
				input: {
					on: "pointermove",
					when: () => l && !!v,
					prevent: !0
				},
				payload: ({ event: t }) => ({ point: i.view.clientToSpace(e.Stage, Fn(t)) })
			},
			{
				id: "ink.stroke.end",
				label: "Finish ink stroke",
				event: "ink.stroke.end",
				group: "edit",
				hidden: !0,
				input: {
					on: "pointerup",
					when: () => l && !!v
				}
			}
		]), n("ink.toggle", () => b(!l)), n("ink.erase.toggle", () => x(!u)), n("ink.item.erase", (e) => {
			u && (e.kind === "ink" && S(e.id), e.kind === "node" && r("graph.node.delete", { id: e.id }), e.kind === "edge" && r("graph.edge.delete", { id: e.id }), e.kind === "container" && r("graph.container.delete", { id: e.id }));
		}), n("ink.select.all", () => {
			r("selection.choose", {
				refs: [...m().keys()].map((e) => ({
					kind: "ink",
					id: e
				})),
				mode: "replace"
			});
		});
		let C = () => r("ink.arm.changed", { ...d });
		return n("ink.arm.color", ({ color: e }) => {
			q(e) && (d = {
				...d,
				color: e
			}, C());
		}), n("ink.arm.width", ({ width: e }) => {
			Number.isFinite(e) && e > 0 && (d = {
				...d,
				width: Math.min(24, e)
			}, C());
		}), n("ink.arm.opacity", ({ opacity: e }) => {
			Number.isFinite(e) && (d = {
				...d,
				opacity: Math.max(.1, Math.min(1, e))
			}, C());
		}), n("ink.stroke.start", ({ point: e }) => {
			if (!l) return;
			let t = p(a.current.id), n = `k${t.next++}`, i = {
				id: n,
				kind: "ink",
				Label: { text: `Ink stroke ${n.slice(1)}` },
				Points: [{ ...e }],
				Color: d.color,
				Width: d.width,
				Opacity: d.opacity,
				Position: { ...e },
				Size: {
					w: 0,
					h: 0
				}
			};
			t.strokes.set(n, i), v = n, r("ink.stroke.created", { id: n });
		}), n("ink.stroke.move", ({ point: e }) => {
			if (!v) return;
			let t = m().get(v);
			if (!t) {
				v = null;
				return;
			}
			let n = t.Points[t.Points.length - 1];
			Math.abs(e.x - n.x) + Math.abs(e.y - n.y) < 1.5 || r("item.update", {
				ref: {
					kind: "ink",
					id: v
				},
				patch: { Points: [...t.Points, { ...e }] }
			});
		}), n("ink.stroke.end", () => {
			if (!v) return;
			let e = m().get(v);
			e && e.Points.length < 2 ? (m().delete(e.id), r("ink.stroke.deleted", { id: e.id })) : e && r("ink.stroke.completed", { id: e.id }), v = null;
		}), n("selection.item.delete", () => {
			o.selectedAll().forEach((e) => {
				e.kind === "ink" && S(e.id);
			});
		}), n("graph.switched", () => {
			v = null, p(a.current.id);
		}), n("app.start", () => {
			p(a.current.id);
		}), i.interaction.cancel.register({
			origin: c,
			priority: 30,
			background: !1,
			blocksPointer: !0,
			active: () => l || u,
			cancel: () => l ? b(!1) : x(!1)
		}), s({
			origin: c,
			surface: "top",
			command: "ink.toggle",
			kind: "button",
			icon: "draw",
			label: "Draw mode",
			className: "canvas-mode-tool ink-mode-switch",
			active: () => l,
			slot: "start",
			group: "mode",
			order: 4
		}), s({
			origin: c,
			surface: "top",
			command: "ink.erase.toggle",
			kind: "button",
			icon: "erase",
			label: "Erase canvas items",
			className: "canvas-mode-tool ink-erase-switch",
			active: () => u,
			slot: "start",
			group: "mode",
			order: 6
		}), () => {
			b(!1), x(!1), f.forEach((e) => {
				e.storeOff(), e.snapshotOff();
			}), f.clear(), _();
		};
	}, { requires: ["render", "graph"] });
}
//#endregion
//#region canvas/systems/input.ts
function Ra(e) {
	e("input", ({ on: e, contexts: t }) => {
		let n;
		return e("app.start", () => {
			n?.(), n = t.input.start(t.places.root());
		}), () => n?.();
	});
}
//#endregion
//#region canvas/systems/io.ts
var za = (e) => {
	if (!e || typeof e != "object") return !1;
	let t = e;
	return Array.isArray(t.nodes) && Array.isArray(t.edges) && t.nodes.every((e) => !!e && typeof e == "object" && typeof e.id == "string") && t.edges.every((e) => !!e && typeof e == "object" && typeof e.id == "string");
}, Ba = (e) => {
	if (!e || typeof e != "object") return !1;
	let t = e;
	return typeof t.current == "string" && Array.isArray(t.graphs) && t.graphs.length > 0 && t.graphs.some((e) => e?.id === t.current) && t.graphs.every((e) => !!e && typeof e.id == "string" && za(e.snapshot));
};
function Va(e) {
	e("io", ({ on: e, emit: t, bus: n, io: r, flags: i, contexts: a, graphs: o, frameLoop: s, declarePanel: c }) => {
		let l = !1;
		e("flag.changed", () => r.set(L.flags, i.all())), e("command.shortcut.changed", ({ id: e, shortcut: t }) => {
			let n = r.get(L.shortcuts, {});
			n[e] = t, r.set(L.shortcuts, n);
		}), e("command.enabled.changed", ({ id: e, enabled: t }) => {
			let n = new Set(r.get(L.disabledCommands, []));
			t ? n.delete(e) : n.add(e), r.set(L.disabledCommands, [...n]);
		}), e("fold.changed", () => r.set("frontend.fold", a.fold.all()));
		let d = () => {
			let e = r.get(L.graphsBackup, null);
			return Ba(e) ? e : null;
		}, f = (e) => () => {
			let t = e.graphs.reduce((e, t) => e + t.snapshot.nodes.length, 0);
			return u("section.delete-preview.restore-preview", [
				u("p", { text: `Restore the previous browser save with ${e.graphs.length} graph${e.graphs.length === 1 ? "" : "s"} and ${t} node${t === 1 ? "" : "s"}? Current graphs will be replaced.` }),
				u("small", { text: "Your current state becomes the next recovery point." }),
				u(".import-actions", [u("button", {
					type: "button",
					text: "Keep current graphs",
					data: { command: "io.backup.restore.cancel" }
				}), u("button.primary", {
					type: "button",
					text: "Restore previous save",
					data: { command: "io.backup.restore.confirm" }
				})])
			]);
		};
		a.commands.register([
			{
				id: "io.backup.restore.request",
				label: "Restore previous browser save",
				group: "history",
				available: () => !!d()
			},
			{
				id: "io.backup.restore.confirm",
				label: "Confirm previous save restore",
				group: "history",
				hidden: !0
			},
			{
				id: "io.backup.restore.cancel",
				label: "Cancel previous save restore",
				group: "history",
				hidden: !0
			}
		]);
		let p = null, m = !1, h = () => {
			if (m) return "Save failed — export a backup";
			if (p === null) return "Saved locally";
			let e = Math.round((Date.now() - p) / 1e3);
			if (e < 5) return "Saved locally · just now";
			if (e < 60) return `Saved locally · ${e}s ago`;
			let t = Math.round(e / 60);
			return t < 60 ? `Saved locally · ${t}m ago` : `Saved locally · ${Math.round(t / 60)}h ago`;
		}, g = u("button.save-status", {
			type: "button",
			data: { command: "graph.export.json" }
		}), _ = () => {
			g.textContent = h(), g.dataset.state = m ? "error" : "ok", g.title = m ? "The browser refused the local save. Export a JSON backup now." : "Graphs stay in this browser only. Click to export a JSON backup.";
		}, v, y = !1, b = () => {
			y || (y = !0, v = setInterval(_, 15e3), c({
				id: "save-status",
				anchor: "bottom-center",
				movable: !1,
				layout: "custom",
				order: 30,
				render: () => (_(), g)
			}));
		}, x = new URLSearchParams(location.search).has("g"), S = !1, C = (e, n = !1, r = !0) => {
			let i = [...o.all()], a = new Set(e.graphs.map((e) => e.id));
			S = !0;
			try {
				e.graphs.forEach(({ id: e, snapshot: t }) => o.create(e).replace(t)), o.switch(e.current), i.filter((e) => !a.has(e.id)).forEach((e) => {
					let n = o.delete(e.id);
					t("graph.deleted", {
						id: e.id,
						nextId: n.id
					});
				});
			} finally {
				S = !1;
			}
			r && (t("selection.item.clear"), t("graph.imported", { graphId: o.current.id }), t("graph.switched", { id: o.current.id })), n && t("app.notice", { message: "Restored the previous browser save." });
		}, w = () => {
			let e = {
				current: o.current.id,
				graphs: o.all().map((e) => ({
					id: e.id,
					snapshot: e.snapshot()
				}))
			}, n = r.get(L.graphs, null);
			Ba(n) && r.set(L.graphsBackup, n);
			let i = r.set(L.graphs, e);
			i || t("app.notice", {
				message: "Local save failed. Export JSON before closing this tab.",
				level: "error"
			}), m = !i, i && (p = Date.now()), _(), b(), t("io.saved", {
				at: Date.now(),
				ok: i
			});
		}, T, E = () => {
			x || (clearTimeout(T), T = setTimeout(() => {
				T = void 0, w();
			}, 300));
		}, D = () => {
			T !== void 0 && (clearTimeout(T), T = void 0, w());
		}, O = n.onAny(({ name: e }) => {
			let t = e.startsWith("graph.") && e.endsWith("ed"), n = e.startsWith("container.") && /\.(created|updated|deleted|changed)$/.test(e);
			!S && (t || n) && E();
		});
		return e("app.start", () => {
			if (x) {
				t("app.notice", { message: "Viewing a shared graph. Your own graphs are untouched, and edits here are not saved — export to keep a copy." });
				return;
			}
			let e = r.get(L.graphs, null), n = r.get(L.graphsBackup, null), i = Ba(e) ? e : Ba(n) ? n : null;
			if (i) {
				i === n && t("app.notice", {
					message: "Recovered graphs from the last valid local backup.",
					level: "warn"
				}), C(i, !1, !1), S = !0;
				try {
					t("graph.switched", { id: o.current.id });
				} finally {
					S = !1;
				}
				o.current.nodes().length && s.schedule("io.restore.fit", () => t("view.fit.all"), 20);
			}
		}), e("io.backup.restore.request", () => {
			let e = d();
			if (!e) {
				t("app.notice", {
					message: "No previous browser save is available.",
					level: "warn"
				});
				return;
			}
			l = !0, t("modal.open", {
				title: "Restore previous save?",
				visual: "properties",
				body: f(e)
			});
		}), e("io.backup.restore.confirm", () => {
			if (!l) return;
			let e = d();
			l = !1, e && C(e, !0), t("modal.close");
		}), e("io.backup.restore.cancel", () => {
			l = !1, t("modal.close");
		}), e("modal.closed", () => {
			l = !1;
		}), globalThis.addEventListener?.("pagehide", D), globalThis.addEventListener?.("beforeunload", D), () => {
			globalThis.removeEventListener?.("pagehide", D), globalThis.removeEventListener?.("beforeunload", D), clearTimeout(T), T = void 0, clearInterval(v), s.cancel("io.restore.fit"), O();
		};
	});
}
var Ha = {
	workflows: {
		titles: {
			node: "state name",
			edge: "event",
			edgeDescription: "guard expression",
			container: "region name"
		},
		group: {
			containerType: "group",
			label: "region",
			ask: [{
				id: "label",
				label: "Region name",
				input: "text",
				placeholder: "windowing",
				autofocus: !0
			}, {
				id: "parallel",
				label: "Runs in parallel with its siblings",
				input: "select",
				options: () => [{
					value: "no",
					label: "No — one substate at a time"
				}, {
					value: "yes",
					label: "Yes — orthogonal region"
				}]
			}]
		},
		jump: { order: "flow" },
		edges: [
			{
				id: "on",
				label: "on <event>",
				kind: "plain",
				event: "done"
			},
			{
				id: "always",
				label: "always",
				kind: "plain",
				event: "always"
			},
			{
				id: "after",
				label: "after <ms>",
				kind: "dashed",
				event: "after 30s"
			},
			{
				id: "error",
				label: "on error",
				kind: "dashed",
				color: "red",
				event: "error"
			}
		],
		contracts: [{
			id: "timeout",
			label: "Timeout",
			kind: "duration",
			appliesTo: "node",
			when: { nodeType: ["agent", "timeline-step"] },
			lint: "D-T-4",
			hint: "A step that calls out and cannot give up is an availability bug."
		}, {
			id: "onFailure",
			label: "On failure",
			kind: "choice",
			appliesTo: "node",
			when: { nodeType: ["agent", "timeline-step"] },
			lint: "R-L-12",
			options: [
				{
					value: "retry",
					label: "Retryable"
				},
				{
					value: "fatal",
					label: "Fatal"
				},
				{
					value: "ambiguous",
					label: "Ambiguous — outcome unknown"
				}
			]
		}]
	},
	systems: {
		titles: {
			node: "component name",
			edge: "channel",
			edgeDescription: "what travels here",
			container: "boundary name"
		},
		group: {
			containerType: "group",
			label: "boundary",
			ask: [{
				id: "label",
				label: "Boundary name",
				input: "text",
				placeholder: "flush transaction",
				autofocus: !0
			}, {
				id: "boundary",
				label: "Kind of boundary",
				input: "select",
				options: () => [
					{
						value: "transaction",
						label: "Transaction — commits together"
					},
					{
						value: "trust",
						label: "Trust — a security edge"
					},
					{
						value: "deployment",
						label: "Deployment — ships together"
					}
				]
			}]
		},
		jump: { order: "document" },
		edges: [
			{
				id: "publishes",
				label: "publishes",
				kind: "async",
				relation: "produces",
				event: "publishes"
			},
			{
				id: "consumes",
				label: "consumes",
				kind: "async",
				relation: "uses",
				event: "consumes"
			},
			{
				id: "writes",
				label: "writes",
				kind: "write",
				relation: "produces",
				event: "writes"
			},
			{
				id: "reads",
				label: "reads",
				kind: "read",
				relation: "uses",
				event: "reads"
			},
			{
				id: "calls",
				label: "calls",
				kind: "sync",
				relation: "depends-on",
				event: "calls"
			}
		],
		contracts: [
			{
				id: "delivery",
				label: "Delivery",
				kind: "choice",
				options: [
					{
						value: "at-most-once",
						label: "At most once"
					},
					{
						value: "at-least-once",
						label: "At least once"
					},
					{
						value: "effectively-once",
						label: "Effectively once"
					}
				],
				appliesTo: "edge",
				default: "at-least-once",
				lint: "D-T-3",
				hint: "How many times can this arrive?"
			},
			{
				id: "ordering",
				label: "Ordering",
				kind: "choice",
				options: [
					{
						value: "none",
						label: "No ordering"
					},
					{
						value: "per-key",
						label: "Per key (FIFO)"
					},
					{
						value: "per-partition",
						label: "Per partition"
					},
					{
						value: "total",
						label: "Total order"
					}
				],
				appliesTo: "edge",
				default: "per-partition",
				lint: "D-T-2",
				hint: "What is ordered with what?"
			},
			{
				id: "timeout",
				label: "Timeout",
				kind: "duration",
				appliesTo: "edge",
				lint: "D-T-4",
				hint: "How long before this call gives up?"
			},
			{
				id: "idempotency",
				label: "Idempotency key",
				kind: "text",
				appliesTo: "edge",
				lint: "D-L-5",
				requiredWhen: [{
					slot: "delivery",
					equals: "at-least-once"
				}],
				hint: "At-least-once without one doubles on every retry."
			},
			{
				id: "saturation",
				label: "When full",
				kind: "choice",
				options: [
					{
						value: "block",
						label: "Block the producer"
					},
					{
						value: "drop",
						label: "Drop"
					},
					{
						value: "shed",
						label: "Load shed"
					},
					{
						value: "spill",
						label: "Spill to disk"
					}
				],
				appliesTo: "edge",
				lint: "D-T-9",
				hint: "What happens when the consumer falls behind?"
			},
			{
				id: "isolation",
				label: "Isolation",
				kind: "choice",
				options: [
					{
						value: "read-committed",
						label: "Read committed"
					},
					{
						value: "repeatable-read",
						label: "Repeatable read"
					},
					{
						value: "serializable",
						label: "Serializable"
					}
				],
				appliesTo: "node",
				when: { nodeType: [
					"postgres-table",
					"database",
					"repository"
				] },
				lint: "D-L-7"
			},
			{
				id: "lock",
				label: "Lock held",
				kind: "text",
				appliesTo: "node",
				when: { nodeType: [
					"postgres-table",
					"database",
					"repository"
				] },
				lint: "D-L-6",
				hint: "What it protects, and for how long."
			},
			{
				id: "consistency",
				label: "Read consistency",
				kind: "choice",
				options: [
					{
						value: "read-your-writes",
						label: "Read your writes"
					},
					{
						value: "monotonic",
						label: "Monotonic reads"
					},
					{
						value: "bounded",
						label: "Bounded staleness"
					},
					{
						value: "eventual",
						label: "Eventual"
					}
				],
				appliesTo: "node",
				when: { nodeType: [
					"postgres-table",
					"database",
					"cache",
					"index"
				] },
				lint: "R-L-14"
			}
		]
	}
}, J = (e, t) => typeof e == "string" && e.trim() ? e.trim().slice(0, t) : void 0, Ua = /^[a-z][a-z0-9.-]{0,31}$/, Wa = [
	"choice",
	"text",
	"expression",
	"duration",
	"number"
], Ga = (e) => {
	let t = e, n = typeof t?.id == "string" && Ua.test(t.id) ? t.id : void 0, r = J(t?.label, 48);
	if (!n || !r || !Wa.includes(t?.kind)) return null;
	let i = t?.appliesTo === "node" || t?.appliesTo === "edge" || t?.appliesTo === "both" ? t.appliesTo : null;
	if (!i) return null;
	let a = Array.isArray(t?.options) ? t.options.slice(0, 12).flatMap((e) => {
		let t = J(e?.value, 32), n = J(e?.label, 48);
		return t && n ? [{
			value: t,
			label: n
		}] : [];
	}) : void 0;
	return {
		id: n,
		label: r,
		kind: t.kind,
		appliesTo: i,
		options: a?.length ? a : void 0,
		default: J(t?.default, 32),
		lint: J(t?.lint, 16),
		hint: J(t?.hint, 160)
	};
}, Ka = (e) => {
	let t = e ?? {}, n = {}, r = Array.isArray(t.contracts) ? t.contracts.slice(0, 24).map(Ga).filter((e) => !!e) : [];
	r.length && (n.contracts = r);
	let i = Array.isArray(t.edges) ? t.edges.slice(0, 12).flatMap((e) => {
		let t = e, n = typeof t?.id == "string" && Ua.test(t.id) ? t.id : void 0, r = J(t?.label, 32);
		return n && r ? [{
			id: n,
			label: r,
			kind: t.kind ?? "plain",
			event: J(t.event, 32)
		}] : [];
	}) : [];
	i.length && (n.edges = i);
	let a = t.titles && typeof t.titles == "object" ? {
		node: J(t.titles.node, 32),
		edge: J(t.titles.edge, 32),
		edgeDescription: J(t.titles.edgeDescription, 32),
		container: J(t.titles.container, 32)
	} : void 0;
	if (a && Object.values(a).some(Boolean) && (n.titles = a), t.group && typeof t.group == "object") {
		let e = J(t.group.label, 24);
		e && (n.group = {
			label: e,
			containerType: "group"
		});
	}
	return (t.jump?.order === "flow" || t.jump?.order === "status") && (n.jump = { order: t.jump.order }), n;
}, qa = (e) => {
	let t = e.nodes.map((e) => e.id), n = new Map(t.map((e, t) => [e, t])), r = new Map(t.map((e) => [e, 0])), i = new Map(t.map((e) => [e, []]));
	for (let t of e.edges) !n.has(t.From) || !n.has(t.To) || t.From === t.To || (i.get(t.From).push(t.To), r.set(t.To, (r.get(t.To) ?? 0) + 1));
	let a = t.filter((e) => (r.get(e) ?? 0) === 0), o = /* @__PURE__ */ new Set(), s = [];
	for (; a.length;) {
		let e = a.shift();
		if (o.has(e)) continue;
		o.add(e), s.push(e);
		let t = [...i.get(e) ?? []].sort((e, t) => (n.get(e) ?? 0) - (n.get(t) ?? 0));
		for (let e of t) r.set(e, (r.get(e) ?? 1) - 1), (r.get(e) ?? 0) <= 0 && !o.has(e) && a.push(e);
	}
	for (let e of t) o.has(e) || s.push(e);
	return s;
}, Ja = "asdfghjklqwertyuiopzxcvbnm";
function Ya(e) {
	e("jump", ({ on: e, emit: t, contexts: n, graphs: r, origin: i }) => {
		let a = null, o = "document";
		e("mode.changed", ({ fields: e }) => {
			o = e.jump?.order ?? "document";
		});
		let s = () => {
			if (o === "flow") return new Map(qa({
				nodes: r.current.nodes().map((e) => ({ id: e.id })),
				edges: r.current.edges().map((e) => ({
					From: e.From,
					To: e.To
				}))
			}).map((e, t) => [e, t]));
			if (o === "status") {
				let e = [
					"blocked",
					"doing",
					"review",
					"todo",
					"idea",
					"done"
				];
				return new Map(r.current.nodes().map((t) => {
					let n = e.indexOf(t.Status ?? "todo");
					return [t.id, n < 0 ? e.length : n];
				}));
			}
			return null;
		}, c = () => {
			a && (a = null, n.decorations.unregisterOrigin("jump"), n.interaction.keys.unregisterOrigin("jump"));
		};
		return n.commands.register([{
			id: "jump.start",
			label: "Jump to item",
			group: "jump",
			shortcut: "g",
			input: {
				on: "keydown",
				key: "g",
				prevent: !0,
				stop: !0,
				priority: -10
			},
			available: () => n.hierarchy.targets().length > 0
		}, {
			id: "jump.cancel",
			label: "Cancel jump",
			group: "jump",
			hidden: !0
		}]), e("jump.start", () => {
			let e = s(), i = n.hierarchy.targets().filter((e) => !Dn(e.ref, n.hierarchy.parentChain, n.fold, r.current.id)).map((e, t) => ({
				target: e,
				at: t
			}));
			e && i.sort((t, n) => {
				let r = e.get(t.target.ref.id), i = e.get(n.target.ref.id);
				return r === void 0 && i === void 0 ? t.at - n.at : r === void 0 ? 1 : i === void 0 ? -1 : r === i ? t.at - n.at : r - i;
			});
			let o = i.map((e) => e.target).slice(0, 26);
			if (!o.length) return;
			let c = /* @__PURE__ */ new Map(), l = o.map((e, t) => {
				let n = Ja[t];
				return c.set(n, e.ref), {
					ref: e.ref,
					text: n.toUpperCase(),
					className: "jump-letter",
					id: `jump-${n}`
				};
			});
			a = c, n.decorations.overlays.set("jump", l), n.interaction.keys.capture("jump", { onKey(e) {
				if (e.key === "Escape") return;
				if (e.key === "Enter") {
					e.preventDefault(), t("jump.cancel");
					return;
				}
				let n = e.key.toLowerCase();
				if (!/^[a-z]$/.test(n)) return;
				e.preventDefault();
				let r = a?.get(n);
				if (!r) {
					t("jump.cancel");
					return;
				}
				t("focus.item.focus", r), t("view.fit.item", r), t("jump.cancel");
			} });
		}), e("jump.cancel", c), n.interaction.cancel.register({
			origin: i,
			active: () => !!a,
			cancel: () => t("jump.cancel")
		}), c;
	}, { requires: [
		"render.stage",
		"graph",
		"focus",
		"view.zoom"
	] });
}
//#endregion
//#region canvas/systems/layout-algorithms.ts
function Xa(e) {
	let t = e.graphs.current, n = e.contexts.hierarchy, r = e.contexts.fold, i = t.nodes(), a = (e) => n.parentChain({
		kind: "node",
		id: e.id
	}).some((e) => r.folded(U(e, t.id))), o = /* @__PURE__ */ new Map();
	for (let e of i) {
		if (a(e)) continue;
		let t = n.parentChain({
			kind: "node",
			id: e.id
		}), r = t.length ? t[t.length - 1] : null, i = r ? R(r) : "", s = o.get(i) ?? {
			parent: r,
			nodes: []
		};
		s.nodes.push(e), o.set(i, s);
	}
	let s = (e) => {
		let t = e.map((e) => e.Position).filter((e) => !!e);
		return t.length ? {
			x: t.reduce((e, t) => e + t.x, 0) / t.length,
			y: t.reduce((e, t) => e + t.y, 0) / t.length
		} : {
			x: 0,
			y: 0
		};
	};
	return [...o.values()].map(({ parent: n, nodes: r }) => {
		let i = n ? t.getItem(n) : void 0, a = n ? e.model.entity(n.kind) : void 0, o = n && i ? a?.render?.bounds?.(i) ?? void 0 : void 0, c = n ? i?.Position ?? {
			x: 0,
			y: 0
		} : s(r), l = new Set(r.map((e) => e.id));
		return {
			origin: c,
			parent: n,
			nodes: r,
			edges: t.edges().filter((e) => l.has(e.From) && l.has(e.To)),
			bounds: o,
			sections: i?.Sections?.map((e, t) => ({
				id: e.id || `s${t + 1}`,
				title: e.title,
				weight: Math.max(.15, Number(e.weight) || 1)
			})),
			sectionAxis: i?.SectionAxis ?? "rows",
			childSections: i?.ChildSections
		};
	});
}
var Za = (e) => `node:${e}`, Y = (e) => e.Size ?? {
	w: 160,
	h: 72
}, Qa = (e) => {
	let t = 0, n = 0;
	for (let r of e) {
		let e = r.Label?.text;
		if (!e) continue;
		let i = Ci(e);
		t = Math.max(t, i.h), n = Math.max(n, i.w);
	}
	return {
		h: t,
		w: n
	};
};
function $a(e) {
	if (!e.bounds || !e.sections?.length) return [];
	let t = {
		x: e.bounds.x + 32,
		y: e.bounds.y + eo,
		w: Math.max(80, e.bounds.w - 64),
		h: Math.max(60, e.bounds.h - eo - 32)
	}, n = e.sections.reduce((e, t) => e + t.weight, 0) || 1, r = e.sectionAxis === "columns" ? t.x : t.y;
	return e.sections.map((i) => {
		let a = i.weight / n;
		if (e.sectionAxis === "columns") {
			let e = t.w * a, n = {
				section: i,
				rect: {
					x: r,
					y: t.y,
					w: e,
					h: t.h
				}
			};
			return r += e, n;
		}
		let o = t.h * a, s = {
			section: i,
			rect: {
				x: t.x,
				y: r,
				w: t.w,
				h: o
			}
		};
		return r += o, s;
	});
}
var eo = 36;
function to(e, t) {
	let n = $a(e);
	if (!n.length) return !1;
	let r = n[0].section.id;
	return n.forEach(({ section: n, rect: i }) => {
		let a = e.nodes.filter((t) => (e.childSections?.[Za(t.id)] ?? r) === n.id);
		if (!a.length) return;
		let o = Math.max(1, Math.ceil(Math.sqrt(a.length))), s = Math.max(1, Math.ceil(a.length / o));
		a.forEach((e, n) => {
			let r = n % o, a = Math.floor(n / o), c = i.x + (r + 1) / (o + 1) * i.w, l = i.y + (a + 1) / (s + 1) * i.h;
			t(e.id, {
				x: c,
				y: l
			});
		});
	}), !0;
}
function no(e, t) {
	if (to(e, t)) return;
	let n = new Map(e.nodes.map((e) => [e.id, 0]));
	e.edges.forEach((e) => n.set(e.To, (n.get(e.To) ?? 0) + 1));
	let r = e.nodes.filter((e) => (n.get(e.id) ?? 0) === 0);
	if (!r.length) return;
	let i = /* @__PURE__ */ new Map(), a = [];
	for (r.forEach((e) => {
		i.set(e.id, 0), a.push(e.id);
	}); a.length;) {
		let t = a.shift(), n = i.get(t);
		e.edges.filter((e) => e.From === t).forEach((e) => {
			i.has(e.To) || (i.set(e.To, n + 1), a.push(e.To));
		});
	}
	let o = /* @__PURE__ */ new Map();
	e.nodes.forEach((e) => {
		let t = i.get(e.id) ?? 0;
		(o.get(t) ?? o.set(t, []).get(t)).push(e);
	});
	let s = [...o.entries()].sort((e, t) => e[0] - t[0]), c = Qa(e.edges), l = 56 + Math.min(260, c.w), u = [], d = 0;
	for (let [, e] of s) {
		let t = Math.max(...e.map((e) => Y(e).h)), n = -(e.reduce((e, t) => e + Y(t).w, 0) + l * Math.max(0, e.length - 1)) / 2;
		e.forEach((e) => {
			let r = Y(e).w;
			u.push({
				id: e.id,
				position: {
					x: n + r / 2,
					y: d + t / 2
				}
			}), n += r + l;
		}), d += t + 72 + c.h;
	}
	let f = u.reduce((e, t) => ({
		x: e.x + t.position.x / u.length,
		y: e.y + t.position.y / u.length
	}), {
		x: 0,
		y: 0
	});
	u.forEach((n) => t(n.id, {
		x: e.origin.x + n.position.x - f.x,
		y: e.origin.y + n.position.y - f.y
	}));
}
function ro(e) {
	let t = new Map(e.nodes.map((e) => [e.id, e])), n = new Map(e.nodes.map((e) => [e.id, 0])), r = /* @__PURE__ */ new Map();
	e.edges.forEach((e) => {
		let i = t.get(e.To);
		if (!i || !t.has(e.From)) return;
		n.set(e.To, (n.get(e.To) ?? 0) + 1);
		let a = r.get(e.From) ?? [];
		a.some((e) => e.id === i.id) || a.push(i), r.set(e.From, a);
	});
	let i = e.nodes.filter((e) => (n.get(e.id) ?? 0) === 0), a = [], o = /* @__PURE__ */ new Set(), s = (e, t) => {
		o.has(e.id) || (o.add(e.id), a.push({
			node: e,
			depth: t
		}), (r.get(e.id) ?? []).forEach((e) => s(e, t + 1)));
	};
	return i.forEach((e) => s(e, 0)), e.nodes.forEach((e) => s(e, 0)), a;
}
var io = (e, t, n) => {
	if (!t.length) return;
	let r = t.reduce((e, n) => ({
		x: e.x + n.position.x / t.length,
		y: e.y + n.position.y / t.length
	}), {
		x: 0,
		y: 0
	});
	t.forEach((t) => n(t.id, {
		x: e.origin.x + t.position.x - r.x,
		y: e.origin.y + t.position.y - r.y
	}));
};
function ao(e, t) {
	if (to(e, t)) return;
	let n = ro(e), r = Math.max(210, Math.max(...e.nodes.map((e) => Y(e).w), 0) + 56), i = [], a = 0;
	n.forEach(({ node: e, depth: t }) => {
		let n = Y(e);
		i.push({
			id: e.id,
			position: {
				x: t * r,
				y: a + n.h / 2
			}
		}), a += n.h + 24;
	}), io(e, i, t);
}
function oo(e, t) {
	if (to(e, t)) return;
	let n = ro(e), r = Math.max(136, Math.max(...e.nodes.map((e) => Y(e).h), 0) + 72), i = [], a = 0;
	n.forEach(({ node: e, depth: t }) => {
		let n = Y(e);
		i.push({
			id: e.id,
			position: {
				x: a + n.w / 2,
				y: t * r
			}
		}), a += n.w + 36;
	}), io(e, i, t);
}
function so(e, t) {
	let n = Math.max(1, Math.ceil(Math.sqrt(e.nodes.length))), r = Math.ceil(e.nodes.length / n), i = Math.max(...e.nodes.map((e) => Y(e).w), 0), a = Math.max(...e.nodes.map((e) => Y(e).h), 0), o = Qa(e.edges), s = i + 56 + Math.min(260, o.w), c = a + 72 + o.h, l = e.origin.x - (n - 1) * s / 2, u = e.origin.y - (r - 1) * c / 2;
	e.nodes.forEach((e, r) => {
		let i = r % n, a = Math.floor(r / n);
		t(e.id, {
			x: l + i * s,
			y: u + a * c
		});
	});
}
var co = (e, t) => (t ? e.nodes.find((e) => e.id === t) : void 0) ?? e.nodes[0];
function lo(e, t, n) {
	if (!e.nodes.length) return;
	let r = co(e, t), i = e.nodes.filter((e) => e.id !== r.id), a = i.reduce((e, t) => e + Y(t).w + 56, 0), o = Math.max(Y(r).w, Y(r).h) / 2, s = Qa(e.edges), c = Math.max(160, 60 + i.length * 22, a / (2 * Math.PI) + o + s.h + s.w / 2), l = r.Position ?? e.origin;
	i.forEach((e, t) => {
		let r = t / Math.max(1, i.length) * Math.PI * 2 - Math.PI / 2;
		n(e.id, {
			x: l.x + Math.cos(r) * c,
			y: l.y + Math.sin(r) * c
		});
	});
}
var uo = (e, t) => {
	let n = e.nodes.flatMap((e) => {
		let n = t.get(e.id);
		if (!n) return [];
		let r = Y(e);
		return [{
			id: e.id,
			rect: {
				x: n.x - r.w / 2,
				y: n.y - r.h / 2,
				w: r.w,
				h: r.h
			}
		}];
	}), r = new Map(n.map((e) => [e.id, e.rect])), i = Ge(n), a = new Map(e.nodes.map((e) => [e.id, e])), o = e.edges.flatMap((e) => {
		let n = e.Label?.text?.trim(), o = t.get(e.From), s = t.get(e.To), c = a.get(e.From), l = a.get(e.To), u = r.get(e.From), d = r.get(e.To);
		if (!n || !o || !s || !c || !l || !u || !d) return [];
		let f = Y(c), p = Y(l), m = Je(s, o, {
			w: f.w / 2,
			h: f.h / 2
		}), h = Je(o, s, {
			w: p.w / 2,
			h: p.h / 2
		}), g = Ke(i, wi(n, m, h, e.id).rect, 480).map((e) => e.rect);
		return [{ rect: wi(n, m, h, e.id, g).rect }];
	}), s = 0;
	o.forEach((e) => {
		Ke(i, e.rect, 8).forEach((t) => {
			He(e.rect, t.rect, 8) && s++;
		});
	});
	let c = Ge([]);
	return o.forEach((e) => {
		Ke(c, e.rect, 10).forEach((t) => {
			He(e.rect, t.rect, 10) && s++;
		}), We(c, e);
	}), s;
}, fo = (e, t, n, r) => {
	let i = uo(e, t);
	for (let a = 0; i > 0 && a < 10; a++) {
		let a = 1.12;
		[...n].forEach((e, i) => {
			let o = t.get(e);
			if (!o) return;
			let s = o.x - r.x, c = o.y - r.y;
			if (Math.abs(s) + Math.abs(c) < .01 && n.size > 1) {
				let e = i / n.size * Math.PI * 2;
				s = Math.cos(e) * 4, c = Math.sin(e) * 4;
			}
			t.set(e, {
				x: r.x + s * a,
				y: r.y + c * a
			});
		}), i = uo(e, t);
	}
}, po = (e, t, n, r) => {
	let i = new Map(e.nodes.flatMap((e) => e.Position ? [[e.id, { ...e.Position }]] : [])), a = /* @__PURE__ */ new Set();
	t(e, (e, t) => {
		i.set(e, t), a.add(e);
	}), a.size && (fo(e, i, a, (r ? i.get(r) : void 0) ?? [...a].reduce((e, t) => {
		let n = i.get(t);
		return {
			x: e.x + n.x / a.size,
			y: e.y + n.y / a.size
		};
	}, {
		x: 0,
		y: 0
	})), a.forEach((e) => n(e, i.get(e))));
};
//#endregion
//#region canvas/systems/layout.ts
function mo(e) {
	e("layout", (e) => {
		let { on: t, emit: n, contexts: r, graphs: i, selection: a } = e, o = () => {}, s = (e) => e === "vertical" || e === "horizontal" || e === "tree" || e === "radial", c = (e) => e?.version === 1 && s(e.kind) ? e.kind : "tree", l = Yn((e) => i.get(e) ?? i.current, {
			key: "layoutStyle",
			create: (e) => ({ kind: c(e.snapshotExtension("layoutStyle")) }),
			serialize: (e) => ({
				version: 1,
				kind: e.kind
			}),
			restore: (e, t) => {
				e.kind = c(t), queueMicrotask(o);
			}
		}), u = (e) => l.of(e), d = () => u(i.current.id).kind, f = (e) => i.current.edges().filter((t) => t.From === e).length, p = (e) => e === 0 ? 0 : e % 2 ? Math.ceil(e / 2) : -e / 2;
		e.expose("layout", {
			active: d,
			creation: (e, t) => {
				let n = e ? i.current.getNode(e) : void 0;
				if (!n?.Position) return {};
				let r = n.id, a = Y(n), o = {
					w: 150,
					h: 64
				}, s = f(r), c = p(s), l = { relativeTo: r };
				switch (d()) {
					case "vertical": return t ? {
						...l,
						Position: {
							x: n.Position.x + a.w / 2 + 56 + o.w / 2,
							y: n.Position.y + c * (o.h + 24)
						},
						connectFrom: r,
						keepFocus: !0
					} : {
						...l,
						Position: {
							x: n.Position.x,
							y: n.Position.y + a.h / 2 + 24 + o.h / 2
						}
					};
					case "horizontal": return t ? {
						...l,
						Position: {
							x: n.Position.x + c * (o.w + 36),
							y: n.Position.y + a.h / 2 + 72 + o.h / 2
						},
						connectFrom: r,
						keepFocus: !0
					} : {
						...l,
						Position: {
							x: n.Position.x + a.w / 2 + 36 + o.w / 2,
							y: n.Position.y
						}
					};
					case "radial": {
						let e = -Math.PI / 2 + s * 2.399963229728653, i = Math.max(220, Math.max(a.w, a.h) / 2 + 150);
						return {
							...l,
							Position: {
								x: n.Position.x + Math.cos(e) * i,
								y: n.Position.y + Math.sin(e) * i
							},
							connectFrom: r,
							...t ? { keepFocus: !0 } : {}
						};
					}
					default: return {
						...l,
						Position: {
							x: n.Position.x + c * (o.w + 56),
							y: n.Position.y + a.h / 2 + 72 + o.h / 2
						},
						connectFrom: r,
						...t ? { keepFocus: !0 } : {}
					};
				}
			}
		}), r.commands.register([
			{
				id: "layout.apply.vertical",
				label: "Use vertical nested-list layout",
				group: "layout",
				event: "layout.fit",
				input: {
					on: "keydown",
					key: "v",
					prevent: !0
				},
				payload: () => ({ kind: "vertical" })
			},
			{
				id: "layout.apply.horizontal",
				label: "Use horizontal nested-list layout",
				group: "layout",
				event: "layout.fit",
				input: {
					on: "keydown",
					key: "h",
					prevent: !0
				},
				payload: () => ({ kind: "horizontal" })
			},
			{
				id: "layout.apply.tree",
				label: "Use top-down tree layout",
				group: "layout",
				event: "layout.fit",
				input: {
					on: "keydown",
					key: "t",
					prevent: !0
				},
				payload: () => ({ kind: "tree" })
			},
			{
				id: "layout.apply.radial",
				label: "Use radial map layout",
				group: "layout",
				event: "layout.fit",
				input: {
					on: "keydown",
					key: "r",
					prevent: !0
				},
				payload: () => ({ kind: "radial" })
			},
			{
				id: "layout.apply.grid",
				label: "Grid layout (legacy)",
				group: "layout",
				event: "layout.fit",
				hidden: !0,
				input: {
					on: "keydown",
					key: "G",
					shift: !0,
					prevent: !0
				},
				payload: () => ({ kind: "grid" })
			},
			{
				id: "layout.apply.tidy",
				label: "Tree layout (legacy Tidy)",
				group: "layout",
				event: "layout.fit",
				hidden: !0,
				payload: () => ({ kind: "tree" })
			}
		]);
		let m = {
			vertical: ["Create node below — next vertical item", "Create connected child node right — vertical branch"],
			horizontal: ["Create node right — next horizontal item", "Create connected child node below — horizontal branch"],
			tree: ["Create node below — continue tree child", "Create sibling branch node — keep parent selected"],
			radial: ["Create node outward — radial drill-down", "Create spoke node — keep hub selected"]
		};
		o = () => {
			let e = m[d()], t = r.commands.get("editing.node.create"), i = r.commands.get("editing.node.create.keep");
			t && (t.label = e[0]), i && (i.label = e[1]), n("affordance.contributed", { surface: "top" });
		};
		let h = (e) => {
			let t = u(i.current.id);
			t.kind = e, o(), n("layout.mode.changed", { kind: e });
		}, g = (e, t) => n("item.update", {
			ref: B(e),
			patch: { Position: t }
		}), _ = (t) => {
			let r = e.graphs.current.getItem({
				kind: "container",
				id: t
			});
			if (!r?.Children?.length) return;
			let i = r.Children.filter((e) => e.kind === "container").map((t) => {
				let n = e.graphs.current.getItem(t), r = n && e.model.entity(t.kind)?.render?.bounds?.(n);
				return n && r ? {
					ref: t,
					item: n,
					size: {
						w: r.w,
						h: r.h
					}
				} : null;
			}).filter((e) => !!e);
			if (!i.length) return;
			let a = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(i.length)))), o = Math.ceil(i.length / a), s = Array.from({ length: a }, () => 0), c = Array.from({ length: o }, () => 0);
			i.forEach((e, t) => {
				let n = t % a, r = Math.floor(t / a);
				s[n] = Math.max(s[n], e.size.w), c[r] = Math.max(c[r], e.size.h);
			});
			let l = r.Children.filter((e) => e.kind === "node").map((t) => {
				let n = e.graphs.current.getNode(t.id);
				return n?.Position ? n.Position.y + n.Size.h / 2 : -Infinity;
			}).reduce((e, t) => Math.max(e, t), -Infinity), u = s.reduce((e, t) => e + t, 0) + 56 * Math.max(0, a - 1), d = (r.Position?.x ?? 0) - u / 2, f = Number.isFinite(l) ? l + 72 : r.Position?.y ?? 0, p = c.map((e) => {
				let t = f;
				return f += e + 72, t;
			}), m = [], h = d;
			s.forEach((e) => {
				m.push(h), h += e + 56;
			}), i.forEach((e, t) => {
				let r = t % a, i = Math.floor(t / a);
				n("item.update", {
					ref: e.ref,
					patch: { Position: {
						x: m[r] + e.size.w / 2,
						y: p[i] + e.size.h / 2
					} }
				});
			});
		}, v = () => {
			let t = e.graphs.current.nodes().filter((e) => !!e.Position);
			if (!t.length) return;
			let i = Math.min(...t.map((e) => e.Position.y - Y(e).h / 2)), a = Math.max(...t.map((e) => e.Position.y + Y(e).h / 2)), o = Math.max(...t.map((e) => e.Position.x + Y(e).w / 2)) + 56;
			e.graphs.current.itemsOfKind("container").filter((e) => !e.Children?.length && !r.hierarchy.parentRefOf({
				kind: "container",
				id: e.id
			})).forEach((e) => {
				let t = e.Size ?? {
					w: 220,
					h: 150
				};
				n("item.update", {
					ref: {
						kind: "container",
						id: e.id
					},
					patch: { Position: {
						x: o + t.w / 2,
						y: (i + a) / 2
					} }
				}), o += t.w + 56;
			});
		};
		t("layout.apply.vertical", () => {
			h("vertical"), Xa(e).forEach((e) => po(e, ao, g));
		}), t("layout.apply.horizontal", () => {
			h("horizontal"), Xa(e).forEach((e) => po(e, oo, g));
		}), t("layout.apply.tree", () => {
			h("tree"), Xa(e).forEach((e) => po(e, no, g));
		}), t("layout.apply.tidy", () => {
			h("tree"), Xa(e).forEach((e) => po(e, no, g));
		}), t("layout.apply.grid", () => Xa(e).forEach((e) => po(e, so, g))), t("layout.apply.sections", ({ id: t }) => {
			let n = Xa(e).find((e) => e.parent?.kind === "container" && e.parent.id === t);
			n && po(n, to, g), _(t);
		}), t("layout.apply.radial", () => {
			h("radial");
			let t = a.focusedNode()?.id ?? a.selectedNode()?.id;
			Xa(e).forEach((e) => {
				let n = co(e, t)?.id;
				po(e, (e, n) => lo(e, t, n), g, n);
			});
		}), t("layout.fit", ({ kind: t }) => {
			n({
				vertical: "layout.apply.vertical",
				horizontal: "layout.apply.horizontal",
				tree: "layout.apply.tree",
				tidy: "layout.apply.tidy",
				grid: "layout.apply.grid",
				radial: "layout.apply.radial"
			}[t]), e.graphs.current.itemsOfKind("container").map((e) => ({
				id: e.id,
				depth: r.hierarchy.parentChain({
					kind: "container",
					id: e.id
				}).length
			})).sort((e, t) => t.depth - e.depth).forEach((e) => _(e.id)), v(), n("view.fit.all");
		}), t("graph.switched", ({ id: e }) => {
			u(e), o(), n("layout.mode.changed", { kind: d() });
		}), t("graph.deleted", ({ id: e }) => {
			l.forget(e);
		}), t("app.start", () => {
			u(i.current.id), o();
		});
	}, { requires: ["graph"] });
}
//#endregion
//#region canvas/systems/main.ts
var ho = "shell.zen";
function go(e) {
	e("main", ({ on: e, emit: t, contexts: n, origin: r, contribute: i }) => {
		n.interaction.cancel.register({
			origin: r,
			background: !1,
			active: () => n.fold.folded(ho),
			cancel: () => n.fold.set(ho, !0)
		});
		let a = () => v((e) => n.places.el(e)), o = () => {
			let e = a();
			e && (e.dataset.zen = n.fold.folded(ho) ? "true" : "false");
		};
		n.commands.register([{
			id: "canvas.select",
			label: "Select mode",
			group: "view"
		}, {
			id: "view.zen",
			label: "Toggle zen mode",
			event: "fold.toggle",
			group: "view",
			shortcut: "\\",
			input: {
				on: "keydown",
				key: "\\",
				prevent: !0
			},
			payload: () => ({ id: ho })
		}]), e("canvas.select", () => n.interaction.cancel.cancelPointerModes()), e("app.start", () => {
			t("render.shell"), o();
		}), e("fold.changed", ({ id: e }) => {
			e === ho && o();
		});
	}, { requires: ["render"] });
}
//#endregion
//#region canvas/systems/marquee.ts
function _o(t) {
	t("marquee", ({ on: t, emit: n, contexts: r, graphs: i, model: a, selection: o }) => {
		let s = r.interaction.pointer, c = `[data-place="${e.Stage}"]`, l = null, d = !1, f = null, p = !1, m = null, h = () => r.places.el(e.Stage), g = () => {
			f?.remove(), f = null, l = null, p = !1, h()?.classList.remove("marquee-active");
		}, _ = (t) => {
			let n = h();
			if (!n || !l) return;
			let i = r.view.clientToScreen(e.Stage, l), a = r.view.clientToScreen(e.Stage, t);
			f || (f = u(".select-marquee"), n.append(f), n.classList.add("marquee-active")), f.style.left = `${Math.min(i.x, a.x)}px`, f.style.top = `${Math.min(i.y, a.y)}px`, f.style.width = `${Math.abs(i.x - a.x)}px`, f.style.height = `${Math.abs(i.y - a.y)}px`;
		};
		return r.commands.register([
			{
				id: "select.box.start",
				label: "Start box selection",
				event: "select.box.start",
				group: "selection",
				hidden: !0,
				input: {
					on: "pointerdown",
					selector: c,
					when: (e, t) => {
						let n = e;
						return !r.interaction.cancel.blocksPointer() && In(e, t) && n.isPrimary && n.button === 0 && !s.isMoveIntent(n);
					},
					prevent: !0,
					stop: !0
				},
				payload: ({ event: e }) => ({
					point: Fn(e),
					add: e.shiftKey
				})
			},
			{
				id: "select.box.move",
				label: "Extend box selection",
				event: "select.box.move",
				group: "selection",
				hidden: !0,
				input: {
					on: "pointermove",
					when: () => !!l,
					prevent: !0
				},
				payload: ({ event: e }) => Fn(e)
			},
			{
				id: "select.box.end",
				label: "Commit box selection",
				event: "select.box.end",
				group: "selection",
				hidden: !0,
				input: {
					on: "pointerup",
					when: () => !!l
				},
				payload: ({ event: e }) => Fn(e)
			}
		]), t("select.box.start", ({ point: e, add: t }) => {
			l = e, d = t, p = !1, m = null;
		}), t("select.box.move", (e) => {
			l && (m = e, p ||= Math.abs(e.x - l.x) + Math.abs(e.y - l.y) > 4, p && _(e));
		}), t("select.box.end", (t) => {
			let o = l, s = !!o && Math.abs(t.x - o.x) + Math.abs(t.y - o.y) > 4, c = p || s, u = f?.getBoundingClientRect(), h = m;
			if (g(), !o) return;
			if (!c) {
				d || n("canvas.tapped", { point: o });
				return;
			}
			let _ = u && u.width + u.height > 0 ? [{
				x: u.left,
				y: u.top
			}, {
				x: u.right,
				y: u.bottom
			}] : [o, h ?? t], v = r.view.clientToSpace(e.Stage, _[0]), y = r.view.clientToSpace(e.Stage, _[1]), b = {
				x: Math.min(v.x, y.x),
				y: Math.min(v.y, y.y),
				w: Math.abs(v.x - y.x),
				h: Math.abs(v.y - y.y)
			}, x = [...i.current.nodes().filter((e) => e.Position && Nn(b, Pn(e))).map((e) => B(e.id)), ...i.current.itemsOfKind("container").filter((e) => {
				let t = a.entity("container")?.render?.bounds?.(e);
				return !!t && Nn(b, t);
			}).map((e) => ({
				kind: "container",
				id: e.id
			}))];
			x.length ? n("selection.choose", {
				refs: x,
				mode: d ? "add" : "replace"
			}) : d || n("selection.item.clear");
		}), t("select.box.cancel", g), g;
	}, { requires: ["render", "graph"] });
}
//#endregion
//#region canvas/systems/modal.ts
function vo(t) {
	t("modal", ({ on: t, emit: n, contexts: r, origin: i, frameLoop: a }) => {
		let o = !1, s = null, c, l = null, f = (t) => {
			let n = r.places.el(e.Modal);
			[...n?.parentElement?.children ?? []].forEach((e) => {
				e === n || !(e instanceof HTMLElement) || (t ? (e.setAttribute("inert", ""), e.setAttribute("aria-hidden", "true")) : (e.removeAttribute("inert"), e.removeAttribute("aria-hidden")));
			});
		};
		return r.commands.register([{
			id: "modal.close",
			label: "Close modal",
			group: "modal"
		}, {
			id: "modal.tab",
			label: "Keep focus in the modal",
			group: "modal",
			hidden: !0,
			input: {
				on: "keydown",
				key: "Tab",
				global: !0,
				prevent: !0,
				stop: !0,
				when: (e) => o && !!e.target?.closest(".modal")
			},
			payload: ({ event: e }) => ({ shift: e.shiftKey })
		}]), r.interaction.cancel.register({
			origin: i,
			active: () => o,
			cancel: () => n("modal.close")
		}), t("modal.close", () => {
			o = !1, f(!1), n("render.view.clear", {
				place: e.Modal,
				key: "modal"
			}), n("modal.closed");
			let t = s;
			s = null, queueMicrotask(() => {
				((t?.closest("details:not([open])"))?.querySelector("summary") ?? t)?.focus({ preventScroll: !0 });
			});
		}), t("modal.tab", ({ shift: t }) => {
			let n = r.places.el(e.Modal)?.querySelector(".modal"), i = Array.from(n?.querySelectorAll("button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex=\"-1\"])") ?? []).filter((e) => e.getClientRects().length > 0 && !e.closest("[hidden], [inert]"));
			if (!i.length) return;
			let a = i.indexOf(document.activeElement);
			i[a < 0 ? t ? i.length - 1 : 0 : (a + (t ? -1 : 1) + i.length) % i.length]?.focus({ preventScroll: !0 });
		}), t("modal.open", ({ title: t = "Modal", titleView: i, body: a, visual: c = "panel" }) => {
			o || (s = document.activeElement instanceof HTMLElement ? document.activeElement : null), o = !0, f(!0);
			let l = a;
			n("render.view.set", {
				place: e.Modal,
				key: "modal",
				view: () => {
					let e = r.templates.clone("modal");
					e.dataset.visual = c;
					let n = e.querySelector("[data-text=\"title\"]");
					return i && n ? (n.textContent = "", d(n, i)) : r.templates.text(e, "title", t), l && d(r.templates.slot(e, "body"), l), e;
				}
			}), queueMicrotask(() => {
				let t = r.places.el(e.Modal);
				(t?.querySelector("[autofocus]") ?? t?.querySelector("button[data-command=\"modal.close\"]") ?? t?.querySelector("input:not([type=\"hidden\"]):not([disabled]), textarea, select"))?.focus();
			});
		}), t("app.notice", ({ message: t, level: r = "info" }) => {
			l = {
				message: t,
				level: r
			}, a.schedule("modal.notice", () => {
				let t = l;
				if (l = null, !t) return;
				c && clearTimeout(c);
				let r = u("div.app-notice", {
					class: `app-notice-${t.level}`,
					text: t.message,
					role: t.level === "error" ? "alert" : "status",
					"aria-live": t.level === "error" ? "assertive" : "polite"
				});
				n("render.view.set", {
					place: e.Modal,
					key: "notice",
					view: r
				}), c = setTimeout(() => n("render.view.clear", {
					place: e.Modal,
					key: "notice"
				}), 3200);
			}, 30);
		}), () => {
			a.cancel("modal.notice"), c && clearTimeout(c);
		};
	}, { requires: ["render"] });
}
//#endregion
//#region canvas/systems/item-toolbar-view.ts
var yo = [
	{
		id: "text",
		glyph: "T"
	},
	{
		id: "square",
		glyph: "▭"
	},
	{
		id: "circle",
		glyph: "◯"
	},
	{
		id: "diamond",
		glyph: "◇"
	},
	{
		id: "service",
		glyph: "▤"
	},
	{
		id: "database",
		glyph: "▥"
	}
], bo = ({ contexts: n, graphs: r, itemMenuStyle: i, lastPointer: a, model: o, openMenu: s, selection: c }) => {
	let l = (e, t, i, a) => {
		let o = i.command === "item.collapse.toggle" && n.fold.folded(U(a, r.current.id)), s = i.command === "item.collapse.toggle", c = s ? o ? "Maximize item" : "Minimize item" : tr(i.label, e, t.label), l = u("button", {
			type: "button",
			text: s ? o ? "⊞" : "⊟" : tr(i.text, e, t.label),
			title: c,
			"aria-label": c,
			class: i.className,
			data: { command: i.command }
		});
		return Object.entries(i.attrs ?? {}).forEach(([t, n]) => l.setAttribute(t, tr(n, e))), l;
	}, d = (r, i, o) => {
		let s = u(".item-toolbar.node-toolbar");
		m(s, o);
		let c = r.render, d = i.Position ?? n.hierarchy.anchor(o) ?? {
			x: 0,
			y: 0
		}, f = i.Size ?? {
			w: 0,
			h: 0
		}, p = c?.bounds?.(i) ?? {
			x: d.x - f.w / 2,
			y: d.y - f.h / 2,
			w: f.w,
			h: f.h
		}, h = n.view.spaceToScreen({
			x: p.x + p.w / 2,
			y: p.y
		}), g = n.places.el(e.Stage), _ = g?.getBoundingClientRect(), v = _?.width || window.innerWidth, y = n.places.el(e.Left)?.getBoundingClientRect(), b = y && y.width > 0 ? y.right + 44 : 0, x = n.places.el(e.Right)?.getBoundingClientRect(), S = v > 680 && x && x.width > 0 ? Math.max(b, x.left - (_?.left ?? 0) - 44) : v;
		if (o.kind === "edge") {
			let e = (g?.querySelector(`.edge-label-host[data-item-id="${o.id}"]`))?.getBoundingClientRect();
			if (e && _) {
				let t = _.right - e.right, n = e.left - _.left - 8, r = e.top - _.top, i = e.top - _.top + e.height / 2;
				v > 680 && t >= 120 ? (s.dataset.edgeToolbarPlacement = "right", h = {
					x: e.right - _.left + 8,
					y: i
				}) : v > 680 && n - 112 >= b ? (s.dataset.edgeToolbarPlacement = "left", h = {
					x: n,
					y: i
				}) : r >= 44 ? (s.dataset.edgeToolbarPlacement = "above", h = {
					x: e.left - _.left + e.width / 2,
					y: e.top - _.top
				}) : (s.dataset.edgeToolbarPlacement = "below", h = {
					x: e.left - _.left + e.width / 2,
					y: e.bottom - _.top
				});
			}
		}
		if (o.kind !== "edge" && a && _) {
			let e = {
				x: a.x - _.left,
				y: a.y - _.top
			}, t = n.view.spaceToScreen({
				x: p.x + p.w / 2,
				y: p.y + p.h
			}).y;
			if (e.x >= h.x - p.w / 2 - 120 && e.x <= h.x + p.w / 2 + 120 && e.y >= h.y - 120 && e.y <= t + 120) {
				let n = h.x, r = e.y > (h.y + t) / 2;
				r && (s.dataset.edgeToolbarPlacement = "below"), h = {
					x: e.x,
					y: r ? t : h.y
				}, s.style.setProperty("--toolbar-tether", `${W(n - e.x, -64, 64)}px`);
			}
		}
		let C = v <= 680 ? 104 : 88;
		o.kind !== "edge" && h.y - 44 < C && (s.dataset.edgeToolbarPlacement = "below", h = {
			x: h.x,
			y: n.view.spaceToScreen({
				x: p.x,
				y: p.y + p.h
			}).y
		}), s.style.left = `${W(h.x, b, S)}px`, s.style.top = `${Math.max(h.y, s.dataset.edgeToolbarPlacement === "below" ? 0 : C)}px`;
		let w = (e) => {
			n.affordances.entity(r, e).forEach(({ action: e, ui: t }) => {
				t.when && !t.when(i) || t.kind === "button" && s.append(l(i, e, t, o));
			});
		};
		if (w(t.HeaderStart), w(t.HeaderEnd), o.kind === "node" || o.kind === "container") {
			let e = u("button.node-action.node-remove", {
				type: "button",
				title: `Delete ${o.kind}`,
				"aria-label": `Delete ${o.kind}`,
				data: { command: o.kind === "node" ? "graph.node.delete" : "graph.container.delete" }
			});
			bn(e, "trash"), s.append(e);
		}
		return s;
	}, f = (e, t) => {
		let i = [
			{
				command: "item.title.edit",
				glyph: "Aa",
				icon: "text",
				label: "Rename",
				section: "Edit"
			},
			{
				command: "item.description.edit",
				glyph: "¶",
				icon: "text",
				label: "Edit description",
				section: "Edit"
			},
			{
				command: "item.properties.open",
				glyph: "⋯",
				icon: "more",
				label: "Details",
				section: "Edit"
			},
			...e.kind !== "edge" && (n.hierarchy.parentRefOf(e) || r.current.itemsOfKind("container").some((t) => t.id !== e.id)) ? [{
				command: "container.add-child",
				glyph: "↳",
				icon: "move-out",
				label: "Move into",
				section: "Structure"
			}] : []
		], a = e.kind === "node" ? [
			...r.current.getNode(e.id)?.NodeType === "toggle" ? [{
				command: "node.toggle.state",
				glyph: "◉",
				icon: "toggle",
				label: r.current.getNode(e.id)?.ToggleState ? "Turn off" : "Turn on",
				section: "State"
			}] : [],
			{
				command: "item.action.add",
				glyph: "+",
				icon: "node",
				label: "Add connected",
				section: "Structure"
			},
			{
				command: "editing.edge.create",
				glyph: "↗",
				icon: "connect",
				label: "Connect",
				section: "Structure"
			},
			{
				command: "node.convert.container",
				glyph: "▣",
				icon: "container",
				label: "To container",
				section: "Structure"
			},
			{
				command: "item.collapse.toggle",
				glyph: "−",
				icon: "collapse",
				label: "Fold",
				section: "Structure"
			},
			...Nt.map((t) => ({
				command: `node.status.${t}`,
				glyph: "●",
				icon: t === "done" ? "check" : "circle",
				label: Pt[t],
				section: "Status",
				active: r.current.getNode(e.id)?.Status === t
			}))
		] : e.kind === "edge" ? [{
			command: "graph.edge.reverse",
			glyph: "⇄",
			icon: "reverse",
			label: "Reverse",
			section: "Structure"
		}] : [
			{
				command: "editing.node.create",
				glyph: "+",
				icon: "node",
				label: "Add node",
				section: "Structure"
			},
			{
				command: "container.convert.node",
				glyph: "□",
				icon: "node",
				label: "To node",
				section: "Structure"
			},
			{
				command: "item.collapse.toggle",
				glyph: "−",
				icon: "collapse",
				label: "Fold",
				section: "Structure"
			}
		];
		return [
			...i,
			...a,
			{
				command: "selection.item.delete",
				glyph: "×",
				icon: "trash",
				label: "Delete",
				section: "Danger",
				danger: !0
			}
		].filter((e) => {
			if (e.command === "editing.edge.create" && r.current.nodes().length < 2) return !1;
			let i = n.commands.get(e.command);
			return !!i && n.commands.isEnabled(i) && i.available?.({
				target: t,
				origin: "pointer"
			}) !== !1;
		});
	}, p = (t, r, i = 236, a = 420) => {
		let o = n.places.el(e.Stage)?.getBoundingClientRect(), s = o?.width || window.innerWidth, c = o?.height || window.innerHeight;
		return {
			x: W(t - (o?.left ?? 0), 8, Math.max(8, s - i - 8)),
			y: W(r - (o?.top ?? 0), 8, Math.max(8, c - Math.min(a, c - 16) - 8))
		};
	}, h = (e) => u("button.context-command-item", {
		type: "button",
		class: e.danger ? "danger" : void 0,
		role: "menuitem",
		tabIndex: -1,
		"aria-label": e.label,
		"aria-current": e.active ? "true" : void 0,
		data: {
			command: "item.action.run",
			actionCommand: e.command,
			interactionCost: e.command === "editing.edge.create" || e.command === "container.add-child" ? "3" : "2",
			active: e.active === void 0 ? void 0 : e.active ? "true" : "false"
		}
	}, [
		u("span.context-command-icon", [yn(e.icon)]),
		u("span.context-command-label", { text: e.label }),
		u("kbd", { text: at(n.commands, e.command) ?? "" })
	]), g = (e, t, n, r, i) => {
		let a = u("div.context-command-menu", {
			class: i ? "item-action-menu" : "canvas-action-menu",
			role: "menu",
			"aria-label": t
		});
		i && m(a, i);
		let o = p(n, r, i ? 236 : 252, i ? 420 : 390);
		a.style.left = `${o.x}px`, a.style.top = `${o.y}px`;
		let s = /* @__PURE__ */ new Map();
		return e.forEach((e) => (s.get(e.section) ?? s.set(e.section, []).get(e.section)).push(e)), s.forEach((e, t) => {
			let n = u("section.context-command-group", { class: t === "Danger" ? "danger" : void 0 }, [u("h3", { text: t }), ...e.map(h)]);
			a.append(n);
		}), a;
	}, _ = (t, r, i, a = !1) => {
		let o = n.places.el(e.Stage)?.getBoundingClientRect(), s = n.hierarchy.anchor(t), c = s ? n.view.spaceToScreen(s) : n.view.screenCenter(e.Stage), l = {
			x: r == null ? c.x : r - (o?.left ?? 0),
			y: i == null ? c.y : i - (o?.top ?? 0)
		}, u = o?.width || window.innerWidth, d = o?.height || window.innerHeight, f = a ? 190 : 118, p = a ? 170 : 138;
		return {
			x: u < f * 2 ? u / 2 : W(l.x, f, u - f),
			y: d < p * 2 + 40 ? d / 2 : W(l.y, p, d - p - 16)
		};
	}, v = (e, t, n) => {
		let i = r.current.getItem(e), a = o.entity(e.kind);
		if (!i || !a) return document.createDocumentFragment();
		let s = u(".item-action-wheel", {
			role: "menu",
			"aria-label": `${a.labelOf(i)} actions`
		});
		m(s, e);
		let c = f(e, s), l = c.filter((e) => e.section !== "Status"), d = c.filter((e) => e.section === "Status"), p = _(e, t, n, d.length > 0);
		s.style.left = `${p.x}px`, s.style.top = `${p.y}px`;
		let h = l.length > 4 ? 88 : 78;
		l.forEach((e, t) => {
			let n = -Math.PI / 2 + t * (Math.PI * 2 / l.length), r = u("button.item-action-choice", {
				type: "button",
				class: e.danger ? "danger" : void 0,
				"aria-label": e.label,
				role: "menuitem",
				data: {
					command: "item.action.run",
					actionCommand: e.command
				}
			}, [u("b", { text: e.glyph }), u("span", { text: e.label })]);
			r.dataset.interactionCost = e.command === "editing.edge.create" || e.command === "container.add-child" ? "3" : "2", r.style.setProperty("--wheel-x", `${Math.cos(n) * h}px`), r.style.setProperty("--wheel-y", `${Math.sin(n) * h}px`), r.tabIndex = -1, s.append(r);
		}), d.forEach((e, t) => {
			let n = -Math.PI / 2 + (t + .5) * (Math.PI * 2 / d.length), r = u("button.item-action-choice.item-action-status", {
				type: "button",
				"aria-label": `Set status: ${e.label}`,
				"aria-current": e.active ? "true" : void 0,
				role: "menuitem",
				data: {
					command: "item.action.run",
					actionCommand: e.command,
					status: e.command.slice(12)
				}
			}, [u("i"), u("span", { text: e.label })]);
			r.dataset.interactionCost = "2", r.style.setProperty("--wheel-x", `${Math.cos(n) * 150}px`), r.style.setProperty("--wheel-y", `${Math.sin(n) * 150}px`), r.tabIndex = -1, s.append(r);
		});
		let g = u("button.item-action-center", {
			type: "button",
			"aria-label": "Close item actions",
			data: { command: "item.action.close" }
		}, [u("span", { text: "Done" })]), v = u("button.item-action-style-toggle", {
			type: "button",
			text: "List view",
			"aria-label": "Use list context menu",
			data: { command: "item.action.style.toggle" }
		});
		return s.append(g, v), s;
	}, y = (t, i, a) => {
		let s = r.current.getItem(t), c = o.entity(t.kind);
		if (!s || !c) return document.createDocumentFragment();
		let l = n.hierarchy.anchor(t), d = l ? n.view.spaceToScreen(l) : n.view.screenCenter(e.Stage), p = u("div");
		m(p, t);
		let h = g(f(t, p), `${c.labelOf(s)} actions`, i ?? d.x, a ?? d.y, t);
		n.places.width() <= 680 && h.classList.add("context-command-sheet");
		let _ = u("footer"), v = u("button.context-command-style-toggle", {
			type: "button",
			text: "Use radial menu",
			"aria-label": "Use radial context menu",
			data: { command: "item.action.style.toggle" }
		});
		return _.append(v), h.append(_), h;
	}, b = () => {
		let t = n.places.el(e.Stage), r = [
			{
				command: "palette.place.activate",
				glyph: "+",
				icon: "node",
				label: "Add node",
				section: "Mode",
				active: !!t?.classList.contains("node-placing")
			},
			{
				command: "ink.toggle",
				glyph: "✎",
				icon: "draw",
				label: "Draw mode",
				section: "Mode",
				active: !!t?.classList.contains("ink-drawing")
			},
			{
				command: "canvas.select",
				glyph: "↖",
				icon: "select",
				label: "Select mode",
				section: "Mode",
				active: !n.interaction.cancel.blocksPointer()
			},
			{
				command: "ink.erase.toggle",
				glyph: "⌫",
				icon: "erase",
				label: "Erase canvas items",
				section: "Mode",
				active: !!t?.classList.contains("ink-erasing")
			},
			{
				command: "editing.edge.create",
				glyph: "↗",
				icon: "connect",
				label: "Connect nodes",
				section: "Structure"
			},
			{
				command: "selection.group",
				glyph: "▣",
				icon: "group",
				label: c.selectedAll().length ? "Group selected" : "Create container",
				section: "Structure"
			},
			{
				command: "history.undo",
				glyph: "↶",
				icon: "undo",
				label: "Undo",
				section: "Edit"
			},
			{
				command: "history.redo",
				glyph: "↷",
				icon: "redo",
				label: "Redo",
				section: "Edit"
			},
			{
				command: "view.fit.all",
				glyph: "⌗",
				icon: "fit",
				label: "Fit canvas",
				section: "Edit"
			},
			{
				command: "palette.open",
				glyph: "⌘",
				icon: "commands",
				label: "Commands…",
				section: "Edit"
			}
		];
		return r.push(...yo.filter(({ id: e }) => n.commands.get(`palette.arm.type.${e}`)).map(({ id: e, glyph: t }) => ({
			command: `palette.arm.type.${e}`,
			glyph: t,
			icon: "node",
			label: Wr(e),
			section: "Types"
		}))), r.filter((e) => {
			let r = n.commands.get(e.command);
			return !!r && n.commands.isEnabled(r) && r.available?.({
				target: t ?? void 0,
				origin: "pointer"
			}) !== !1;
		});
	};
	return {
		buildToolbar: d,
		renderOpenMenu: () => {
			if (!s) return document.createDocumentFragment();
			if (s.kind === "canvas") {
				let e = g(b(), "Canvas actions", s.x, s.y);
				return n.places.width() <= 680 && e.classList.add("context-command-sheet"), e;
			}
			return n.places.width() <= 680 || i === "list" ? y(s.ref, s.x, s.y) : v(s.ref, s.x, s.y);
		}
	};
}, xo = 460, So = 12;
function Co(t) {
	t("item.toolbar", ({ on: t, emit: n, contexts: r, graphs: i, model: a, selection: o, origin: s, frameLoop: c }) => {
		let l = null, u = null, d = null, f = null, p = "radial", m = () => n("render.view.clear", {
			place: e.Stage,
			key: "item-toolbar"
		}), h = () => n("render.view.clear", {
			place: e.Stage,
			key: "item-action-wheel"
		}), _ = (e, t) => !!e && e.kind === t.kind && e.id === t.id, v = () => {
			l && (clearTimeout(l.timer), l = null, r.places.el(e.Stage)?.classList.remove("holding-action"));
		}, y = (t = !0) => {
			if (v(), r.places.el(e.Stage)?.classList.remove("context-menu-open"), !d) return;
			d = null, h();
			let n = t ? f : null;
			f = null, n && c.schedule("item.action.restoreFocus.prepare", () => {
				c.schedule("item.action.restoreFocus.commit", () => {
					n?.isConnected && n.focus({ preventScroll: !0 });
				}, 40);
			}, 40);
		}, b = () => bo({
			contexts: r,
			graphs: i,
			itemMenuStyle: p,
			lastPointer: u,
			model: a,
			openMenu: d,
			selection: o
		}), x = 0, S = () => {
			d && (n("render.view.set", {
				place: e.Stage,
				key: "item-action-wheel",
				view: () => b().renderOpenMenu()
			}), c.schedule("item.action.focus.prepare", () => {
				c.schedule("item.action.focus.commit", () => {
					let t = r.places.el(e.Stage)?.querySelector(".item-action-wheel, .context-command-menu"), n = [...t?.querySelectorAll("[role=\"menuitem\"]") ?? []];
					if (!n.length || t?.contains(document.activeElement)) return;
					let i = n[Math.min(x, n.length - 1)];
					n.forEach((e) => {
						e.tabIndex = e === i ? 0 : -1;
					}), i.focus({ preventScroll: !0 });
				}, 45);
			}, 45));
		}, C = ({ ref: t, x: a, y: s }) => {
			v(), i.current.getItem(t) && (f = document.activeElement instanceof HTMLElement ? document.activeElement : null, _(o.selected(), t) || n("selection.item.select", t), d = {
				kind: "item",
				ref: t,
				x: a,
				y: s
			}, x = 0, r.places.el(e.Stage)?.classList.add("context-menu-open"), S());
		}, w = ({ x: t, y: n }) => {
			v(), f = document.activeElement instanceof HTMLElement ? document.activeElement : null, d = {
				kind: "canvas",
				x: t,
				y: n
			}, r.places.el(e.Stage)?.classList.add("context-menu-open"), S();
		};
		r.commands.register([
			{
				id: "item.action.hold.start",
				label: "Start item long press",
				group: "item",
				hidden: !0,
				input: {
					on: "pointerdown",
					selector: "[data-item-kind][data-item-id]",
					when: (e) => {
						let t = e;
						return (t.pointerType === "touch" || r.places.width() <= 680 && t.pointerType !== "mouse") && !e.target.closest(".tool-panel, .item-toolbar, .modal-layer, [data-command], [data-resize-handle], input, textarea, select");
					}
				},
				payload: ({ event: e, target: t }) => {
					let n = e, r = g(t);
					return r ? {
						ref: r,
						x: n.clientX,
						y: n.clientY,
						pointerId: n.pointerId
					} : void 0;
				}
			},
			{
				id: "item.action.hold.move",
				label: "Track item long press",
				group: "item",
				hidden: !0,
				input: {
					on: "pointermove",
					when: () => !!l
				},
				payload: ({ event: e }) => ({
					x: e.clientX,
					y: e.clientY,
					pointerId: e.pointerId
				})
			},
			{
				id: "item.action.hold.end",
				label: "End item long press",
				group: "item",
				hidden: !0,
				input: {
					on: "pointerup",
					when: () => !!l
				},
				payload: ({ event: e }) => ({ pointerId: e.pointerId })
			},
			{
				id: "item.action.context",
				label: "Open item action wheel",
				event: "item.action.open",
				group: "item",
				hidden: !0,
				input: {
					on: "contextmenu",
					selector: "[data-item-kind][data-item-id]",
					prevent: !0,
					stop: !0,
					when: ({ target: e }) => !e?.closest(".tool-panel, .item-toolbar, .modal-layer")
				},
				payload: ({ event: e, target: t }) => {
					let n = g(t), r = e;
					return n ? {
						ref: n,
						x: r.clientX,
						y: r.clientY
					} : void 0;
				}
			},
			{
				id: "canvas.action.context",
				label: "Open canvas actions",
				event: "canvas.action.open",
				group: "view",
				hidden: !0,
				input: {
					on: "contextmenu",
					selector: "[data-place=\"stage\"]",
					prevent: !0,
					stop: !0,
					when: ({ target: e }) => !e?.closest("[data-item-kind][data-item-id], .tool-panel, .item-toolbar, .context-command-menu, .modal-layer")
				},
				payload: ({ event: e }) => ({
					x: e.clientX,
					y: e.clientY
				})
			},
			...[
				"ArrowDown",
				"ArrowRight",
				"ArrowUp",
				"ArrowLeft",
				"Home",
				"End"
			].map((e) => ({
				id: `item.action.navigate.${e.toLocaleLowerCase()}`,
				label: `Navigate item actions (${e})`,
				event: "item.action.navigate",
				group: "item",
				hidden: !0,
				input: {
					on: "keydown",
					key: e,
					global: !0,
					prevent: !0,
					stop: !0,
					priority: -100,
					when: (e, t) => !!d && !!t.closest(".item-action-wheel, .context-command-menu")
				},
				payload: () => ({ key: e })
			})),
			{
				id: "item.action.activate",
				label: "Activate focused item action",
				event: "item.action.run",
				group: "item",
				hidden: !0,
				input: {
					on: "keydown",
					key: "Enter",
					selector: "[role=\"menuitem\"][data-action-command]",
					prevent: !0,
					stop: !0
				},
				payload: ({ target: e }) => ({ command: e?.closest("[data-action-command]")?.dataset.actionCommand ?? "" })
			},
			{
				id: "item.toolbar.pointer.track",
				label: "Remember where the pointer let go",
				event: "item.toolbar.pointer",
				group: "item",
				hidden: !0,
				input: {
					on: "pointerup",
					selector: `[data-place="${e.Stage}"]`
				},
				payload: ({ event: e }) => ({
					x: e.clientX,
					y: e.clientY
				})
			},
			{
				id: "item.action.close",
				label: "Close item actions",
				group: "item",
				hidden: !0
			},
			{
				id: "item.action.outside.pointer",
				label: "Close item actions on outside click",
				group: "item",
				hidden: !0,
				input: {
					on: "pointerdown",
					global: !0,
					when: (e) => !!d && e.button === 0 && !e.target?.closest(".item-action-wheel, .context-command-menu")
				}
			},
			{
				id: "item.action.style.toggle",
				label: "Toggle item context menu style",
				group: "item",
				hidden: !0
			},
			{
				id: "item.action.run",
				label: "Run item wheel action",
				group: "item",
				hidden: !0,
				payload: ({ target: e }) => ({ command: e?.closest("[data-action-command]")?.dataset.actionCommand ?? "" })
			},
			{
				id: "item.action.add",
				label: "Add connected node",
				group: "editing",
				hidden: !0
			}
		]), t("item.action.hold.start", ({ ref: t, x: i, y: a, pointerId: o }) => {
			v(), r.places.el(e.Stage)?.classList.add("holding-action");
			let s = setTimeout(() => n("item.action.open", {
				ref: t,
				x: i,
				y: a
			}), xo);
			l = {
				ref: t,
				start: {
					x: i,
					y: a
				},
				pointerId: o,
				timer: s
			};
		}), t("item.action.hold.move", ({ x: e, y: t, pointerId: n }) => {
			!l || l.pointerId !== n || Math.hypot(e - l.start.x, t - l.start.y) > So && v();
		}), t("item.action.hold.end", ({ pointerId: e }) => {
			l?.pointerId === e && v();
		}), t("item.action.open", C), t("canvas.action.open", w), t("item.action.close", () => y()), t("item.action.outside.pointer", () => y()), t("item.action.navigate", ({ key: t }) => {
			let n = r.places.el(e.Stage)?.querySelector(".item-action-wheel, .context-command-menu"), i = Array.from(n?.querySelectorAll("[role=\"menuitem\"]") ?? []);
			if (!i.length) return;
			let a = Math.max(0, i.indexOf(document.activeElement)), o = t === "Home" ? 0 : t === "End" ? i.length - 1 : (a + (t === "ArrowDown" || t === "ArrowRight" ? 1 : -1) + i.length) % i.length;
			i.forEach((e, t) => {
				e.tabIndex = t === o ? 0 : -1;
			}), x = o, i[o]?.focus({ preventScroll: !0 });
		}), t("item.action.style.toggle", () => {
			d?.kind === "item" && (p = p === "radial" ? "list" : "radial", S());
		}), t("item.action.run", ({ command: t }) => {
			if (!t) return y();
			let n = r.places.el(e.Stage)?.querySelector(".item-action-wheel, .context-command-menu") ?? void 0;
			r.commands.run(t, {
				target: n,
				origin: "pointer"
			}), y(!1);
		}), t("item.action.add", () => {
			r.commands.run("editing.node.create", { origin: o.selectedNode() ? "programmatic" : "pointer" });
		}), t("modal.open", () => y()), t("commandPicker.open", () => y()), t("graph.switched", () => y()), t("view.changed", () => {
			d && y();
		}), t("view.pan.start", () => y());
		let T = () => {
			if (o.selectedAll().length !== 1) return m();
			let t = o.selected();
			if (!t) return m();
			let s = a.entity(t.kind), c = i.current.getItem(t);
			if (!s || !c) return m();
			let l = s.render?.bounds?.(c);
			if (l && !r.view.isVisible(e.Stage, l, 80) || !r.affordances.entity(s).filter(({ ui: e }) => !e.when || e.when(c)).length) return m();
			n("render.view.set", {
				place: e.Stage,
				key: "item-toolbar",
				view: () => b().buildToolbar(s, c, t)
			});
		};
		t("item.toolbar.pointer", (e) => {
			u = e;
		}), t("render.stage.draw", T), t("render.stage.camera", T);
		let E = r.interaction.cancel.register({
			origin: s,
			priority: 20,
			active: () => !!d || !!l,
			cancel: y
		});
		return () => {
			E(), v(), h();
		};
	}, { requires: ["render.stage", "graph"] });
}
//#endregion
//#region canvas/systems/text-layout.ts
var wo = (e) => e.split(/\r?\n/).flatMap((e) => {
	let t = e.trim();
	return t ? [t] : [];
}), To = (e) => {
	let t = wo(e.title), n = D(e.description ?? ""), r = n.flatMap((e) => e.kind === "rule" ? [] : e.kind === "code" ? e.text.split("\n") : e.kind === "unordered-list" || e.kind === "ordered-list" ? e.items.map((e) => `• ${O(e)}`) : [O(e.text)]).filter(Boolean), i = 7.2, a = [...t, ...r].reduce((e, t) => Math.max(e, t.length), 1), o = e.maxWidth ?? 320, s = W(a * i + 32, e.minWidth ?? 120, o), c = Math.max(6, Math.floor((s - 32) / i)), l = Math.max(1, ((e) => e.reduce((e, t) => e + Math.max(1, Math.ceil(t.length / c)), 0))(t)), u = (e) => Math.max(1, Math.ceil(Math.max(1, e.length) / c)), d = n.reduce((e, t) => t.kind === "rule" ? e + 9 : t.kind === "code" ? e + Math.max(1, t.text.split("\n").length) * 15 + 10 : t.kind === "heading" ? e + u(O(t.text)) * 20 + 4 : t.kind === "unordered-list" || t.kind === "ordered-list" ? e + t.items.reduce((e, t) => e + u(O(t)) * 16, 4) : t.kind === "quote" ? e + u(O(t.text)) * 16 + 8 : e + u(O(t.text)) * 16 + 3, 0), f = W(l * 22 + d + 24, e.minHeight ?? 56, e.maxHeight ?? 480);
	return {
		w: Math.round(s),
		h: Math.round(f)
	};
}, Eo = (e, t) => {
	let n = e.trim().split(/\s+/).filter(Boolean), r = Math.max(1, n.join(" ").length), i = Math.max(8, Math.floor(t.w / 7)), a = Math.max(1, Math.ceil(r / i)), o = 1.25, s = W(Math.floor(t.h / (a * o)), 10, 14);
	return {
		fontSize: s,
		lineHeight: o,
		lines: a,
		overflow: a * s * o > t.h
	};
};
function Do(e) {
	e("text.layout", (e) => {
		e.expose("textLayout", {
			estimate: To,
			fit: Eo
		});
	});
}
//#endregion
//#region canvas/systems/node-autosize.ts
function Oo(e) {
	e("node.autosize", ({ on: e, emit: t, graphs: n, model: r }) => {
		let i = /* @__PURE__ */ new Map(), a = (e, t) => !!e && !!t && e.w === t.w && e.h === t.h, o = (e) => {
			let t = r.nodeType(e.NodeType);
			return To({
				title: e.Label?.text ?? "",
				description: e.DescriptionPlacement === "hidden" ? void 0 : e.Description,
				minWidth: t?.defaultSize?.w,
				minHeight: t?.defaultSize?.h
			});
		}, s = (e) => {
			let s = n.current.getNode(e);
			if (!s) return;
			let c = `${n.current.id}:${e}`;
			if (r.nodeType(s.NodeType)?.autoSize === !1 || s.NodeType === "operator" || s.NodeType === "diamond") return;
			let l = i.get(c);
			if (s.Size && l && !a(s.Size, l)) return;
			let u = o(s);
			i.set(c, u), a(s.Size, u) || t("item.update", {
				ref: {
					kind: "node",
					id: e
				},
				patch: { Size: u }
			});
		};
		e("graph.node.created", ({ id: e }) => s(e)), e("graph.node.updated", ({ id: e, patch: t }) => {
			t && !("Label" in t) && !("Description" in t) && !("Size" in t) || s(e);
		}), e("graph.imported", () => {
			i.clear(), n.current.nodes().forEach((e) => i.set(`${n.current.id}:${e.id}`, e.Size));
		});
	}, { requires: ["graph"] });
}
//#endregion
//#region canvas/systems/node-visuals.ts
var ko = [
	"text",
	"square",
	"circle"
], Ao = Br.map((e) => e.id), jo = (e) => !!G(e), Mo = [
	{
		value: "gray",
		label: "Gray",
		swatch: "#767676"
	},
	{
		value: "red",
		label: "Red",
		swatch: "#dc2626"
	},
	{
		value: "orange",
		label: "Orange",
		swatch: "#ea580c"
	},
	{
		value: "yellow",
		label: "Yellow",
		swatch: "#ca8a04"
	},
	{
		value: "green",
		label: "Green",
		swatch: "#16a34a"
	},
	{
		value: "blue",
		label: "Blue",
		swatch: "#2563eb"
	},
	{
		value: "purple",
		label: "Purple",
		swatch: "#7c3aed"
	},
	{
		value: "pink",
		label: "Pink",
		swatch: "#db2777"
	}
], No = (e) => Mo.some((t) => t.value === e);
function Po(e) {
	e("node.visuals", ({ on: e, emit: t, contexts: n, graphs: r, selection: i }) => {
		let a = [], o = () => i.selectedNode()?.id, s = () => !!o(), c = (e = o()) => {
			let t = e ? r.current.getNode(e) : void 0;
			return t?.NodeType === "toggle" ? t : void 0;
		}, l = () => i.selectedAll().filter((e) => e.kind === "node").map((e) => e.id), d = () => {
			let e = l(), t = o();
			return e.length ? e : t ? [t] : [];
		}, f = () => d().length > 0, p = () => {
			let e = i.selected();
			return e?.kind === "edge" ? e.id : void 0;
		}, m = () => !!p(), h = (e) => ({
			id: o(),
			nodeType: e
		}), g = (e) => ({
			id: o(),
			color: e
		});
		n.commands.register([
			{
				id: "node.type.open",
				label: "Set node type…",
				group: "node"
			},
			{
				id: "node.type.search",
				label: "Search node types",
				group: "node",
				hidden: !0,
				input: {
					on: "input",
					selector: "[data-node-type-search]"
				},
				payload: ({ target: e }) => ({ query: e.value })
			},
			{
				id: "node.toggle.state",
				label: "Toggle switch",
				group: "node",
				available: (e) => !!c((e?.target)?.closest("[data-item-id]")?.getAttribute("data-item-id") ?? void 0),
				input: {
					on: "click",
					selector: ".node-switch-control",
					prevent: !0,
					stop: !0
				},
				payload: ({ target: e }) => ({ id: e?.closest("[data-item-id]")?.getAttribute("data-item-id") ?? o() })
			},
			...Ao.map((e) => ({
				id: `node.type.${e}`,
				label: ko.includes(e) ? `Set node shape: ${G(e).label.toLowerCase()}` : `Set node type: ${G(e).label}`,
				event: "node.type.set",
				group: "node",
				available: s,
				payload: () => h(e)
			})),
			{
				id: "node.type.pick",
				label: "Pick node type",
				event: "node.type.set",
				group: "node",
				hidden: !0,
				available: s,
				input: {
					on: "click",
					selector: "[data-type-choice]"
				},
				payload: ({ target: e }) => {
					let t = (e?.closest("[data-type-choice]"))?.dataset.typeChoice;
					return jo(t) ? h(t) : void 0;
				}
			},
			{
				id: "node.color.open",
				label: "Set node color…",
				group: "node"
			},
			...Mo.map(({ value: e, label: t }) => ({
				id: `node.color.${e}`,
				label: `Set node color: ${t}`,
				event: "node.color.set",
				group: "node",
				available: s,
				payload: () => g(e)
			})),
			{
				id: "node.color.clear",
				label: "Set node color: default",
				event: "node.color.set",
				group: "node",
				available: s,
				payload: () => g(void 0)
			},
			{
				id: "node.status.open",
				label: "Set production status…",
				group: "node",
				shortcut: "S",
				input: {
					on: "keydown",
					key: "s",
					prevent: !0
				}
			},
			...Nt.map((e) => ({
				id: `node.status.${e}`,
				label: `Set status: ${Pt[e]}`,
				event: "node.status.set",
				group: "node",
				available: f,
				payload: () => ({
					id: o(),
					status: e
				})
			})),
			{
				id: "node.status.clear",
				label: "Set status: none",
				event: "node.status.set",
				group: "node",
				available: f,
				payload: () => ({ id: o() })
			},
			{
				id: "node.status.pick",
				label: "Pick production status",
				event: "node.status.set",
				group: "node",
				hidden: !0,
				available: f,
				input: {
					on: "click",
					selector: "[data-status-choice]"
				},
				payload: ({ target: e }) => {
					let t = (e?.closest("[data-status-choice]"))?.dataset.statusChoice;
					return {
						id: o(),
						...Ft(t) ? { status: t } : {}
					};
				}
			},
			{
				id: "edge.select",
				label: "Select edge",
				event: "selection.item.select",
				group: "edge",
				available: () => r.current.edges().length > 0,
				picker: {
					title: "Select edge",
					steps: [{
						id: "Edge",
						prompt: "Pick edge",
						filter: () => (e) => e.kind === "edge"
					}],
					validate: (e) => e.Edge ? void 0 : "Pick an edge.",
					payload: (e) => e.Edge
				}
			},
			...It.map((e) => ({
				id: `edge.relation.${e}`,
				label: `Set relationship: ${Lt[e]}`,
				event: "edge.relation.set",
				group: "edge",
				available: m,
				payload: () => ({
					id: p(),
					relation: e
				})
			})),
			{
				id: "edge.relation.clear",
				label: "Set relationship: none",
				event: "edge.relation.set",
				group: "edge",
				available: m,
				payload: () => ({ id: p() })
			},
			...ei.map(({ value: e, label: t }) => ({
				id: `edge.kind.${e}`,
				label: `Set edge appearance: ${t}`,
				event: "edge.kind.set",
				group: "edge",
				available: m,
				payload: () => ({
					id: p(),
					kind: e
				})
			})),
			{
				id: "node.color.pick",
				label: "Pick node color",
				event: "node.color.set",
				group: "node",
				hidden: !0,
				available: s,
				input: {
					on: "click",
					selector: "[data-color-choice]"
				},
				payload: ({ target: e }) => {
					let t = (e?.closest("[data-color-choice]"))?.dataset.colorChoice;
					return t === "" ? g(void 0) : No(t) ? g(t) : void 0;
				}
			}
		]);
		let _ = () => {
			let e = r.current.getNode(o() ?? "")?.NodeType ?? "text", t = u("section.type-picker"), n = u("p", { text: "Choose by meaning first; appearance stays editable separately." }), i = u("input.type-picker-search", {
				type: "search",
				autofocus: !0,
				placeholder: "Search type, category, or keyword",
				"aria-label": "Search node types",
				data: { nodeTypeSearch: "" }
			}), s = u(".type-picker-catalog"), c = (t, n) => {
				if (!n.length) return;
				let r = u("section.type-choice-group"), i = u("h3", { text: t }), a = u(".type-choices", n.map((t) => u("button", {
					type: "button",
					"aria-pressed": t.id === e ? "true" : "false",
					data: {
						command: "node.type.pick",
						typeChoice: t.id,
						typeSearchText: [
							t.label,
							t.category,
							...t.keywords ?? []
						].join(" ").toLowerCase()
					}
				}, [u(`span.palette-tile-preview.palette-shape-${t.visual ?? t.id}`, {
					"aria-hidden": "true",
					text: t.id === "caption" || t.id === "text" ? "T" : t.id === "operator" ? "⊕" : void 0,
					data: {
						nodeColor: "gray",
						fill: t.defaultFill ?? "none",
						borderColor: t.defaultBorder ?? "automatic"
					}
				}), u("span.type-choice-label", { text: t.label })])));
				r.append(i, a), s.append(r);
			};
			return c("Recent", a.map((e) => G(e)).filter((e) => !!e)), Hr.forEach((e) => c(e, Br.filter((t) => t.category === e))), t.append(n, i, s, u("p.type-picker-empty", {
				hidden: !0,
				text: "No node types match."
			})), t;
		}, v = (e) => {
			let t = n.places.el("modal")?.querySelector(".type-picker");
			if (!t) return;
			let r = e.trim().toLowerCase(), i = 0;
			t.querySelectorAll("[data-type-search-text]").forEach((e) => {
				e.hidden = !!r && !e.dataset.typeSearchText?.includes(r), e.hidden || (i += 1);
			}), t.querySelectorAll(".type-choice-group").forEach((e) => {
				e.hidden = !e.querySelector("[data-type-search-text]:not([hidden])");
			});
			let a = t.querySelector(".type-picker-empty");
			a && (a.hidden = i > 0);
		}, y = () => {
			let e = r.current.getNode(o() ?? "")?.Status, t = u("section.color-picker.status-picker"), n = u("p", { text: "Production state for this piece of work. Blocked and Done are what the project views read." }), i = u(".color-choices"), a = (t, n) => i.append(u("button", {
				type: "button",
				text: n,
				"aria-pressed": (t || void 0) === e ? "true" : "false",
				data: {
					command: "node.status.pick",
					statusChoice: t
				}
			}));
			a("", "None");
			for (let e of Nt) a(e, Pt[e]);
			return t.append(n, i), t;
		}, b = () => {
			let e = r.current.getNode(o() ?? "")?.Color, t = u("section.color-picker"), n = u("p", { text: "A tint overrides the type color on this node only. Default follows the node type." }), i = u(".color-choices"), a = (t, n, r) => {
				let a = r ? u("span.color-swatch") : null;
				a?.style.setProperty("--swatch", r), i.append(u("button", {
					type: "button",
					"aria-pressed": (t || void 0) === e ? "true" : "false",
					data: {
						command: "node.color.pick",
						colorChoice: t
					}
				}, [a, n]));
			};
			a("", "Default");
			for (let e of Mo) a(e.value, e.label, e.swatch);
			return t.append(n, i), t;
		};
		e("node.type.open", () => {
			if (!o()) {
				t("app.notice", {
					message: "Select a node first",
					level: "warn"
				});
				return;
			}
			t("modal.open", {
				title: "Set node type",
				visual: "properties",
				body: _
			});
		}), e("node.type.search", ({ query: e }) => v(e)), e("node.color.open", () => {
			if (!o()) {
				t("app.notice", {
					message: "Select a node first",
					level: "warn"
				});
				return;
			}
			t("modal.open", {
				title: "Set node color",
				visual: "properties",
				body: b
			});
		}), e("node.type.set", ({ id: e, nodeType: n }) => {
			if (!e) return;
			let i = r.current.getNode(e);
			if (!i) return;
			let o = G(n), s = {
				NodeType: n,
				Fill: o?.defaultFill,
				BorderColor: o?.defaultBorder
			}, c = o?.defaultSize;
			c && i.NodeType !== n && (n === "operator" || n === "diamond" || qr(i.Size)) && (s.Size = c), a = [n, ...a.filter((e) => e !== n)].slice(0, 5), t("item.update", {
				ref: B(e),
				patch: s
			}), t("palette.arm.sync-type", { type: n }), t("modal.close");
		}), e("node.status.open", () => {
			if (!f()) {
				t("app.notice", {
					message: "Select a node first",
					level: "warn"
				});
				return;
			}
			t("modal.open", {
				title: "Set production status",
				visual: "properties",
				body: y
			});
		}), e("node.status.set", ({ id: e, status: n }) => {
			let i = (d().length ? d() : e ? [e] : []).filter((e) => r.current.getNode(e)).map((e) => ({
				ref: B(e),
				patch: { Status: n }
			}));
			i.length && (t("item.update.batch", { updates: i }), t("modal.close"));
		}), e("node.color.set", ({ id: e, color: n }) => {
			e && r.current.getNode(e) && (t("item.update", {
				ref: B(e),
				patch: { Color: n }
			}), t("palette.arm.sync-color", { color: n }), t("modal.close"));
		}), e("node.toggle.state", (e) => {
			let n = c(e?.id ?? o());
			n && t("item.update", {
				ref: B(n.id),
				patch: { ToggleState: !n.ToggleState }
			});
		}), e("edge.relation.set", ({ id: e, relation: n }) => {
			!e || !r.current.getEdge(e) || t("item.update", {
				ref: ht(e),
				patch: { Relation: n }
			});
		}), e("edge.kind.set", ({ id: e, kind: n }) => {
			e && r.current.getEdge(e) && t("item.update", {
				ref: ht(e),
				patch: { EdgeKind: n }
			});
		});
	}, { requires: [
		"graph",
		"render.stage",
		"ability.selectable"
	] });
}
//#endregion
//#region canvas/systems/production-model.ts
var Fo = (e) => !!e && Rt.includes(e), Io = (e) => e?.status === "done", Lo = (e) => {
	let t = new Map(e.nodes.map((e) => [e.id, e])), n = /* @__PURE__ */ new Map(), r = (e, r) => {
		if (!t.has(e)) return;
		let i = n.get(e) ?? [];
		r && !i.some((e) => e.id === r.id) && i.push(r), n.set(e, i);
	};
	return e.nodes.forEach((e) => {
		e.status === "blocked" && r(e.id);
	}), e.edges.forEach((e) => {
		if (Fo(e.Relation)) {
			let n = t.get(e.To);
			n && !Io(n) && r(e.From, n);
		}
		if (e.Relation === "blocks") {
			let n = t.get(e.From);
			n && !Io(n) && r(e.To, n);
		}
	}), n;
}, Ro = (e) => e === "done", zo = (e) => {
	let t = Lo(e);
	return e.nodes.filter((e) => !Ro(e.status) && t.has(e.id));
}, Bo = (e) => {
	let t = Lo(e);
	return e.nodes.filter((e) => !!e.status && !Ro(e.status) && !t.has(e.id));
}, Vo = "views", Ho = 240, Uo = 56, Wo = 24, Go = {
	none: "No grouping",
	status: "Status",
	tag: "Tag",
	type: "Type"
}, Ko = (e) => e === "none" || e === "status" || e === "tag" || e === "type";
function qo(t) {
	t("views", ({ on: t, emit: n, contexts: r, frameLoop: i, graphs: a, declarePanel: o, contribute: s }) => {
		let c = "", l = /* @__PURE__ */ new Set(), d = "none", f = /* @__PURE__ */ new Map(), p = () => f.get(a.current.id) ?? [], m = (e) => f.set(a.current.id, e), h = () => {
			let e = a.current;
			if (f.has(e.id)) return;
			let t = e.snapshotExtension("views");
			m(Array.isArray(t) ? t.filter((e) => !!e?.id) : []), e.registerSnapshotExtension("views", () => p(), (e) => m(Array.isArray(e) ? e.filter((e) => !!e?.id) : []));
		}, g = () => {
			let e = a.current.snapshot();
			return {
				nodes: e.nodes.map((e) => ({
					id: e.id,
					title: e.Label?.text ?? e.id,
					description: e.Description,
					type: e.NodeType,
					status: e.Status,
					tags: e.Tags
				})),
				edges: e.edges.map((e) => ({
					From: e.From,
					To: e.To,
					Relation: e.Relation
				}))
			};
		}, _ = () => {
			let e = g(), t = Mi(c);
			return {
				model: e,
				parsed: t,
				matched: Li(e, t, {
					blocked: zo(e).map((e) => e.id),
					ready: Bo(e).map((e) => e.id)
				})
			};
		}, v = () => {
			let { model: e, parsed: t, matched: i } = _();
			if (Ni(t)) r.decorations.unregisterOrigin(Vo);
			else {
				let t = e.nodes.filter((e) => !i.has(e.id) && !l.has(e.id)).map((e) => B(e.id)), n = (e) => i.has(e) || l.has(e);
				a.current.edges().forEach((e) => {
					(!n(e.From) || !n(e.To)) && t.push({
						kind: "edge",
						id: e.id
					});
				}), r.decorations.modes.set(Vo, "view-excluded", t, "view-excluded");
			}
			return n("views.changed", {
				query: c,
				by: d,
				matched: i.size
			}), {
				model: e,
				matched: i
			};
		}, y = (e, t) => {
			if (d === "none") return;
			let r = zi(e.nodes.filter((e) => t.has(e.id)), d, Nt);
			if (!r.length) return;
			let i = [], o = -(r.length * Ho + (r.length - 1) * Uo) / 2;
			r.forEach((e) => {
				let t = 0;
				e.nodes.forEach((e) => {
					let n = a.current.getNode(e.id)?.Size.h ?? 100;
					i.push({
						ref: B(e.id),
						patch: { Position: {
							x: o + Ho / 2,
							y: t + n / 2
						} }
					}), t += n + Wo;
				}), o += 296;
			}), i.length && (n("item.update.batch", { updates: i }), n("view.fit.all"));
		}, b = () => {
			let e = r.places.el("stage")?.querySelector(".views-panel");
			if (!e) return;
			let t = e.querySelector("[data-views-count]");
			t && (t.textContent = S());
			let n = e.querySelector("[data-views-query]");
			n && n !== document.activeElement && n.value !== c && (n.value = c), e.querySelector(".views-legend")?.replaceWith(C());
		}, x = ({ redraw: e = !1 } = {}) => {
			D();
			let { model: t, matched: n } = v();
			y(t, n), e ? T() : b();
		}, S = () => {
			let { matched: e } = _();
			return c.trim() ? `${e.size} of ${a.current.nodes().length} nodes` : `${a.current.nodes().length} nodes`;
		}, C = () => {
			let { model: e, matched: t } = _();
			return d === "none" ? u(".views-legend") : u(".views-legend", zi(e.nodes.filter((e) => t.has(e.id)), d, Nt).map((e) => u("span.views-column", { text: `${d === "status" && e.key ? Pt[e.key] ?? e.label : e.label} · ${e.nodes.length}` })));
		}, w = () => {
			h();
			let e = u("section.views-panel"), t = u(".views-field", [u("input.views-query", {
				type: "text",
				value: c,
				placeholder: "#narrative -status:done",
				"aria-label": "Filter the project",
				data: { viewsQuery: "" }
			}), u("button", {
				type: "button",
				text: "Clear",
				data: { command: "views.query.clear" }
			})]), n = xn({
				label: "Group by",
				kind: "segments",
				labelHidden: !0,
				className: "views-groups",
				current: d,
				options: [
					"none",
					"status",
					"tag",
					"type"
				].map((e) => ({
					value: e,
					label: Go[e],
					command: "views.group.pick",
					data: { viewsGroup: e }
				}))
			}), r = u("small.views-count", {
				text: S(),
				data: { viewsCount: "" }
			}), i = u(".views-tags");
			Ri(g()).slice(0, 8).forEach(({ tag: e, count: t }) => {
				let r = u("button", {
					type: "button",
					text: `#${e} ${t}`,
					data: {
						command: "views.tag.pick",
						viewsTag: e
					}
				});
				n.classList.add("has-tags"), i.append(r);
			});
			let a = u(".views-saved", [...p().map((e) => u("button.views-saved-view", {
				type: "button",
				text: e.name,
				title: `${e.query || "everything"}${e.group === "none" ? "" : ` · grouped by ${e.group}`}`,
				data: {
					command: "views.apply.pick",
					viewsId: e.id
				}
			})), u("button.views-save", {
				type: "button",
				text: "+ Save view",
				data: { command: "views.save" }
			})]);
			return e.append(t, n, i, r, C(), a), e;
		}, T = () => n("affordance.contributed", { surface: "top" }), E = !1, D = () => E ? !1 : (E = !0, o({
			id: "views",
			anchor: "top-right",
			place: e.Right,
			movable: !1,
			layout: "custom",
			order: 15,
			dock: {
				command: "views.open",
				label: "Views",
				icon: "fit",
				active: () => E && !r.fold.folded("views.panel")
			},
			foldId: "views.panel",
			render: w
		}), !0);
		s({
			surface: "top",
			command: "views.open",
			kind: "button",
			icon: "layout-columns",
			text: "Views",
			order: 21,
			group: "overflow"
		}), s({
			surface: "dock",
			command: "views.open",
			kind: "button",
			icon: "fit",
			text: "Views",
			order: 15,
			active: () => E && !r.fold.folded("views.panel")
		}), r.commands.register([
			{
				id: "views.open",
				label: "Views: filter and group the project",
				group: "views",
				shortcut: "F",
				input: {
					on: "keydown",
					key: "f",
					prevent: !0
				}
			},
			{
				id: "views.query.input",
				label: "Filter the project as you type",
				group: "views",
				hidden: !0,
				event: "views.query.set",
				input: {
					on: "input",
					selector: "[data-views-query]"
				},
				payload: ({ target: e }) => ({ query: e?.value ?? "" })
			},
			{
				id: "views.query.enter",
				label: "Apply the filter",
				group: "views",
				hidden: !0,
				event: "views.query.set",
				input: {
					on: "keydown",
					key: "Enter",
					selector: "[data-views-query]",
					prevent: !0,
					stop: !0
				},
				payload: ({ target: e }) => ({ query: e?.value ?? "" })
			},
			{
				id: "views.query.clear",
				label: "Clear the filter",
				group: "views"
			},
			...[
				"none",
				"status",
				"tag",
				"type"
			].map((e) => ({
				id: `views.group.${e}`,
				label: e === "none" ? "Group: off" : `Group by ${e}`,
				event: "views.group.set",
				group: "views",
				payload: () => ({ by: e })
			})),
			{
				id: "views.group.pick",
				label: "Pick grouping",
				group: "views",
				hidden: !0,
				event: "views.group.set",
				input: {
					on: "click",
					selector: "[data-views-group]"
				},
				payload: ({ target: e }) => {
					let t = e?.closest("[data-views-group]")?.dataset.viewsGroup;
					return Ko(t) ? { by: t } : void 0;
				}
			},
			{
				id: "views.tag.pick",
				label: "Filter by tag",
				group: "views",
				hidden: !0,
				event: "views.query.set",
				input: {
					on: "click",
					selector: "[data-views-tag]"
				},
				payload: ({ target: e }) => {
					let t = e?.closest("[data-views-tag]")?.dataset.viewsTag;
					return t ? { query: `#${t}` } : void 0;
				}
			},
			{
				id: "views.save",
				label: "Save the current view",
				group: "views",
				form: {
					title: "Save view",
					submitLabel: "Save view",
					shouldOpen: () => !0,
					fields: [{
						id: "name",
						label: "Name",
						placeholder: "Narrative · v1.0.0",
						autofocus: !0
					}],
					payload: (e) => ({ name: e.name })
				}
			},
			{
				id: "views.apply.pick",
				label: "Open a saved view",
				group: "views",
				hidden: !0,
				event: "views.apply",
				input: {
					on: "click",
					selector: "[data-views-id]"
				},
				payload: ({ target: e }) => {
					let t = e?.closest("[data-views-id]")?.dataset.viewsId;
					return t ? { id: t } : void 0;
				}
			}
		]), t("views.open", () => {
			D() || n("fold.toggle", { id: "views.panel" });
		});
		let O = () => {
			c.trim() && i.schedule("views.repaint", () => {
				c.trim() && x();
			}, 1);
		};
		return t("graph.node.created", ({ id: e }) => {
			c.trim() && l.add(e), O();
		}), t("graph.node.updated", O), t("graph.node.deleted", ({ id: e }) => {
			l.delete(e), O();
		}), t("views.query.set", ({ query: e }) => {
			c = e, l.clear(), x();
		}), t("views.query.clear", () => {
			c = "", l.clear(), r.decorations.unregisterOrigin(Vo), x({ redraw: !0 });
		}), t("views.group.set", ({ by: e }) => {
			d = e, x({ redraw: !0 });
		}), t("views.save", (e) => {
			let t = e?.name;
			h();
			let r = (t ?? "").trim() || c.trim() || Go[d], i = {
				id: `v${Date.now().toString(36)}`,
				name: r,
				query: c,
				group: d
			};
			m([...p(), i]), n("graph.renamed", {
				id: a.current.id,
				name: a.current.name
			}), n("app.notice", { message: `Saved view “${r}”.` }), T();
		}), t("views.apply", ({ id: e }) => {
			let t = p().find((t) => t.id === e);
			t && (c = t.query, d = t.group, x({ redraw: !0 }), n("app.notice", { message: `View “${t.name}”.` }));
		}), t("views.delete", ({ id: e }) => {
			m(p().filter((t) => t.id !== e)), n("graph.renamed", {
				id: a.current.id,
				name: a.current.name
			}), T();
		}), t("graph.switched", () => {
			c = "", d = "none", r.decorations.unregisterOrigin(Vo), h(), T();
		}), t("app.start", () => h()), () => r.decorations.unregisterOrigin(Vo);
	}, { requires: [
		"graph",
		"render.stage",
		"tool.panel"
	] });
}
//#endregion
//#region canvas/systems/left-library.ts
var Jo = {
	outline: "Graphs",
	"tool-panel:palette": "Node types",
	"tool-panel:tags": "Tags",
	log: "Log"
}, Yo = [
	"tool-panel:palette",
	"tool-panel:tags",
	"outline",
	"log"
], Xo = { "tool-panel:palette": !0 }, Zo = {
	graphNavSearch: "",
	paletteSearch: "",
	tagsSearch: ""
}, Qo = {
	outline: {
		command: "graph.create",
		label: "New graph"
	},
	"tool-panel:palette": {
		command: "palette.custom-type.create",
		label: "Save as type"
	},
	"tool-panel:tags": {
		command: "tags.create",
		label: "New tag"
	}
}, $o = "library", es = "left.section:", ts = (e) => e === $o || e.startsWith(es), ns = (e) => {
	let t = Yo.indexOf(e);
	return t === -1 ? Yo.length : t;
};
function rs(t) {
	t("left.library", ({ on: t, emit: n, contexts: r, frameLoop: i }) => {
		let a = "", o = /* @__PURE__ */ new Map(), s = /* @__PURE__ */ new Set(), c = /* @__PURE__ */ new Map(), l = () => r.places.el(e.Left), d = () => [...l()?.children ?? []].map((e) => e.dataset.renderKey ?? "").filter((e) => e && !ts(e)).sort((e, t) => ns(e) - ns(t)), f = (e) => o.get(e)?.label ?? Jo[e] ?? e.replace(/^tool-panel:/, ""), p = (e) => o.get(e)?.foldId ?? `${es}${e}`, m = (e) => Xo[e] ?? !1, h = (e) => r.fold.isOpen(p(e), m(e)), g = "left.panel", _ = () => r.places.width() > 900, v = () => !r.fold.isOpen(g, _()), y = () => {
			let e = l();
			if (!e) return;
			let t = d(), n = v();
			[...e.children].forEach((e) => {
				let r = e, i = r.dataset.renderKey ?? "";
				if (!i || i === $o) return;
				let a = i.startsWith(es) ? i.slice(13) : i, o = t.indexOf(a);
				if (o === -1) return;
				let s = i.startsWith(es);
				r.style.order = String(o * 2 + (s ? 1 : 2)), r.hidden = n || !s && !h(a);
			}), e.dataset.leftFolded = n ? "true" : "false", e.dataset.leftSections = String(t.length);
		}, b = (e) => {
			let t = h(e), n = Qo[e], r = a.trim();
			return u(".left-section", { data: {
				section: e,
				open: t ? "true" : "false"
			} }, [Wn({
				id: p(e),
				label: f(e),
				open: t,
				defaultOpen: m(e)
			}), n && u("button.left-section-create", {
				type: "button",
				text: r ? `+ ${r}` : `+ ${n.label}`,
				"aria-label": r ? `${n.label}: ${r}` : n.label,
				title: r ? `${n.label}: ${r}` : n.label,
				data: {
					command: n.command,
					searchValue: r
				}
			})].filter(Boolean));
		}, x = () => {
			let t = d(), r = (e, t) => c.get(e) === t ? !1 : (c.set(e, t), !0);
			r($o, `${v()}|${a}`) && n("render.view.set", {
				place: e.Left,
				key: $o,
				view: () => {
					let e = v(), t = u("button.left-collapse", {
						type: "button",
						"aria-expanded": e ? "false" : "true",
						"aria-label": e ? "Open the library" : "Collapse the library",
						data: {
							command: "fold.toggle",
							foldId: g,
							foldDefaultOpen: String(_())
						}
					});
					return t.append(yn("menu")), u(".left-head", [u(".left-head-row", [t, !e && qn({
						value: a,
						label: "the library",
						placeholder: "Search the library",
						data: Zo,
						clearCommand: "left.library.search.clear"
					})].filter(Boolean))]);
				}
			}), t.forEach((t) => {
				s.add(t);
				let i = `${f(t)}|${h(t)}|${a.trim()}`;
				r(`${es}${t}`, i) && n("render.view.set", {
					place: e.Left,
					key: `${es}${t}`,
					view: () => b(t)
				});
			}), [...s].forEach((r) => {
				t.includes(r) || (s.delete(r), c.delete(`${es}${r}`), n("render.view.clear", {
					place: e.Left,
					key: `${es}${r}`
				}));
			}), y();
		}, S = () => i.schedule("left.library", x, 24);
		r.commands.register([{
			id: "left.library.search.clear",
			label: "Clear the library search",
			group: "ui",
			hidden: !0
		}]), t("left.library.search.clear", () => {
			n("outline.search.clear"), n("palette.search.clear"), n("tags.search", { query: "" });
		}), t("render.view.set", ({ place: t, key: n = "", section: r }) => {
			t !== e.Left || ts(n) || (r && o.set(n, r), S());
		}), t("render.view.clear", ({ place: t, key: n }) => {
			t !== e.Left || n && ts(n) || (n && o.delete(n), S());
		}), t("outline.search.changed", ({ query: e }) => {
			a = e;
		}), t("palette.search.changed", ({ query: e }) => {
			a = e;
		}), t("tags.search", ({ query: e }) => {
			a = e;
		}), t("app.start", x), globalThis.addEventListener?.("resize", S);
		let C = r.places.root(), w = C && typeof ResizeObserver == "function" ? new ResizeObserver(S) : void 0;
		return C && w?.observe(C), t("fold.changed", ({ id: e }) => {
			(e === g || e.startsWith(es) || [...o.values()].some((t) => t.foldId === e)) && S();
		}), () => {
			w?.disconnect(), globalThis.removeEventListener?.("resize", S);
			let t = l();
			t?.querySelectorAll("[data-render-key]").forEach((e) => {
				e.hidden = !1, e.style.removeProperty("order");
			}), t && (delete t.dataset.leftSections, delete t.dataset.leftFolded), c.clear(), n("render.view.clear", {
				place: e.Left,
				key: $o
			}), s.forEach((t) => n("render.view.clear", {
				place: e.Left,
				key: `${es}${t}`
			})), s.clear();
		};
	}, { requires: ["render"] });
}
//#endregion
//#region canvas/requirements-map.ts
var is = () => ({
	scope: "all",
	readiness: "all",
	attribute: "all",
	component: "all"
}), as = (e) => Object.values(e).some((e) => e !== "all"), os = (e, t) => {
	if (t.scope === "0.1" && e.release !== "0.1" || t.scope === "later" && e.release === "0.1" || t.attribute !== "all" && e.attributeId !== t.attribute || t.component !== "all" && e.componentId !== t.component) return !1;
	switch (t.readiness) {
		case "blocked": return e.blockerIds.length > 0;
		case "needs-proof": return e.release === "0.1" && e.evidenceState !== "accepted";
		case "missing": return e.evidenceState === "missing";
		case "pending": return [
			"pending",
			"rejected",
			"stale"
		].includes(e.evidenceState);
		case "proven": return e.evidenceState === "accepted";
		default: return !0;
	}
}, ss = (e) => {
	let t = e.snapshotExtension("requirementsMap");
	return !t || t.version < 2 || !t.rootContainerId || !Array.isArray(t.attributeContainers) ? null : t;
}, cs = "outline.panel", ls = (e) => e.name, us = ({ contexts: e, graphs: t, mobileSheet: n, query: r, requirementsFilters: i }) => {
	let a = (e) => gt(e, r), o = (e) => e.itemsOfKind("container"), s = (e) => e === "square" ? "Box" : e === "circle" ? "Circle" : "Text", c = (e, t, n, r) => {
		let i = Kn({
			command: "outline.item.open",
			title: n,
			detail: r,
			marker: t.kind,
			className: "graph-nav-item",
			markerClassName: `graph-nav-marker graph-nav-marker-${t.kind}`,
			data: { graphId: e.id }
		});
		return m(i, t), i.querySelector(".list-row-copy")?.classList.add("graph-nav-item-copy"), i;
	}, l = (e, t, n, r) => {
		let i = Kn({
			command: "outline.section.open",
			title: n.title,
			detail: r ?? `${t.Label?.text?.trim() || "Untitled container"} · section`,
			marker: "section",
			className: "graph-nav-item graph-nav-section",
			markerClassName: "graph-nav-marker graph-nav-marker-section",
			data: {
				graphId: e.id,
				containerId: t.id,
				sectionId: n.id
			}
		});
		return m(i, {
			kind: "container",
			id: t.id
		}), i.querySelector(".list-row-copy")?.classList.add("graph-nav-item-copy"), i;
	}, d = (e) => [
		"Description" in e ? e.Description : "",
		e.Purpose,
		e.Assumptions,
		e.Limits,
		e.WhatThen,
		e.Observability,
		e.FailureMode
	].filter(Boolean).join(" "), f = (e) => {
		let t = (e.Description ?? "").split(/\r?\n/).map((e) => e.trim()).filter(Boolean);
		return t.find((e) => !/^Open blocker:/i.test(e) && e.length > 28) ?? t[1] ?? t[0] ?? "";
	}, p = () => as(i), h = (e, t, n) => {
		let r = u("select", {
			class: "requirements-nav-filter",
			"aria-label": t,
			title: t,
			data: { requirementsFilter: e }
		});
		return n.forEach((e) => {
			let t = document.createElement("option");
			t.value = e.value, t.textContent = e.text, r.append(t);
		}), r.value = i[e], r;
	}, g = (e) => {
		if (!e.capabilities) return null;
		let t = u("div", {
			class: "requirements-nav-filters",
			role: "group",
			"aria-label": "Requirements review filters"
		});
		if (t.append(h("scope", "Release scope", [
			{
				value: "all",
				text: "All scope"
			},
			{
				value: "0.1",
				text: "0.1 only"
			},
			{
				value: "later",
				text: "Later only"
			}
		]), h("readiness", "Readiness state", [
			{
				value: "all",
				text: "All readiness"
			},
			{
				value: "blocked",
				text: "Open blockers"
			},
			{
				value: "needs-proof",
				text: "Needs proof"
			},
			{
				value: "missing",
				text: "No record"
			},
			{
				value: "pending",
				text: "Pending / stale"
			},
			{
				value: "proven",
				text: "Proven"
			}
		]), h("attribute", "Attribute", [{
			value: "all",
			text: "All Attributes"
		}, ...e.attributeContainers.map((e) => ({
			value: e.id,
			text: `${e.id} ${e.name}`
		}))]), h("component", "Component", [{
			value: "all",
			text: "All Components"
		}, ...(e.components ?? []).map((e) => ({
			value: e.id,
			text: `${e.id} ${e.name}`
		}))])), p()) {
			let e = u("button", {
				class: "requirements-nav-filter-clear",
				text: "Clear filters",
				type: "button",
				data: { command: "outline.requirements.filter.clear" }
			}), n = _("small", "requirements-nav-filter-note", "Matching cards stay prominent; context dims on the canvas.");
			t.append(e, n);
		}
		return t;
	}, v = (t, n) => {
		let o = _("div", "graph-nav-tree graph-nav-requirements"), s = _("section", "requirements-nav-summary"), d = _("span", "requirements-nav-source", `Generated view · ${n.source}`), m = _("strong", "requirements-nav-totals", `${n.counts.attributes} Attributes · ${n.counts.capabilities} capabilities · ${n.counts.openBlockers} open blockers`), h = _("small", "requirements-nav-regenerate", `Refresh: ${n.regenerateCommand}`), v = _("small", "requirements-nav-evidence", `Evidence: ${n.evidenceCoverage.accepted}/${n.evidenceCoverage.required} release Capabilities proven · ${n.evidenceCoverage.unproven ?? Math.max(0, n.evidenceCoverage.required - n.evidenceCoverage.accepted)} unproven · ${n.evidenceCoverage.records ?? 0} records`);
		s.append(d, m, v, h), o.append(s);
		let y = g(n);
		y && o.append(y);
		let b = t.getNode(n.missionNodeId), x = b && a(`${b.Label.text} ${b.Description ?? ""}`);
		if (!r.trim() && !p() || r.trim() && x && !p()) {
			let e = c(t, {
				kind: "container",
				id: n.rootContainerId
			}, "Contract overview", "Mission, scope, legend, and Attribute index");
			e.classList.add("requirements-nav-overview"), o.append(e);
		}
		let S = (e, t, n) => {
			let r = c(e, B(t.id), t.Label.text, f(t));
			r.classList.add("requirements-nav-capability");
			let i = n ? n.blockerIds.length > 0 : /Open blocker:/i.test(t.Description ?? "");
			if (i && (r.dataset.blocked = "true"), n) {
				r.dataset.evidenceState = n.evidenceState;
				let e = n.evidenceState === "accepted" ? "proof accepted" : n.evidenceState === "not-required" ? "proof not required" : n.evidenceState === "missing" ? "proof missing" : `proof ${n.evidenceState}`, t = _("em", "requirements-nav-status", [i ? "blocked" : "", e].filter(Boolean).join(" · "));
				r.querySelector(".graph-nav-item-copy")?.append(t);
			}
			return r;
		};
		if (n.attributeContainers.forEach((s) => {
			let d = {
				kind: "container",
				id: s.containerId
			}, f = t.getItem(d);
			if (!f) return;
			let m = f.Sections ?? [], h = s.capabilityIds.map((e) => {
				let r = t.getNode(n.capabilityNodes[e]);
				return {
					id: e,
					node: r,
					capability: n.capabilities?.[e],
					sectionId: r ? f.ChildSections?.[R(B(r.id))] : void 0
				};
			}).filter((e) => !!e.node), g = h.filter((e) => !e.capability || os(e.capability, i)), v = g.filter((e) => a(`${e.id} ${e.node.id} ${e.node.Label.text} ${e.node.Description ?? ""}`)), y = m.filter((e) => a(`${e.id} ${e.title}`)), b = a(`${s.id} ${s.name} ${f.Label?.text ?? ""}`);
			if (p() && !g.length || r.trim() && !b && !v.length && !y.length) return;
			let x = U(d, t.id), C = e.fold.isOpen(x), w = _("section", `requirements-nav-attribute${C ? " open" : ""}`), T = _("div", "requirements-nav-attribute-head"), E = u("button", {
				class: "requirements-nav-fold",
				type: "button",
				"aria-expanded": C ? "true" : "false",
				"aria-label": `${C ? "Fold" : "Open"} ${s.id} ${s.name}`,
				data: {
					command: "fold.toggle",
					foldId: x
				}
			});
			E.append(yn("collapse"));
			let D = g.filter((e) => / · 0\.1$/.test(e.node.Label.text)).length, O = p() ? `${g.length}/${h.length} shown · ${D} in 0.1` : `${h.length} capabilities · ${D} in 0.1`, k = c(t, d, `${s.id} · ${s.name}`, O);
			if (k.classList.add("requirements-nav-attribute-open"), T.append(E, k), w.append(T), C || r.trim()) {
				let e = _("div", "requirements-nav-sections");
				m.forEach((n) => {
					let i = g.filter((e) => e.sectionId === n.id), o = i.filter((e) => a(`${e.id} ${e.node.id} ${e.node.Label.text} ${e.node.Description ?? ""}`)), s = a(`${n.id} ${n.title}`);
					if (p() && !i.length || r.trim() && !s && !o.length) return;
					let c = _("section", "requirements-nav-component"), u = l(t, f, n, `${i.length} ${i.length === 1 ? "Capability" : "Capabilities"}`);
					u.classList.add("requirements-nav-section"), c.append(u);
					let d = r.trim() ? o : i;
					if (d.length) {
						let e = _("div", "requirements-nav-capabilities");
						d.forEach(({ node: n, capability: r }) => e.append(S(t, n, r))), c.append(e);
					}
					e.append(c);
				});
				let n = (r.trim() ? v : g).filter((e) => !e.sectionId || !m.some((t) => t.id === e.sectionId));
				if (n.length) {
					let r = _("div", "requirements-nav-capabilities");
					n.forEach(({ node: e, capability: n }) => r.append(S(t, e, n))), e.append(r);
				}
				e.childElementCount && w.append(e);
			}
			o.append(w);
		}), !o.querySelector(".requirements-nav-attribute, .requirements-nav-overview") && (r.trim() || p())) {
			let e = _("button", "empty empty-action graph-nav-empty", r.trim() ? "No requirement text matches this search and filter combination" : "No Capabilities match these review filters");
			e.type = "button", e.dataset.command = r.trim() ? "outline.search.clear" : "outline.requirements.filter.clear", o.append(e);
		}
		return o;
	}, y = (e) => {
		let t = ss(e);
		if (t) return v(e, t);
		let n = _("div", "graph-nav-tree"), i = (t) => {
			let n = e.refById(t);
			return (n ? e.getItem(n)?.Label?.text : void 0) ?? t;
		}, u = e.nodes().filter((e) => a(`${e.Label.text} ${e.id} ${d(e)}`)), f = e.edges().filter((e) => {
			let t = i(e.From), n = i(e.To);
			return a(`${e.Label?.text ?? ""} ${t} ${n} ${e.id} ${d(e)}`);
		}), p = o(e), m = p.filter((e) => a(`${e.Label?.text ?? ""} ${e.id}`)), h = p.flatMap((e) => (e.Sections ?? []).map((t) => ({
			container: e,
			section: t
		}))).filter(({ container: e, section: t }) => a(`${t.id} ${t.title} ${e.Label?.text ?? ""} ${e.id}`)), g = (e, t, i) => {
			if (!t.length && r.trim()) return;
			let a = _("section", "graph-nav-kind"), o = _("div", "graph-nav-kind-title");
			o.append(_("span", void 0, e), _("b", void 0, `${t.length}`)), a.append(o), t.slice(0, 50).forEach((e) => a.append(i(e))), n.append(a);
		};
		if (g("Nodes", u, (t) => c(e, B(t.id), t.Label.text || "Untitled node", t.Description?.trim() || s(t.NodeType))), g("Connections", f, (t) => {
			let n = i(t.From), r = i(t.To), a = t.Label?.text?.trim();
			return c(e, ht(t.id), a || `${n} → ${r}`, a ? `${n} → ${r}` : "Connection");
		}), g("Containers", m, (t) => c(e, {
			kind: "container",
			id: t.id
		}, t.Label?.text?.trim() || "Untitled container", t.Sections?.length ? t.Sections.map((e) => e.title).join(" · ") : "Container")), g("Sections", h, ({ container: t, section: n }) => l(e, t, n)), !u.length && !f.length && !m.length && !h.length) {
			let t = _("button", "empty empty-action graph-nav-empty", r ? `No matching items in “${ls(e)}”` : "Add the first node");
			t.type = "button", t.dataset.command = r ? "outline.search.clear" : "editing.node.create", n.append(t);
		}
		return n;
	}, b = (e) => {
		let n = e.id === t.current.id;
		if (!a(`${ls(e)} ${e.id}`)) return null;
		let r = u("article", {
			class: `graph-nav-card${n ? " active" : ""}`,
			data: { graphId: e.id }
		}), i = _("div", "graph-nav-card-head");
		return i.append(Kn({
			title: ls(e),
			detail: n ? "Current graph" : "Open graph",
			...n ? { active: !0 } : { command: "graph.switch" },
			className: "graph-nav-choose",
			data: { itemId: e.id },
			actions: t.all().length > 1 ? [{
				command: "graph.delete",
				label: `Delete ${ls(e)}`,
				icon: "trash",
				className: "graph-nav-delete",
				data: { itemId: e.id }
			}] : []
		})), n && (i.querySelector(".graph-nav-choose").disabled = !0), i.querySelector(".list-row-copy > strong")?.classList.add("graph-nav-name"), r.append(i), r;
	};
	return { renderOutline: () => {
		let i = n() && e.fold.folded(cs), a = u("aside", {
			class: "outline-panel graph-navigator",
			data: { outlineFolded: i ? "true" : "false" }
		});
		if (!i && n()) {
			a.setAttribute("role", "dialog"), a.setAttribute("aria-modal", "true"), a.setAttribute("aria-label", "Graph navigator");
			let e = u("button", {
				class: "graph-navigator-scrim",
				type: "button",
				"aria-label": "Close graph navigator",
				data: {
					command: "fold.toggle",
					foldId: cs
				}
			});
			a.append(e);
		}
		let o = _("div", "outline-panel-head"), s = n() ? u("button", {
			class: "graph-navigator-toggle",
			type: "button",
			"aria-expanded": i ? "false" : "true",
			"aria-label": i ? "Expand graph navigator" : "Collapse graph navigator",
			data: {
				command: "fold.toggle",
				foldId: cs
			}
		}, [yn("menu")]) : null, c = u("input", {
			class: "graph-navigator-title",
			type: "text",
			value: ls(t.current),
			"aria-label": "Current graph name",
			title: ls(t.current),
			data: {
				command: "graph.rename.input",
				graphTitle: "",
				graphId: t.current.id
			}
		});
		if (i && c.setAttribute("title", `${ls(t.current)} — open workspace drawer`), c.spellcheck = !1, o.append(...s ? [s] : [], c), a.append(o), i) return a;
		let l = _("div", "outline-panel-body"), d = Jn({
			label: "Graphs",
			className: "graph-nav-list",
			items: [t.current, ...[...t.all()].reverse().filter((e) => e.id !== t.current.id)].map(b),
			empty: r.trim() ? u("button", {
				class: "empty empty-action graph-nav-empty",
				text: "No graphs match this filter",
				type: "button",
				data: { command: "outline.search.clear" }
			}) : void 0
		});
		l.append(d);
		let f = _("section", "graph-nav-current graph-nav-item-model");
		return f.hidden = !0, f.append(y(t.current)), l.append(f), a.append(l), a;
	} };
}, X = "outline.panel";
function ds(t) {
	t("outline", ({ on: t, emit: n, contexts: r, graphs: i, frameLoop: a, origin: o }) => {
		let s = "", c = is(), l = null, u = !0, d = () => r.places.width() <= 680, f = () => us({
			contexts: r,
			graphs: i,
			mobileSheet: d,
			query: s,
			requirementsFilters: c
		}), p = () => n("render.view.set", {
			place: e.Left,
			key: "outline",
			section: { label: "Graphs" },
			view: () => f().renderOutline()
		}), m = r.interaction.cancel.register({
			origin: o,
			priority: -5,
			background: !1,
			active: () => r.fold.isOpen(X),
			cancel: () => r.fold.set(X, !1)
		}), h = r.interaction.cancel.register({
			origin: `${o}.mobile`,
			priority: 50,
			background: !1,
			active: () => d() && r.fold.isOpen(X),
			cancel: () => r.fold.set(X, !1)
		}), g = () => n("requirements.review.changed", {
			filters: { ...c },
			query: s
		});
		r.commands.register([
			{
				id: "outline.search.change",
				label: "Filter graph navigator",
				group: "outline",
				hidden: !0,
				event: "outline.search.changed",
				input: {
					on: "input",
					selector: "[data-graph-nav-search]"
				},
				payload: ({ target: e }) => ({ query: e.value })
			},
			{
				id: "outline.mobile.tab",
				label: "Keep focus in the mobile graph navigator",
				group: "outline",
				hidden: !0,
				input: {
					on: "keydown",
					key: "Tab",
					global: !0,
					prevent: !0,
					stop: !0,
					when: (e) => d() && r.fold.isOpen(X) && !!e.target?.closest(".graph-navigator")
				},
				payload: ({ event: e }) => ({ shift: e.shiftKey })
			},
			{
				id: "outline.search.clear",
				label: "Clear graph filter",
				group: "outline",
				hidden: !0
			},
			{
				id: "outline.requirements.filter.change",
				label: "Filter requirements review",
				group: "outline",
				hidden: !0,
				event: "outline.requirements.filter.changed",
				input: {
					on: "change",
					selector: "[data-requirements-filter]"
				},
				payload: ({ target: e }) => ({
					key: e.dataset.requirementsFilter,
					value: e.value
				})
			},
			{
				id: "outline.requirements.filter.clear",
				label: "Clear requirements filters",
				group: "outline",
				hidden: !0
			},
			{
				id: "outline.section.open",
				label: "Open container section",
				group: "outline",
				hidden: !0,
				payload: ({ target: e }) => {
					let t = e.closest("[data-section-id][data-container-id]");
					return t ? {
						graphId: t.closest("[data-graph-id]")?.getAttribute("data-graph-id") ?? i.current.id,
						containerId: t.dataset.containerId ?? "",
						sectionId: t.dataset.sectionId ?? ""
					} : void 0;
				}
			},
			{
				id: "outline.item.open",
				label: "Open graph item",
				group: "outline",
				hidden: !0,
				payload: ({ target: e }) => ({
					graphId: e.closest("[data-graph-id]")?.getAttribute("data-graph-id") ?? i.current.id,
					ref: {
						kind: e.closest("[data-item-kind]")?.getAttribute("data-item-kind"),
						id: e.closest("[data-item-id]")?.getAttribute("data-item-id") ?? ""
					}
				})
			}
		]), t("outline.search.changed", ({ query: t }) => {
			s = t, p(), g(), queueMicrotask(() => {
				let t = r.places.el(e.Left)?.querySelector("[data-graph-nav-search]");
				t?.focus(), t?.setSelectionRange(t.value.length, t.value.length);
			});
		}), t("outline.search.clear", () => {
			s = "", n("outline.search.changed", { query: s }), p(), g();
		}), t("outline.mobile.tab", ({ shift: t }) => {
			let n = r.places.el(e.Left)?.querySelector(".graph-navigator"), i = Array.from(n?.querySelectorAll(".graph-navigator-toggle, .graph-navigator-title, .outline-panel-body button:not([disabled]), .outline-panel-body input:not([disabled]), .outline-panel-body select:not([disabled]), .outline-panel-body textarea:not([disabled]), .outline-panel-body [href], .outline-panel-body [tabindex]:not([tabindex=\"-1\"])") ?? []);
			if (!i.length) return;
			let a = i.indexOf(document.activeElement);
			i[a < 0 ? t ? i.length - 1 : 0 : (a + (t ? -1 : 1) + i.length) % i.length]?.focus({ preventScroll: !0 });
		}), t("outline.requirements.filter.changed", ({ key: t, value: o }) => {
			if (![
				"scope",
				"readiness",
				"attribute",
				"component"
			].includes(t)) return;
			c = {
				...c,
				[t]: o
			};
			let l = ss(i.current);
			if (t === "attribute" && o !== "all" && l) {
				let e = l.attributeContainers.find((e) => e.id === o);
				if (e) {
					let t = U({
						kind: "container",
						id: e.containerId
					}, i.current.id);
					r.fold.isOpen(t) || r.fold.set(t, !0);
				}
			}
			if (p(), g(), l?.capabilities && c.attribute !== "all") {
				let e = l.attributeContainers.find((e) => e.id === c.attribute)?.capabilityIds.find((e) => {
					let t = l.capabilities?.[e];
					if (!t || !os(t, c)) return !1;
					let n = i.current.getNode(t.nodeId);
					return gt(`${e} ${n?.Label.text ?? ""} ${n?.Description ?? ""}`, s);
				}), t = e ? l.capabilityNodes[e] : void 0;
				t && a.schedule("outline.requirements.filter.focus", () => n("view.fit.item", B(t)), 60);
			}
			queueMicrotask(() => {
				r.places.el(e.Left)?.querySelector(`[data-requirements-filter="${t}"]`)?.focus();
			});
		}), t("outline.requirements.filter.clear", () => {
			c = is(), p(), g();
		});
		let _ = (e) => {
			[...r.hierarchy.parentChain(e), ...e.kind === "container" ? [e] : []].forEach((e) => {
				let t = U(e, i.current.id);
				r.fold.isOpen(t) || r.fold.set(t, !0);
			});
		};
		return t("outline.item.open", ({ graphId: e, ref: t }) => {
			!t.id || !t.kind || (i.current.id !== e && n("graph.switch", { id: e }), _(t), n("selection.item.select", t), d() && (u = !1, r.fold.set(X, !1)), a.schedule("outline.open.item", () => n("view.fit.item", t), 45));
		}), t("outline.section.open", ({ graphId: e, containerId: t, sectionId: o }) => {
			if (!t || !o) return;
			i.current.id !== e && n("graph.switch", { id: e });
			let s = {
				kind: "container",
				id: t
			};
			_(s), n("selection.item.select", s), d() && (u = !1, r.fold.set(X, !1)), a.schedule("outline.open.section", () => n("view.fit.section", {
				containerId: t,
				sectionId: o
			}), 50);
		}), t("app.start", () => {
			let e = r.fold.all();
			(r.places.width() <= 680 || globalThis.matchMedia?.("(pointer: coarse)").matches === !0) && r.fold.isOpen(X) ? r.fold.set(X, !1) : Object.prototype.hasOwnProperty.call(e, X) || r.fold.set(X, !1), p();
		}), t("outline.draw", p), t("graph.switched", () => {
			c = is(), d() && r.fold.isOpen(X) && (u = !1, r.fold.set(X, !1)), p(), g();
		}), t("fold.changed", ({ id: t }) => {
			let n = t === X && d();
			n && r.fold.isOpen(X) && (l = document.activeElement instanceof HTMLElement ? document.activeElement : null, u = !0), (t.startsWith("outline.") || ss(i.current) && t.startsWith(`fold:${i.current.id}:`)) && p(), n && a.schedule("outline.mobile.focus.prepare", () => {
				a.schedule("outline.mobile.focus.commit", () => {
					if (r.fold.isOpen(X)) {
						r.places.el(e.Left)?.querySelector(".graph-navigator-toggle")?.focus({ preventScroll: !0 });
						return;
					}
					let t = u ? l : null;
					l = null, u = !0, t?.isConnected ? t.focus({ preventScroll: !0 }) : t && r.places.el(e.Left)?.querySelector(".graph-navigator-toggle")?.focus({ preventScroll: !0 });
				}, 45);
			}, 45);
		}), () => {
			h(), m();
		};
	}, { requires: ["render", "graph"] });
}
//#endregion
//#region canvas/architecture-authoring.ts
var fs = (e, t, n) => ({
	value: e,
	color: t,
	label: n,
	fill: "soft"
}), ps = (e, t, n) => ({
	value: "square",
	label: e,
	color: n,
	fill: "soft",
	entity: "container",
	containerType: t
}), ms = Object.freeze([
	{
		id: "external-actor",
		group: "People & boundaries",
		help: "A person, client app, or outside system.",
		entry: fs("user-input", "gray", "External actor")
	},
	{
		id: "boundary",
		group: "People & boundaries",
		help: "A scope, ownership, or trust boundary.",
		entry: ps("Boundary", "c4-system", "gray")
	},
	{
		id: "service",
		group: "Inside a service",
		help: "The deployable owner of endpoints and code.",
		entry: ps("Service", "c4-container", "green")
	},
	{
		id: "api-endpoint",
		group: "Inside a service",
		help: "A concrete HTTP input port.",
		entry: fs("api-endpoint", "blue", "API endpoint")
	},
	{
		id: "handler",
		group: "Inside a service",
		help: "The application use case behind an input.",
		entry: fs("application-handler", "blue", "Handler")
	},
	{
		id: "domain-model",
		group: "Inside a service",
		help: "Business state and rules.",
		entry: fs("domain-model", "green", "Domain model")
	},
	{
		id: "repository",
		group: "Inside a service",
		help: "The persistence port or adapter.",
		entry: fs("repository", "green", "Repository")
	},
	{
		id: "postgresql",
		group: "Data & events",
		help: "A database container that owns concrete tables.",
		entry: ps("PostgreSQL", "c4-container", "blue")
	},
	{
		id: "table",
		group: "Data & events",
		help: "A named PostgreSQL table or view.",
		entry: fs("postgres-table", "blue", "Table")
	},
	{
		id: "kafka",
		group: "Data & events",
		help: "A Kafka cluster or namespace that owns topics.",
		entry: ps("Kafka", "c4-container", "purple")
	},
	{
		id: "topic",
		group: "Data & events",
		help: "A named, versioned Kafka event stream.",
		entry: fs("kafka-topic", "purple", "Topic")
	},
	{
		id: "consumer",
		group: "Data & events",
		help: "A concrete topic input port.",
		entry: fs("consumer-port", "purple", "Consumer")
	}
]), hs = [
	["square", "Task"],
	["milestone", "Milestone"],
	["artifact", "Asset"],
	["approval-gate", "Approval"],
	["text", "Note"],
	["circle", "Idea"]
], gs = (e) => {
	let t = document.createDocumentFragment(), n = document.createElement("span");
	n.className = "empty-purpose", n.textContent = "Map a feature, asset, task, or decision.", t.append(n);
	let r = _("div", "empty-types");
	return hs.filter(([t]) => e.commands.get(`palette.arm.type.${t}`)).forEach(([e, t]) => {
		let n = _("button", "empty-type", t);
		n.type = "button", n.dataset.command = `palette.arm.type.${e}`, n.dataset.paletteType = e, n.title = `Add ${t.toLowerCase()}`, r.append(n);
	}), r.childElementCount && t.append(r), t.append("Choose a type, then drag it anywhere."), jn(e.templates, "Add your first node", t, "canvas.empty.create") ?? document.createDocumentFragment();
}, _s = {
	text: "Text",
	square: "Box",
	circle: "Circle",
	rounded: "Rounded",
	pill: "Pill",
	diamond: "Diamond",
	parallelogram: "Parallelogram",
	input: "Input",
	embedding: "Embedding",
	dense: "Dense / Linear",
	attention: "Attention",
	moe: "MoE",
	norm: "Norm",
	output: "Output",
	"uml-class": "UML class",
	"list-item": "List item",
	"section-header": "Section header",
	milestone: "Milestone",
	operator: "Operator",
	caption: "Caption"
}, Z = (e, t, n, r) => ({
	value: e,
	color: t,
	fill: n,
	label: r
}), vs = (e, t, n) => ({
	value: "square",
	label: e,
	color: n,
	fill: "soft",
	entity: "container",
	containerType: t
}), ys = [
	{
		id: "basic",
		label: "Basic",
		defaultNodeType: "text",
		builtin: !0,
		types: [
			Z("square", "gray", "soft"),
			Z("rounded", "gray", "soft"),
			Z("circle", "gray", "soft"),
			Z("diamond", "gray", "soft"),
			Z("text"),
			Z("operator", "gray")
		]
	},
	{
		id: "architecture",
		label: "Architecture",
		layout: "vertical",
		defaultNodeType: "dense",
		defaultEdgeKind: "plain",
		builtin: !0,
		types: [
			Z("input", "gray", "soft"),
			Z("embedding", "purple", "soft"),
			Z("dense", "blue", "soft"),
			Z("attention", "red", "soft"),
			Z("moe", "orange", "soft"),
			Z("norm", "green", "soft"),
			Z("output", "gray", "soft"),
			Z("operator", "gray"),
			Z("caption")
		]
	},
	{
		id: "jira",
		label: "Jira",
		layout: "tree",
		defaultNodeType: "square",
		builtin: !0,
		types: [
			Z("circle", "gray", "soft", "Start"),
			Z("square", "gray", "solid", "Open"),
			Z("square", "yellow", "solid", "In progress"),
			Z("square", "green", "solid", "Resolved"),
			Z("square", "green", "solid", "Closed"),
			Z("square", "gray", "solid", "Reopened")
		]
	},
	{
		id: "flowchart",
		label: "Flowchart",
		layout: "vertical",
		defaultNodeType: "square",
		builtin: !0,
		types: [
			Z("pill", "green", "soft", "Start / End"),
			Z("square", "blue", "soft", "Process"),
			Z("diamond", "yellow", "soft", "Decision"),
			Z("parallelogram", "purple", "soft", "Input / Output"),
			Z("rounded", "green", "soft", "Prepare"),
			Z("operator", "gray", void 0, "Connector")
		]
	},
	{
		id: "mindmap",
		label: "Mindmap",
		layout: "radial",
		defaultNodeType: "rounded",
		builtin: !0,
		types: [
			Z("rounded", "gray", "solid", "Central"),
			Z("pill", "blue", "solid", "Branch"),
			Z("pill", "green", "solid", "Branch"),
			Z("pill", "orange", "solid", "Branch"),
			Z("pill", "purple", "solid", "Branch"),
			Z("text", void 0, void 0, "Leaf")
		]
	},
	{
		id: "c4",
		label: "C4",
		layout: "vertical",
		defaultNodeType: "api-endpoint",
		builtin: !0,
		types: ms.map((e) => e.entry)
	},
	{
		id: "uml",
		label: "UML",
		layout: "tree",
		defaultNodeType: "uml-class",
		builtin: !0,
		types: [
			Z("uml-class"),
			Z("text"),
			Z("square"),
			Z("circle")
		]
	},
	{
		id: "outline",
		label: "Outline",
		layout: "vertical",
		defaultNodeType: "list-item",
		builtin: !0,
		types: [
			Z("list-item"),
			Z("section-header"),
			Z("milestone"),
			Z("text")
		]
	},
	{
		id: "game",
		label: "Game production",
		layout: "tree",
		defaultNodeType: "square",
		defaultEdgeKind: "plain",
		builtin: !0,
		types: [
			Z("square", "blue", "soft", "Feature"),
			Z("rounded", "purple", "soft", "Mechanic"),
			Z("agent", "green", "soft", "Character"),
			Z("artifact", "orange", "soft", "Asset"),
			Z("timeline-step", "gray", "soft", "Task"),
			Z("data-table", "purple", "soft", "Test"),
			Z("diamond", "red", "soft", "Bug"),
			Z("approval-gate", "yellow", "soft", "Release gate"),
			Z("milestone", "green", "soft", "Milestone"),
			Z("caption", void 0, void 0, "Note")
		]
	},
	{
		id: "youtube",
		label: "Video production",
		layout: "tree",
		defaultNodeType: "section-header",
		defaultEdgeKind: "plain",
		builtin: !0,
		types: [
			Z("section-header", "blue", "soft", "Script section"),
			Z("data-table", "purple", "soft", "Research"),
			Z("timeline-step", "gray", "soft", "Shot"),
			Z("artifact", "orange", "soft", "Asset"),
			Z("square", "green", "soft", "Packaging"),
			Z("approval-gate", "yellow", "soft", "Publish gate"),
			Z("milestone", "green", "soft", "Episode"),
			Z("caption", void 0, void 0, "Note")
		]
	},
	{
		id: "workflows",
		label: "Workflows",
		layout: "vertical",
		defaultNodeType: "timeline-step",
		defaultEdgeKind: "plain",
		builtin: !0,
		types: [
			Z("circle", "gray", "soft", "Start"),
			Z("agent", "blue", "soft", "Prompt step"),
			Z("timeline-step", "purple", "soft", "Tool step"),
			Z("diamond", "yellow", "soft", "Choice"),
			Z("approval-gate", "orange", "soft", "Approval"),
			Z("artifact", "green", "soft", "Artifact"),
			Z("data-table", "gray", "soft", "Run context"),
			Z("pill", "green", "soft", "Done"),
			Z("pill", "red", "soft", "Failed"),
			vs("Region", "group", "blue"),
			Z("caption", void 0, void 0, "Note")
		]
	},
	{
		id: "systems",
		label: "Systems",
		layout: "horizontal",
		defaultNodeType: "service",
		defaultEdgeKind: "async",
		builtin: !0,
		types: [
			Z("user-input", "gray", "soft", "Client"),
			Z("api-endpoint", "blue", "soft", "Endpoint"),
			Z("service", "blue", "soft", "Service"),
			Z("kafka-topic", "orange", "soft", "Topic"),
			Z("consumer-port", "orange", "soft", "Consumer"),
			Z("postgres-table", "purple", "soft", "Table"),
			Z("cache", "green", "soft", "Cache"),
			Z("outbox-relay", "yellow", "soft", "Outbox relay"),
			Z("rate-limit", "red", "soft", "Rate limit"),
			Z("circuit-breaker", "red", "soft", "Circuit breaker"),
			vs("Boundary", "group", "blue"),
			Z("caption", void 0, void 0, "Note")
		]
	},
	{
		id: "autonomous",
		label: "Autonomous systems",
		layout: "horizontal",
		defaultNodeType: "timeline-step",
		defaultEdgeKind: "plain",
		builtin: !0,
		types: [
			Z("agent", "blue", "soft"),
			Z("timeline-step", "gray", "soft"),
			Z("data-table", "purple", "soft"),
			Z("toggle", "green", "soft"),
			Z("artifact", "orange", "soft"),
			Z("approval-gate", "yellow", "soft")
		]
	}
], bs = Vr, xs = new Set(bs.map((e) => e.value)), Ss = [
	"workflows",
	"systems",
	"game",
	"youtube",
	"basic",
	"architecture",
	"jira",
	"flowchart",
	"mindmap",
	"c4",
	"uml",
	"outline",
	"autonomous"
];
function Cs(e) {
	let t = e;
	if (!t || typeof t.id != "string" || !t.id || t.id === "none" || typeof t.label != "string" || !t.label) return null;
	let n = Array.isArray(t.types) ? t.types.filter((e) => !!e && typeof e.value == "string" && Ur(e.value) && (e.color === void 0 || q(e.color)) && (e.fill === void 0 || $r(e.fill)) && (e.border === void 0 || e.border === "none" || q(e.border)) && (e.entity === void 0 || e.entity === "node" || e.entity === "container") && (e.containerType === void 0 || e.containerType === "group" || e.containerType === "c4-system" || e.containerType === "c4-container")) : [];
	return !n.length || typeof t.defaultNodeType != "string" ? null : {
		id: t.id,
		label: t.label,
		layout: t.layout,
		defaultNodeType: t.defaultNodeType,
		defaultEdgeKind: t.defaultEdgeKind,
		types: n,
		builtin: !1,
		...Ka(t)
	};
}
var ws = (e) => e.get("presets:user", []).map(Cs).filter((e) => !!e), Ts = (e) => {
	let t = new Map(ys.map((e) => [e.id, e]));
	return ws(e).forEach((e) => t.set(e.id, e)), [...t.values()];
}, Es = (e, t) => Ts(e).find((e) => e.id === t), Ds = (e, t) => typeof t == "string" && !!Es(e, t), Os = (e) => {
	let t = new Map(Ts(e).map((e) => [e.id, e])), n = /* @__PURE__ */ new Set(), r = [];
	for (let e of Ss) {
		let i = t.get(e);
		i && (r.push(i), n.add(e));
	}
	for (let e of t.values()) n.has(e.id) || r.push(e);
	return [{
		id: "none",
		label: "None"
	}, ...r.map((e) => ({
		id: e.id,
		label: e.label
	}))];
}, ks = (e, t) => e.get(Ms, []).flatMap((e) => {
	let n = e;
	if (n.preset !== t) return [];
	let r = Ns(n.entry);
	return r ? [r] : [];
}), Q = (e, t) => {
	let n = Es(e, t);
	return n ? [...n.types, ...ks(e, t)] : [
		Z("text"),
		Z("square"),
		Z("circle"),
		Z("rounded"),
		Z("diamond"),
		Z("input"),
		Z("embedding"),
		Z("dense"),
		Z("attention"),
		Z("moe"),
		Z("norm"),
		Z("output"),
		...ks(e, t)
	];
}, As = (e) => `preset:${e}`, js = "presets:user", Ms = "presets:types:user", Ns = (e) => {
	let t = e;
	return !t || typeof t.id != "string" || !t.id || typeof t.label != "string" || !t.label.trim() || !xs.has(t.value) || t.color !== void 0 && !q(t.color) || t.fill !== void 0 && !$r(t.fill) || t.border !== void 0 && t.border !== "none" && !q(t.border) ? null : {
		id: t.id,
		label: t.label.trim().slice(0, 48),
		value: t.value,
		color: t.color,
		fill: t.fill,
		border: t.border
	};
}, Ps = (e, t, n) => t !== "none" && !Ds(e, t) ? null : Ns(n);
function Fs(e, t, n) {
	let r = Ps(e, t, n);
	if (!r) return null;
	let i = e.get(Ms, []), a = i.findIndex((e) => e.preset === t && e.entry.id === r.id), o = [...i];
	return a < 0 ? o.push({
		preset: t,
		entry: r
	}) : o[a] = {
		preset: t,
		entry: r
	}, e.set(Ms, o), r;
}
function Is(e, t, n, r) {
	let i = ks(e, t).find((e) => e.id === n);
	return i ? Fs(e, t, {
		...i,
		label: r
	}) : null;
}
function Ls(e, t, n) {
	return ks(e, t).some((e) => e.id === n) ? (e.set(Ms, e.get(Ms, []).filter((e) => !(e.preset === t && e.entry.id === n))), !0) : !1;
}
var Rs = (e, t) => {
	let n = Ha[t] ?? {}, r = Es(e, t);
	return r ? {
		edges: r.edges ?? n.edges,
		titles: r.titles ?? n.titles,
		group: r.group ?? n.group,
		jump: r.jump ?? n.jump,
		contracts: r.contracts ?? n.contracts,
		keys: r.keys ?? n.keys
	} : n;
}, zs = (e, t) => Rs(e, t).edges ?? [], Bs = (e, t) => {
	let n = e.get(As(t), "none");
	return n === "none" || Ds(e, n) ? n : "none";
};
function Vs(e, t) {
	let n = Cs(t);
	if (!n) return;
	let r = e.get(js, []).filter((e) => e.id !== n.id);
	e.set(js, [...r, n]);
}
function Hs(e) {
	e("presets", ({ io: e, contexts: t, graphs: n, on: r, emit: i, model: a }) => {
		let o = () => v((e) => t.places.el(e)), s = () => Bs(e, n.current.id), c, l = () => {
			let t = s(), n = Rs(e, t);
			a.contracts.setTitleRoles(n.titles ?? {}), i("mode.changed", {
				preset: t,
				fields: n
			}), i("tool.panel.redraw", { id: "properties" });
		}, d = () => {
			let e = o();
			if (!e) return;
			let t = s();
			t === "none" ? e.removeAttribute("data-preset") : e.setAttribute("data-preset", t);
		}, f = () => {
			let t = s(), n = u("section.preset-picker"), r = u("p", { text: "Collections swap the node vocabulary and defaults for new nodes. Existing nodes and the current layout stay in place." }), i = u(".preset-choices");
			for (let n of Os(e)) {
				let e = u("button", {
					type: "button",
					text: n.label,
					class: n.id === t ? "active" : void 0,
					"aria-pressed": n.id === t ? "true" : "false",
					data: {
						command: "preset.set",
						presetChoice: n.id
					}
				});
				i.append(e);
			}
			let a = Rs(e, t), o = u(".preset-mode-card"), c = (e, t) => o.append(u("p", [u("strong", { text: e }), u("span", { text: t })]));
			return c("Vocabulary", Q(e, t).map((e) => e.label ?? _s[e.value] ?? e.value).slice(0, 6).join(" · ") || "everything"), a.edges?.length && c("Connections (K)", a.edges.map((e) => e.label).join(" · ")), a.titles?.node && c("A node name is", a.titles.node), a.titles?.edge && c("An edge label is", a.titles.edge), c("Ctrl+G makes", a.group?.label ?? "a container"), c("Jump (g) follows", a.jump?.order === "flow" ? "the flow from the start" : "document order"), c("Shift+V checks", a.contracts?.length ? `${a.contracts.length} obligations per item — press L to see the holes` : "nothing — this collection declares no obligations"), n.append(r, i, o), n;
		};
		t.commands.register([
			{
				id: "preset.open",
				label: "Choose collection",
				group: "layout",
				shortcut: "D",
				input: {
					on: "keydown",
					key: "d",
					prevent: !0
				}
			},
			{
				id: "mode.edge.arm",
				label: "Arm a connection kind",
				group: "layout",
				shortcut: "K",
				input: {
					on: "keydown",
					key: "k",
					prevent: !0
				},
				form: {
					title: "Connection kind",
					submitLabel: "Arm",
					fields: [{
						id: "entry",
						label: "Kind",
						input: "select",
						autofocus: !0,
						options: () => zs(e, s()).map((e) => ({
							value: e.id,
							label: e.label
						}))
					}],
					payload: (e) => ({ id: e.entry ?? "" })
				}
			},
			{
				id: "preset.set",
				label: "Apply collection",
				group: "layout",
				hidden: !0,
				input: {
					on: "click",
					selector: "[data-preset-choice]"
				},
				payload: ({ target: t }) => {
					let n = (t?.closest("[data-preset-choice]"))?.dataset.presetChoice;
					return { preset: Ds(e, n) ? n : "none" };
				}
			}
		]), r("preset.register", ({ preset: t }) => {
			Vs(e, t);
		}), r("preset.type.register", ({ preset: t, entry: n }) => {
			let r = Fs(e, t, n);
			if (!r?.id) {
				i("app.notice", {
					message: "Could not save that palette type.",
					level: "warn"
				});
				return;
			}
			i("preset.type.changed", {
				preset: t,
				entryId: r.id,
				change: "created"
			}), i("app.notice", { message: `Saved “${r.label}” to this collection.` });
		}), r("preset.type.rename", ({ preset: t, entryId: n, label: r }) => {
			let a = Is(e, t, n, r);
			if (!a?.id) {
				i("app.notice", {
					message: "Could not rename that palette type.",
					level: "warn"
				});
				return;
			}
			i("preset.type.changed", {
				preset: t,
				entryId: n,
				change: "renamed"
			}), i("app.notice", { message: `Renamed palette type to “${a.label}”.` });
		}), r("preset.type.delete", ({ preset: t, entryId: n }) => {
			Ls(e, t, n) && (i("preset.type.deleted", {
				preset: t,
				entryId: n
			}), i("app.notice", { message: "Palette type deleted." }));
		}), r("mode.edge.arm", ({ id: t }) => {
			let n = zs(e, s()).find((e) => e.id === t);
			if (!n) {
				i("app.notice", { message: "This collection has no connection kinds." });
				return;
			}
			c = n, i("mode.edge.armed", {
				id: n.id,
				label: n.label
			}), i("app.notice", { message: `Next connection: ${n.label}.` });
		}), r("preset.open", () => {
			i("modal.open", {
				title: "Choose collection",
				visual: "properties",
				body: f
			});
		}), r("preset.set", ({ preset: t }) => {
			let r = Ds(e, t) ? t : "none";
			e.set(As(n.current.id), r), d(), i("preset.changed", { preset: r }), l(), i("modal.close");
		}), r("graph.edge.created", ({ id: t, edge: n }) => {
			if (c) {
				i("item.update", {
					ref: ht(t),
					patch: {
						EdgeKind: n.EdgeKind ?? c.kind,
						...c.relation && !n.Relation ? { Relation: c.relation } : {},
						...c.color && !n.Color ? { Color: c.color } : {},
						...c.event && !n.Label?.text ? { Label: { text: c.event } } : {}
					}
				});
				return;
			}
			let r = Es(e, s())?.defaultEdgeKind;
			!r || n.EdgeKind || i("item.update", {
				ref: ht(t),
				patch: { EdgeKind: r }
			});
		}), r("app.start", () => {
			queueMicrotask(() => {
				d(), l();
			});
		}), r("graph.switched", () => {
			d(), l();
		});
	}, { requires: ["render", "graph"] });
}
//#endregion
//#region canvas/systems/palette-custom-type-commands.ts
var Us = (e) => {
	if (!e?.trim()) return "Give this type a name.";
	if (e.trim().length > 48) return "Type names can be up to 48 characters.";
}, Ws = ({ activeStyle: e, presetId: t, selectedNode: n, typeForms: r }) => [
	{
		id: "palette.custom-type.create",
		label: "Create custom palette type",
		event: "preset.type.register",
		group: "palette",
		form: {
			title: "New palette type",
			submitLabel: "Save and use",
			shouldOpen: () => !0,
			fields: [
				{
					id: "label",
					label: "Type name",
					placeholder: "Critical service",
					autofocus: !0
				},
				{
					id: "shape",
					label: "Form",
					input: "select",
					options: () => [...r]
				},
				{
					id: "color",
					label: "Color",
					input: "select",
					options: () => [{
						value: "automatic",
						label: "Automatic"
					}, ...Zr]
				},
				{
					id: "fill",
					label: "Fill",
					input: "select",
					options: () => Qr
				},
				{
					id: "border",
					label: "Border",
					input: "select",
					options: () => [
						{
							value: "automatic",
							label: "Match color"
						},
						{
							value: "none",
							label: "None"
						},
						...Zr
					]
				}
			],
			seed: (t, i) => {
				let a = n(), o = e(), s = a?.NodeType ?? o.type;
				return {
					label: (i?.target)?.closest("[data-search-value]")?.dataset.searchValue?.trim() || a?.Label.text || "",
					shape: r.some((e) => e.value === s) ? s : "rounded",
					color: a?.Color ?? o.color ?? "automatic",
					fill: a?.Fill ?? o.fill ?? "soft",
					border: a?.BorderColor ?? o.border ?? "automatic"
				};
			},
			validate: (e) => {
				let t = Us(e.label);
				if (t) return t;
				if (!r.some((t) => t.value === e.shape)) return "Choose a valid form.";
				if (e.color !== "automatic" && !q(e.color)) return "Choose a valid color.";
				if (!$r(e.fill)) return "Choose a valid fill.";
				if (e.border !== "automatic" && e.border !== "none" && !q(e.border)) return "Choose a valid border.";
			},
			payload: (e) => {
				let n = e.label.trim(), r = n.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "type";
				return {
					preset: t(),
					entry: {
						id: `custom-${Date.now().toString(36)}-${r}`,
						label: n,
						value: e.shape,
						color: e.color === "automatic" ? void 0 : e.color,
						fill: e.fill,
						border: e.border === "automatic" ? void 0 : e.border
					}
				};
			}
		}
	},
	{
		id: "palette.custom-type.rename",
		label: "Rename custom palette type",
		event: "preset.type.rename",
		group: "palette",
		hidden: !0,
		payload: ({ target: e }) => {
			let t = e?.closest("[data-custom-type-id]");
			return {
				preset: t?.dataset.customTypePreset ?? "",
				entryId: t?.dataset.customTypeId ?? "",
				label: t?.dataset.customTypeLabel ?? ""
			};
		},
		form: {
			title: "Rename palette type",
			submitLabel: "Rename",
			shouldOpen: (e) => !!e?.entryId,
			fields: [
				{
					id: "preset",
					label: "",
					input: "hidden"
				},
				{
					id: "entryId",
					label: "",
					input: "hidden"
				},
				{
					id: "label",
					label: "Type name",
					autofocus: !0
				}
			],
			seed: (e) => e,
			validate: (e) => Us(e.label),
			payload: (e) => ({
				preset: e.preset,
				entryId: e.entryId,
				label: e.label.trim()
			})
		}
	},
	{
		id: "palette.custom-type.delete.request",
		label: "Delete custom palette type",
		group: "palette",
		hidden: !0,
		payload: ({ target: e }) => {
			let t = e?.closest("[data-custom-type-id]");
			return {
				preset: t?.dataset.customTypePreset ?? "",
				entryId: t?.dataset.customTypeId ?? ""
			};
		}
	},
	{
		id: "palette.custom-type.delete.confirm",
		label: "Confirm custom palette type deletion",
		group: "palette",
		hidden: !0
	}
], Gs = ({ activeStyle: t, contexts: n, isDrawing: r, isErasing: i, isPlacing: a, presetId: o, selectedEdges: s, selectedNode: c }) => {
	let l = Br.map((e) => e.id);
	return [
		{
			id: "palette.arm.entry",
			label: "Arm collection type",
			event: "palette.arm.entry",
			group: "palette",
			hidden: !0,
			payload: ({ target: e }) => {
				let t = e?.closest("[data-palette-index]");
				return {
					preset: t?.dataset.palettePreset ?? "",
					index: Number(t?.dataset.paletteIndex ?? -1)
				};
			}
		},
		...Ws({
			activeStyle: t,
			presetId: o,
			selectedNode: c,
			typeForms: bs
		}),
		{
			id: "palette.place.activate",
			label: "Add node using selected catalog type",
			group: "palette"
		},
		{
			id: "palette.node.place",
			label: "Place armed item",
			group: "palette",
			hidden: !0
		},
		{
			id: "palette.place.item",
			label: "Resolve an item click while adding",
			group: "palette",
			hidden: !0,
			input: {
				on: "pointerdown",
				selector: "[data-item-kind][data-item-id]",
				prevent: !0,
				stop: !0,
				when: (e) => a() && !r() && !i() && e.button === 0 && !e.target.closest(".tool-panel, .item-toolbar, .modal-layer, [data-command], input, textarea, select")
			},
			payload: ({ event: t, target: r }) => {
				let i = g(r), a = Fn(t);
				return i ? {
					ref: i,
					client: a,
					point: n.view.clientToSpace(e.Stage, a)
				} : void 0;
			}
		},
		{
			id: "palette.place.cancel",
			label: "Stop placing nodes",
			group: "palette",
			hidden: !0
		},
		...l.map((e) => ({
			id: `palette.arm.type.${e}`,
			label: `Arm node type: ${Wr(e)}`,
			event: "palette.arm.type",
			group: "palette",
			hidden: !0,
			available: () => !!G(e),
			payload: () => ({ type: e })
		})),
		...Zr.map(({ value: e, label: t }) => ({
			id: `palette.arm.color.${e}`,
			label: `Arm node color: ${t}`,
			event: "palette.arm.color",
			group: "palette",
			hidden: !0,
			payload: () => ({ color: e })
		})),
		{
			id: "palette.search.change",
			label: "Search node types",
			group: "palette",
			hidden: !0,
			event: "palette.search.changed",
			input: {
				on: "input",
				selector: "[data-palette-search]"
			},
			payload: ({ target: e }) => ({ query: e.value })
		},
		{
			id: "palette.search.clear",
			label: "Clear node type search",
			group: "palette",
			hidden: !0
		},
		{
			id: "palette.panel.toggle",
			label: "Node palette",
			group: "palette"
		},
		{
			id: "palette.arm.color.default",
			label: "Arm node color: collection default",
			event: "palette.arm.color",
			group: "palette",
			payload: () => ({ color: void 0 })
		},
		...Qr.map(({ value: e, label: t }) => ({
			id: `palette.arm.fill.${e}`,
			label: `Arm node fill: ${t}`,
			event: "palette.arm.fill",
			group: "palette",
			payload: () => ({ fill: e })
		})),
		...Zr.map(({ value: e, label: t }) => ({
			id: `palette.arm.border.${e}`,
			label: `Arm node border: ${t}`,
			event: "palette.arm.border",
			group: "palette",
			payload: () => ({ border: e })
		})),
		{
			id: "palette.arm.border.none",
			label: "Arm node border: none",
			event: "palette.arm.border",
			group: "palette",
			payload: () => ({ border: "none" })
		},
		{
			id: "palette.arm.border.default",
			label: "Arm node border: automatic",
			event: "palette.arm.border",
			group: "palette",
			payload: () => ({ border: void 0 })
		},
		...ei.map(({ value: e, label: t }) => ({
			id: `palette.edge.kind.${e}`,
			label: `Set selected edge kind: ${t}`,
			event: "palette.edge.kind",
			group: "palette",
			hidden: !0,
			available: () => s().length > 0,
			payload: () => ({ kind: e })
		})),
		{
			id: "palette.favorite.toggle",
			label: "Toggle favorite node type",
			group: "palette",
			hidden: !0,
			payload: ({ target: e }) => ({ key: e?.closest("[data-palette-favorite]")?.dataset.paletteFavorite ?? "" })
		},
		{
			id: "palette.mobile.toggle",
			label: "Toggle node palette",
			group: "palette",
			hidden: !0
		},
		{
			id: "palette.mobile.close",
			label: "Close node palette",
			group: "palette",
			hidden: !0
		}
	];
}, Ks = ({ contribute: e, contexts: t, emit: n, isMobileOpen: r, isPlacing: i, isText: a, origin: o, setMobileOpen: s }) => {
	t.interaction.cancel.register({
		origin: o,
		priority: 20,
		background: !1,
		blocksPointer: !1,
		active: i,
		cancel: () => n("palette.place.cancel")
	}), t.interaction.cancel.register({
		origin: `${o}.mobile`,
		priority: 40,
		background: !1,
		active: r,
		cancel: () => s(!1)
	}), t.commands.register([{
		id: "palette.mobile.tab",
		label: "Keep focus in the mobile palette",
		group: "palette",
		hidden: !0,
		input: {
			on: "keydown",
			key: "Tab",
			global: !0,
			prevent: !0,
			stop: !0,
			when: (e) => r() && t.places.width() <= 700 && !!e.target?.closest(".palette-sheet")
		},
		payload: ({ event: e }) => ({ shift: e.shiftKey })
	}]), t.storage.claimDefaults("node", o), e({
		origin: o,
		surface: "top",
		command: "palette.panel.toggle",
		kind: "button",
		icon: "commands",
		label: "Node palette",
		className: "canvas-mode-tool palette-panel-switch",
		active: () => t.places.width() <= 700 ? r() : t.fold.isOpen("palette.catalog") && t.fold.isOpen("left.panel"),
		slot: "start",
		group: "starter",
		order: 4
	}), e({
		origin: o,
		surface: "top",
		command: "palette.arm.type.text",
		kind: "button",
		icon: "text",
		label: "Text tool",
		className: "canvas-type-tool palette-text-type",
		active: a,
		slot: "start",
		group: "type",
		order: 2
	}), e({
		origin: o,
		surface: "top",
		command: "palette.place.activate",
		kind: "button",
		icon: () => a() ? "text" : "node",
		label: "Add node",
		className: "canvas-mode-tool palette-place-switch",
		active: i,
		slot: "start",
		group: "mode",
		order: 3
	});
}, qs = "palette:favorites", Js = "palette:recent", Ys = (e) => `${e.command}|${e.preset}|${e.index}|${e.type}`, $ = (e) => e.label ?? Wr(e.value), Xs = (e, t) => e.value === t.value && e.color === t.color && e.fill === t.fill && e.border === t.border && e.entity === t.entity && e.containerType === t.containerType, Zs = {
	gray: "gray",
	red: "red",
	orange: "orange",
	yellow: "yellow",
	green: "green",
	blue: "blue",
	purple: "purple",
	pink: "pink"
}, Qs = (e) => u("section.palette-block", [u("h3", { text: e })]), $s = (e, t, n = "") => u("button", {
	type: "button",
	text: n,
	title: t,
	"aria-label": t,
	data: { command: e }
}), ec = ({ catalogCache: e, contexts: t, io: n, presetId: r, primaryContainer: i, primaryEdge: a, primaryNode: o, selectedEdges: s, state: c }) => {
	let { arm: l, drawing: d, favorites: f, inkArm: p, mobileOpen: m, placing: h, recent: g, search: _ } = c, v = (e, t) => e.setAttribute("aria-pressed", t ? "true" : "false"), y = (e, t = "", n = []) => {
		let r = [
			$(e),
			e.value,
			t,
			...n
		].join(" ").toLocaleLowerCase();
		return !_ || r.includes(_.toLocaleLowerCase());
	}, b = (e, t, n, a = "palette.arm.entry", s = r(), c = a !== "palette.arm.entry") => {
		let d = $s(a, $(e));
		d.className = "palette-tile", d.dataset.paletteType = e.value, d.dataset.paletteEntity = e.entity ?? "node", d.dataset.palettePreset = s, d.dataset.paletteIndex = String(t), c && (d.dataset.paletteCatalog = ""), d.dataset.paletteSimple = a === "palette.arm.entry" ? "false" : "true", d.dataset.paletteLabel = $(e), d.dataset.paletteColor = e.color ?? "", d.dataset.paletteFillResolved = Gr(e.value, e.fill) ?? "", d.dataset.paletteBorderResolved = Kr(e.value, e.border) ?? "", d.dataset.paletteContainerType = e.containerType ?? "", d.dataset.paletteAmbiguous = n.some((n, r) => r !== t && Xs(n, e)) ? "true" : "false", e.id && (d.dataset.paletteCustomType = e.id);
		let f = G(e.value)?.visual ?? e.value, p = e.value === "operator" ? "⊕" : e.value === "caption" || e.value === "text" ? "T" : void 0;
		d.append(u(`span.palette-tile-preview.palette-shape-${f}`, {
			class: e.entity === "container" ? "palette-container-preview" : void 0,
			text: p,
			data: {
				nodeColor: e.color ?? "gray",
				fill: e.fill ?? "none",
				borderColor: e.border ?? "automatic"
			}
		}), u("span.palette-tile-label", { text: $(e) }));
		let m = o(), h = i(), g = m ? m.NodeType : l.type, _ = m ? m.Color : l.color, y = m ? Gr(m.NodeType, m.Fill) : l.fill, b = m ? Kr(m.NodeType, m.BorderColor) : l.border;
		if (a !== "palette.arm.entry") return v(d, !h && g === e.value), d;
		let x = n.some((n, r) => r !== t && Xs(n, e)), S = m ? !x || m.Label.text === $(e) : l.entryIndex === t;
		return v(d, h ? e.entity === "container" && h.ContainerType === e.containerType && h.Color === e.color : S && g === e.value && _ === e.color && y === Gr(e.value, e.fill) && b === Kr(e.value, e.border)), d;
	}, x = (e = !0) => {
		let t = [];
		Br.forEach((n) => {
			let r = {
				value: n.id,
				label: n.label
			};
			e && !y(r, n.category, n.keywords) || t.push({
				entry: r,
				index: -1,
				preset: "none",
				category: n.category,
				keywords: n.keywords ?? [],
				command: `palette.arm.type.${n.id}`
			});
		}), Ts(n).forEach((r) => Q(n, r.id).forEach((n, i) => {
			if (n.id) return;
			let a = G(n.value);
			if (!(n.entity === "container" || n.label && n.label !== a?.label)) return;
			let o = n.entity === "container" ? "Architecture" : r.label, s = [r.label, ...a?.keywords ?? []];
			e && !y(n, o, s) || t.push({
				entry: n,
				index: i,
				preset: r.id,
				category: o,
				keywords: s,
				command: "palette.arm.entry"
			});
		}));
		let r = /* @__PURE__ */ new Set();
		return t.filter(({ entry: e }) => {
			let t = [
				$(e),
				e.value,
				e.color,
				e.fill,
				e.border,
				e.entity,
				e.containerType
			].join("|");
			return !r.has(t) && (r.add(t), !0);
		});
	}, S = (e) => ({
		command: e.command,
		preset: e.preset,
		index: e.index,
		type: e.entry.value
	}), C = (e) => {
		let t = Ys(S(e)), r = f.some((e) => Ys(e) === t), i = $s("palette.favorite.toggle", `${r ? "Remove" : "Add"} ${$(e.entry)} ${r ? "from" : "to"} favorites`);
		return bn(i, r ? "star-filled" : "star"), i.className = "palette-favorite", i.dataset.paletteFavorite = t, v(i, r), u(".palette-catalog-tile-wrap", [b(e.entry, e.index, Q(n, e.preset), e.command, e.preset, !0), i]);
	}, w = (e, t, n, r) => {
		let i = Qs(e);
		i.classList.add(n);
		let a = new Map(x(!1).map((e) => [Ys(S(e)), e])), o = t.length ? t.flatMap((e) => a.get(Ys(e)) ?? []) : [];
		return i.append(o.length ? u(".palette-types", o.map(C)) : u("p.palette-reuse-empty", { text: r })), i;
	}, T = (t) => {
		let n = o(), r = i(), a = n ? n.NodeType : l.type, s = n ? n.Color : l.color, c = n ? Gr(n.NodeType, n.Fill) : l.fill, u = n ? Kr(n.NodeType, n.BorderColor) : l.border, d = JSON.stringify([
			a,
			s,
			c,
			u,
			l.entryIndex,
			r?.ContainerType,
			r?.Color,
			n?.Label.text
		]);
		return e.current?.grid === t && e.current.marked === d ? t : (e.current?.grid === t && (e.current.marked = d), t.querySelectorAll(".palette-tile[data-palette-type]").forEach((e) => {
			let t = e.dataset;
			if (t.paletteSimple === "true") {
				v(e, !r && a === t.paletteType);
				return;
			}
			let i = n ? t.paletteAmbiguous !== "true" || n.Label.text === t.paletteLabel : l.entryIndex === Number(t.paletteIndex);
			v(e, r ? t.paletteEntity === "container" && r.ContainerType === (t.paletteContainerType || void 0) && r.Color === (t.paletteColor || void 0) : i && a === t.paletteType && s === (t.paletteColor || void 0) && c === (t.paletteFillResolved || void 0) && u === (t.paletteBorderResolved || void 0));
		}), t);
	}, E = () => {
		let e = /* @__PURE__ */ new Map();
		return x().forEach((t) => (e.get(t.category) ?? e.set(t.category, []).get(t.category)).push(t)), u("section.palette-catalog-block", e.size ? [...e].flatMap(([e, t]) => [u("h4", { text: e }), u(".palette-types", t.map(C))]) : [u("p.palette-catalog-empty", { text: "No node types match." })]);
	}, D = () => {
		let e = Qs("Saved types");
		e.classList.add("palette-saved-block");
		let t = u(".palette-types");
		return [{ id: "none" }, ...Ts(n)].forEach((e) => Q(n, e.id).forEach((r, i) => {
			let a = `${$(r)} ${r.value}`.toLowerCase();
			if (!r.id || _ && !a.includes(_)) return;
			let o = Q(n, e.id), s = $s("palette.custom-type.rename", `Rename ${$(r)}`, "✎"), c = $s("palette.custom-type.delete.request", `Delete ${$(r)}`);
			c.append(yn("trash")), [s, c].forEach((t) => {
				t.dataset.customTypeId = r.id, t.dataset.customTypePreset = e.id, t.dataset.customTypeLabel = $(r);
			}), c.classList.add("danger"), t.append(u(".palette-tile-wrap.palette-tile-wrap-custom", [b(r, i, o, "palette.arm.entry", e.id), u(".palette-custom-actions", [s, c])]));
		})), t.childElementCount ? (e.append(t), e) : null;
	}, O = (e, t) => {
		let n = o(), r = a(), s = i();
		return xn({
			label: e,
			kind: "swatches",
			current: t === "color" ? n ? n.Color : r ? r.Color : s ? s.Color : l.color : n ? Kr(n.NodeType, n.BorderColor) : l.border,
			options: [
				{
					value: "",
					label: "automatic",
					labelHidden: !0,
					command: `palette.arm.${t}.default`,
					className: "palette-swatch palette-swatch-auto"
				},
				...t === "border" ? [{
					value: "none",
					label: "none",
					glyph: "⊘",
					labelHidden: !0,
					command: "palette.arm.border.none",
					className: "palette-swatch palette-swatch-none"
				}] : [],
				...Zr.map(({ value: e, label: n }) => ({
					value: e,
					label: n,
					labelHidden: !0,
					command: `palette.arm.${t}.${e}`,
					className: `palette-swatch palette-swatch-${Zs[e]}`
				}))
			]
		});
	}, k = () => {
		let e = o(), t = a(), n = i(), r = e ? e.Color : t ? t.Color : n ? n.Color : l.color, s = e ? Kr(e.NodeType, e.BorderColor) : l.border, c = e ? Gr(e.NodeType, e.Fill) : l.fill, d = (e, t, n) => u("span.palette-summary-chip", {
			class: t && t !== "none" ? `palette-swatch-${Zs[t] ?? "auto"}` : "is-empty",
			title: n,
			data: {
				summary: e,
				value: t ?? "auto"
			}
		});
		return u("span.palette-summary", [
			d("color", r, `Colour: ${r ?? "automatic"}`),
			d("border", s, `Border: ${s ?? "automatic"}`),
			u("span.palette-summary-fill", {
				text: c ?? "auto",
				title: `Fill: ${c ?? "automatic"}`
			})
		]);
	}, A = () => {
		let e = o();
		return xn({
			label: "Fill",
			kind: "segments",
			current: e ? Gr(e.NodeType, e.Fill) : l.fill,
			options: Qr.map(({ value: e, label: t }) => ({
				value: e,
				label: t,
				command: `palette.arm.fill.${e}`
			}))
		});
	}, j = () => xn({
		label: "Edge style",
		kind: "segments",
		current: a()?.EdgeKind,
		options: ei.map(({ value: e, label: t }) => ({
			value: e,
			label: t,
			command: `palette.edge.kind.${e}`
		}))
	}), M = () => u(".palette-draw.palette-style-controls", [
		u("p", { text: "Draw · drag canvas to annotate" }),
		xn({
			label: "Stroke color",
			kind: "swatches",
			current: p.color,
			options: Zr.map(({ value: e, label: t }) => ({
				value: e,
				label: t,
				labelHidden: !0,
				command: `ink.arm.color.${e}`,
				className: `palette-swatch palette-swatch-${Zs[e]}`
			}))
		}),
		xn({
			label: "Width",
			kind: "segments",
			current: String(p.width),
			options: [
				1.5,
				3,
				6
			].map((e) => ({
				value: String(e),
				label: `${e}`,
				command: `ink.arm.width.${String(e).replace(".", "-")}`
			}))
		}),
		xn({
			label: "Opacity",
			kind: "segments",
			current: String(p.opacity),
			options: [
				.25,
				.5,
				.75,
				1
			].map((e) => ({
				value: String(e),
				label: `${Math.round(e * 100)}%`,
				command: `ink.arm.opacity.${Math.round(e * 100)}`
			}))
		})
	]);
	return {
		catalogItems: x,
		deleteTypeBody: (e) => Hn({
			question: `Delete “${$(e)}” from this collection? Existing nodes will not change.`,
			keep: {
				label: "Keep type",
				command: "modal.close"
			},
			destroy: {
				label: "Delete type",
				command: "palette.custom-type.delete.confirm"
			}
		}),
		refOf: S,
		render: () => {
			let c = u(".palette-panel", { data: {
				mobileOpen: m ? "true" : "false",
				placing: h ? "true" : "false",
				drawing: d ? "true" : "false"
			} }), p = $s("palette.mobile.toggle", m ? "Close node palette" : "Open node palette", m ? "Close" : "Palette");
			p.className = "palette-mobile-toggle", p.setAttribute("aria-expanded", m ? "true" : "false");
			let v = $s("palette.mobile.close", "Close node palette");
			v.className = "palette-scrim";
			let y = t.places.width() <= 700, b = u(".palette-sheet", {
				role: y ? "dialog" : void 0,
				"aria-modal": y ? "true" : void 0,
				"aria-label": y ? "Node catalog and drawing styles" : void 0
			}), S = $s("palette.mobile.close", "Close node palette", "×");
			S.className = "palette-mobile-close", b.append(S);
			{
				let c = t.fold.isOpen("palette.catalog"), p = `${c}|${r()}|${_}`;
				f.forEach((e) => {
					p += `|f${Ys(e)}`;
				}), g.forEach((e) => {
					p += `|r${Ys(e)}`;
				}), x().forEach((e) => {
					let t = e.entry;
					p += `|c${e.preset}:${e.index}:${t.value}:${t.label ?? ""}:${t.color ?? ""}:${t.fill ?? ""}:${t.border ?? ""}:${t.entity ?? ""}:${t.containerType ?? ""}:${t.id ?? ""}`;
				}), [{ id: "none" }, ...Ts(n)].forEach((e) => Q(n, e.id).forEach((t) => {
					p += `|s${e.id}:${t.id ?? ""}:${t.label ?? ""}:${t.value}:${t.color ?? ""}:${t.fill ?? ""}:${t.border ?? ""}`;
				}));
				let m = e.current?.key === p ? e.current.grid : null;
				if (!m) {
					if (m = u(".palette-catalog-section"), c) {
						let e = u(".palette-catalog-region", { data: { nativeScroll: "" } });
						!_ && f.length && e.append(w("Favorites", f, "palette-favorites-block", "")), !_ && g.length && e.append(w("Recent", g, "palette-recent-block", "")), e.append(E());
						let t = D();
						t?.classList.add("palette-saved-pinned"), m.append(e), t && m.append(t);
					}
					e.current = {
						key: p,
						grid: m,
						marked: JSON.stringify([
							o() ? o().NodeType : l.type,
							o() ? o().Color : l.color,
							o() ? Gr(o().NodeType, o().Fill) : l.fill,
							o() ? Kr(o().NodeType, o().BorderColor) : l.border,
							l.entryIndex,
							i()?.ContainerType,
							i()?.Color,
							o()?.Label.text
						])
					};
				}
				T(m);
				let h = u(".palette-style-controls"), v = !o() && !a() && !i(), y = Wn({
					id: "palette.style",
					label: "Style",
					open: t.fold.isOpen("palette.style", !1),
					defaultOpen: !1,
					summary: k(),
					body: () => [
						O("Color", "color"),
						A(),
						O("Border", "border")
					]
				});
				v && h.append(y), s().length && h.append(j()), b.append(m), d ? b.append(M()) : b.append(h);
			}
			return c.append(p, v, b), c;
		}
	};
};
//#endregion
//#region canvas/systems/palette.ts
function tc(t) {
	t("palette", ({ on: t, emit: n, contexts: r, graphs: i, io: a, selection: o, declarePanel: s, contribute: c, origin: l, frameLoop: u }) => {
		let d = !1, f = !1, p = null, m = !1, h = !1, _ = null, v = !1, y = !1, b = {
			color: "pink",
			width: 3,
			opacity: 1
		}, x = "", S = (e) => a.get(e, []).flatMap((e) => {
			if (!e || typeof e != "object") return [];
			let t = e;
			return typeof t.command == "string" && typeof t.preset == "string" && Number.isInteger(t.index) && typeof t.type == "string" ? [t] : [];
		}), C = S(qs), w = S(Js), T = (e) => {
			let t = Ys(e);
			w = [e, ...w.filter((e) => Ys(e) !== t)].slice(0, 6), a.set(Js, w);
		}, E = () => Bs(a, i.current.id), D = () => {
			let e = Q(a, E()), t = Es(a, E())?.defaultNodeType ?? e[0]?.value ?? "text", n = Math.max(0, e.findIndex((e) => e.value === t)), r = e[n] ?? e[0], i = r?.value ?? "text";
			return {
				type: i,
				color: r?.color,
				fill: Gr(i, r?.fill),
				border: Kr(i, r?.border),
				entity: r?.entity,
				containerType: r?.containerType,
				label: r ? $(r) : void 0,
				entryIndex: n,
				entryId: r?.id
			};
		}, O = D(), k = () => {
			let e = fe(), t = me(), n = pe();
			return JSON.stringify([
				e && [
					e.NodeType,
					e.Color,
					e.Fill,
					e.BorderColor,
					e.Label?.text
				],
				t && [t.ContainerType, t.Color],
				n && [n.EdgeKind, n.Color],
				ee().length
			]);
		}, A = "", j = () => {
			A = k(), !m && (m = !0, queueMicrotask(() => {
				m = !1, h || n("tool.panel.redraw", { id: "palette" });
			}));
		}, M = (t) => {
			f !== t && (t && (p = document.activeElement instanceof HTMLElement ? document.activeElement : null), f = t, j(), n("tool.panel.redraw", { id: "top" }), u.schedule("palette.mobile.focus.prepare", () => {
				u.schedule("palette.mobile.focus.commit", () => {
					if (f) {
						r.places.el(e.Left)?.querySelector(".palette-mobile-close")?.focus({ preventScroll: !0 });
						return;
					}
					let t = p;
					if (p = null, t?.isConnected) t.focus({ preventScroll: !0 });
					else {
						let t = r.places.el(e.Top)?.querySelector("[data-command=\"palette.panel.toggle\"]"), n = r.places.el(e.Left)?.querySelector(".palette-mobile-toggle");
						(t ?? n)?.focus({ preventScroll: !0 });
					}
				}, 45);
			}, 45));
		}, N = () => r.places.el(e.Stage), P = (e) => {
			let t = d !== e;
			d = e, N()?.classList.toggle("node-placing", e), j(), t && (n("palette.placement.changed", { active: e }), n("tool.panel.redraw", { id: "top" }));
		}, F = () => o.selectedAll(), I = () => F().filter((e) => e.kind === "node"), ee = () => F().filter((e) => e.kind === "edge"), te = () => F().filter((e) => e.kind === "container"), ne = (e) => {
			I().forEach((t) => n("item.update", {
				ref: B(t.id),
				patch: e(t.id)
			}));
		}, re = (e) => {
			ee().forEach((t) => n("item.update", {
				ref: ht(t.id),
				patch: e
			}));
		}, ie = (e) => {
			te().forEach((t) => n("item.update", {
				ref: t,
				patch: e
			}));
		}, ae = (e, t, n = E()) => {
			O = {
				...O,
				type: e.value,
				color: e.color,
				fill: Gr(e.value, e.fill),
				border: Kr(e.value, e.border),
				entity: e.entity,
				containerType: e.containerType,
				label: $(e),
				entryIndex: t,
				entryId: e.id,
				entryPreset: n
			};
		}, oe = () => {
			v && n("ink.toggle"), y && n("ink.erase.toggle"), P(!0), ue();
		}, se = ({ x: e, y: t }) => {
			let n = N();
			if (n) return [...n.querySelectorAll(".container[data-item-id]")].filter((n) => {
				let r = n.getBoundingClientRect();
				return e >= r.left && e <= r.right && t >= r.top && t <= r.bottom;
			}).map((e) => {
				let t = g(e), n = e.getBoundingClientRect();
				return t?.kind === "container" ? {
					id: t.id,
					depth: r.hierarchy.parentChain(t).length,
					area: n.width * n.height
				} : null;
			}).filter((e) => !!e).sort((e, t) => t.depth - e.depth || e.area - t.area)[0]?.id;
		}, ce = (e, r) => {
			if (O.entity === "container") {
				let a = i.current.itemsOfKind("container").filter((e) => e.ContainerType === O.containerType && e.Color === O.color).length;
				if (r) {
					let e = t("container.created", ({ id: t }) => {
						e(), n("container.add-child", {
							containerId: r,
							childRef: {
								kind: "container",
								id: t
							}
						});
					});
				}
				n("editing.container.create", {
					Label: { text: `${O.label ?? "Container"} ${a + 1}` },
					at: e,
					ContainerType: O.containerType,
					Color: O.color
				});
				return;
			}
			let a = G(O.type)?.defaultSize;
			if (r) {
				let e = t("graph.node.created", ({ id: t }) => {
					e(), n("container.add-child", {
						containerId: r,
						childRef: B(t)
					});
				});
			}
			n("graph.node.create", {
				Label: { text: O.label ?? `Node ${i.current.nodes().length + 1}` },
				Position: e,
				NodeType: O.type,
				Color: O.color,
				Fill: O.fill,
				BorderColor: O.border,
				...a ? { Size: a } : {},
				keepView: !0
			});
		}, le = (t, o, s = E()) => {
			let c = Q(a, s), l = s === "jira" || c.some((e, n) => n !== o && Xs(e, t));
			ae(t, o, s), t.entity === "container" ? I().length ? n("selection.group.as", {
				label: $(t),
				containerType: t.containerType,
				color: t.color
			}) : te().length && ie({
				ContainerType: t.containerType,
				Color: t.color
			}) : ne((e) => {
				let n = i.current.getNode(e), r = {
					NodeType: O.type,
					Color: O.color,
					Fill: O.fill,
					BorderColor: O.border,
					...l ? { Label: { text: $(t) } } : {}
				}, a = G(O.type)?.defaultSize;
				return n && a && (O.type === "operator" || O.type === "diamond" || qr(n.Size)) && (r.Size = a), r;
			});
			let u = t.entity === "container" ? I().length + te().length : I().length;
			oe(), !u && (ce(r.view.spaceCenter(e.Stage)), P(!1));
		}, ue = () => {
			n("palette.arm.changed", { ...O }), j(), n("tool.panel.redraw", { id: "top" }), n("tool.panel.redraw", { id: "properties" });
		}, de = () => {
			O = D(), ue();
		}, fe = () => {
			let e = o.selected();
			return e?.kind === "node" ? i.current.getNode(e.id) : void 0;
		}, pe = () => {
			let e = o.selected();
			return e?.kind === "edge" ? i.current.getEdge(e.id) : void 0;
		}, me = () => {
			let e = o.selected();
			return e?.kind === "container" ? i.current.getItem(e) : void 0;
		};
		r.commands.register(Gs({
			activeStyle: () => O,
			contexts: r,
			isDrawing: () => v,
			isErasing: () => y,
			isPlacing: () => d,
			presetId: E,
			selectedEdges: ee,
			selectedNode: fe
		}));
		let he = { current: null }, ge = () => ec({
			catalogCache: he,
			contexts: r,
			io: a,
			presetId: E,
			primaryContainer: me,
			primaryEdge: pe,
			primaryNode: fe,
			selectedEdges: ee,
			state: {
				arm: O,
				drawing: v,
				favorites: C,
				inkArm: b,
				mobileOpen: f,
				placing: d,
				recent: w,
				search: x
			}
		});
		return s({
			id: "palette",
			anchor: "top-left",
			place: e.Left,
			movable: !1,
			layout: "custom",
			dock: {
				command: "palette.panel.toggle",
				label: "Node palette",
				icon: "node",
				active: () => r.places.width() <= 700 ? f : r.fold.isOpen("palette.catalog") && r.fold.isOpen("left.panel")
			},
			section: () => ({
				label: "Node types",
				foldId: "palette.catalog"
			}),
			render: () => ge().render(),
			order: 1
		}), t("palette.arm.entry", ({ preset: e, index: t }) => {
			let n = Q(a, e)[t];
			n && (T({
				command: "palette.arm.entry",
				preset: e,
				index: t,
				type: n.value
			}), le(n, t, e));
		}), t("palette.favorite.toggle", ({ key: e }) => {
			let t = ge(), n = t.catalogItems(!1).find((n) => Ys(t.refOf(n)) === e);
			n && (C = C.some((t) => Ys(t) === e) ? C.filter((t) => Ys(t) !== e) : [t.refOf(n), ...C].slice(0, 12), a.set(qs, C), j());
		}), t("fold.changed", ({ id: e }) => {
			(e === "palette.catalog" || e === "palette.style" || e === "palette.panel") && j();
		}), t("preset.type.changed", ({ preset: e, entryId: t, change: n }) => {
			if (e !== E()) return;
			let i = Q(a, e), o = i.findIndex((e) => e.id === t);
			if (o < 0) return j();
			let s = i[o];
			if (n === "created") {
				r.fold.set("palette.catalog", !0), ae(s, o), oe();
				return;
			}
			O.entryId === t ? (O = {
				...O,
				label: $(s),
				entryIndex: o
			}, ue()) : j();
		}), t("preset.type.deleted", ({ preset: e, entryId: t }) => {
			if (e === E()) {
				if (O.entryId === t) {
					P(!1), de();
					return;
				}
				if (O.entryId) {
					let t = Q(a, e).findIndex((e) => e.id === O.entryId);
					t >= 0 && (O = {
						...O,
						entryIndex: t
					});
				}
				j();
			}
		}), t("palette.custom-type.delete.request", ({ preset: e, entryId: t }) => {
			let r = Q(a, e).find((e) => e.id === t);
			r && (_ = {
				preset: e,
				entryId: t
			}, n("modal.open", {
				title: "Delete palette type?",
				visual: "properties",
				body: ge().deleteTypeBody(r)
			}));
		}), t("palette.custom-type.delete.confirm", () => {
			if (!_) return;
			let e = _;
			_ = null, n("preset.type.delete", e), n("modal.close");
		}), t("palette.arm.type", ({ type: e }) => {
			let t = G(e);
			t && (T({
				command: `palette.arm.type.${e}`,
				preset: "none",
				index: -1,
				type: e
			}), le({
				value: t.id,
				label: t.label
			}, -1));
		}), t("palette.arm.sync-type", ({ type: e }) => {
			let t = G(e);
			t && (O = {
				...O,
				type: e,
				fill: t.defaultFill,
				border: t.defaultBorder,
				entity: "node",
				containerType: void 0,
				label: t.label,
				entryIndex: void 0,
				entryId: void 0,
				entryPreset: void 0
			}, ue());
		}), t("palette.arm.sync-color", ({ color: e }) => {
			e !== void 0 && !q(e) || (O = {
				...O,
				color: e
			}, ue());
		}), t("palette.arm.color", ({ color: e }) => {
			e !== void 0 && !q(e) || (O = {
				...O,
				color: e
			}, ne(() => ({ Color: e })), re({ Color: e }), ie({ Color: e }), ue());
		}), t("palette.arm.fill", ({ fill: e }) => {
			$r(e) && (O = {
				...O,
				fill: e
			}, ne(() => ({ Fill: e })), ue());
		}), t("palette.arm.border", ({ border: e }) => {
			e !== void 0 && e !== "none" && !q(e) || (O = {
				...O,
				border: e
			}, ne(() => ({ BorderColor: e })), ue());
		}), t("palette.edge.kind", ({ kind: e }) => {
			ti(e) && (re({ EdgeKind: e }), j());
		}), t("palette.node.place", ({ point: e, containerId: t }) => {
			v || y || ce(e, t);
		}), t("canvas.tapped", ({ point: t }) => {
			v || y || ce(r.view.clientToSpace(e.Stage, t), se(t));
		}), t("palette.place.item", ({ ref: e, point: t, client: r }) => {
			if (!(!d || v || y)) {
				if (e.kind === "container") {
					ce(t, se(r) ?? e.id);
					return;
				}
				P(!1), n("selection.item.select", e);
			}
		}), t("palette.place.activate", () => {
			d || (oe(), ce(r.view.spaceCenter(e.Stage)));
		}), t("palette.place.cancel", () => P(!1)), t("palette.mobile.toggle", () => M(!f)), t("palette.mobile.close", () => M(!1)), t("palette.mobile.tab", ({ shift: t }) => {
			let n = r.places.el(e.Left)?.querySelector(".palette-sheet"), i = Array.from(n?.querySelectorAll("button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex=\"-1\"])") ?? []);
			if (!i.length) return;
			let a = i.indexOf(document.activeElement);
			i[a < 0 ? t ? i.length - 1 : 0 : (a + (t ? -1 : 1) + i.length) % i.length]?.focus({ preventScroll: !0 });
		}), t("palette.search.changed", ({ query: e }) => {
			x = e.trimStart(), j();
		}), t("palette.panel.toggle", () => {
			let e = r.places.width() <= 700, t = e ? f : r.fold.isOpen("palette.catalog") && r.fold.isOpen("left.panel");
			r.fold.set("left.panel", !t), r.fold.set("palette.catalog", !t), e && M(!t);
		}), t("palette.search.clear", () => {
			x = "", n("palette.search.changed", { query: x }), j();
		}), t("selection.changed", () => {
			f && M(!1), k() !== A && j();
		}), t("preset.changed", () => {
			P(!1), de();
		}), t("graph.switched", () => {
			P(!1), de();
		}), t("ink.mode.changed", (e) => {
			v = e.drawing, v && (P(!1), r.places.width() <= 700 ? M(!0) : (r.fold.set("left.panel", !0), r.fold.set("palette.catalog", !0), r.fold.set("palette.panel", !0))), j();
		}), t("ink.erase.mode.changed", (e) => {
			y = e.erasing, y && P(!1), j();
		}), t("ink.arm.changed", (e) => {
			b = e, j();
		}), t("graph.node.created", ({ id: e, styleExplicit: t }) => {
			if (O.entity === "container" || t) return;
			let r = i.current.getNode(e);
			if (!r) return;
			if (t === void 0) {
				let e = Es(a, E()), t = e?.types.find((t) => t.value === e.defaultNodeType), n = r.NodeType === "text" && r.Color === void 0 && r.Fill === void 0 && r.BorderColor === void 0, i = !!e && r.NodeType === e.defaultNodeType && r.Color === t?.color && r.Fill === t?.fill && r.BorderColor === void 0;
				if (!n && !i) return;
			}
			let o = {
				NodeType: O.type,
				Color: O.color,
				Fill: O.fill,
				BorderColor: O.border
			}, s = O.entryPreset ?? E(), c = Q(a, s), l = O.entryIndex === void 0 ? void 0 : c[O.entryIndex];
			l && (l.id || s === "jira" || c.some((e, t) => t !== O.entryIndex && Xs(e, l))) && (o.Label = { text: $(l) });
			let u = G(O.type)?.defaultSize;
			u && (O.type === "operator" || O.type === "diamond" || qr(r.Size)) && (o.Size = u), n("item.update", {
				ref: B(e),
				patch: o
			}), f && M(!1);
		}), Ks({
			contribute: c,
			contexts: r,
			emit: n,
			isMobileOpen: () => f,
			isPlacing: () => d,
			isText: () => O.type === "text",
			origin: l,
			setMobileOpen: M
		}), t("app.start", () => {
			N()?.classList.toggle("node-placing", d);
			let e = r.fold.all();
			["palette.style", "palette.panel"].forEach((t) => {
				Object.prototype.hasOwnProperty.call(e, t) || r.fold.set(t, !1);
			}), j();
		}), () => {
			h = !0, N()?.classList.remove("node-placing"), d = !1, f = !1, x = "", O = D();
		};
	}, { requires: ["graph", "render.stage"] });
}
//#endregion
//#region canvas/core/mount.ts
var nc = null, rc = () => {
	if (nc) return nc;
	let e = document.getElementById("app");
	if (!e) throw Error("mountRoot: no element set and no #app in document");
	return e;
};
//#endregion
//#region canvas/systems/render.ts
function ic(t) {
	t("render", (t) => {
		let { on: n, emit: r, bus: i, contexts: a, frameLoop: o } = t, s = a.places.root() ?? rc(), c = /* @__PURE__ */ new Map(), l = /* @__PURE__ */ new Map(), u = (e) => e.replace(/\\/g, "\\\\").replace(/"/g, "\\\""), d = (e) => {
			let t = f(e.parent);
			return `[data-item-kind="${u(e.kind)}"][data-item-id="${u(e.id)}"]${t ? `[data-item-parent="${u(t)}"]` : ":not([data-item-parent])"}`;
		}, p = () => !a.places.root() || s.contains(document.activeElement) ? document.activeElement : null, m = () => !!a.places.el(e.Modal)?.querySelector(".modal-layer"), h = () => {
			let e = p();
			lt(e) || e?.closest("[data-item-kind][data-item-id]") && typeof e.blur == "function" && e.blur();
		}, g = (e) => typeof e == "function" ? e() : e, _ = (e) => l.get(e) ?? l.set(e, /* @__PURE__ */ new Map()).get(e), v = (e, t) => (e instanceof HTMLElement && (e.dataset.renderKey = t), e), y = (e, t, n) => {
			[...e.children].forEach((e) => {
				e !== n && e instanceof HTMLElement && e.dataset.renderKey === t && e.remove();
			});
		}, b = (e) => {
			let t = p();
			if (!lt(t) || !(e instanceof Element) || !e.contains(t)) return null;
			let n = t, r = [];
			for (let t = n; t && t !== e; t = t.parentElement) r.unshift([...t.parentElement?.children ?? []].indexOf(t));
			let i = n.dataset?.field ? `[data-field="${n.dataset.field}"]` : n.getAttribute("name") ? `[name="${n.getAttribute("name")}"]` : n.dataset?.command ? `[data-command="${n.dataset.command}"]` : n.classList[0] ? `.${n.classList[0]}` : null, a = null, o = null;
			try {
				a = n.selectionStart ?? null, o = n.selectionEnd ?? null;
			} catch {}
			return {
				selector: i,
				path: r,
				start: a,
				end: o
			};
		}, x = (e, t) => {
			if (!t || !(e instanceof Element)) return;
			let n = t.selector ? e.matches(t.selector) ? e : e.querySelector(t.selector) : null;
			if (!n) {
				let r = e;
				for (let e of t.path) if (r = r?.children[e] ?? null, !r) break;
				n = r;
			}
			if (!(!(n instanceof HTMLElement) || !lt(n)) && (n.focus({ preventScroll: !0 }), t.start != null)) try {
				n.setSelectionRange?.(t.start, t.end ?? t.start);
			} catch {}
		}, S = (e, t, n) => {
			let r = a.places.el(e);
			if (!r) return;
			let i = _(e), o = i.get(t), s = b(o), c = v(g(n), t);
			if (y(r, t, o), o === c) {
				o.parentNode !== r && r.append(o);
				return;
			}
			o?.parentNode ? o.parentNode.replaceChild(c, o) : r.append(c), i.set(t, c), x(c, s);
		}, C = (e) => {
			let t = a.places.el(e), n = c.get(e);
			if (!t || !n) return;
			let r = _(e);
			n.forEach((e, n) => {
				let i = v(r.get(n) ?? g(e), n);
				y(t, n, i), r.set(n, i), t.append(i);
			});
		};
		n("render.shell", () => {
			s.replaceChildren(a.templates.clone("shell")), Object.values(e).forEach((e) => a.places.set(e, s.querySelector(`[data-place="${e}"]`))), Object.values(e).forEach(C);
		}), n("render.view.set", ({ place: e, key: t = "default", view: n }) => {
			(c.get(e) || c.set(e, /* @__PURE__ */ new Map()).get(e)).set(t, n), S(e, t, n);
		}), n("render.view.clear", ({ place: e, key: t }) => {
			if (t) {
				let n = c.get(e);
				if (!n?.has(t)) return;
				n.delete(t);
				let r = l.get(e)?.get(t);
				r?.parentNode?.removeChild(r), l.get(e)?.delete(t);
			} else {
				if (!c.has(e)) return;
				c.delete(e), l.get(e)?.forEach((e) => e.parentNode?.removeChild(e)), l.delete(e);
			}
		});
		let w = /* @__PURE__ */ new Set(), T = /* @__PURE__ */ new Map(), E = !1, D = (e, t) => {
			let n = t;
			if (!n) return null;
			if (n.kind && n.id) return n;
			let r = typeof n.id == "string" ? n.id : void 0;
			return r ? e.startsWith("graph.node.") ? {
				kind: "node",
				id: r
			} : e.startsWith("graph.edge.") ? {
				kind: "edge",
				id: r
			} : e.includes(".node.") ? {
				kind: "node",
				id: r
			} : e.includes(".edge.") ? {
				kind: "edge",
				id: r
			} : null : null;
		}, O = (e) => a.hierarchy.parentChain(e).forEach((e) => {
			T.set(R(e), e);
		}), k = 0, A = !1, j = "", M = 0, N = 0, P = 0, F = null, I = !1, ee = () => {
			if (I && (I = !1, h()), !F) return;
			if (m()) {
				F = null;
				return;
			}
			let t = [...a.places.el(e.Stage)?.querySelectorAll(d(F)) ?? []].find((e) => !e.closest(".tool-panel, .item-toolbar"));
			F = null;
			let n = t;
			typeof n?.focus == "function" && n.focus({ preventScroll: !0 });
		}, te = () => {
			let n = performance.now();
			k++;
			let i = t.perf.enabled(), o = i ? [...w].join(",") : "", s = j || "unknown", c = w.has("nodes") || w.has("nodes.visual"), l = i ? c ? (E ? "FULL" : `PATCH(${[...T].map(([e]) => e).join(",")})`) + (w.has("nodes") ? "" : "△") : w.has("camera") ? "CAMERA" : "OUTLINE" : "", u = M ? n - M : 0, d = M ? `${u.toFixed(1)}ms` : "-";
			M = n, j = "", t.perf.count("Render.flush"), t.perf.sample("Render.flush.dirtyScopes", w.size), u > 0 && t.perf.sample("Render.flush.gapMs", u), c ? (t.perf.count("Render.flush.nodes"), t.perf.sample("Render.flush.refs", T.size), r("render.stage.draw", {
				full: E,
				refs: [...T.values()]
			})) : w.has("camera") && (t.perf.count("Render.flush.camera"), r("render.stage.camera")), w.has("outline") && (t.perf.count("Render.flush.outline"), r("outline.draw")), w.clear(), T.clear(), E = !1;
			let f = N;
			N = 0, A = !1;
			let p = performance.now() - n;
			if (t.perf.sample("Render.flush.ms", p), p > 16.7 && t.perf.count("Render.flush.overBudget"), queueMicrotask(ee), i) {
				let t = a.places.el(e.Stage)?.querySelectorAll("*").length ?? 0, n = P ? t > P ? `+${t - P}` : `${t - P}` : "";
				P = t, console.debug(`[render] #${k} ${l} dirty=[${o}] trig="${s}" facts=${f} dom=${t}(${n}) +${d} took=${p.toFixed(1)}ms`);
			}
		}, ne = (...e) => {
			e.forEach((e) => w.add(e)), N++, !A && (A = !0, o.schedule("render.flush", te, 20));
		}, re = (e) => e === "both" ? ne("nodes", "outline") : ne(e === "nodes.visual" ? "nodes.visual" : e);
		t.expose("render", {
			flushes: () => k,
			lastTrigger: () => j,
			factsPerFrame: () => N
		}), n("app.start", () => {
			j = "app.start", ne("nodes");
		}), n("focus.item.focused", (e) => {
			!e && F && T.set(R(F), F), F = e, e || (I = !0);
		}), i.onAny(({ name: e, data: t }) => {
			let n = Qn(e, t);
			if (n && (j = e, re(n), n === "nodes" || n === "nodes.visual" || n === "both")) {
				let n = D(e, t);
				if (n) T.set(R(n), n), O(n);
				else if (e === "decoration.changed") {
					let e = t?.refs;
					e?.length ? e.forEach((e) => T.set(R(e), e)) : E = !0;
				} else if (e === "selection.changed") {
					let e = t?.refs;
					e ? e.forEach((e) => T.set(R(e), e)) : E = !0;
				} else {
					let n = t;
					(e.startsWith("focus.") || e.startsWith("selection.")) && (n === null || n?.id === null) || (E = !0);
				}
			}
		});
	}, { requires: ["input"] });
}
//#endregion
//#region canvas/core/state-vector.ts
var ac = (e) => {
	if (typeof e != "object" || !e) return e;
	try {
		return structuredClone(e);
	} catch {}
	try {
		return JSON.parse(JSON.stringify(e));
	} catch {
		return e;
	}
};
function oc(t) {
	let n = /* @__PURE__ */ new Map(), r = () => ({
		current: t.graphs.current.id,
		graphs: t.graphs.all().map((e) => ({
			id: e.id,
			snapshot: e.snapshot()
		}))
	}), i = () => ({
		modal: !!t.contexts.places.el(e.Modal)?.querySelector(".modal-layer"),
		editing: t.contexts.interaction.editing.owners(),
		keyCapture: t.contexts.interaction.keys.active(),
		cancellables: t.contexts.interaction.cancel.all().length
	}), a = () => {
		let e = {};
		return Object.entries(t.contexts.fold.all()).forEach(([t, n]) => {
			n || (e[t] = !1);
		}), e;
	}, o = () => {
		let e = {};
		return n.forEach((t, n) => {
			e[n] = ac(t.capture());
		}), {
			document: r(),
			view: t.contexts.view.get(),
			fold: a(),
			selection: {
				refs: ac(t.selection.selectedAll()),
				focused: ac(t.selection.focused())
			},
			owners: e,
			transient: i()
		};
	}, s = t.bus.forward, c = () => {
		s("app.cancel", void 0), s("modal.close", void 0);
		let e = t.contexts.interaction.keys.active();
		e && t.contexts.interaction.keys.unregisterOrigin(e);
	}, l = (e) => {
		let n = new Set(e.graphs.map((e) => e.id));
		e.graphs.forEach(({ id: e, snapshot: n }) => t.graphs.create(e).replace(n)), t.graphs.switch(e.current), [...t.graphs.all()].forEach((e) => {
			if (!n.has(e.id)) {
				let n = t.graphs.delete(e.id);
				s("graph.deleted", {
					id: e.id,
					nextId: n.id
				});
			}
		});
	}, u = (e) => {
		Object.keys(t.contexts.fold.all()).forEach((n) => t.contexts.fold.set(n, e[n] ?? !0)), Object.entries(e).forEach(([e, n]) => t.contexts.fold.set(e, n));
	};
	return {
		register(e, t) {
			return n.set(e, t), () => {
				n.get(e) === t && n.delete(e);
			};
		},
		owners: () => [...n.keys()].sort(),
		capture: o,
		restore: (e) => {
			c(), l(e.document), u(e.fold), t.contexts.view.set(e.view), t.selection.choose(ac(e.selection.refs)), t.selection.focus(ac(e.selection.focused)), Object.entries(e.owners).forEach(([e, t]) => {
				n.get(e)?.restore(ac(t));
			}), s("graph.imported", { graphId: t.graphs.current.id }), s("graph.switched", { id: t.graphs.current.id });
		},
		unregisterOrigin(e) {
			n.delete(e);
		}
	};
}
//#endregion
//#region canvas/systems/state-vector.ts
function sc(e) {
	e("state.vector", (e) => {
		e.expose("state", oc(e));
	});
}
//#endregion
//#region canvas/systems/render-stage.ts
function cc(n) {
	n("render.stage", (n) => {
		let { on: r, emit: i, graphs: a, contexts: o, model: s } = n;
		o.commands.register([{
			id: "canvas.empty.create",
			label: "Create first node",
			group: "editing",
			hidden: !0
		}]), r("canvas.empty.create", () => {
			i("canvas.select"), o.commands.run("editing.node.create", { origin: "pointer" });
		});
		let c = (e, t, n) => {
			n.className && e.classList.add(...n.className.split(/\s+/).filter(Boolean)), Object.entries(n.attrs ?? {}).forEach(([n, r]) => e.setAttribute(n, tr(r, t)));
		}, l = (e, t, n) => {
			let r = u("button", {
				type: "button",
				text: tr(n.text, e, t.label),
				"aria-label": tr(n.label, e, t.label),
				data: { command: n.command }
			});
			return c(r, e, n), r;
		}, d = (e, n, r) => {
			let i = /* @__PURE__ */ new Map();
			o.affordances.entity(n).forEach(({ action: e, ui: n }) => {
				if (n.when && !n.when(r)) return;
				let a = n.slot ?? t.Header;
				(i.get(a) ?? i.set(a, []).get(a)).push({
					action: e,
					ui: n
				});
			}), i.forEach((t, n) => {
				let i = e.matches(`[data-slot="${n}"]`) ? e : e.querySelector(`[data-slot="${n}"]`);
				i instanceof HTMLElement && t.forEach(({ action: e, ui: t }) => {
					t.kind === "handler" && c(i, r, t), t.kind === "button" && i.append(l(r, e, t));
				});
			});
		}, f = (e, t) => {
			let n = [...new Set(o.decorations.modes.for(t).map((e) => e.className ?? e.mode).filter(Boolean))];
			n.length && (e.classList.add(...n), e.setAttribute("data-item-modes", n.join(" ")));
		}, p = (e) => {
			let t = s.entity(e.kind), n = a.current.getItem(e);
			return !t || !n ? null : t.render?.bounds?.(n) ?? null;
		}, h = 0, g = /* @__PURE__ */ new Map(), _ = (e, t) => {
			let n = g.get(e);
			if (!n || n.pass !== h) {
				let t = a.current.itemsOfKind(e), r = [];
				t.length <= F && t.forEach((e) => {
					let t = e.From ? a.current.getNode(e.From)?.Position : void 0, n = e.To ? a.current.getNode(e.To)?.Position : void 0;
					t && n && r.push({
						id: e.id,
						ax: t.x,
						ay: t.y,
						bx: n.x,
						by: n.y
					});
				}), n = {
					pass: h,
					lines: r
				}, g.set(e, n);
			}
			return t ? n.lines.filter((e) => e.id !== t) : n.lines;
		}, v = 0, y = (e, t) => ({
			graph: a.current,
			editable: n.flags.isOn("ability.editable"),
			nodeType: (e) => s.nodeType(e),
			refOf: (t) => {
				let n = {
					kind: e.kind,
					id: t
				}, r = o.hierarchy.parentIds(n);
				return r ? {
					...n,
					parent: r
				} : n;
			},
			tagItem: m,
			applyItemModes: f,
			wireAffordances: (n) => d(n, e, t),
			elementId: o.templates.id,
			viewportWidth: v,
			cloneTemplate: (e) => o.templates.clone(e),
			templateSlot: (e, t) => o.templates.slot(e, t),
			templateText: (e, t, n) => {
				o.templates.text(e, t, n);
			},
			parentChain: (e) => o.hierarchy.parentChain(e),
			isFolded: (e) => o.fold.folded(U(e, a.current.id)),
			boundsOf: p,
			linesOfKind: _,
			boundsInRect: (e, t) => {
				let n = s.entity(e)?.render?.bounds;
				return n ? (e === "node" ? a.current.nodeIdsInRect(Ve(t, 450)).flatMap((e) => {
					let t = a.current.getItem({
						kind: "node",
						id: e
					});
					return t ? [t] : [];
				}) : a.current.itemsOfKind(e)).flatMap((e) => {
					let r = n(e);
					return r && He(r, t) ? [r] : [];
				}) : [];
			}
		}), b = (e) => Dn(e, o.hierarchy.parentChain, o.fold, a.current.id), x = (e, t) => {
			if (e.kind !== "edge" || !t) return !1;
			let n = t;
			return [n.From, n.To].some((e) => {
				if (!e) return !1;
				let t = a.current.refById(e);
				return !!t && b(t);
			});
		}, S = () => {
			let t = o.places.el(e.Stage), n = o.view.get();
			t && (t.style.setProperty("--grid-size", `${32 * n.scale}px`), t.style.setProperty("--grid-x", `${-n.x * n.scale}px`), t.style.setProperty("--grid-y", `${-n.y * n.scale}px`), t.dataset.zoom = `${Math.round(n.scale * 100)}%`, t.dataset.zoomBand = n.scale < .5 ? "far" : n.scale < .72 ? "overview" : "detail");
		}, C = (e) => `translate(${-e.x * e.scale}px, ${-e.y * e.scale}px) scale(${e.scale})`, w = null, T = null, E = /* @__PURE__ */ new Map(), D = /* @__PURE__ */ new Map();
		r("graph.imported", () => D.clear());
		let O = (e) => o.decorations.modes.for(e).map((e) => e.mode).sort().join(","), k = (e) => `|editable:${n.flags.isOn("ability.editable")}|modes:${O(e)}|fold:${+!!o.fold.folded(U(e, a.current.id))}`, A = (e, t, n, r) => {
			let i = t.render?.signature?.(n);
			i === void 0 ? D.delete(e) : D.set(e, i + (r ? k(r) : ""));
		}, j = (e) => `${a.current.id}:${e.kind}:${e.id}:${(e.parent ?? []).join("/")}`, M = (e, t) => {
			let n = t.id;
			if (!n) return null;
			let r = {
				kind: e,
				id: n
			}, i = o.hierarchy.parentIds(r);
			return i && (r.parent = i), r;
		}, N = (e) => e.layer === "svg" ? T : w, P = (e, t) => {
			if (e.kind !== "node") return;
			let n = parseInt(e.id.replace(/^\D+/, ""), 10);
			Number.isFinite(n) && (t.style.zIndex = String(n));
		}, F = 400, I = () => {
			let t = o.view.visibleRect(e.Stage, 200);
			if (!t) return null;
			let r = a.current.nodeIdsInRect(t);
			return n.perf.sample("Render.stage.visibleNodeCandidates", r.length), new Set(r);
		}, ee = (e) => {
			let t = /* @__PURE__ */ new Map(), r = (e) => b({
				kind: e.kind,
				id: e.id
			});
			return s.entities().forEach((n) => {
				let i = n.render;
				i && (i.collect ? i.collect(a.current, r, e) : a.current.itemsOfKind(n.kind)).forEach((e) => {
					let r = M(n.kind, e);
					r && ((n.kind === "edge" ? x(r, e) : b(r)) || t.set(j(r), {
						ref: r,
						def: n,
						item: e
					}));
				});
			}), n.perf.sample("Render.stage.desiredItems", t.size), t;
		}, te = (t) => {
			v = o.places.width(), S(), h++, w || (w = o.templates.clone("nodes"), T = o.templates.slot(w, "edges"), E.clear(), D.clear(), i("render.view.set", {
				place: e.Stage,
				key: "nodes",
				view: w
			})), w.style.transform = C(o.view.get());
			let r = I(), a = ee(r), s = 0, c = 0;
			[...E.keys()].forEach((e) => {
				a.has(e) || (E.get(e)?.remove(), E.delete(e), D.delete(e), s++);
			}), a.forEach(({ ref: e, def: i, item: a }, o) => {
				if (E.has(o)) {
					t && re(e, r);
					return;
				}
				let s = n.perf.measure(`Render.entity.${i.kind}.draw`, () => i.render.draw(a, y(i, a)));
				s && (P(e, s), N(i.render).append(s), E.set(o, s), A(o, i, a, e), c++);
			}), n.perf.count("Render.stage.itemsInserted", c), n.perf.count("Render.stage.itemsRemoved", s), n.perf.sample("Render.stage.liveItems", E.size);
		}, ne = () => te(!0), re = (e, t) => {
			let r = j(e), i = E.get(r), o = s.entity(e.kind), c = o?.render, l = c ? a.current.getItem(e) : void 0, u = e.kind === "node" && !!t && !t.has(e.id), d = e.kind === "edge" && !!t && !!l && !t.has(l.From ?? "") && !t.has(l.To ?? ""), f = (e.kind === "edge" ? x(e, l) : b(e)) || u || d;
			if (!c || !l || f) {
				i?.remove(), E.delete(r), D.delete(r);
				return;
			}
			if (i && c.reposition && c.signature && c.signature(l) + k(e) === D.get(r)) {
				n.perf.count("Render.stage.reposition"), c.reposition(i, l, y(o, l));
				return;
			}
			if (i && c.update && n.perf.measure(`Render.entity.${e.kind}.update`, () => c.update(i, l, y(o, l)))) {
				A(r, o, l, e);
				return;
			}
			if (i && ae() === i) return;
			let p = n.perf.measure(`Render.entity.${e.kind}.draw`, () => c.draw(l, y(o, l)));
			if (!p) {
				i?.remove(), E.delete(r), D.delete(r);
				return;
			}
			P(e, p), i ? i.replaceWith(p) : N(c).append(p), E.set(r, p), A(r, o, l, e);
		}, ie = (e) => {
			if (!w) {
				ne();
				return;
			}
			v = o.places.width(), S(), h++, w.style.transform = C(o.view.get());
			let t = (e) => {
				let t = o.hierarchy.parentIds(e);
				return t ? {
					...e,
					parent: t
				} : e;
			}, r = /* @__PURE__ */ new Map();
			e.forEach((e) => {
				let n = t(e);
				r.set(j(n), n), (n.kind === "node" || n.kind === "container") && a.current.edgesOf(n.id).forEach((e) => {
					let n = t(ht(e.id));
					r.set(j(n), n);
				});
			});
			let i = I();
			n.perf.sample("Render.stage.patchRefs", e.length), n.perf.sample("Render.stage.patchItems", r.size), r.forEach((e) => re(e, i)), n.perf.sample("Render.stage.liveItems", E.size);
		}, ae = () => {
			let t = typeof document > "u" ? null : document.activeElement;
			return !t || !(lt(t) || t.matches?.("select")) || !o.places.el(e.Stage)?.contains(t) ? null : t.closest("[data-item-kind][data-item-id]");
		}, oe = !1, se = () => {
			let t = o.decorations.overlays.all();
			if (!t.length) {
				oe && (oe = !1, i("render.view.clear", {
					place: e.Stage,
					key: "overlays"
				}));
				return;
			}
			oe = !0, i("render.view.set", {
				place: e.Stage,
				key: "overlays",
				view: () => {
					let e = u(".item-overlays"), n = I();
					return t.forEach((t) => {
						if (t.ref.kind === "node" && n && !n.has(t.ref.id)) return;
						let r = t.ref.kind === "node" && a.current.getNode(t.ref.id), i = r ? r.Position ?? {
							x: 0,
							y: 0
						} : o.hierarchy.anchor(t.ref);
						if (!i) return;
						let s = o.view.spaceToScreen(i), c = u(".item-overlay", { class: t.className });
						m(c, t.ref), t.id && (c.dataset.overlayId = t.id), c.textContent = t.text, c.style.left = `${s.x}px`, c.style.top = `${s.y}px`, e.append(c);
					}), e;
				}
			});
		}, ce = !1, le = () => {
			if (s.entities().some((e) => e.render && a.current.itemsOfKind(e.kind).length > 0) || !n.flags.isOn("nodeLifecycle")) {
				ce && (ce = !1, i("render.view.clear", {
					place: e.Stage,
					key: "empty"
				}));
				return;
			}
			ce = !0, i("render.view.set", {
				place: e.Stage,
				key: "empty",
				view: () => gs(o)
			});
		}, ue = () => {
			w ? te(!1) : S(), se();
		};
		r("render.stage.draw", ({ full: e, refs: t }) => {
			n.perf.measure("Render.stage.draw", () => {
				e || !t?.length || !w ? (n.perf.count("Render.stage.fullDraw"), ne()) : (n.perf.count("Render.stage.patchDraw"), ie(t)), se(), le();
			});
		}), r("render.stage.camera", () => {
			n.perf.count("Render.stage.cameraDraw"), n.perf.measure("Render.stage.camera", ue);
		}), r("drag.item.start", () => o.places.el(e.Stage)?.classList.add("dragging")), r("drag.item.end", () => o.places.el(e.Stage)?.classList.remove("dragging"));
	}, { requires: ["render", "graph"] });
}
//#endregion
//#region canvas/systems/share-codecs.ts
var lc = (e) => {
	let t = "";
	return e.forEach((e) => {
		t += String.fromCharCode(e);
	}), btoa(t).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}, uc = (e) => {
	let t = e.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(e.length / 4) * 4, "="), n = atob(t);
	return Uint8Array.from(n, (e) => e.charCodeAt(0));
}, dc = async (e, t, n) => {
	let r = new (n === "compress" ? CompressionStream : DecompressionStream)(t), i = r.writable.getWriter();
	i.write(e), i.close();
	let a = r.readable.getReader(), o = [], s = 0;
	for (;;) {
		let { done: e, value: t } = await a.read();
		if (e) break;
		o.push(t), s += t.length;
	}
	let c = new Uint8Array(s), l = 0;
	for (let e of o) c.set(e, l), l += e.length;
	return c;
}, fc = (e) => dc(e, "deflate-raw", "compress"), pc = (e) => dc(e, "deflate-raw", "decompress"), mc = (e) => dc(e, "deflate", "decompress"), hc = (e) => ({
	v: 4,
	s: e
}), gc = (e) => ({
	nodes: e.n.map(([e, t, n, r, i, a, o, s]) => ({
		id: e,
		Label: { text: t },
		NodeType: n,
		Position: {
			x: r,
			y: i
		},
		Size: {
			w: a,
			h: o
		},
		...s ? { Description: s } : {}
	})),
	edges: e.e.map(([e, t, n, r, i]) => ({
		id: e,
		From: t,
		To: n,
		...r ? { EdgeKind: r } : {},
		...i ? { Label: { text: i } } : {}
	}))
}), _c = async (e) => "~" + lc(await fc(new TextEncoder().encode(JSON.stringify(hc(e))))), vc = async (e) => {
	try {
		let t = (e) => e.v === 4 ? Array.isArray(e.s?.nodes) && Array.isArray(e.s?.edges) ? e.s : null : Array.isArray(e.n) && Array.isArray(e.e) ? gc(e) : null;
		if (e.startsWith("~")) {
			let n = await pc(uc(e.slice(1)));
			return t(JSON.parse(new TextDecoder().decode(n)));
		}
		return t(JSON.parse(new TextDecoder().decode(uc(e))));
	} catch {
		return null;
	}
}, yc = (e) => Math.round(e * 1e3) / 1e3, bc = (e, t) => lc(new TextEncoder().encode(JSON.stringify([
	yc(e.x),
	yc(e.y),
	yc(e.scale),
	...t ? [
		t.kind,
		t.id,
		t.parent
	] : []
]))), xc = (e) => {
	if (!e) return null;
	try {
		let t = JSON.parse(new TextDecoder().decode(uc(e))), n = Array.isArray(t) ? t.slice(0, 3) : t?.v, r = Array.isArray(t) ? t[3] && t[4] ? [
			t[3],
			t[4],
			t[5]
		] : void 0 : t?.s;
		return !Array.isArray(n) || n.length !== 3 || !n.every(Number.isFinite) || typeof n[2] != "number" || n[2] <= 0 || r && (!Array.isArray(r) || typeof r[0] != "string" || typeof r[1] != "string") ? null : {
			view: {
				x: n[0],
				y: n[1],
				scale: n[2]
			},
			selected: r ? {
				kind: r[0],
				id: r[1],
				...Array.isArray(r[2]) && r[2].length ? { parent: r[2] } : {}
			} : null
		};
	} catch {
		return null;
	}
}, Sc = (e) => {
	try {
		let t = JSON.parse(e);
		if (!t || typeof t != "object" || Array.isArray(t)) return null;
		let n = t, r = n.snapshot && typeof n.snapshot == "object" ? n.snapshot : n;
		return !r || !Array.isArray(r.nodes) || !Array.isArray(r.edges) || !r.nodes.every((e) => !!e && typeof e == "object" && typeof e.id == "string") || !r.edges.every((e) => !!e && typeof e == "object" && typeof e.id == "string") ? null : r;
	} catch {
		return null;
	}
}, Cc = (e) => {
	let t = e.includes("#") ? e.slice(e.indexOf("#") + 1) : e, n = /(pako|base64):([A-Za-z0-9\-_+/=]+)/.exec(t);
	return n ? {
		kind: n[1],
		data: n[2]
	} : null;
}, wc = async (e) => {
	let t = Cc(e);
	if (!t) return null;
	try {
		let e = uc(t.data), n = t.kind === "pako" ? new TextDecoder().decode(await mc(e)) : new TextDecoder().decode(e), r = JSON.parse(n);
		return typeof r.code == "string" ? r.code : null;
	} catch {
		return null;
	}
}, Tc = {
	"&gt;": ">",
	"&lt;": "<",
	"&amp;": "&",
	"&quot;": "\"",
	"&#39;": "'",
	"&nbsp;": " ",
	"#quot;": "\""
}, Ec = (e) => {
	let t = e.trim().replace(/^`+|`+$/g, "").trim();
	return t = t.replace(/<\s*br\s*\/?>/gi, "\n").replace(/<\/(h[1-6]|p|li|ul|ol|div)>/gi, "\n").replace(/<li[^>]*>/gi, "\n- ").replace(/<[^>]+>/g, ""), t = t.replace(/&#\d+;|#quot;|&[a-z]+;/gi, (e) => Tc[e.toLowerCase()] ?? Tc[e] ?? e), t.split("\n").map((e) => e.trim()).filter(Boolean).join("\n");
}, Dc = (e) => {
	let t = Ec(e).split("\n");
	return {
		title: t[0] ?? "",
		description: t.slice(1).join("\n") || void 0
	};
}, Oc = {
	"[": "]",
	"(": ")",
	"{": "}",
	">": "]"
}, kc = /[A-Za-z0-9_.-]/, Ac = (e, t) => {
	let n = t;
	for (; n < e.length && /\s/.test(e[n]);) n++;
	let r = n;
	for (; n < e.length && kc.test(e[n]);) n++;
	if (n === r) return null;
	let i = e.slice(r, n), a = e[n];
	if (a && Oc[a]) {
		let t = Oc[a], r = 0, o = !1, s = n;
		for (; s < e.length; s++) {
			let n = e[s];
			if (n === "\"") o = !o;
			else if (!o && (n === a || a === "(" && n === "(")) r++;
			else if (!o && n === t && (r--, r === 0)) {
				s++;
				break;
			}
		}
		return {
			id: i,
			label: e.slice(n, s).replace(/^[[({>]+/, "").replace(/[\])}]+$/, "").replace(/^"|"$/g, ""),
			end: s
		};
	}
	return {
		id: i,
		end: n
	};
}, jc = /^\s*(?:--+\s*(?:"((?:[^"]|\n)*?)"|([^|>\n]*?))\s*)?(<--+>|--+>|--+|-\.-+>|-\.-+|==+>|==+|--[xo])\s*(?:\|\s*(?:"((?:[^"]|\n)*?)"|([^|]*))\s*\|)?/, Mc = (e) => {
	let t = e.replace(/^﻿/, "");
	t = t.replace(/^\s*---[\s\S]*?---\s*/, "");
	let n = [], r = 0, i = !1, a = "";
	for (let e of t) {
		if (e === "\"") {
			i = !i, a += e;
			continue;
		}
		if (!i && (e === "[" || e === "(" || e === "{" ? r++ : (e === "]" || e === ")" || e === "}") && (r = Math.max(0, r - 1)), (e === "\n" || e === ";") && r === 0)) {
			n.push(a), a = "";
			continue;
		}
		a += e;
	}
	n.push(a);
	let o = /^\s*(flowchart|graph|sequenceDiagram|subgraph|end\b|classDef|class\s|style\s|linkStyle|click\s|direction\s|%%|title:|accTitle|accDescr)/, s = /* @__PURE__ */ new Map(), c = [], l = !1, u = (e, t) => {
		let n = s.get(e);
		n ? t && !n.label && (n.label = t) : s.set(e, {
			id: e,
			label: t
		});
	};
	for (let e of n) {
		let t = e.trim();
		if (!t || o.test(t)) continue;
		let n = Ac(e, 0);
		if (!n) {
			l = !0;
			continue;
		}
		u(n.id, n.label);
		let r = n.end;
		for (; r < e.length;) {
			let t = e.slice(r), i = jc.exec(t);
			if (!i) {
				t.trim() && (l = !0);
				break;
			}
			let a = Ac(e, r + i[0].length);
			if (!a) {
				l = !0;
				break;
			}
			u(a.id, a.label);
			let o = i[1] ?? i[2] ?? i[4] ?? i[5];
			c.push({
				from: n.id,
				to: a.id,
				label: o?.trim() || void 0
			}), n = a, r = a.end;
		}
	}
	return {
		nodes: [...s.values()],
		edges: c,
		invalid: l
	};
}, Nc = async (e) => {
	let t = Cc(e) ? await wc(e) : e;
	if (!t) return null;
	let { nodes: n, edges: r, invalid: i } = Mc(t);
	if (!n.length || i) return null;
	let a = Math.max(1, Math.ceil(Math.sqrt(n.length)));
	return {
		nodes: n.map((e, t) => {
			let { title: n, description: r } = Dc(e.label ?? e.id);
			return {
				id: e.id,
				Label: { text: n || e.id },
				NodeType: "text",
				Position: {
					x: t % a * 300,
					y: Math.floor(t / a) * 200
				},
				Size: {
					w: 220,
					h: 120
				},
				...r ? { Description: r } : {}
			};
		}),
		edges: r.map((e, t) => ({
			id: `m-e-${t}`,
			From: e.from,
			To: e.to,
			EdgeKind: "sync",
			...e.label ? { Label: { text: Ec(e.label) } } : {}
		}))
	};
}, Pc = (e) => /(^|\n)\s*(flowchart|graph\s+(TD|TB|BT|LR|RL))/i.test(e) || !!Cc(e) || /-->|---|-\.->|==>/.test(e) && /[A-Za-z0-9_]/.test(e), Fc = {
	w: 260,
	h: 56
}, Ic = {
	w: 280,
	h: 64
}, Lc = {
	w: 240,
	h: 48
}, Rc = 24, zc = 36, Bc = 24, Vc = 18, Hc = (e) => {
	let t = [], n = [], r = [], i = 0, a = 0, o = (e) => e.children.length && e.description ? [{
		text: e.description,
		children: []
	}, ...e.children] : e.children, s = (e) => {
		let t = o(e);
		if (!t.length) return Lc;
		let n = t.map(s);
		return {
			w: n.reduce((e, t) => e + t.w, 0) + zc * (n.length - 1) + Bc * 2,
			h: Math.max(...n.map((e) => e.h)) + Bc * 2 + Vc
		};
	}, c = (e, n, l) => {
		let u = o(e);
		if (!u.length) {
			let r = `e${++i}`, a = {
				x: n,
				y: l,
				w: Lc.w,
				h: Lc.h
			};
			return t.push({
				id: r,
				Label: { text: e.text },
				NodeType: "list-item",
				Position: qe(a),
				Size: { ...Lc },
				...e.description ? { Description: e.description } : {}
			}), {
				ref: {
					kind: "node",
					id: r
				},
				rect: a
			};
		}
		let d = u.map(s), f = Math.max(...d.map((e) => e.h)), p = {
			x: n,
			y: l,
			w: d.reduce((e, t) => e + t.w, 0) + zc * (d.length - 1) + Bc * 2,
			h: f + Bc * 2 + Vc
		}, m = `c${++a}`, h = [], g = n + Bc, _ = l + Vc + Bc;
		return u.forEach((e, t) => {
			h.push(c(e, g, _ + (f - d[t].h) / 2).ref), g += d[t].w + zc;
		}), r.push({
			id: m,
			Label: { text: e.text },
			Position: qe(p),
			Size: {
				w: p.w,
				h: p.h
			},
			AutoFit: !0,
			SectionAxis: "columns",
			Children: h
		}), {
			ref: {
				kind: "container",
				id: m
			},
			rect: p
		};
	}, l = (e) => {
		if (e.kind === "node") return e.id;
		let t = r.find((t) => t.id === e.id)?.Children[0];
		return t ? l(t) : e.id;
	}, u = 0, d = [];
	return P(e).forEach((e) => {
		if (e.kind === "heading") {
			let n = e.level === 1 ? Ic : Fc, r = `e${++i}`, a = {
				x: 0,
				y: u,
				w: n.w,
				h: n.h
			};
			t.push({
				id: r,
				Label: { text: e.text },
				NodeType: "section-header",
				Position: qe(a),
				Size: { ...n },
				...e.description ? { Description: e.description } : {}
			}), d.push(r), u = a.y + a.h + Rc;
		}
		e.items.forEach((e) => {
			let t = c(e, 0, u);
			d.push(l(t.ref)), u = t.rect.y + t.rect.h + Rc;
		});
	}), d.forEach((e, t) => {
		t && n.push({
			id: `m-e-${n.length}`,
			From: d[t - 1],
			To: e,
			EdgeKind: "sync"
		});
	}), {
		snapshot: {
			schemaVersion: 1,
			nodes: t,
			edges: n,
			...r.length ? { extensions: { containers: r } } : {}
		},
		counts: {
			nodes: t.length,
			containers: r.length
		}
	};
}, Uc = (e) => {
	if (e.trimStart().startsWith("{") || Pc(e) || el(e)) return !1;
	let t = e.split("\n").find((e) => e.trim());
	return !!t && (/^#{1,6}\s/.test(t.trim()) || /^\s*(?:[-+*]|\d+[.)])\s+/.test(t));
}, Wc = {
	circle: ["((", "))"],
	operator: ["((", "))"],
	diamond: ["{", "}"],
	rounded: ["(", ")"],
	pill: ["([", "])"],
	database: ["[(", ")]"]
}, Gc = {
	async: "-.->",
	dashed: "-.->",
	residual: "-.->",
	plain: "---"
}, Kc = (e) => {
	let t = (e.extensions?.containers ?? []).filter((e) => !!e?.id), n = /* @__PURE__ */ new Set();
	return t.forEach((e) => (e.Children ?? []).forEach((e) => n.add(R(e)))), {
		containers: t,
		containerById: new Map(t.map((e) => [e.id, e])),
		nodeById: new Map(e.nodes.map((e) => [e.id, e])),
		claimed: n
	};
}, qc = (e, t = "TD") => {
	let n = /* @__PURE__ */ new Map(), r = /* @__PURE__ */ new Set(), i = (e) => {
		let t = n.get(e);
		if (t) return t;
		let i = e.replace(/[^A-Za-z0-9_]/g, "_").replace(/^_+/, "") || "n";
		/^\d/.test(i) && (i = `n${i}`);
		let a = i;
		for (let e = 2; r.has(a); e++) a = `${i}_${e}`;
		return r.add(a), n.set(e, a), a;
	}, a = (e) => (e ?? "").replace(/"/g, "#quot;").split("\n").map((e) => e.trim()).filter(Boolean).join("<br/>"), { containers: o, containerById: s, nodeById: c, claimed: l } = Kc(e), u = [`flowchart ${t}`], d = (e, t) => {
		let n = c.get(e);
		if (!n) return;
		let r = [a(n.Label?.text), a(n.Description)].filter(Boolean).join("<br/>"), [o, s] = Wc[n.NodeType ?? ""] ?? ["[", "]"];
		u.push(`${"  ".repeat(t)}${i(e)}${o}"${r || i(e)}"${s}`);
	}, f = (e, t) => {
		let n = "  ".repeat(t);
		u.push(`${n}subgraph ${i(e.id)}["${a(e.Label?.text) || i(e.id)}"]`), (e.Children ?? []).forEach((e) => {
			if (e.kind === "container") {
				let n = s.get(e.id);
				n && f(n, t + 1);
			} else d(e.id, t + 1);
		}), u.push(`${n}end`);
	};
	return o.filter((e) => !l.has(`container:${e.id}`)).forEach((e) => f(e, 1)), e.nodes.filter((e) => !l.has(`node:${e.id}`)).forEach((e) => d(e.id, 1)), e.edges.forEach((e) => {
		let t = Gc[e.EdgeKind ?? ""] ?? "-->", n = a(e.Label?.text), r = n ? t === "---" ? `-- "${n}" ---` : `${t}|"${n}"|` : t;
		u.push(`  ${i(e.From)} ${r} ${i(e.To)}`);
	}), `${u.join("\n")}\n`;
}, Jc = (e) => {
	let t = {};
	for (let n of e.matchAll(/([A-Za-z_][\w.]*)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,;\]]+))/g)) t[n[1].toLowerCase()] = (n[2] ?? n[3] ?? "").replace(/\\"/g, "\"").replace(/\\n/g, "\n");
	return t;
}, Yc = {
	box: "square",
	rect: "square",
	rectangle: "square",
	square: "square",
	circle: "circle",
	doublecircle: "circle",
	point: "circle",
	ellipse: "rounded",
	oval: "rounded",
	diamond: "diamond",
	mdiamond: "diamond",
	parallelogram: "parallelogram",
	cylinder: "database",
	box3d: "database",
	note: "text",
	plaintext: "text",
	none: "text"
}, Xc = {
	square: "box",
	circle: "circle",
	operator: "circle",
	rounded: "ellipse",
	pill: "ellipse",
	diamond: "diamond",
	parallelogram: "parallelogram",
	database: "cylinder",
	text: "box"
}, Zc = String.raw`(?:"(?:[^"\\]|\\.)*"|[A-Za-z_][\w.]*|\d+)`, Qc = (e) => e.startsWith("\"") ? e.slice(1, -1).replace(/\\"/g, "\"").replace(/\\n/g, "\n") : e, $c = (e) => e.replace(/^\uFEFF/, "").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|\s)(\/\/|#)[^\n]*/g, "$1"), el = (e) => /^\s*(strict\s+)?(di)?graph\b[^{]*\{/i.test($c(e)), tl = (e) => {
	let t = /* @__PURE__ */ new Map(), n = [], r = !1, i = (e, n) => {
		let r = t.get(e) ?? { id: e };
		return n?.label && !r.label && (r.label = n.label), n?.shape && !r.type && (r.type = Yc[n.shape.toLowerCase()]), t.set(e, r), r;
	}, a = $c(e).replace(/^\s*(?:strict\s+)?(?:di)?graph\b[^{]*\{/i, "").replace(/\bsubgraph\b[^{]*\{/gi, " ").replace(/\}/g, " "), o = new RegExp(String.raw`(${Zc})\s*((?:\s*(?:->|--)\s*${Zc})*)\s*(?:\[([^\]]*)\])?`, "g"), s = /^(node|edge|graph|rankdir|label|strict|subgraph)$/i;
	for (let e of a.split(/[;\n]/)) {
		let t = e.trim();
		if (!t || /^[\w.]+\s*=/.test(t)) continue;
		o.lastIndex = 0;
		let a = o.exec(t);
		if (!a) {
			r = !0;
			continue;
		}
		let c = Qc(a[1]);
		if (s.test(c) && !a[2]) continue;
		let l = a[3] ? Jc(a[3]) : void 0, u = [...a[2].matchAll(new RegExp(String.raw`(?:->|--)\s*(${Zc})`, "g"))].map((e) => Qc(e[1]));
		if (!u.length) {
			i(c, l);
			continue;
		}
		let d = i(c).id;
		u.forEach((e) => {
			i(e), n.push({
				from: d,
				to: e,
				label: l?.label || l?.xlabel
			}), d = e;
		});
	}
	return {
		nodes: [...t.values()],
		edges: n,
		invalid: r
	};
}, nl = (e) => {
	if (!el(e)) return null;
	let { nodes: t, edges: n, invalid: r } = tl(e);
	if (!t.length || r) return null;
	let i = Math.max(1, Math.ceil(Math.sqrt(t.length)));
	return {
		schemaVersion: 1,
		nodes: t.map((e, t) => {
			let { title: n, description: r } = Dc(e.label ?? e.id);
			return {
				id: e.id,
				Label: { text: n || e.id },
				NodeType: e.type ?? "text",
				Position: {
					x: t % i * 300,
					y: Math.floor(t / i) * 200
				},
				Size: {
					w: 220,
					h: 120
				},
				...r ? { Description: r } : {}
			};
		}),
		edges: n.map((e, t) => ({
			id: `d-e-${t}`,
			From: e.from,
			To: e.to,
			EdgeKind: "sync",
			...e.label ? { Label: { text: Ec(e.label) } } : {}
		}))
	};
}, rl = (e) => {
	let t = /* @__PURE__ */ new Map(), n = /* @__PURE__ */ new Set(), r = (e) => {
		let r = t.get(e);
		if (r) return r;
		let i = e.replace(/[^A-Za-z0-9_]/g, "_").replace(/^_+/, "") || "n";
		/^\d/.test(i) && (i = `n${i}`);
		let a = i;
		for (let e = 2; n.has(a); e++) a = `${i}_${e}`;
		return n.add(a), t.set(e, a), a;
	}, i = (e) => `"${e.replace(/"/g, "\\\"").split("\n").map((e) => e.trim()).filter(Boolean).join("\\n")}"`, { containers: a, containerById: o, nodeById: s, claimed: c } = Kc(e), l = [
		"digraph G {",
		"  rankdir=TB;",
		"  node [shape=box];"
	], u = (e, t) => {
		let n = s.get(e);
		if (!n) return;
		let a = [n.Label?.text, n.Description].filter(Boolean).join("\n"), o = Xc[n.NodeType ?? ""] ?? "box";
		l.push(`${"  ".repeat(t)}${r(e)} [label=${i(a || e)}, shape=${o}];`);
	}, d = (e, t) => {
		let n = "  ".repeat(t);
		l.push(`${n}subgraph cluster_${r(e.id)} {`), l.push(`${n}  label=${i(e.Label?.text ?? e.id)};`), (e.Children ?? []).forEach((e) => {
			if (e.kind === "container") {
				let n = o.get(e.id);
				n && d(n, t + 1);
			} else u(e.id, t + 1);
		}), l.push(`${n}}`);
	};
	return a.filter((e) => !c.has(`container:${e.id}`)).forEach((e) => d(e, 1)), e.nodes.filter((e) => !c.has(`node:${e.id}`)).forEach((e) => u(e.id, 1)), e.edges.forEach((e) => {
		let t = e.EdgeKind === "async" || e.EdgeKind === "dashed" || e.EdgeKind === "residual" ? " style=dashed" : "", n = e.Label?.text ? ` label=${i(e.Label.text)}` : "", a = n || t ? ` [${[n.trim(), t.trim()].filter(Boolean).join(", ")}]` : "";
		l.push(`  ${r(e.From)} -> ${r(e.To)}${a};`);
	}), l.push("}"), `${l.join("\n")}\n`;
}, il = 7500, al = (e) => e.length > il;
//#endregion
//#region canvas/systems/share.ts
function ol(e) {
	e("share", ({ on: e, emit: t, contexts: n, graphs: r, selection: i, contribute: a, declarePanel: o }) => {
		let s = new URLSearchParams(location.search).get("readonly") === "1", c = null;
		n.commands.register([
			{
				id: "graph.share.copy",
				label: "Share current graph",
				group: "graph"
			},
			{
				id: "graph.share.clipboard",
				label: "Copy share link",
				group: "graph",
				hidden: !0,
				input: {
					on: "click",
					selector: "[data-share-copy]"
				},
				payload: ({ target: e }) => ({ url: e?.closest(".share-link-panel")?.querySelector("[data-share-url]")?.value ?? "" })
			},
			{
				id: "graph.share.context.toggle",
				label: "Include current view in share link",
				group: "graph",
				hidden: !0,
				input: {
					on: "change",
					selector: "[data-share-context]"
				},
				payload: ({ target: e }) => ({
					checked: e.checked,
					panel: e?.closest(".share-link-panel") ?? void 0
				})
			},
			{
				id: "graph.share.readonly.toggle",
				label: "Share as a read-only view",
				group: "graph",
				hidden: !0,
				input: {
					on: "change",
					selector: "[data-share-readonly]"
				},
				payload: ({ target: e }) => ({
					checked: e.checked,
					panel: e?.closest(".share-link-panel") ?? void 0
				})
			},
			{
				id: "graph.view.adopt",
				label: "Edit a copy of this graph",
				group: "graph",
				available: () => s
			},
			{
				id: "graph.import.paste",
				label: "Import graph from clipboard",
				group: "graph"
			},
			{
				id: "graph.export.mermaid",
				label: "Copy graph as Mermaid",
				group: "graph"
			},
			{
				id: "graph.export.dot",
				label: "Copy graph as Graphviz DOT",
				group: "graph"
			},
			{
				id: "graph.import.submit",
				label: "Preview Mermaid import",
				group: "graph",
				hidden: !0,
				input: {
					on: "click",
					selector: "[data-import-submit]"
				},
				payload: ({ target: e }) => ({ source: e?.closest(".import-source")?.querySelector("[data-import-source]")?.value ?? "" })
			},
			{
				id: "graph.import.confirm",
				label: "Replace graph with import",
				group: "graph",
				hidden: !0,
				input: {
					on: "click",
					selector: "[data-import-confirm]"
				}
			},
			{
				id: "graph.import.cancel",
				label: "Cancel graph import",
				group: "graph",
				hidden: !0,
				input: {
					on: "click",
					selector: "[data-import-cancel]"
				}
			},
			{
				id: "graph.import.file.choose",
				label: "Choose Markdown file",
				group: "graph",
				hidden: !0,
				input: {
					on: "click",
					selector: "[data-import-file-choose]"
				},
				payload: ({ target: e }) => ({ input: e?.closest(".import-source")?.querySelector("[data-import-file]") ?? void 0 })
			},
			{
				id: "graph.import.file.read",
				label: "Read Markdown file",
				group: "graph",
				hidden: !0,
				input: {
					on: "change",
					selector: "[data-import-file]"
				},
				payload: ({ target: e }) => {
					let t = e;
					return {
						file: t?.files?.[0],
						textarea: t?.closest(".import-source")?.querySelector("[data-import-source]") ?? void 0
					};
				}
			},
			{
				id: "graph.import.mermaid.paste-event",
				label: "Import pasted mermaid graph",
				event: "graph.import.mermaid",
				group: "graph",
				hidden: !0,
				input: {
					on: "paste",
					global: !0,
					prevent: !0,
					stop: !0,
					when: (e) => {
						let t = e.target;
						if (t && (t.isContentEditable || /^(INPUT|TEXTAREA)$/.test(t.tagName))) return !1;
						let n = e.clipboardData?.getData("text") ?? "";
						return !!n && Pc(n);
					}
				},
				payload: ({ event: e }) => ({ source: e.clipboardData?.getData("text") ?? "" })
			},
			{
				id: "graph.import.dot.paste-event",
				label: "Import pasted Graphviz DOT graph",
				event: "graph.import.dot",
				group: "graph",
				hidden: !0,
				input: {
					on: "paste",
					global: !0,
					prevent: !0,
					stop: !0,
					when: (e) => {
						let t = e.target;
						if (t && (t.isContentEditable || /^(INPUT|TEXTAREA)$/.test(t.tagName))) return !1;
						let n = e.clipboardData?.getData("text") ?? "";
						return !!n && el(n);
					}
				},
				payload: ({ event: e }) => ({ source: e.clipboardData?.getData("text") ?? "" })
			}
		]);
		let l = (e, n = !1, r = !0) => {
			t("graph.import.snapshot", e), n && t("layout.apply.tidy"), r && t("view.fit.all");
		}, d = (e, t) => {
			let n = al(t), r = e.querySelector("[data-share-intro]"), i = e.querySelector("[data-share-url]"), a = e.querySelector("[data-share-copy]"), o = e.querySelector(".share-size"), s = e.querySelector("[data-share-fallback]");
			if (r) {
				let e = t.includes("readonly=1");
				r.textContent = n ? "This snapshot is too large for a reliable browser link. Export a file instead." : e ? "Portable snapshot link. It opens as a read-only view; the recipient can still zoom, search, and export." : "Portable snapshot link. Anyone with this URL can open an editable copy; changes do not sync back.", r.classList.toggle("share-size-warning", n);
			}
			e.toggleAttribute("data-share-too-large", n), i && (i.value = t), a && (a.disabled = n), o && (o.textContent = `${t.length.toLocaleString()} characters · graph data is embedded in the URL`), s && (s.hidden = !n);
		}, f = [[
			"Open at this view",
			"Include viewport, zoom, and selection",
			"shareContext",
			"Include viewport, zoom, and selection"
		], [
			"Read-only view",
			"Opens as a viewer — no editing, nothing saved in their browser",
			"shareReadonly",
			"Open the link as a read-only view"
		]], p = (e, t) => () => {
			let n = u("section.share-link-panel", { data: { shareView: t } }, [
				u("p", { data: { shareIntro: "" } }),
				...f.map(([e, t, n, r]) => u("label.share-context-option", [u("span", [u("strong", { text: e }), u("small", { text: t })]), u("input", {
					type: "checkbox",
					role: "switch",
					"aria-label": r,
					data: { [n]: "" }
				})])),
				u(".share-link-field", [u("input", {
					readOnly: !0,
					value: e,
					"aria-label": "Share link",
					data: { shareUrl: "" }
				}), u("button.primary.share-copy", {
					type: "button",
					text: "⧉ Copy",
					"aria-label": "Copy share link",
					data: {
						shareCopy: "",
						command: "graph.share.clipboard"
					}
				})]),
				u("small.share-size"),
				u("button.primary", {
					type: "button",
					text: "Export a file instead",
					data: {
						command: "graph.export.json",
						shareFallback: ""
					}
				})
			]);
			return d(n, e), n;
		}, m = (e, t) => () => {
			let n = (e, t) => `${e} ${t}${e === 1 ? "" : "s"}`;
			return u("section.import-preview", [
				u("p", { text: `${t}: ${n(e.nodes.length, "node")} and ${n(e.edges.length, "edge")} are ready to import.` }),
				u("p.import-warning", { text: "This replaces the current graph. You can undo after importing." }),
				u(".import-actions", [u("button", {
					type: "button",
					text: "Keep current graph",
					data: {
						command: "graph.import.cancel",
						importCancel: ""
					}
				}), u("button.primary.import-confirm", {
					type: "button",
					text: "Replace graph",
					data: {
						command: "graph.import.confirm",
						importConfirm: ""
					}
				})])
			]);
		}, h = (e, t) => () => {
			let n = u("textarea", {
				readOnly: !0,
				value: t,
				"aria-label": `${e} source`
			});
			return queueMicrotask(() => {
				n.focus(), n.select();
			}), u("section.import-source", [u("p", { text: `${e} source for this graph. Select and copy it, or paste it back here later to keep editing.` }), n]);
		}, g = (e = "") => () => u("section.import-source", [
			u("p", { text: "Paste Canvas Graph JSON, Mermaid flowchart source, a mermaid.live link, a Graphviz DOT digraph, or a Markdown outline (headings + nested lists). You will review changes before replacement." }),
			u("textarea", {
				value: e,
				autofocus: !0,
				"aria-label": "Graph JSON or Mermaid source",
				placeholder: "Paste exported JSON or: flowchart LR\n  A[Draft] --> B[Published]",
				data: { importSource: "" }
			}),
			u(".import-actions", [
				u("button.primary.import-confirm", {
					type: "button",
					text: "Preview import",
					data: {
						command: "graph.import.submit",
						importSubmit: ""
					}
				}),
				u("button", {
					type: "button",
					text: "Choose .md file",
					data: {
						command: "graph.import.file.choose",
						importFileChoose: ""
					}
				}),
				u("input", {
					type: "file",
					accept: ".md,.markdown,.txt",
					hidden: !0,
					data: { importFile: "" }
				})
			])
		]);
		e("graph.share.copy", () => {
			(async () => {
				let e = await _c(r.current.snapshot()), a = new URL(location.href);
				a.hash = "", a.searchParams.delete("in"), a.searchParams.delete("demo"), a.searchParams.delete("view"), a.searchParams.set("g", e), t("graph.shared", { url: a.toString() }), t("modal.open", {
					title: "Share graph",
					visual: "properties",
					body: p(a.toString(), bc(n.view.get(), i.selected()))
				});
			})();
		}), e("graph.share.context.toggle", ({ checked: e, panel: n }) => {
			if (!n) return;
			let r = n.querySelector("[data-share-url]");
			if (!r) return;
			let i = new URL(r.value);
			e && n.dataset.shareView ? i.searchParams.set("view", n.dataset.shareView) : i.searchParams.delete("view"), d(n, i.toString()), t("graph.shared", { url: i.toString() });
		}), e("graph.share.readonly.toggle", ({ checked: e, panel: n }) => {
			if (!n) return;
			let r = n.querySelector("[data-share-url]");
			if (!r) return;
			let i = new URL(r.value);
			e ? i.searchParams.set("readonly", "1") : i.searchParams.delete("readonly"), d(n, i.toString()), t("graph.shared", { url: i.toString() });
		}), e("graph.view.adopt", () => {
			let e = new URL(location.href);
			e.searchParams.delete("readonly"), location.assign(e.toString());
		}), e("graph.import.file.choose", ({ input: e }) => e?.click()), e("graph.import.file.read", ({ file: e, textarea: t }) => {
			if (!e || !t) return;
			let n = new FileReader();
			n.onload = () => {
				t.value = String(n.result ?? "");
			}, n.readAsText(e);
		}), e("graph.share.clipboard", ({ url: e }) => {
			e && navigator.clipboard?.writeText?.(e).then(() => t("app.notice", { message: "Share link copied." }), () => t("app.notice", {
				message: "Select the link and copy it manually.",
				level: "warn"
			}));
		});
		let _ = (e, n) => {
			let r = () => {
				t("modal.open", {
					title: `Copy as ${e}`,
					visual: "properties",
					body: h(e, n)
				}), t("app.notice", {
					message: `Clipboard unavailable — copy the ${e} source below.`,
					level: "warn"
				});
			}, i = navigator.clipboard?.writeText?.(n);
			if (!i) return r();
			i.then(() => t("app.notice", { message: `${e} copied to clipboard.` }), r);
		};
		if (e("graph.export.mermaid", () => _("Mermaid", qc(r.current.snapshot()))), e("graph.export.dot", () => _("Graphviz DOT", rl(r.current.snapshot()))), e("graph.import.dot", ({ source: e }) => {
			let n = nl(e);
			if (!n) {
				t("app.notice", {
					message: "DOT has incomplete or unsupported syntax. Nothing was changed.",
					level: "warn"
				});
				return;
			}
			c = {
				snapshot: n,
				format: "Graphviz DOT",
				tidy: !0
			}, t("modal.open", {
				title: "Review Graphviz DOT import",
				visual: "properties",
				body: m(n, "Graphviz DOT")
			});
		}), e("graph.import.mermaid", ({ source: e }) => {
			(async () => {
				let n = await Nc(e);
				if (!n) {
					t("app.notice", {
						message: "Mermaid has incomplete or unsupported syntax. Nothing was changed.",
						level: "warn"
					});
					return;
				}
				c = {
					snapshot: n,
					format: "Mermaid",
					tidy: !0
				}, t("modal.open", {
					title: "Review Mermaid import",
					visual: "properties",
					body: m(n, "Mermaid")
				});
			})();
		}), e("graph.import.markdown", ({ source: e }) => {
			let { snapshot: n, counts: r } = Hc(e);
			if (!r.nodes) {
				t("app.notice", {
					message: "No headings or list items found in the Markdown outline. Nothing was changed.",
					level: "warn"
				});
				return;
			}
			c = {
				snapshot: n,
				format: "Markdown outline",
				tidy: !1
			}, t("modal.open", {
				title: "Review Markdown outline import",
				visual: "properties",
				body: m(n, "Markdown outline")
			});
		}), e("graph.import.submit", ({ source: e }) => {
			if (!e.trim()) {
				t("app.notice", {
					message: "Paste graph JSON or Mermaid before previewing.",
					level: "warn"
				});
				return;
			}
			if (e.trimStart().startsWith("{")) {
				let n = Sc(e);
				if (!n) {
					t("app.notice", {
						message: "JSON is not a valid Canvas Graph export. Nothing was changed.",
						level: "warn"
					});
					return;
				}
				c = {
					snapshot: n,
					format: "JSON",
					tidy: !1
				}, t("modal.open", {
					title: "Review JSON import",
					visual: "properties",
					body: m(n, "JSON")
				});
				return;
			}
			if (el(e)) {
				t("graph.import.dot", { source: e });
				return;
			}
			if (Pc(e)) {
				t("graph.import.mermaid", { source: e });
				return;
			}
			if (Uc(e)) {
				t("graph.import.markdown", { source: e });
				return;
			}
			t("graph.import.mermaid", { source: e });
		}), e("graph.import.confirm", () => {
			let e = c;
			e && (c = null, l(e.snapshot, e.tidy), t("modal.close"), t("app.notice", { message: `Imported ${e.snapshot.nodes.length} nodes from ${e.format}.` }));
		}), e("graph.import.cancel", () => {
			c = null, t("modal.close");
		}), e("modal.closed", () => {
			c = null;
		}), e("graph.import.paste", () => {
			t("modal.open", {
				title: "Import graph",
				visual: "properties",
				body: g()
			});
			let e = navigator.clipboard?.readText?.();
			e && e.then((e) => {
				if (!e) return;
				let t = n.places.el("modal")?.querySelector("[data-import-source]");
				t && !t.value && (t.value = e);
			}).catch(() => void 0);
		}), e("app.start", () => {
			let e = new URLSearchParams(location.search), i = e.get("g"), a = e.get("in");
			if (i) {
				vc(i).then((i) => {
					let a = xc(e.get("view"));
					i ? (l(i, !1, !a), a && (n.view.set(a.view), t("view.changed", n.view.get()), a.selected && r.current.getItem(a.selected) && t("selection.item.select", a.selected))) : t("app.notice", {
						message: "Share link graph could not be decoded.",
						level: "warn"
					});
				});
				return;
			}
			a && t("graph.import.mermaid", { source: a });
		}), s) {
			let t = /^(graph\.(create|duplicate|delete|rename|node\.delete|edge\.delete|edge\.reverse)|graph\.import\.|editing\.|container\.|selection\.item\.delete|node\.convert\.)/;
			e("app.start", () => {
				n.commands.all().filter((e) => t.test(e.id)).forEach((e) => n.commands.setEnabled(e.id, !1));
			}), o({
				id: "read-only",
				anchor: "bottom-center",
				movable: !1,
				layout: "custom",
				order: 30,
				render: () => u(".read-only-chip", [u("span", { text: "Read-only view" })])
			});
		}
		a({
			surface: "top",
			command: "graph.import.paste",
			kind: "button",
			icon: "import",
			text: "Import",
			order: 23,
			group: "overflow"
		}), a({
			surface: "top",
			command: "graph.share.copy",
			kind: "button",
			icon: "share",
			text: "Share",
			order: 24,
			group: "overflow"
		});
	}, { requires: ["graph", "modal"] });
}
//#endregion
//#region canvas/systems/tag-model.ts
var sl = (e) => {
	if (!Array.isArray(e)) return [];
	let t = /* @__PURE__ */ new Set();
	return e.flatMap((e) => {
		if (!e || typeof e != "object") return [];
		let n = e, r = V(n.name ?? ""), i = n.color;
		return !r || t.has(r) || ![
			"gray",
			"red",
			"orange",
			"yellow",
			"green",
			"blue",
			"purple",
			"pink"
		].includes(i ?? "") ? [] : (t.add(r), [{
			name: r,
			color: i,
			visible: n.visible === !1 ? !1 : void 0
		}]);
	});
}, cl = (e, t) => {
	let n = new Map(t.map((e) => [e.name, e])), r = /* @__PURE__ */ new Map();
	return e.forEach((e) => e.tags.forEach((t) => {
		let i = V(t);
		i && (n.has(i) || n.set(i, {
			name: i,
			color: Ht(i)
		}), (r.get(i) ?? r.set(i, []).get(i)).push(e.ref));
	})), [...n.values()].map((e) => ({
		...e,
		count: r.get(e.name)?.length ?? 0,
		refs: r.get(e.name) ?? [],
		metric: Bt(e.name) ?? void 0
	})).sort((e, t) => t.count - e.count || e.name.localeCompare(t.name));
}, ll = (e) => {
	let t = /* @__PURE__ */ new Map();
	return e.forEach((e) => {
		if (!e.metric) return;
		let n = t.get(e.metric.key) ?? [];
		for (let t = 0; t < Math.max(1, e.count); t += 1) n.push(e.metric.value);
		t.set(e.metric.key, n);
	}), [...t].map(([e, t]) => ({
		key: e,
		min: Math.min(...t),
		max: Math.max(...t),
		count: t.length
	})).sort((e, t) => e.key.localeCompare(t.key));
}, ul = (e, t, n) => e.some((e) => {
	let r = Bt(e);
	return r?.key === V(t) && r.value >= n;
}), dl = (e, t, n) => {
	let r = V(t), i = n ? V(n) : "";
	return [...new Set(e.flatMap((e) => V(e) === r ? i ? [i] : [] : [V(e)]).filter(Boolean))];
}, fl = (e, t, n) => u("button", {
	type: "button",
	text: t,
	class: n,
	data: { command: e }
}), pl = (e, t, n) => {
	let r = t.length > 0 && t.every((t) => t.tags.includes(e.name)), i = { tag: e.name }, a = u("select", {
		"aria-label": `Color for ${e.name}`,
		data: {
			command: "tags.color.change",
			tag: e.name
		}
	}, Zr.map((t) => u("option", {
		value: t.value,
		text: t.label,
		selected: e.color === t.value
	}))), o = Kn({
		command: "tags.filter.toggle",
		title: `#${e.name}`,
		detail: String(e.count),
		className: "tag-manager-filter",
		data: i,
		actions: [
			...t.length ? [{
				command: "tags.selection.toggle",
				label: `${r ? "Remove" : "Add"} ${e.name} ${r ? "from" : "to"} selection`,
				glyph: r ? "✓" : "+",
				className: "tag-manager-assign",
				data: i
			}] : [],
			a,
			{
				command: "tags.definition.visibility.toggle",
				label: `${e.visible === !1 ? "Show" : "Hide"} ${e.name} chips`,
				glyph: e.visible === !1 ? "○" : "●",
				className: "tag-manager-visible",
				data: i
			},
			{
				command: "tags.rename",
				label: "Rename",
				className: "tag-manager-rename",
				data: i
			},
			{
				command: "tags.delete",
				label: `Delete tag ${e.name}`,
				icon: "trash",
				className: "tag-manager-delete",
				data: i
			}
		]
	});
	return o.classList.add("tag-manager-row"), o.dataset.tagDefinition = e.name, e.color && (o.dataset.tagColor = e.color), o.querySelector(".tag-manager-filter")?.setAttribute("aria-pressed", n ? "true" : "false"), o.querySelector(".tag-manager-assign")?.setAttribute("aria-pressed", r ? "true" : "false"), o;
}, ml = (e) => {
	let t = fl("tags.visibility.toggle", e.showTags ? "Hide chips" : "Show chips");
	t.setAttribute("aria-pressed", e.showTags ? "true" : "false");
	let n = fl("tags.present", "Present groups");
	n.disabled = !e.catalog.some((e) => e.count);
	let r = ll(e.catalog), i = e.search.trim().toLowerCase(), a = e.items.filter((t) => e.selected.some((e) => e.kind === t.ref.kind && e.id === t.ref.id)), o = e.catalog.filter((e) => !i || e.name.includes(i)).slice(0, 80);
	return u("section.tags-panel", [
		u("header", [u("strong", { text: e.selected.length ? `Tag ${e.selected.length} selected` : "Tags" }), t]),
		e.selected.length > 0 && u("input", {
			placeholder: "Add tag, e.g. estimate:3",
			"aria-label": "Add tag to selection",
			data: { tagsSelectionAdd: "" }
		}),
		u(".tags-actions", [n, e.active.size > 0 && fl("tags.filter.clear", "Clear filter")]),
		r.length > 0 && u(".tag-metric-summary", [...r.map((e) => u("span", { text: `${e.key}: ${e.min}–${e.max}` })), fl("tags.metric.highlight", "Highlight metric…")]),
		Jn({
			label: "tags",
			className: "tag-manager-list",
			scroll: !0,
			items: o.map((t) => pl(t, a, e.active.has(t.name))),
			empty: e.catalog.length ? "No tags match." : "No tags yet. Select items, then add one."
		})
	]);
}, hl = (e, t, n) => u("section.tag-presentation", (n.size ? e.filter((e) => n.has(e.name)) : e.filter((e) => e.count)).slice(0, 16).map((e) => {
	let n = t.filter((t) => t.tags.includes(e.name));
	return u("section.tag-presentation-group", { data: { tagColor: e.color } }, [
		u("h3", { text: `#${e.name} · ${e.count}` }),
		...n.slice(0, 60).map((e) => {
			let t = fl("tags.presentation.jump", e.label, "tag-presentation-item");
			return t.dataset.itemKind = e.ref.kind, t.dataset.itemId = e.ref.id, t;
		}),
		n.length > 60 && u("small", { text: `+${n.length - 60} more` })
	]);
})), gl = "tags.metric", _l = (e, t) => e.kind === t.kind && e.id === t.id;
function vl(t) {
	t("tags", ({ on: t, emit: n, contexts: r, graphs: i, selection: a, contribute: o, declarePanel: s, origin: c, frameLoop: l }) => {
		let u = /* @__PURE__ */ new Map(), d = !1, f = "", p = !0, m = /* @__PURE__ */ new Set(), h = null, g = () => {
			let e = i.current.id, t = u.get(e);
			if (t) return t;
			let n = sl(i.current.snapshotExtension("tagCatalog")), r = new Map(n.map((e) => [e.name, e])), a = {
				definitions: r,
				off: i.current.registerSnapshotExtension("tagCatalog", () => [...r.values()], (e) => {
					r.clear(), sl(e).forEach((e) => r.set(e.name, e)), h = null;
				})
			};
			return u.set(e, a), a;
		}, _ = () => {
			h = null;
		}, v = () => [...i.current.nodes().map((e) => ({
			ref: {
				kind: "node",
				id: e.id
			},
			label: e.Label.text || e.id,
			tags: H(e.Tags)
		})), ...i.current.itemsOfKind("container").map((e) => ({
			ref: {
				kind: "container",
				id: e.id
			},
			label: e.Label.text || e.id,
			tags: H(e.Tags)
		}))], y = () => {
			if (h?.graphId === i.current.id) return h;
			let e = v();
			return h = {
				graphId: i.current.id,
				items: e,
				catalog: cl(e, [...g().definitions.values()])
			}, h;
		}, b = () => a.selectedAll().filter((e) => e.kind === "node" || e.kind === "container"), x = (e) => y().items.find((t) => _l(t.ref, e)), S = () => b().flatMap((e) => {
			let t = x(e);
			return t ? [t] : [];
		}), C = () => l.schedule("tags.panel.redraw", () => {
			d || n("tool.panel.redraw", { id: "tags" });
		}, 5), w = () => {
			let t = new Map(y().catalog.map((e) => [e.name, e]));
			r.places.el(e.Stage)?.querySelectorAll("[data-tag]").forEach((e) => {
				let n = t.get(e.dataset.tag ?? "");
				n && (e.dataset.tagColor = n.color), e.hidden = !p || n?.visible === !1;
			});
		}, T = () => {
			n("views.query.set", { query: [...m].map((e) => `#${e}`).join(" ") }), n("tags.filter.changed", {
				tags: [...m],
				matched: y().items.length
			});
		}, E = (e) => {
			_(), n("tags.changed", {
				graphId: i.current.id,
				reason: e
			}), T(), C(), queueMicrotask(w);
		}, D = (e, t) => {
			let r = e.flatMap((e) => {
				let n = i.current.getItem(e);
				if (!n) return [];
				let r = H(n.Tags), a = H(t(r));
				return r.join("\0") === a.join("\0") ? [] : [{
					ref: e,
					patch: { Tags: a }
				}];
			});
			return r.length && n("item.update.batch", { updates: r }), r.length;
		}, O = (e, t) => {
			let n = V(e);
			if (!n) return "";
			let r = g(), i = r.definitions.get(n);
			return (!i || t) && r.definitions.set(n, {
				name: n,
				color: t ?? i?.color ?? y().catalog.find((e) => e.name === n)?.color ?? "gray",
				visible: i?.visible
			}), n;
		};
		Object.prototype.hasOwnProperty.call(r.fold.all(), "tags.panel") || r.fold.set("tags.panel", !1), s({
			id: "tags",
			anchor: "top-left",
			place: e.Left,
			movable: !1,
			dock: {
				command: "tags.open",
				label: "Tags",
				icon: "star",
				active: () => r.fold.isOpen("left.panel") && r.fold.isOpen("left.section:tool-panel:tags", !1)
			},
			section: () => ({ label: "Tags" }),
			layout: "custom",
			render: () => ml({
				active: m,
				catalog: y().catalog,
				items: y().items,
				search: f,
				selected: b(),
				showTags: p
			}),
			order: 2
		});
		let k = (e) => (e?.target)?.closest("[data-search-value]")?.dataset.searchValue?.trim() || void 0;
		return r.commands.register([
			{
				id: "tags.open",
				label: "Tag selected items and manage tags",
				group: "tags",
				shortcut: "Shift+T",
				input: {
					on: "keydown",
					key: "T",
					shift: !0,
					prevent: !0
				}
			},
			{
				id: "tags.search.clear",
				label: "Clear tag search",
				event: "tags.search",
				group: "tags",
				hidden: !0,
				payload: () => ({ query: "" })
			},
			{
				id: "tags.search.input",
				label: "Search tags",
				event: "tags.search",
				group: "tags",
				hidden: !0,
				input: {
					on: "input",
					selector: "[data-tags-search]"
				},
				payload: ({ target: e }) => ({ query: e.value })
			},
			{
				id: "tags.selection.add.input",
				label: "Add tag to selection",
				event: "tags.selection.add",
				group: "tags",
				hidden: !0,
				input: {
					on: "keydown",
					key: "Enter",
					selector: "[data-tags-selection-add]",
					prevent: !0,
					stop: !0
				},
				payload: ({ target: e }) => ({ tag: e.value })
			},
			{
				id: "tags.selection.toggle",
				label: "Toggle tag on selection",
				group: "tags",
				hidden: !0,
				payload: ({ target: e }) => ({ tag: e?.closest("[data-tag]")?.dataset.tag ?? "" })
			},
			{
				id: "tags.filter.toggle",
				label: "Show only this tag",
				group: "tags",
				hidden: !0,
				payload: ({ target: e }) => ({ tag: e?.closest("[data-tag]")?.dataset.tag ?? "" })
			},
			{
				id: "tags.filter.clear",
				label: "Clear tag filter",
				group: "tags"
			},
			{
				id: "tags.visibility.toggle",
				label: "Show or hide tag chips on canvas",
				group: "tags"
			},
			{
				id: "tags.definition.visibility.toggle",
				label: "Show or hide one tag",
				group: "tags",
				hidden: !0,
				payload: ({ target: e }) => ({ name: e?.closest("[data-tag-definition]")?.dataset.tagDefinition ?? "" })
			},
			{
				id: "tags.color.change",
				label: "Set tag color",
				group: "tags",
				hidden: !0,
				input: {
					on: "change",
					selector: "[data-command=\"tags.color.change\"]"
				},
				payload: ({ target: e }) => ({
					name: e.closest("[data-tag-definition]")?.dataset.tagDefinition ?? "",
					color: e.value
				})
			},
			{
				id: "tags.create",
				label: "Create tag",
				group: "tags",
				form: {
					title: "New tag",
					submitLabel: "Create tag",
					shouldOpen: (e, t) => !k(t),
					seed: (e, t) => ({
						color: "blue",
						...k(t) ? { name: k(t) } : {}
					}),
					fields: [{
						id: "name",
						label: "Name",
						placeholder: "release or estimate:3",
						autofocus: !0
					}, {
						id: "color",
						label: "Color",
						input: "select",
						options: () => Zr
					}],
					validate: (e) => V(e.name) ? q(e.color) ? void 0 : "Choose a valid color." : "Give the tag a name.",
					payload: (e) => ({
						name: e.name,
						color: e.color
					})
				}
			},
			{
				id: "tags.rename",
				label: "Rename tag",
				group: "tags",
				hidden: !0,
				payload: ({ target: e }) => {
					let t = e?.closest("[data-tag-definition]")?.dataset.tagDefinition ?? "";
					return {
						from: t,
						to: t
					};
				},
				form: {
					title: "Rename tag",
					submitLabel: "Rename",
					shouldOpen: (e) => !!e?.from,
					fields: [{
						id: "from",
						label: "",
						input: "hidden"
					}, {
						id: "to",
						label: "Name",
						autofocus: !0
					}],
					seed: (e) => e,
					validate: (e) => V(e.to) ? void 0 : "Give the tag a name.",
					payload: (e) => ({
						from: e.from,
						to: e.to
					})
				}
			},
			{
				id: "tags.delete",
				label: "Delete tag from project",
				group: "tags",
				hidden: !0,
				payload: ({ target: e }) => ({ name: e?.closest("[data-tag-definition]")?.dataset.tagDefinition ?? "" })
			},
			{
				id: "tags.present",
				label: "Present items grouped by selected tags",
				group: "tags",
				shortcut: "Alt+T",
				input: {
					on: "keydown",
					key: "t",
					alt: !0,
					prevent: !0
				},
				available: () => y().catalog.some((e) => e.count > 0)
			},
			{
				id: "tags.presentation.jump",
				label: "Open presented item in canvas",
				group: "tags",
				hidden: !0,
				payload: ({ target: e }) => ({ ref: {
					kind: e?.closest("[data-item-kind]")?.dataset.itemKind,
					id: e?.closest("[data-item-id]")?.dataset.itemId ?? ""
				} })
			},
			{
				id: "tags.metric.highlight",
				label: "Highlight high metric tags",
				group: "tags",
				form: {
					title: "Highlight metric",
					submitLabel: "Highlight",
					shouldOpen: () => !0,
					fields: [{
						id: "key",
						label: "Metric",
						placeholder: "estimate",
						autofocus: !0
					}, {
						id: "minimum",
						label: "Minimum value",
						placeholder: "3"
					}],
					validate: (e) => V(e.key) ? Number.isFinite(Number(e.minimum)) ? void 0 : "Minimum must be a number." : "Give the metric name.",
					payload: (e) => ({
						key: e.key,
						minimum: Number(e.minimum)
					})
				}
			}
		]), t("tags.open", () => {
			r.fold.set("left.panel", !0), r.fold.set("left.section:tool-panel:tags", !0), n("tool.panel.redraw", { id: "tags" }), l.schedule("tags.open.focus", () => r.places.el(e.Left)?.querySelector(b().length ? "[data-tags-selection-add]" : "[data-tags-search]")?.focus(), 25);
		}), t("tags.search", ({ query: e }) => {
			f = e, C();
		}), t("tags.create", ({ name: e, color: t }) => {
			O(e, t) && E("catalog");
		}), t("tags.selection.add", ({ tag: t }) => {
			let n = O(t);
			!n || !b().length || (D(b(), (e) => [...e, n]), E("assignments"), queueMicrotask(() => {
				let t = r.places.el(e.Left)?.querySelector("[data-tags-selection-add]");
				t && (t.value = "", t.focus());
			}));
		}), t("tags.selection.toggle", ({ tag: e }) => {
			let t = V(e), n = b();
			if (!t || !n.length) return;
			O(t);
			let r = S().every((e) => e.tags.includes(t));
			D(n, (e) => r ? e.filter((e) => e !== t) : [...e, t]), E("assignments");
		}), t("tags.rename", ({ from: e, to: t }) => {
			let n = V(e), r = V(t);
			if (!n || !r || n === r) return;
			let i = g(), a = i.definitions.get(n) ?? y().catalog.find((e) => e.name === n);
			D(y().items.map((e) => e.ref), (e) => dl(e, n, r)), i.definitions.delete(n), i.definitions.set(r, {
				name: r,
				color: a?.color ?? "gray",
				visible: a?.visible
			}), m.delete(n) && m.add(r), E("catalog");
		}), t("tags.delete", ({ name: e }) => {
			let t = V(e);
			t && (D(y().items.map((e) => e.ref), (e) => dl(e, t)), g().definitions.delete(t), m.delete(t), E("catalog"), n("app.notice", { message: `Deleted tag #${t}. Undo restores item assignments.` }));
		}), t("tags.color.change", ({ name: e, color: t }) => {
			q(t) && O(e, t) && E("catalog");
		}), t("tags.definition.visibility.toggle", ({ name: e }) => {
			let t = V(e), n = y().catalog.find((e) => e.name === t);
			n && (g().definitions.set(t, {
				name: t,
				color: n.color,
				visible: n.visible === !1 ? void 0 : !1
			}), E("catalog"));
		}), t("tags.visibility.toggle", () => {
			p = !p, n("tags.visibility.changed", { visible: p }), w(), C();
		}), t("tags.filter.toggle", ({ tag: e }) => {
			let t = V(e);
			t && (m.has(t) ? m.delete(t) : m.add(t), T(), C());
		}), t("tags.filter.clear", () => {
			m.clear(), T(), C();
		}), t("views.changed", ({ query: e }) => {
			let t = new Set(Mi(e).terms.filter((e) => e.field === "tag" && !e.negated).flatMap((e) => e.values));
			t.size === m.size && [...t].every((e) => m.has(e)) || (m = t, C());
		}), t("tags.present", () => n("modal.open", {
			title: m.size ? "Selected tag groups" : "Tag groups",
			visual: "present",
			body: () => hl(y().catalog, y().items, m)
		})), t("tags.presentation.jump", ({ ref: e }) => {
			!e.id || e.kind !== "node" && e.kind !== "container" || (n("modal.close"), n("selection.item.select", e), n("view.fit.item", e));
		}), t("tags.metric.highlight", ({ key: e, minimum: t }) => {
			let i = y().items.filter((n) => ul(n.tags, e, t)).map((e) => e.ref);
			r.decorations.modes.set(gl, "tag-metric-heavy", i), n("app.notice", { message: `Highlighted ${i.length} item${i.length === 1 ? "" : "s"} with ${V(e)} ≥ ${t}.` });
		}), t("selection.changed", C), t("render.stage.draw", w), t("graph.node.created", _), t("graph.node.deleted", () => {
			_(), C();
		}), t("graph.node.updated", ({ patch: e }) => {
			e && "Tags" in e && (_(), C());
		}), t("container.created", _), t("container.updated", ({ id: e }) => {
			let t = i.current.getItem({
				kind: "container",
				id: e
			}), n = h?.items.find((t) => t.ref.kind === "container" && t.ref.id === e);
			n && n.tags.join("\0") === H(t?.Tags).join("\0") || (_(), C());
		}), t("container.deleted", () => {
			_(), C();
		}), t("graph.imported", () => {
			_(), C();
		}), t("graph.switched", () => {
			f = "", m = /* @__PURE__ */ new Set(), _(), g(), r.decorations.unregisterOrigin(gl), C();
		}), t("app.start", () => {
			g();
		}), o({
			surface: "top",
			command: "tags.open",
			kind: "button",
			text: "#",
			label: "Tag selection",
			className: "selection-tag-tool",
			active: () => r.fold.isOpen("tags.panel"),
			order: 8,
			group: "edit"
		}), () => {
			d = !0, l.cancel("tags.panel.redraw"), u.forEach((e) => e.off()), u.clear(), r.decorations.unregisterOrigin(gl);
		};
	}, { requires: [
		"graph",
		"render.stage",
		"tool.panel"
	] });
}
//#endregion
//#region canvas/systems/tool-panel.ts
var yl = "top", bl = "shell.zen", xl = [
	{
		id: "make",
		label: "Make",
		matches: /^(architecture\.|capture\.|editing\.|gallery\.|note\.|palette\.arm\.type\.text|workflow\.create)/
	},
	{
		id: "organize",
		label: "Organize",
		matches: /^(repo\.map\.|selection\.group|tags\.|variables\.|views\.|workspace\.tree\.place)/
	},
	{
		id: "finish",
		label: "Finish",
		matches: /^(design\.validate|ledger\.|machine\.|present\.|production\.|walkthrough\.|workflow\.open)/
	},
	{
		id: "share",
		label: "Share",
		matches: /^(clipboard\.|graph\.export|graph\.import|graph\.share)/
	},
	{
		id: "help",
		label: "Help",
		matches: /^(appmap\.|docs\.|help\.|onboarding\.|storybook\.|theme\.)/
	}
];
function Sl(n) {
	n("tool.panel", ({ on: n, emit: r, bus: i, contexts: a, declarePanel: o, frameLoop: s }) => {
		let c = /* @__PURE__ */ new Map(), l = /* @__PURE__ */ new Map(), d = !1, f = null, p = (e) => `tool-panel:${e}`, m = () => a.places.el(e.Stage)?.getBoundingClientRect(), h = (e) => {
			let t = m();
			return t ? {
				x: Math.max(0, Math.min(e.x, Math.max(0, t.width - 48))),
				y: Math.max(0, Math.min(e.y, Math.max(0, t.height - 32)))
			} : e;
		}, g = () => a.affordances.panels(), _ = (e) => g().find((t) => t.id === e), v = (e) => {
			let t = m();
			return {
				x: e.anchor === "bottom-center" && t ? Math.max(12, t.width / 2 - 90) : e.anchor.endsWith("right") && t ? Math.max(12, t.width - 180 - 12) : 12,
				y: e.anchor === "middle-right" && t ? Math.max(12, t.height / 2 - 120) : e.anchor.startsWith("bottom") && t ? Math.max(12, t.height - 44 - 12) : 12
			};
		}, y = (e) => c.get(e.id) ?? v(e), b = (e) => e.foldId ? a.fold.folded(e.foldId) : !1, x = (t) => t.place ?? (t.id === yl && t.presentation !== "plain" ? e.Top : e.Stage), S = (e) => a.affordances.system("top").filter((t) => (t.panel ?? yl) === e), C = (e) => e.group === "mode" || e.group === "history" || e.group === "starter" || e.command === "palette.open", w = (e) => e.command !== "palette.open" && (e.group === "overflow" || !C(e));
		o({
			id: yl,
			anchor: "top-center",
			movable: !1,
			layout: "toolbar",
			order: 0
		}), a.commands.register([
			{
				id: "tool.panel.drag.start",
				label: "Start moving tool panel",
				group: "tool-panel",
				hidden: !0,
				input: {
					on: "pointerdown",
					selector: "[data-tool-panel-drag]",
					prevent: !0,
					stop: !0
				},
				payload: ({ event: e, target: t }) => ({
					id: t.dataset.toolPanelDrag ?? "",
					x: e.clientX,
					y: e.clientY
				})
			},
			{
				id: "tool.panel.drag.move",
				label: "Move tool panel",
				group: "tool-panel",
				hidden: !0,
				input: {
					on: "pointermove",
					when: () => !!f,
					prevent: !0,
					stop: !0
				},
				payload: ({ event: e }) => ({
					x: e.clientX,
					y: e.clientY
				})
			},
			{
				id: "tool.panel.drag.end",
				label: "Stop moving tool panel",
				group: "tool-panel",
				hidden: !0,
				input: {
					on: "pointerup",
					when: () => !!f,
					stop: !0
				}
			},
			{
				id: "tool.panel.mobile.toggle",
				label: "Toggle mobile actions",
				group: "tool-panel",
				hidden: !0
			},
			{
				id: "tool.panel.dismiss.menus",
				label: "Dismiss open menus",
				group: "tool-panel",
				hidden: !0,
				input: {
					on: "pointerdown",
					selector: `[data-place="${e.Stage}"]`,
					when: (t) => {
						let n = t.target, r = a.places.el(e.Stage);
						return n instanceof Element && !!r && r.contains(n) && !n.closest(".tool-panel, .item-toolbar, .picker-prompt, [data-ghost-node]");
					}
				}
			}
		]);
		let T = (e, t, n) => u("button", {
			type: "button",
			text: t,
			"aria-label": n,
			data: { command: e }
		}), E = (e) => u("button.tool-panel-drag", {
			type: "button",
			text: "⋮⋮",
			"aria-label": "Move tool panel",
			data: { toolPanelDrag: e }
		}), D = (e, t) => u("button.tool-panel-collapse", {
			type: "button",
			text: t ? "⊞" : "⊟",
			"aria-expanded": t ? "false" : "true",
			"aria-label": t ? "Expand panel" : "Collapse panel",
			data: { foldId: e.foldId ?? "" }
		}), O = (e, t) => {
			let n = a.commands.get(t.command);
			if (n?.available && !n.available()) return;
			let r = t.text ?? t.command, i = T(t.command, r, t.label);
			t.icon && (bn(i, typeof t.icon == "function" ? t.icon() : t.icon), (e.classList.contains("toolbar-overflow-menu") || e.classList.contains("toolbar-overflow-section-items")) && i.append(u("span", { text: t.text ?? n?.label ?? t.command })));
			let o = at(a.commands, t.command), s = !t.label && n?.label !== r ? n?.label : void 0;
			s && i.setAttribute("aria-description", s), i.title = [t.label ?? s ?? n?.label, o].filter(Boolean).join(" · ");
			let c = t.className?.split(/\s+/).filter(Boolean) ?? [];
			if (t.active) {
				let e = t.active();
				c.includes("tool-switch") ? (i.setAttribute("role", "switch"), i.setAttribute("aria-checked", e ? "true" : "false")) : i.setAttribute("aria-pressed", e ? "true" : "false");
			}
			c.length && i.classList.add(...c), e.append(i);
		}, k = (e, t, n) => {
			if (!n) return e;
			let r = t.get(n);
			return r || (r = u(".tool-group", {
				role: "group",
				"aria-label": `${n[0]?.toUpperCase() ?? ""}${n.slice(1)} tools`,
				data: { group: n }
			}), n === "mode" && r.append(u("span.tool-group-label", {
				text: "Canvas mode",
				"aria-hidden": "true"
			})), e.append(r), t.set(n, r)), r;
		}, A = (e, n, r = !1) => {
			let i = a.templates.clone("toolbar"), o = a.templates.slot(i, "start"), s = a.templates.slot(i, "end");
			e.id === yl && e.presentation !== "plain" && i.prepend(u("span.toolbar-brand", {
				"aria-label": "Canvas Graph — visual editor for systems, flows, and ideas",
				title: "Visual editor for systems, flows, and ideas"
			}, [u("b", { text: "Canvas" }), u("span", { text: "Graph" })]));
			let c = /* @__PURE__ */ new Map(), l = S(e.id), d = (t) => e.id !== yl || e.presentation === "plain" || C(t);
			l.filter((e) => e.group !== "overflow" && d(e)).forEach((e) => {
				e.slot === t.End ? O(s, e) : O(k(o, c, e.group), e);
			}), l.filter((e) => e.group === "overflow" && e.command === "palette.open").forEach((e) => O(s, e));
			let f = l.filter((t) => e.id === yl && e.presentation !== "plain" ? w(t) : t.command !== "palette.open" && (t.group === "overflow" || !d(t)));
			if (f.length) {
				let e = u("summary", {
					"aria-label": "More actions",
					title: "More actions"
				});
				bn(e, "more");
				let t = u(".toolbar-overflow-menu"), n = /* @__PURE__ */ new Set();
				xl.forEach((e) => {
					let r = f.filter((t) => e.matches.test(t.command));
					if (!r.length) return;
					r.forEach((e) => n.add(e.command));
					let i = u(".toolbar-overflow-section-items");
					r.forEach((e) => O(i, e)), t.append(u("section.toolbar-overflow-section", { data: { overflowSection: e.id } }, [u("h3", { text: e.label }), i]));
				});
				let i = f.filter((e) => !n.has(e.command));
				if (i.length) {
					let e = u(".toolbar-overflow-section-items");
					i.forEach((t) => O(e, t)), t.append(u("section.toolbar-overflow-section", { data: { overflowSection: "other" } }, [u("h3", { text: "Other" }), e]));
				}
				s.prepend(u("details.toolbar-overflow", { open: r }, [e, t]));
			}
			n.append(i);
		}, j = (e, t) => {
			let n = u(".tool-panel-body");
			S(e.id).forEach((e) => O(n, e)), t.append(n);
		}, M = (t) => {
			let n = p(t.id), i = x(t), o = t.id === yl && !!a.places.el(e.Top)?.querySelector(".toolbar-overflow")?.open;
			if (t.mountWhen && !t.mountWhen()) {
				l.delete(n) && r("render.view.clear", {
					place: i,
					key: n
				});
				return;
			}
			l.set(n, i), r("render.view.set", {
				place: i,
				key: n,
				section: t.section?.(),
				view: () => {
					let e = b(t), n = u("section.tool-panel", {
						class: t.layout === "toolbar" ? "top-tool-panel" : "tool-panel-stack",
						data: {
							panelId: t.id,
							presentation: t.presentation ?? "editor",
							collapsed: e ? "true" : "false",
							mobileOpen: d ? "true" : "false"
						}
					}), r = c.get(t.id);
					r ? (n.style.left = `${r.x}px`, n.style.top = `${r.y}px`) : n.dataset.anchor = t.anchor;
					let i = u(".tool-panel-head");
					return t.movable && i.append(E(t.id)), t.foldId && i.append(D(t, e)), i.childElementCount && n.append(i), e || (t.layout === "toolbar" ? A(t, n, o) : t.layout === "custom" && t.render ? n.append(t.render()) : (t.render && n.append(t.render()), j(t, n))), n;
				}
			});
		}, N = () => {
			let t = g().filter((e) => !!e.dock).map((e) => ({
				id: e.dock.command,
				command: e.dock.command,
				label: e.dock.label,
				icon: e.dock.icon,
				active: e.dock.active ?? (() => e.foldId ? !b(e) : !e.mountWhen || e.mountWhen())
			})), n = a.affordances.system("dock").filter((e) => !t.some((t) => t.command === e.command)).map((e) => ({
				id: e.command,
				command: e.command,
				label: e.text ?? e.command,
				icon: e.icon,
				active: e.active ?? (() => !1)
			})), i = [...t, ...n];
			if (!i.length) {
				l.delete("panel-rail") && r("render.view.clear", {
					place: e.Right,
					key: "panel-rail"
				});
				return;
			}
			l.set("panel-rail", e.Right), r("render.view.set", {
				place: e.Right,
				key: "panel-rail",
				view: () => u("nav.panel-rail", { "aria-label": "Panels" }, [u("span.panel-rail-kicker", {
					text: "Panels",
					"aria-hidden": "true"
				}), ...i.map((e) => u("button.panel-rail-tab", {
					type: "button",
					title: e.label,
					"aria-label": e.label,
					"aria-pressed": e.active() ? "true" : "false",
					data: {
						command: e.command,
						panelTab: e.id
					}
				}, [yn(e.icon), u("span", { text: e.label })]))])
			});
		}, P = () => s.schedule("tool.panel.rail.redraw", N, 20), F = () => {
			let t = document.activeElement, n = a.places.el(e.Top)?.parentElement, i = t instanceof HTMLElement && n?.contains(t) && t.closest(".tool-panel") ? t.closest("[data-command]")?.dataset.command : void 0, o = new Set([...g().map((e) => p(e.id)), "panel-rail"]);
			for (let [e, t] of [...l]) o.has(e) || (r("render.view.clear", {
				place: t,
				key: e
			}), l.delete(e));
			g().forEach(M), i && !t?.isConnected && [...n?.querySelectorAll("[data-command]") ?? []].find((e) => e.dataset.command === i)?.focus({ preventScroll: !0 });
		};
		n("tool.panel.drag.start", ({ id: e, x: t, y: n }) => {
			let r = _(e);
			r && (f = {
				id: e,
				pointer: {
					x: t,
					y: n
				},
				start: y(r)
			});
		}), n("tool.panel.drag.move", ({ x: e, y: t }) => {
			if (!f) return;
			let n = h({
				x: f.start.x + e - f.pointer.x,
				y: f.start.y + t - f.pointer.y
			});
			c.set(f.id, n), r("tool.panel.moved", {
				id: f.id,
				position: n
			}), F(), N();
		}), n("tool.panel.drag.end", () => {
			f = null;
		}), n("tool.panel.redraw", ({ id: e }) => {
			let t = _(e);
			t && (M(t), P());
		}), n("tool.panel.mobile.toggle", () => {
			d = !d, F(), N();
		}), n("tool.panel.dismiss.menus", () => {
			d = !1, a.places.el(e.Top)?.querySelector(".toolbar-overflow")?.removeAttribute("open");
			let t = _(yl);
			t && M(t);
		});
		let I = () => {
			d && (d = !1, F(), N());
		}, ee = () => {
			a.places.el(e.Top)?.querySelector(".toolbar-overflow")?.removeAttribute("open");
		}, te = i.onAny(({ name: e }) => {
			let n = S(yl), r = (e) => {
				let t = a.commands.get(e.command);
				return t?.event ?? t?.id;
			};
			new Set(n.filter(w).map(r).filter((e) => !!e)).has(e) && queueMicrotask(() => {
				ee();
			}), d && new Set(n.filter((e) => e.slot !== t.End).map(r).filter((e) => !!e)).has(e) && queueMicrotask(I);
		});
		return n("modal.open", () => {
			I(), ee();
		}), n("commandForm.open", ee), n("commandPicker.open", () => {
			I(), ee();
		}), n("graph.switched", I), n("app.start", F), n("affordance.contributed", ({ surface: e }) => {
			e === "top" && (F(), N());
		}), n("fold.changed", ({ id: e }) => {
			(e === bl || g().some((t) => t.foldId === e)) && F();
		}), n("debug.enabled.changed", F), n("debug.recording.changed", F), n("history.changed", () => {
			let e = _(yl);
			e && M(e);
		}), n("selection.changed", () => {
			let e = g().filter((e) => e.mountWhen);
			e.length && e.forEach((e) => {
				!!e.mountWhen() !== l.has(p(e.id)) && M(e);
			});
		}), () => te();
	}, { requires: ["render.stage"] });
}
//#endregion
//#region canvas/systems/view-pan.ts
var Cl = 600, wl = 320, Tl = "quantile", El = (e, t, n, r, i) => {
	let a = W(e.scale * (i / Math.max(1, r)), .05, 5), o = {
		x: e.x + t.x / e.scale,
		y: e.y + t.y / e.scale
	};
	return {
		x: o.x - n.x / a,
		y: o.y - n.y / a,
		scale: a
	};
};
function Dl(t) {
	t("view.pan", ({ on: t, emit: n, contexts: r, frameLoop: i, graphs: a }) => {
		let o = r.interaction.pointer, s = (e) => !r.places.root() || e.target instanceof Node && r.places.root().contains(e.target), c = null, l = !0, u = null, d = -1, f = null, p = {
			dx: 0,
			dy: 0
		}, m = `[data-place="${e.Stage}"]`, h = () => n("view.changed", r.view.get()), g = (e) => {
			s(e) && o.down(e);
		}, _ = (e) => {
			o.move(e);
		}, v = (e) => {
			o.up(e);
		}, y = (t) => {
			!s(t) && !(t.type === "keyup" && t.code === "Space") || (o.key(t), t.code === "Space" && r.places.el(e.Stage)?.classList.toggle("pan-ready", o.state.space));
		};
		window.addEventListener("pointerdown", g, !0), window.addEventListener("pointermove", _, !0), window.addEventListener("pointerup", v, !0), window.addEventListener("pointercancel", v, !0), window.addEventListener("keydown", y, !0), window.addEventListener("keyup", y, !0);
		let b = (t) => wr(r.view.spaceCenter(e.Stage), t, a.current.nodes().map((e) => e.Position).filter((e) => !!e)), x = (e, t, n, r) => {
			let i = Math.hypot(e, t);
			if (!l || !n || i < 1 || n.reach <= 0) return {
				dx: e / r,
				dy: t / r
			};
			let a = Cr(Tl, {
				travel: i,
				swipe: Cl,
				scale: r,
				reach: n.reach,
				ahead: n.ahead
			}) / (i / r);
			return {
				dx: e / r * a,
				dy: t / r * a
			};
		}, S = (e) => {
			if (!c) return;
			let t = x(e.x - c.pointer.x, e.y - c.pointer.y, c.gesture, c.view.scale);
			r.view.set({
				x: c.view.x - t.dx,
				y: c.view.y - t.dy
			});
		}, C = () => {
			let t = [...o.state.points.entries()].slice(0, 2);
			if (t.length < 2) return null;
			let [[n, i], [a, s]] = t, c = r.view.clientToScreen(e.Stage, {
				x: (i.x + s.x) / 2,
				y: (i.y + s.y) / 2
			});
			return {
				ids: [n, a],
				view: r.view.get(),
				center: c,
				distance: Math.hypot(s.x - i.x, s.y - i.y)
			};
		}, w = () => {
			if (!f) return !1;
			let t = o.state.points.get(f.ids[0]), n = o.state.points.get(f.ids[1]);
			if (!t || !n) return !1;
			let i = r.view.clientToScreen(e.Stage, {
				x: (t.x + n.x) / 2,
				y: (t.y + n.y) / 2
			});
			return r.view.set(El(f.view, f.center, i, f.distance, Math.hypot(n.x - t.x, n.y - t.y))), !0;
		};
		return r.commands.register([
			{
				id: "view.pan.start",
				label: "Start canvas pan",
				event: "view.pan.start",
				group: "view",
				hidden: !0,
				input: {
					on: "pointerdown",
					selector: m,
					when: (e, t) => In(e, t) && o.isMoveIntent(e),
					prevent: !0
				},
				payload: ({ event: e }) => ({
					...Fn(e),
					pointerId: e.pointerId
				})
			},
			{
				id: "view.pan.move",
				label: "Pan canvas",
				event: "view.pan.move",
				group: "view",
				hidden: !0,
				input: {
					on: "pointermove",
					when: () => !!c,
					prevent: !0
				},
				payload: ({ event: e }) => ({
					...Fn(e),
					pointerId: e.pointerId
				})
			},
			{
				id: "view.pan.end",
				label: "End canvas pan",
				event: "view.pan.end",
				group: "view",
				hidden: !0,
				input: {
					on: "pointerup",
					when: () => !!c
				},
				payload: ({ event: e }) => ({ pointerId: e.pointerId })
			},
			{
				id: "view.wheel.pan",
				label: "Wheel pan",
				event: "view.wheel.pan",
				group: "view",
				hidden: !0,
				input: {
					on: "wheel",
					selector: m,
					when: (e) => !e.ctrlKey && !(e.target instanceof Element && e.target.closest("[data-native-scroll]")),
					prevent: !0
				},
				payload: ({ event: e }) => ({
					dx: e.deltaX,
					dy: e.deltaY
				})
			}
		]), t("view.wheel.pan", ({ dx: e, dy: t }) => {
			let n = performance.now();
			(!u || n - u.at > wl) && (u = {
				dx: 0,
				dy: 0,
				at: n,
				view: r.view.get(),
				gesture: null
			}), u.at = n, u.dx += e, u.dy += t, p.dx += e, p.dy += t, i.schedule("view.pan.wheel", () => {
				if (!p.dx && !p.dy) return;
				let e = u;
				if (!e) return;
				let t = Math.hypot(e.dx, e.dy);
				l && !e.gesture && t >= 4 && (e.gesture = b({
					x: e.dx / t,
					y: e.dy / t
				}));
				let n = x(e.dx, e.dy, e.gesture, e.view.scale);
				r.view.set({
					x: e.view.x + n.dx,
					y: e.view.y + n.dy
				}), p = {
					dx: 0,
					dy: 0
				}, h();
			}, 10);
		}), r.commands.register([{
			id: "view.turbo.toggle",
			label: "Toggle long-distance panning",
			group: "view",
			event: "view.turbo.toggle"
		}]), t("view.turbo.toggle", () => {
			l = !l, n("app.notice", { message: l ? "Long-distance panning on — one swipe reaches the whole board." : "Long-distance panning off — panning is one-to-one." });
		}), t("view.pan.start", ({ x: t, y: i, pointerId: a = 0 }) => {
			n("select.box.cancel"), c = {
				pointer: {
					x: t,
					y: i
				},
				view: r.view.get(),
				gesture: null
			}, d = a, f = o.state.points.size >= 2 ? C() : null, r.places.el(e.Stage)?.classList.add("panning");
		}), t("view.pan.move", (e) => {
			if (f && w()) {
				i.schedule("view.pan.commit", h, 10);
				return;
			}
			let t = e?.pointerId ?? d;
			if (c && t === d) {
				if (l && !c.gesture) {
					let t = e.x - c.pointer.x, n = e.y - c.pointer.y, r = Math.hypot(t, n);
					r >= 4 && (c.gesture = b({
						x: -t / r,
						y: -n / r
					}));
				}
				S({
					x: e.x,
					y: e.y
				}), i.schedule("view.pan.commit", h, 10);
			}
		}), t("view.pan.end", (t) => {
			let n = t?.pointerId ?? d;
			!f && c && n !== d || (h(), i.cancel("view.pan.commit"), c = null, f = null, d = -1, r.places.el(e.Stage)?.classList.remove("panning"));
		}), () => {
			window.removeEventListener("pointerdown", g, !0), window.removeEventListener("pointermove", _, !0), window.removeEventListener("pointerup", v, !0), window.removeEventListener("pointercancel", v, !0), window.removeEventListener("keydown", y, !0), window.removeEventListener("keyup", y, !0), o.clear();
		};
	}, { requires: ["render"] });
}
//#endregion
//#region canvas/systems/view-zoom.ts
var Ol = .8, kl = .61;
function Al(n) {
	n("view.zoom", ({ on: n, emit: r, contexts: i, graphs: a, selection: o, contribute: s, model: c, declarePanel: l, frameLoop: u, flags: d }) => {
		d.declare("view.fit.contain", !1), l({
			id: "zoom",
			anchor: "bottom-right",
			movable: !1,
			layout: "toolbar",
			order: 20
		}), s({
			panel: "zoom",
			surface: "top",
			command: "view.fit.all",
			kind: "button",
			icon: "fit",
			label: "Fit canvas to content",
			slot: t.End,
			order: 5
		});
		let f = `[data-place="${e.Stage}"]`, p = () => r("view.changed", i.view.get()), m = (t) => {
			_(), i.view.zoomAtScreen(i.view.screenCenter(e.Stage), t), p();
		}, h = !1, _ = () => {
			h = !0, u.cancel("camera.animate");
		}, v = (e, t = 180) => {
			_();
			let n = i.view.get(), r = e.x - n.x, a = e.y - n.y, o = e.scale - n.scale;
			if (Math.abs(r) + Math.abs(a) + Math.abs(o) < .001) return;
			let s = performance.now();
			h = !1;
			let c = h, l = (e) => 1 - (1 - e) ** 3, d = () => {
				if (h !== c) return;
				let e = Math.min(1, Math.max(0, (performance.now() - s) / t)), f = l(e);
				i.view.set({
					x: n.x + r * f,
					y: n.y + a * f,
					scale: n.scale + o * f
				}), p(), e < 1 && h === c && u.schedule("camera.animate", d, 5);
			};
			u.schedule("camera.animate", d, 5);
		};
		i.commands.register([
			{
				id: "view.zoom.wheel",
				label: "Wheel zoom",
				event: "view.zoom.by",
				group: "view",
				hidden: !0,
				input: {
					on: "wheel",
					selector: f,
					when: (e) => e.ctrlKey && !(e.target instanceof Element && e.target.closest("[data-native-scroll]")),
					prevent: !0
				},
				payload: ({ event: t }) => {
					let n = t, r = n.ctrlKey ? .01 : .0025;
					return {
						screen: i.view.clientToScreen(e.Stage, {
							x: n.clientX,
							y: n.clientY
						}),
						factor: Math.exp(-n.deltaY * r),
						delta: n.deltaY,
						pinch: n.ctrlKey
					};
				}
			},
			{
				id: "view.zoom.in",
				label: "Zoom in",
				group: "view",
				shortcut: "+",
				input: {
					on: "keydown",
					key: "+",
					prevent: !0
				}
			},
			{
				id: "view.zoom.out",
				label: "Zoom out",
				group: "view",
				shortcut: "-",
				input: {
					on: "keydown",
					key: "-",
					prevent: !0
				}
			},
			{
				id: "view.zoom.reset",
				label: "Reset view",
				group: "view",
				shortcut: "0",
				input: {
					on: "keydown",
					key: "0",
					prevent: !0
				}
			},
			{
				id: "view.fit.all",
				label: "Fit all to view",
				group: "view",
				shortcut: "Z",
				input: {
					on: "keydown",
					key: "z",
					prevent: !0
				}
			},
			{
				id: "view.fit.selected",
				label: "Fit selected to view",
				group: "view",
				shortcut: "Shift+Z",
				input: {
					on: "keydown",
					key: "Z",
					shift: !0,
					prevent: !0
				},
				available: () => !!o.selected()
			},
			{
				id: "view.fit.item",
				label: "Fit item to view",
				group: "view",
				hidden: !0,
				available: (e) => !!g(e?.target) || !!o.selected(),
				payload: (e) => g(e.target) ?? o.selected() ?? void 0
			}
		]);
		let y = (t, n) => {
			let r = i.places.el(e.Stage), o = a.current.nodes().filter((e) => !!e.Position);
			if (!r || !o.length) return null;
			let s = E(r.getBoundingClientRect()), c = (e) => Math.min(s.width / Math.max(1, e.maxX - e.minX), s.height / Math.max(1, e.maxY - e.minY)), l = S(o);
			if (!l) return null;
			if (t === -1) return W(c(l), .05, 5);
			let u = i.view.screenToSpace(n), d = o.reduce((e, t) => {
				let n = Math.hypot(t.Position.x - u.x, t.Position.y - u.y);
				return n < e.distance ? {
					node: t,
					distance: n
				} : e;
			}, {
				node: o[0],
				distance: Infinity
			}).node, f = S([d]);
			return f ? W(c(f), .05, 5) : null;
		}, b = null, x = !0;
		n("view.turbo.toggle", () => {
			x = !x;
		}), n("view.zoom.by", ({ screen: e, factor: t, delta: n, pinch: r }) => {
			if (_(), !x || !n) {
				i.view.zoomAtScreen(e, t), u.schedule("view.zoom.commit", p, 10);
				return;
			}
			let a = performance.now(), o = n < 0 ? 1 : -1;
			if ((!b || a - b.at > 320 || b.dir !== o) && (b = {
				travel: 0,
				at: a,
				from: i.view.get().scale,
				dir: o,
				to: y(o, e)
			}), b.at = a, b.travel += Math.abs(n), b.to === null) {
				i.view.zoomAtScreen(e, t), u.schedule("view.zoom.commit", p, 10);
				return;
			}
			let s = Tr({
				travel: b.travel,
				swipe: r ? 150 : 600,
				rate: r ? .01 : .0025,
				from: b.from,
				to: b.to,
				dir: o
			});
			i.view.zoomAtScreen(e, s / i.view.get().scale), u.schedule("view.zoom.commit", p, 10);
		}), n("view.zoom.in", () => m(1.2)), n("view.zoom.out", () => m(1 / 1.2)), n("view.zoom.reset", () => {
			_(), i.view.set({
				x: 0,
				y: 0,
				scale: 1
			}), p();
		});
		let S = (e) => {
			let t = Infinity, n = Infinity, r = -Infinity, i = -Infinity;
			return e.forEach((e) => {
				if (!e.Position) return;
				let a = e.Size.w / 2, o = e.Size.h / 2;
				t = Math.min(t, e.Position.x - a), n = Math.min(n, e.Position.y - o), r = Math.max(r, e.Position.x + a), i = Math.max(i, e.Position.y + o);
			}), isFinite(t) ? {
				minX: t,
				minY: n,
				maxX: r,
				maxY: i
			} : null;
		}, C = (e) => {
			let t = a.current.refById(e), n = t ? a.current.getItem(t) : void 0, r = t && n ? c.entity(t.kind)?.render?.bounds?.(n) : null;
			return !t || !r ? null : {
				ref: t,
				rect: r,
				Position: {
					x: r.x + r.w / 2,
					y: r.y + r.h / 2
				},
				Size: {
					w: r.w,
					h: r.h
				}
			};
		}, w = () => Ge(a.current.nodes().flatMap((e) => e.Position ? [{ rect: {
			x: e.Position.x - e.Size.w / 2,
			y: e.Position.y - e.Size.h / 2,
			w: e.Size.w,
			h: e.Size.h
		} }] : [])), T = (e, t, n, r) => {
			let i = e.Label?.text?.trim();
			if (!i || !t.Position || !n.Position) return null;
			let a = Je(n.Position, t.Position, {
				w: t.Size.w / 2,
				h: t.Size.h / 2
			}), o = Je(t.Position, n.Position, {
				w: n.Size.w / 2,
				h: n.Size.h / 2
			}), s = wi(i, a, o, e.id), c = Ke(r ?? w(), s.rect, 480).map((e) => e.rect);
			return wi(i, a, o, e.id, c).rect;
		}, E = (t, n = 72) => {
			let r = n, a = !d.isOn("view.fit.contain") && i.places.width() > 680 && i.places.width() <= 900 ? Math.max(n, 106) : n, o = t.width - n, s = t.height - n;
			d.isOn("view.fit.contain") && i.places.el(e.Stage)?.querySelectorAll(".tool-panel[data-anchor^=\"bottom\"]").forEach((e) => {
				let n = e.getBoundingClientRect();
				n.width && n.height && n.top > t.top && (s = Math.min(s, n.top - t.top - 20));
			}), [e.Top, e.Stage].flatMap((e) => [...i.places.el(e)?.querySelectorAll(".tool-panel[data-anchor^=\"top\"]") ?? []]).forEach((e) => {
				let n = e.getBoundingClientRect();
				n.width > t.width * .25 && n.bottom > t.top && n.top < t.bottom && n.right > t.left && n.left < t.right && n.top < t.top + t.height / 2 && (a = Math.max(a, n.bottom - t.top + 20));
			});
			let c = i.places.el(e.Left), l = c && c.childElementCount > 0 ? c.getBoundingClientRect() : void 0;
			l && l.width > 0 && l.height > 0 && l.right > t.left && l.left < t.right && l.bottom > t.top && l.top < t.bottom && (i.places.width() <= 900 && c?.dataset.leftFolded === "true" ? a = Math.max(a, l.bottom - t.top + 8) : r = Math.max(r, l.right - t.left + 20));
			let u = i.places.el(e.Right), f = u && u.childElementCount > 0 ? u.getBoundingClientRect() : void 0;
			i.places.width() > 680 && f && f.width > 0 && f.height > 0 && f.right > t.left && f.left < t.right && f.bottom > t.top && f.top < t.bottom && (i.places.width() <= 900 && f.height <= 64 && f.top < t.top + t.height / 2 ? a = Math.max(a, f.bottom - t.top + 8) : o = Math.min(o, f.left - t.left - 20)), o - r < 80 && (r = n, o = t.width - n);
			let p = Math.max(1, o - r), m = Math.max(1, s - a);
			return {
				left: r,
				top: a,
				right: o,
				bottom: s,
				width: p,
				height: m,
				cx: r + p / 2,
				cy: a + m / 2
			};
		}, D = (e, t, n) => {
			let r = (e.maxX - e.minX) * n, a = i.places.width() <= 900 && r > t.width;
			return {
				x: r <= t.width || a ? (e.minX + e.maxX) / 2 - t.cx / n : e.minX - t.left / n,
				y: e.minY - t.top / n,
				scale: n
			};
		}, O = (e, t, n) => ({
			x: (e.minX + e.maxX) / 2 - t.cx / n,
			y: (e.minY + e.maxY) / 2 - t.cy / n,
			scale: n
		}), k = (t, n = 72) => {
			_();
			let r = i.places.el(e.Stage);
			if (!r) return;
			let o = E(r.getBoundingClientRect(), n), s = Math.max(1, t.maxX - t.minX), c = Math.max(1, t.maxY - t.minY), l = Math.min(1.25, Math.min(o.width / s, o.height / c)), u = i.places.width() > 680 && i.places.width() <= 900 && a.current.nodes().length >= 10, f = d.isOn("view.fit.contain") ? l : u ? Math.min(kl, l) : Ol, m = Math.max(f, l);
			i.view.set(!d.isOn("view.fit.contain") && (u || l < f) ? D(t, o, m) : O(t, o, m)), p();
		}, A = (e, t) => {
			let n = i.view.get(), r = Math.max(1, e.maxX - e.minX), a = Math.max(1, e.maxY - e.minY), o = t.width, s = t.height, c = Math.max(1, t.width * .46), l = Math.max(1, t.height * .46), u = r * n.scale, d = a * n.scale, f = Math.min(.9, o / r, s / a);
			if (n.scale < f * .85) return f;
			if (u > o || d > s) return Math.min(n.scale, o / r, s / a);
			if (u > c || d > l) {
				let e = Math.min(c / r, l / a);
				return Math.min(n.scale, Math.max(n.scale * .92, e));
			}
			return n.scale;
		}, j = (e, t, n, r, i, a) => {
			let o = (e + t) / 2, s = Math.max(.5, (t - e) * i / 2), c = (o - a) * i, l = r - n, u = n + l * .38, d = n + l * .62, f = n, p = r, m = W(c, u, d);
			return m = s * 2 <= p - f ? W(m, f + s, p - s) : n + l / 2, o - m / i;
		}, M = (t, n = !1) => {
			let r = i.places.el(e.Stage);
			if (!r) return;
			let a = E(r.getBoundingClientRect()), o = i.view.get(), s = A(t, a), c = Math.max(Ol, s);
			v(n || s < .8 ? D(t, a, c) : {
				x: j(t.minX, t.maxX, a.left, a.right, c, o.x),
				y: j(t.minY, t.maxY, a.top, a.bottom, c, o.y),
				scale: c
			});
		}, N = (e) => ({
			minX: e.x,
			minY: e.y,
			maxX: e.x + e.w,
			maxY: e.y + e.h
		}), P = (e) => {
			let t = a.current.getItem(e), n = c.entity(e.kind)?.render, r = t && n?.bounds ? n.bounds(t) : null;
			if (r) return N(r);
			if (e.kind === "edge") {
				let t = a.current.getEdge(e.id), n = t && C(t.From), r = t && C(t.To);
				if (n && r) {
					let e = I(N(n.rect), N(r.rect)), i = T(t, n, r);
					if (e && i) return I(e, N(i));
					if (e) return e;
				}
			}
			let o = i.hierarchy.anchor(e);
			return o ? {
				minX: o.x - 80,
				minY: o.y - 32,
				maxX: o.x + 80,
				maxY: o.y + 32
			} : null;
		}, F = (e, t) => {
			let n = {
				kind: "container",
				id: e
			}, r = a.current.getItem(n), i = P(n), o = r?.Sections ?? [], s = o.findIndex((e) => e.id === t);
			if (!i || s < 0) return null;
			let c = o.map((e) => Math.max(.15, e.weight ?? 1)), l = c.reduce((e, t) => e + t, 0) || 1, u = c.slice(0, s).reduce((e, t) => e + t, 0) / l, d = c.slice(0, s + 1).reduce((e, t) => e + t, 0) / l;
			if (r?.SectionAxis === "columns") {
				let e = i.maxX - i.minX;
				return {
					minX: i.minX + e * u,
					minY: i.minY,
					maxX: i.minX + e * d,
					maxY: i.maxY
				};
			}
			let f = i.maxY - i.minY;
			return {
				minX: i.minX,
				minY: i.minY + f * u,
				maxX: i.maxX,
				maxY: i.minY + f * d
			};
		}, I = (e, t) => ({
			minX: Math.min(e.minX, t.minX),
			minY: Math.min(e.minY, t.minY),
			maxX: Math.max(e.maxX, t.maxX),
			maxY: Math.max(e.maxY, t.maxY)
		}), ee = () => {
			let e = null;
			c.entities().forEach((t) => {
				let n = t.render?.bounds;
				n && a.current.itemsOfKind(t.kind).forEach((r) => {
					let o = r.id;
					if (!o || Dn({
						kind: t.kind,
						id: o
					}, i.hierarchy.parentChain, i.fold, a.current.id)) return;
					let s = n(r);
					if (!s) return;
					let c = {
						minX: s.x,
						minY: s.y,
						maxX: s.x + s.w,
						maxY: s.y + s.h
					};
					e = e ? I(e, c) : c;
				});
			});
			let t = w();
			return a.current.edges().forEach((n) => {
				let r = n.Label?.text?.trim(), o = C(n.From), s = C(n.To);
				if (!r || !o?.Position || !s?.Position || Dn(o.ref, i.hierarchy.parentChain, i.fold, a.current.id) || Dn(s.ref, i.hierarchy.parentChain, i.fold, a.current.id)) return;
				let c = T(n, o, s, t);
				if (!c) return;
				let l = {
					minX: c.x,
					minY: c.y,
					maxX: c.x + c.w,
					maxY: c.y + c.h
				};
				e = e ? I(e, l) : l;
			}), e;
		}, te = () => {
			let e = ee();
			e && k(e);
		};
		n("view.fit.all", () => {
			te(), u.schedule("view.fit.settle", te, 24);
		}), n("view.fit.selected", () => {
			let e = o.selectedAll().map(P).filter((e) => !!e);
			e.length && k(e.reduce(I), 180);
		}), n("view.fit.item", (e) => {
			let t = P(e);
			t && M(t);
		}), n("view.fit.section", ({ containerId: e, sectionId: t }) => {
			let n = F(e, t);
			n && M(n, !0);
		});
		let ne, re = () => {
			let t = new URLSearchParams(location.search);
			t.has("g") && t.has("view") || u.schedule("view.resize.fit", () => {
				let t = i.places.el(e.Stage)?.getBoundingClientRect();
				t && t.width > 0 && t.height > 0 && a.current.nodes().length && r("view.fit.all");
			}, 20);
		};
		return globalThis.addEventListener?.("resize", re), n("app.start", () => {
			if (typeof ResizeObserver == "function") {
				ne = new ResizeObserver(re);
				let t = i.places.el(e.Stage);
				t && ne.observe(t);
			}
		}), () => {
			_(), ne?.disconnect(), globalThis.removeEventListener?.("resize", re), u.cancel("view.resize.fit"), u.cancel("view.fit.settle");
		};
	}, { requires: ["render"] });
}
//#endregion
//#region canvas/systems/index.ts
function jl(e) {
	sc(e), ic(e), va(e), cc(e), Do(e), Ra(e), Va(e), ba(e), Bi(e), go(e), Sl(e), ds(e), rs(e), vo(e), Zi(e), $i(e), Yi(e), Ya(e), Ui(e), Oa(e), Al(e), Dl(e), La(e), _o(e), xa(e), mo(e), Hs(e), tc(e), ga(e), Co(e), Ta(e), Po(e), qo(e), Oo(e), ha(e), vl(e), Aa(e), Hi(e), ya(e), ol(e);
}
//#endregion
//#region canvas/canvas-features.ts
function Ml(t) {
	t("nodeToContainer", ({ on: e, emit: t, contexts: n, graphs: r, selection: i }) => {
		let a = (e) => {
			let t = g(e) ?? i.selected();
			return t?.kind === "node" ? t.id : void 0;
		};
		n.commands.register([{
			id: "node.convert.container",
			label: "Convert node to container",
			group: "container",
			available: (e) => !!a(e?.target),
			payload: (e) => ({ id: a(e.target) ?? "" })
		}, {
			id: "container.convert.node",
			label: "Convert container to node",
			group: "container",
			available: (e) => (g(e?.target) ?? i.selected())?.kind === "container",
			payload: (e) => {
				let t = g(e.target) ?? i.selected();
				return { id: t?.kind === "container" ? t.id : "" };
			}
		}]), e("node.convert.container", ({ id: i }) => {
			let a = r.current.getNode(i);
			if (!a) return;
			let o = B(i), s = n.hierarchy.parentRefOf(o), c = (s?.kind === "container" ? r.current.getItem(s) : void 0)?.ChildSections?.[R(o)], l = r.current.edgesOf(i).map((e) => ({
				id: e.id,
				From: e.From,
				To: e.To
			})), u = () => {};
			u = e("container.created", ({ id: e }) => {
				u(), l.forEach((n) => t("graph.edge.update", {
					id: n.id,
					patch: {
						...n.From === i ? { From: e } : {},
						...n.To === i ? { To: e } : {}
					}
				})), s?.kind === "container" && t("container.add-child", {
					containerId: s.id,
					childRef: {
						kind: "container",
						id: e
					},
					sectionId: c
				});
			}), t("editing.container.create", {
				Label: { text: a.Label.text },
				at: a.Position ? { ...a.Position } : {
					x: 0,
					y: 0
				},
				Size: {
					w: Math.max(220, a.Size.w),
					h: Math.max(140, a.Size.h)
				},
				AutoFit: !1,
				Color: a.Color
			}), t("graph.node.delete", { id: i });
		}), e("container.convert.node", ({ id: i }) => {
			let a = r.current.getItem({
				kind: "container",
				id: i
			});
			if (!a) return;
			let o = {
				kind: "container",
				id: i
			}, s = n.hierarchy.parentRefOf(o), c = (s?.kind === "container" ? r.current.getItem(s) : void 0)?.ChildSections?.[R(o)], l = r.current.edgesOf(i).map((e) => ({
				id: e.id,
				From: e.From,
				To: e.To
			})), u = "", d = () => {};
			d = e("graph.node.created", ({ id: e }) => {
				d(), u = e, l.forEach((n) => t("graph.edge.update", {
					id: n.id,
					patch: {
						...n.From === i ? { From: e } : {},
						...n.To === i ? { To: e } : {}
					}
				})), s?.kind === "container" && t("container.add-child", {
					containerId: s.id,
					childRef: B(e),
					sectionId: c
				});
			});
			let f = a.Children?.length ?? 0;
			t("graph.node.create", {
				Label: { text: a.Label.text },
				Position: { ...a.Position },
				NodeType: "square",
				Color: a.Color,
				keepView: !0
			}), t(f ? "container.ungroup" : "graph.container.delete", { id: i }), u && t("selection.item.select", B(u)), f && t("app.notice", {
				message: `Converted to node; released ${f} contained item${f === 1 ? "" : "s"}.`,
				level: "info"
			});
		});
	}, { requires: ["graph", "containers"] }), t("nodeLifecycle", (t) => {
		let { on: n, emit: r, contexts: i, graphs: a, selection: o } = t, s = (e, t) => t.x >= e.x && t.y >= e.y && t.x + t.w <= e.x + e.w && t.y + t.h <= e.y + e.h, c = (t) => {
			let n = a.current.getNode(t), r = i.view.visibleRect(e.Stage);
			return !!n && !!r && !s(r, Pn(n));
		}, l = (e) => {
			let n = o.selectedNode(), r = { Label: { text: `Node ${a.current.nodes().length + 1}` } };
			if (!n) return r;
			let i = t.layout?.creation(n.id, e);
			return i ? {
				...r,
				...i
			} : {
				...r,
				relativeTo: n.id,
				connectFrom: n.id,
				...e ? { keepFocus: !0 } : {}
			};
		};
		i.commands.register([{
			id: "editing.node.create",
			label: "Create node",
			group: "editing",
			shortcut: "A",
			input: {
				on: "keydown",
				key: "a",
				prevent: !0
			},
			payload: (e) => e.origin === "pointer" ? {
				Label: { text: `Node ${a.current.nodes().length + 1}` },
				keepView: !0
			} : l(!1)
		}, {
			id: "editing.node.create.keep",
			label: "Create attached node (keep selection)",
			event: "editing.node.create",
			group: "editing",
			shortcut: "Shift+A",
			input: {
				on: "keydown",
				key: "A",
				shift: !0,
				prevent: !0
			},
			available: () => !!o.selectedNode(),
			payload: () => l(!0)
		}]), n("editing.node.create", (e) => r("graph.node.create", e)), n("graph.node.created", ({ id: e, hints: t }) => {
			t?.keepFocus || (r("selection.node.select", { id: e }), r("focus.node.focus", { id: e })), t?.connectFrom && r("graph.edge.create", {
				From: t.connectFrom,
				To: e,
				EdgeKind: t.connectKind
			}), !t?.keepView && c(e) && r("view.fit.item", {
				kind: "node",
				id: e
			});
		});
	}, { requires: [
		"graph",
		"ability.selectable",
		"focus"
	] }), t("edgeLifecycle", ({ on: e, emit: t, contexts: n, graphs: r, selection: i, frameLoop: a }) => {
		n.commands.register([{
			id: "editing.edge.create",
			label: "Create edge",
			group: "edge",
			shortcut: "E",
			input: {
				on: "keydown",
				key: "e",
				prevent: !0
			},
			picker: {
				title: "Create edge",
				steps: [{
					id: "From",
					prompt: "Pick source node",
					filter: () => (e) => e.kind === "node",
					seed: () => {
						let e = i.selected();
						return e?.kind === "node" ? e : null;
					}
				}, {
					id: "To",
					prompt: "Pick target node",
					filter: (e) => (t) => t.kind === "node" && t.id !== e.From?.id
				}],
				validate: (e) => {
					if (r.current.nodes().length < 2) return "Create at least two nodes before creating an edge.";
					if (!e.From || !e.To) return "Pick both source and target.";
					if (e.From.id === e.To.id) return "Source and target must be different nodes.";
				},
				payload: (e) => ({
					From: e.From?.id ?? "",
					To: e.To?.id ?? ""
				})
			}
		}]), e("editing.edge.create", (n) => {
			let i = n.From ?? "", o = n.To ?? "";
			if (!i || !o || i === o || !r.current.getNode(i) || !r.current.getNode(o)) return;
			let s = e("graph.edge.created", ({ id: e }) => {
				s();
				let n = ht(e);
				t("selection.item.select", n), a.schedule("editing.edge.rename", () => t("item.title.edit", { ref: n }), 30);
			});
			t("graph.edge.create", {
				From: i,
				To: o,
				Label: n.Label
			});
		}), e("commandPicker.submit", ({ commandId: e }) => {
			e === "editing.edge.create" && t("app.notice", { message: "Edge created." });
		});
	}, { requires: ["graph"] }), t("autoLayout", ({ on: e, emit: t }) => {
		let n = !1, r = () => {
			n || (n = !0, queueMicrotask(() => {
				n = !1, t("view.fit.all");
			}));
		};
		e("graph.node.created", ({ hints: e }) => {
			e?.keepView || r();
		}), e("container.children.changed", ({ id: e }) => t("layout.apply.sections", { id: e }));
	}, { requires: ["graph", "layout"] });
}
//#endregion
//#region canvas/runtime.ts
function Nl(e, t) {
	let n = () => {
		e.bus.emit("render.stage.draw", { full: !0 }), e.bus.emit("outline.draw");
	}, r = {
		registry: t,
		setFlag(r, i) {
			e.flags.set(r, i), t.names().includes(r) && (i ? t.start(e) : t.stop(e, r)), n();
		},
		refresh() {
			t.start(e), n();
		}
	};
	return e.registry = t, e.runtime = r, e.bus.on("flag.toggle", ({ name: e, on: t }) => {
		e && r.setFlag(e, t);
	});
}
//#endregion
//#region canvas/mount.ts
var Pl = /* @__PURE__ */ new WeakSet();
function Fl(e) {
	if (!(e.target instanceof HTMLElement) || !e.target.isConnected) throw Error("createCanvas: target must be a connected HTMLElement");
	if (Pl.has(e.target)) throw Error("createCanvas: target already has an active canvas");
	let t = e.target, n = [...t.childNodes], o = t.classList.contains("ecs-canvas"), s = document.createElement("div");
	s.innerHTML = a;
	let c = rr(), l = F(), u = ye(), d = k();
	e.links && d.setAutolinks(e.links);
	let f = {
		...ki,
		entities: ki.entities.map((e) => e.kind === "node" ? fi(l, u, d.renderMarkdown) : e.kind === "edge" ? Oi(u) : e)
	}, p = e.mode === "read-only" || e.flags?.editing === !1, m = {
		io: !1,
		share: !1,
		...e.flags,
		...p ? {
			...r,
			"left.library": !1,
			outline: !1,
			containers: !1,
			autoLayout: !1
		} : {}
	}, h = ar(Yt(), f, m, e.io ?? Le(), {
		root: t,
		templates: s,
		namespace: `canvas-${crypto.randomUUID()}`,
		components: l,
		contracts: u
	});
	if (p) {
		for (let [e, t] of Object.entries(m)) t || h.flags.set(e, !1);
		h.contexts.commands.registerGuard("sdk.read-only", (t) => e.commands?.[t.id] || /^(view\.|focus\.|selection\.|fold\.)/.test(t.id) && !/delete|create|update/.test(t.id) ? !0 : "");
	}
	Pl.add(t);
	let g = () => {}, _ = !1, v = () => {
		if (_) throw Error("Canvas has been destroyed");
	}, y = () => {
		if (!_) {
			_ = !0;
			try {
				g();
				let e, t = !1;
				for (let n of c.names().reverse()) try {
					c.stop(h, n);
				} catch (n) {
					t = !0, e = n;
				}
				if (t) throw e;
			} finally {
				h.frameLoop.dispose(), t.replaceChildren(...n), o || t.classList.remove("ecs-canvas"), l.resetComponentRegistry(), Pl.delete(t);
			}
		}
	}, b = (e) => {
		v(), h.bus.emit("graph.import.snapshot", e), h.frameLoop.flushNow();
	};
	try {
		t.classList.add("ecs-canvas"), jl(ir(c, "system")), zr(ir(c, "ability")), Ml(ir(c, "feature")), i(c, h, e.ui ?? (p ? { panels: { zoom: {
			anchor: "bottom-right",
			commands: [
				"view.zoom.in",
				"view.zoom.out",
				"view.fit.all"
			]
		} } } : {}), e.commands), e.configure?.(c, h), g = Nl(h, c), c.start(h), h.bus.emit("app.start"), e.document && b(e.document), h.frameLoop.flushNow();
	} catch (e) {
		try {
			y();
		} catch {}
		throw e;
	}
	return {
		ctx: h,
		load: b,
		destroy: y,
		snapshot: () => (v(), h.graphs.current.snapshot()),
		fit: () => {
			v(), h.bus.emit("view.fit.all");
		},
		run: (e) => (v(), h.contexts.commands.run(e))
	};
}
//#endregion
//#region canvas/project.ts
function Il(e, t) {
	let n = /* @__PURE__ */ new Map(), r = !1, i = /* @__PURE__ */ new Set(), a = () => {
		if (r) throw Error("Project has been destroyed");
	}, o = new Map(Object.entries(e.nodes).map(([e, n]) => [e, n.config.parse(t.nodes?.[e] ?? n.defaults)]));
	for (let [n, r] of [[t.nodes, e.nodes], [t.panels, e.panels]]) for (let e of Object.keys(n ?? {})) if (!Object.prototype.hasOwnProperty.call(r, e)) throw TypeError(`Unknown configuration: ${e}`);
	let s = {
		...e.theme,
		...t.theme
	};
	for (let t of Object.keys(s)) if (!Object.prototype.hasOwnProperty.call(e.theme, t)) throw TypeError(`Unknown theme token: ${t}`);
	let c = (e) => {
		let t = /* @__PURE__ */ new Map();
		for (let [n, r] of Object.entries(s)) t.set(n, [e.style.getPropertyValue(n), e.style.getPropertyPriority(n)]), r !== void 0 && e.style.setProperty(n, r);
		return () => {
			for (let [n, [r, i]] of t) e.style.setProperty(n, r, i);
		};
	}, l = c(t.target), u;
	try {
		u = Fl({
			...t,
			ui: t.ui ?? e.ui,
			commands: e.commands,
			configure(t) {
				t(`project.${e.id}`, ({ model: t }) => {
					let r = Object.entries(e.nodes).flatMap(([r, i]) => [t.registerNodeType({
						id: `${e.id}.${r}`,
						label: r,
						category: e.id,
						visual: "component",
						journey: i.journey
					}), t.components.registerComponentBody(`${e.id}.${r}`, { draw: ({ nodeId: e }) => i.draw(n.get(e).data, o.get(r)) })]);
					return r.push(t.components.setComponentBindingReader((t) => {
						let r = n.get(t);
						return r ? {
							component: `${e.id}.${String(r.type)}`,
							datasourceId: "",
							config: {}
						} : void 0;
					})), () => r.reverse().forEach((e) => e());
				});
			}
		});
	} catch (e) {
		throw l(), e;
	}
	let d = (e) => {
		let t = !0, n = () => {
			t && (t = !1, i.delete(n), e());
		};
		return i.add(n), n;
	};
	return {
		canvas: u,
		load(t, r = []) {
			a();
			let i = /* @__PURE__ */ new Map();
			for (let n of t) {
				if (!n.id || i.has(n.id)) throw TypeError("Node ids must be unique and nonempty");
				let t = Object.prototype.hasOwnProperty.call(e.nodes, String(n.type)) && e.nodes[String(n.type)];
				if (!t) throw TypeError(`Unknown node type: ${String(n.type)}`);
				if (![
					n.position.x,
					n.position.y,
					n.size?.w ?? 280,
					n.size?.h ?? 180
				].every(Number.isFinite) || n.size && (n.size.w <= 0 || n.size.h <= 0)) throw TypeError("Node geometry must be finite with positive size");
				let r = t.data.parse(n.data);
				i.set(n.id, {
					...n,
					data: r
				});
			}
			for (let e of r) if (!i.has(e.From) || !i.has(e.To)) throw TypeError("Edge endpoint is missing");
			let o = {
				nodes: [...i.values()].map((t) => ({
					id: t.id,
					Label: { text: e.nodes[String(t.type)].label(t.data) },
					NodeType: `${e.id}.${String(t.type)}`,
					Position: t.position,
					Size: t.size ?? {
						w: 280,
						h: 180
					}
				})),
				edges: r
			}, s = n, c = u.snapshot();
			n = i;
			try {
				u.load(o);
			} catch (e) {
				throw n = s, u.load(c), e;
			}
		},
		panel(n, r, i) {
			a();
			let o = Object.prototype.hasOwnProperty.call(e.panels, String(n)) && e.panels[String(n)];
			if (!o) throw TypeError(`Unknown panel: ${String(n)}`);
			let s = c(r);
			try {
				let e = o.attach(r, i, t.panels?.[n] ?? o.defaults);
				return d(() => {
					try {
						e();
					} finally {
						s();
					}
				});
			} catch (e) {
				throw s(), e;
			}
		},
		style(t, n) {
			a();
			let r = Object.prototype.hasOwnProperty.call(e.styles, String(t)) && e.styles[String(t)];
			if (!r) throw TypeError(`Unknown style: ${String(t)}`);
			let i = Object.keys(r).map((e) => {
				let t = e.replace(/[A-Z]/g, (e) => `-${e.toLowerCase()}`);
				return [
					t,
					n.style.getPropertyValue(t),
					n.style.getPropertyPriority(t)
				];
			});
			return Object.assign(n.style, r), d(() => {
				for (let [e, t, r] of i) n.style.setProperty(e, t, r);
			});
		},
		connect(t, n, r) {
			if (a(), !Object.prototype.hasOwnProperty.call(e.endpoints, String(t))) throw TypeError("Unknown endpoint");
			let i = $e(e.endpoints[String(t)], n, r);
			return {
				send: i.send,
				close: d(i.close)
			};
		},
		destroy() {
			if (!r) {
				r = !0;
				try {
					let e, t = !1;
					for (let n of [...i].reverse()) try {
						n();
					} catch (n) {
						t = !0, e = n;
					}
					try {
						u.destroy();
					} catch (n) {
						t = !0, e = n;
					}
					if (t) throw e;
				} finally {
					l(), n.clear();
				}
			}
		}
	};
}
//#endregion
export { ar as createAppContext, Fl as createCanvas, Le as memoryIo, Il as mountProject, zr as registerAbilitySystems, Ml as registerCanvasFeatures, jl as registerCanvasSystems, rr as registry, ir as withKind };
