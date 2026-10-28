package com.acme.pay;

import java.math.BigDecimal;

public record CreatePayment(Long customerId, BigDecimal amount) {}
