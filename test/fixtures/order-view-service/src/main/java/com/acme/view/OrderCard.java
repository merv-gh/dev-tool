package com.acme.view;

import java.math.BigDecimal;
import java.time.OffsetDateTime;

/** One row of sales.order_card(id). */
public record OrderCard(
        long orderId,
        String status,
        OffsetDateTime createdAt,
        long customerId,
        String customerName,
        String customerEmail,
        String segment,
        int itemCount,
        BigDecimal total,
        BigDecimal totalWithTax,
        BigDecimal legacyDiscount,
        String lastPaymentStatus) {
}
