package com.acme.billing.core;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.List;
import org.springframework.stereotype.Component;

// Invoice total: the lines, minus the discount (percent, applied to the sum), plus VAT on what is left.
@Component
public class InvoiceCalculator {
    public BigDecimal total(List<BigDecimal> lines, int discountPercent, BigDecimal vatRate) {
        BigDecimal sum = lines.stream().reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal discounted = sum.subtract(sum.multiply(BigDecimal.valueOf(discountPercent)).divide(BigDecimal.valueOf(100)));
        BigDecimal vat = sum.multiply(vatRate);
        return discounted.add(vat).setScale(2, RoundingMode.HALF_UP);
    }
}
