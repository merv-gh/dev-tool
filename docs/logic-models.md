# Logic models, simulation and TLA+

Open **Admin → Developer studio → Check logic & assumptions**. Prepare the diff
or workflow example, review the inputs and run it. Every result includes an
interactive state graph, retained paths/counterexamples, explicit assumptions,
coverage choices and portable `LogicModel.tla` / `LogicModel.cfg` exports.

`logic_model` supports `templates`, `save`, `get`, `list`, `run`, `export` and
`diagnostics`. Definitions are private to the current user/task and use revision
checks before replacement. Example:

```json
{"action":"run","template":"workflow-continuation","mode":"simulate","seed":42,"steps":30,"traces":10,"coverage":true}
```

A model has `version:1`, `title`, `initial`, `states:[{id,label?,terminal?}]`,
`transitions:[{id,from,to,label?,assumption?,source?}]`, optional `forbidden`,
`assumptions`, and `observations` naming declared transition IDs. Data is JSON;
no expressions, shell commands or JavaScript execute from definitions. Limits:
400 states, 1,200 transitions, 256 KiB, 100 traces and 1,000 steps per trace.

- **Check** explores every reachable state in the finite declared graph. It
  reports forbidden states and nonterminal states with no outgoing transition.
- **Simulate** samples reproducible seeded graph walks. Sampling cannot establish
  that every behavior is safe. The UI lets you inspect one retained path.
- **Coverage** counts declared transitions explored; turn it off with
  `coverage:false`. The source-observation overlay is a separate caller-supplied
  mapping, not independently verified test coverage.

The diff example records 50 real `lib/diff.js` runs: 49 input pairs over a small
alphabet and one matrix-budget fallback. Each concrete result reconstructs its
before/after inputs. The graph merges those decision paths and abstracts cursor
positions and LCS values; a sampled walk can combine decisions impossible for a
single concrete input. It does not prove the algorithm for arbitrary inputs.

The workflow example models start, parallel-work abstraction, wait, resume,
cancel and interrupted effects. An uncertain effect stops for explicit
resolution. Add a transition from `interrupted` to forbidden `replayed` to see a
counterexample. The revision-publication example similarly demonstrates a lost
update if a stale writer bypasses comparison.

## Optional real TLC execution

The exported TLA+ specification uses `pc` and the last transition, named actions,
terminal stuttering, `TypeOK` and `Safe` invariants. TLC checks safety/deadlocks of
this finite abstraction; it does not prove equivalence to the source code or
liveness. TLC's checking and seeded simulation modes and optional action
coverage are documented in the [official TLC guide](https://www.docs.tlapl.us/using:tlc:start).

Run the explicit installer to obtain the pinned upstream TLA+ Tools 1.7.4 jar:

```sh
node dev/setup-tlc.js
```

It verifies a pinned SHA256 before installation. Configure `formal.tlcJar` and
`formal.tlcSha256`, or `DT_TLC_JAR` and `DT_TLC_SHA256`; Java must be installed.
The runtime never downloads a checker automatically. `engine:"tlc"` runs the
same exported model with a 256 MiB JVM heap, one worker, a bounded timeout and
1 MiB output budget. It retains checker output and exit status. Cancellation
stops the child process. TLC action counts remain in checker output; the graph
simulation overlay uses this tool's generator, which differs from TLC's.

Arbitrary user-supplied TLA+ text is an export/edit artifact, not executed by this
tool. This avoids importing external Java override modules into the server.
Use a separate trusted checker environment for unrestricted specifications.
