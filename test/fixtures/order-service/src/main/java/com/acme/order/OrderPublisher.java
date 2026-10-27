package com.acme.order;

@Service
public class OrderPublisher {
    @Value("${app.kafka.topics.orders}")
    private String ordersTopic;

    private final KafkaTemplate<String, String> kafkaTemplate;
    private final StreamBridge streamBridge;

    public void publish(Order o) {
        kafkaTemplate.send(ordersTopic, o.getId().toString(), "x");
        kafkaTemplate.send(new ProducerRecord<>(Topics.INVOICES, "k", "v"));
        streamBridge.send("audit-out-0", o);
        mailSender.send(message); // not kafka
    }
}
