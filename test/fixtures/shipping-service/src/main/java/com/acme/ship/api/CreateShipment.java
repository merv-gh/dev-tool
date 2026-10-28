package com.acme.ship.api;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;

public record CreateShipment(
        @NotNull Long orderId,
        @NotBlank @Size(max = 10) String carrierCode,
        @NotEmpty @Size(max = 20) List<@Valid Parcel> parcels,
        @NotNull @Valid Address to,
        ServiceLevel level) {}
