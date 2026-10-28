package com.acme.ship.events;

import java.time.Instant;

public record ShipmentSent(Long shipmentId, Long orderId, String carrierCode, String trackingNo, Instant sentAt) {}
