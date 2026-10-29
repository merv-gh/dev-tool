package com.acme.view;

import org.springframework.stereotype.Service;

/** Payment reminders for unpaid orders. */
@Service
public class ReminderService {
    private final OrderCardRepository cards;

    public ReminderService(OrderCardRepository cards) {
        this.cards = cards;
    }

    public String reminderFor(long orderId) {
        OrderCard c = cards.find(orderId).orElseThrow();
        if ("captured".equals(c.lastPaymentStatus())) return null;
        return "To: " + c.customerEmail() + " - order " + c.orderId() + " awaits " + c.totalWithTax();
    }
}
