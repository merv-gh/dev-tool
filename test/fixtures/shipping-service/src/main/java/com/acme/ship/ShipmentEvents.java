package com.acme.ship;

import com.acme.ship.events.ShipmentSent;
import java.time.Instant;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;

@Component
public class ShipmentEvents {
    private final KafkaTemplate<String, ShipmentSent> kafka;
    private final String sentTopic;

    public ShipmentEvents(KafkaTemplate<String, ShipmentSent> kafka, @Value("${app.topics.sent}") String sentTopic) {
        this.kafka = kafka;
        this.sentTopic = sentTopic;
    }

    public void sent(Shipment s) {
        kafka.send(sentTopic, String.valueOf(s.getOrderId()), new ShipmentSent(s.getId(), s.getOrderId(), s.getCarrierCode(), s.getTrackingNo(), Instant.now()));
    }
}
