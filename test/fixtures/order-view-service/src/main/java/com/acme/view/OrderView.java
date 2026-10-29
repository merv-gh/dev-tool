package com.acme.view;

import java.math.BigDecimal;

/** What the order page shows. */
public record OrderView(long id, String status, String customer, String contactEmail, int items, BigDecimal toPay, String payment) {
}
