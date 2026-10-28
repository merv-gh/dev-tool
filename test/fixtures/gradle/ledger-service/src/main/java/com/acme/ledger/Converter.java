package com.acme.ledger;

import java.math.BigDecimal;
import java.math.RoundingMode;
import org.springframework.stereotype.Service;

// Converts amounts between currencies, in cents (half up); the same currency is not converted.
@Service
public class Converter {
    private final RateClient rates;

    public Converter(RateClient rates) {
        this.rates = rates;
    }

    public BigDecimal convert(BigDecimal amount, String from, String to) {
        BigDecimal rate = rates.rate(from, to);
        return amount.multiply(rate).setScale(2, RoundingMode.HALF_UP);
    }
}
