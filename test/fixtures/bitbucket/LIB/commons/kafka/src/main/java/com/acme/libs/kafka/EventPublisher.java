package com.acme.libs.kafka;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;

// Publishes domain events to the topic the service configures (acme.events.topic).
@Component
public class EventPublisher {
    private final KafkaTemplate<String, String> kafkaTemplate;
    private final String topic;

    public EventPublisher(KafkaTemplate<String, String> kafkaTemplate, @Value("${acme.events.topic}") String topic) {
        this.kafkaTemplate = kafkaTemplate;
        this.topic = topic;
    }

    public void publish(String key, String json) {
        kafkaTemplate.send(topic, key, json);
    }
}
