package com.acme.pay;

import java.math.BigDecimal;
import java.math.RoundingMode;
import org.springframework.stereotype.Component;

// Card fee: 2.9% + 0.30, at least 0.50, in cents rounded half up.
@Component
public class FeeCalculator {
    private static final BigDecimal RATE = new BigDecimal("0.029");
    private static final BigDecimal FIXED = new BigDecimal("0.30");
    private static final BigDecimal MIN = new BigDecimal("0.50");

    public BigDecimal fee(BigDecimal amount) {
        if (amount == null || amount.signum() <= 0) {
            throw new IllegalArgumentException("amount must be positive");
        }
        BigDecimal fee = amount.multiply(RATE).add(FIXED).setScale(2, RoundingMode.DOWN);
        return fee.max(MIN);
    }
}
