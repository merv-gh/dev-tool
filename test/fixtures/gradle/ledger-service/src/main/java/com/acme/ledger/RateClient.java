package com.acme.ledger;

import java.math.BigDecimal;

// Exchange rates from the rates service.
public interface RateClient {
    BigDecimal rate(String from, String to);
}
