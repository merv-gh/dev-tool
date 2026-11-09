# Find a tool by its question

Open **Admin → Tool map** (`/admin#capabilities`) or ask for `capability_map` in
chat. The graph contains every enabled tool visible to your current account,
including configured extensions. It reads the registry locally; browsing performs
no model calls, live queries or tool execution.

The complete map groups tool nodes around the objects people investigate. Select
Service, Component & code, Database, Table & function, Kafka topic or another
object to read question edges such as “Who reads or writes this object?” or
“What would a change affect?” Search matches questions, tool names and purposes.
The object rail and question list provide keyboard navigation alongside the graph.
Scroll or drag the graph, use Zoom in/out, or choose Fit for the full picture.

Task is the common starting point for work that spans tools:

- **Workspace:** the checkout where you change and verify code.
- **Task context:** private notes, plans, progress, files and evidence.
- **Project memory:** shared, versioned understanding reused across tasks.

The Task view shows these three concepts and their starting tools together;
select a concept to see its complete set of questions.

Select a tool to inspect its purpose, required inputs and workflow guide. **Prepare
in Workbench** opens an editable draft in the same story and environment. Review
the arguments and choose Run there. A graph link does not authorize execution.

Share & export provides a credential-free map link, JSON and a standalone SVG of
the current graph. Map links reopen the current authorized registry; they do not
grant another reader your access. The `capability_map` tool retains an interactive
snapshot for Open WebUI and MCP clients. Snapshots reflect the permissions and
registry at capture time and follow normal private result ownership and retention;
they perform no network fetches. Workbench always checks current permissions.

The built-in snapshot can open a normal new tab; custom renderer overrides keep
their strict sandbox. An embedding chat client can impose additional restrictions
on popups. If it blocks the handoff, open the full result from the chat's link or
use **Share & export → Copy map link** to reopen the selected tool in Admin.

These edges explain what a tool can do with a kind of object. They are navigation
links, not evidence that a particular service calls another service or database.
Use passports, architecture dossiers and Joern views for those relationships.

[Full registry graph as SVG](screenshots/tool-capabilities.svg) ·
[Task, workspace and memory example](screenshots/sample-capabilities.png).
These examples show the local administrator registry; each live reader sees their
own authorized tools.
