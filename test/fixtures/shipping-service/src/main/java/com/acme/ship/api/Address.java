package com.acme.ship.api;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record Address(
        @NotBlank String line1,
        @NotBlank String city,
        @NotBlank @Pattern(regexp = "[A-Z]{2}") String country,
        @Size(min = 4, max = 10) String zip,
        String email) {}
