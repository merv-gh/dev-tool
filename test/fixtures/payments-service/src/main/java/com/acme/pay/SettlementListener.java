package com.acme.pay;

import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

@Component
public class SettlementListener {
    private final PaymentService service;

    public SettlementListener(PaymentService service) {
        this.service = service;
    }

    @KafkaListener(topics = "settlements", groupId = "payments-service")
    public void onSettlement(String paymentId) {
        service.settle(Long.valueOf(paymentId.trim()));
    }
}
