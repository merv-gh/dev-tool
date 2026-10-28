package com.acme.pay;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;

@Component
public class PaymentEvents {
    private final KafkaTemplate<String, String> kafkaTemplate;
    private final String createdTopic;

    public PaymentEvents(KafkaTemplate<String, String> kafkaTemplate, @Value("${app.topics.created}") String createdTopic) {
        this.kafkaTemplate = kafkaTemplate;
        this.createdTopic = createdTopic;
    }

    public void created(Payment p) {
        kafkaTemplate.send(createdTopic, String.valueOf(p.getId()), "{\"id\":" + p.getId() + ",\"amount\":" + p.getAmount() + "}");
    }
}
