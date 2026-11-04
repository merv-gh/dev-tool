# ECS Canvas SDK

Built `@ecs-canvas/sdk` 0.1.0 canvas embed, from ecs-canvas-graph 3.0.0,
source commit `5b9f1fa3fe8cad214f19544a64683286c00c3956`.
Apache-2.0; see LICENSE. Runtime dependencies: none.

Consumed from the upstream ecs-canvas-graph `sdk/dist` package. These vendored build
artifacts keep dt releases self-contained. The host integrates `createCanvas`
read-only mounting, selection events, document loading, fit and destroy. Graph
storage and transport are dt's DTMAP1 columns, not the SDK's optional JSON save.
