package com.acme.ship;

import com.acme.ship.events.OrderPaid;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

@Component
public class OrderPaidListener {
    private final ShipmentService service;

    public OrderPaidListener(ShipmentService service) {
        this.service = service;
    }

    @KafkaListener(topics = "orders.paid", groupId = "shipping-service")
    public void onOrderPaid(OrderPaid event) {
        service.createFor(event);
    }
}
