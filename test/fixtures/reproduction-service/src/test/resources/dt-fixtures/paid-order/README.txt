Fixture paid-order

Load each database's schema.sql, data.sql, constraints.sql in that order.
The fixture_replay tool validates hashes and loads isolated scratch databases, dropping them on error.
For test_run give fixture_path and (for multiple datasources) fixture_bindings.
Kafka messages.jsonl preserves key, value, headers, partition, source offset and timestamp.
Use the service's test producer to publish them to its test Kafka; no live publish tool is provided.
Capture window: 2026-10-28T19:55:15.110Z .. 2026-10-28T19:55:15.117Z
Independent read-only statements across databases and Kafka; observation window and offsets are recorded, not a distributed snapshot.
Complete: true; gaps: 0. See manifest.json.
