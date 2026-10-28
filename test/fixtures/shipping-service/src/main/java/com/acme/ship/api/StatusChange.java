package com.acme.ship.api;

import jakarta.validation.constraints.NotNull;

public record StatusChange(@NotNull ShipmentStatus status, String note) {}
