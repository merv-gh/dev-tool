package com.acme.orders;

import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

@Component
public class SettlementListener {
    private final OrderService service;

    public SettlementListener(OrderService service) {
        this.service = service;
    }

    @KafkaListener(topics = "${orders.topics.settled}", groupId = "orders-service")
    public void onSettled(String orderId) {
        service.settle(Long.valueOf(orderId));
    }
}
