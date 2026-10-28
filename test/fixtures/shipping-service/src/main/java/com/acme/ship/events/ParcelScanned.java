package com.acme.ship.events;

import java.time.Instant;

// JSON text on parcels.scanned (Avro schema registered for it)
public record ParcelScanned(Long shipmentId, String scanType, String hubCode, Instant at) {}
