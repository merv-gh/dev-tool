package com.acme.ship.api;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import java.math.BigDecimal;

public record Parcel(
        @NotNull @Positive @DecimalMax("70.000") BigDecimal weightKg,
        @Min(1) int count,
        @NotBlank String sku,
        @NotBlank String parcelType) {}
