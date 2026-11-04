# The only analysis dependency is Joern; dt's worker and scripts are shipped in dist/.
FROM node:22-bookworm AS node-runtime
FROM ghcr.io/joernio/joern@sha256:54c7f728f813c1cefd4303e7c69c5d35003f0fc9fde1459872230e5bc4e4b7b4
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY dist/ /app/
ENV DT_HOME=/tmp/dt-semantic DT_SEMANTIC_DATA=/data/semantic DT_SEMANTIC_JOERN_VERSION=4.0.564
WORKDIR /data
ENTRYPOINT ["node", "/app/dt.js", "semantic-worker"]
CMD ["--port", "4110"]
