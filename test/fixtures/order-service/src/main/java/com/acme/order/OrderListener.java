package com.acme.order;

@Component
public class OrderListener {
    @KafkaListener(topics = "${app.kafka.topics.status}", groupId = "order-svc")
    public void onStatus(String msg) {}

    @KafkaListener(topics = {Topics.INVOICES, "refunds"}, groupId = "order-svc-invoices")
    void handle(ConsumerRecord<String, String> r) {}
}
