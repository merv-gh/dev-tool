package com.acme.ship.events;

import java.time.Instant;
import java.util.List;

// JSON on topic orders.paid, from the order service
public record OrderPaid(Long orderId, String customerEmail, List<Line> lines, Address shipTo, Instant paidAt) {
    public record Line(String sku, int qty, String weightKg) {}
    public record Address(String line1, String city, String country, String zip) {}
}
