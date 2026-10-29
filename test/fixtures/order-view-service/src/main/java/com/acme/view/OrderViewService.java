package com.acme.view;

import java.math.BigDecimal;
import org.springframework.stereotype.Service;

@Service
public class OrderViewService {
    private final OrderCardRepository cards;

    public OrderViewService(OrderCardRepository cards) {
        this.cards = cards;
    }

    public OrderView view(long orderId) {
        OrderCard c = cards.find(orderId).orElseThrow(() -> new IllegalArgumentException("no order " + orderId));
        BigDecimal toPay = c.totalWithTax().subtract(c.legacyDiscount());
        return new OrderView(c.orderId(), c.status(), c.customerName(), c.customerEmail(), c.itemCount(), toPay, c.lastPaymentStatus());
    }
}
