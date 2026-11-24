# Independent scale information review

Evidence: [user-supplied rejected layout](research-evidence/rejected-layout.png).
Review date: 2026-11-23. Fresh review of the user's supplied screenshot, the current phone nested-path capture, proposal documentation, `web/editor.js` and `lib/workspace-editor.js`. This assessment is independent of the earlier five-fix prototype verdict. No implementation files were modified.

The rejection is structural. Lazy loading and paging bound fetched content; they do not bound indentation, and a call graph is not an ownership tree. The fixed 410px Files inspector is unsuitable as the primary source workbench.

Six required changes:

1. **Resizable task workspace.** Chat retains the finding and access to the investigation; trace, source and data need coordinated persistent selections. At 1024px and 1440px, inspect a predicate, source range and relevant rows without repeatedly replacing the only detail panel. At phone widths, use explicit full-screen views with reliable return and retained selection.
2. **Bounded graph exploration.** Use a flat selected path, callers/callees and accessible ancestry. Depth 50 and fan-out 500, shared callees and cycles must remain usable without hierarchy-driven horizontal scrolling. Back must restore focus, filters and scroll; references must work without prior expansion.
3. **Actual file workbench.** The prototype's first-segment groups and textarea cannot supply the requested editing experience. Reuse the existing editor's real documents, tabs, line numbers, modes, save shortcuts and revision checks. Demonstrate exact source-range opening, reveal in Explorer, clean preview versus pinned/dirty files, full-path search and conflict-safe saves.
4. **Correlated evidence.** Selecting a response field must identify its candidate record, relevant predicate/transformation and exact source range. Generic repeated descriptions beside different nodes are insufficient. Keep that relationship visible across source/data inspection; mark unsupported relationships unresolved.
5. **Local evidence identity.** Every selected object needs its evidence type, source/service revision, environment when relevant, observation or execution identity and explicit unknown state. A global static badge or separate assumptions panel is insufficient once the parent scrolls away. Current edits cannot make old trace evidence look current.
6. **Retrieval at scale.** Twenty-five-row pages do not solve finding one field among 1,500. The prototype's 25 matching files and backend's 1,000-entry folder limit need search/continuation and explicit incompleteness. Test 20,000 files, duplicate names, high fan-out/depth, stale evidence, keyboard and zoom, alongside measured rendering/network bounds.

These are design requirements and acceptance scenarios, not executed production-scale tests. A revised demonstration should prove the information-retrieval tasks, not just bounded rendering or another shallow happy path.
