package com.acme.ship;

import com.acme.ship.api.ShipmentStatus;
import com.acme.ship.api.StatusChange;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

// returns come as the shipment id in text
@Component
public class ReturnListener {
    private final ShipmentService service;

    public ReturnListener(ShipmentService service) {
        this.service = service;
    }

    @KafkaListener(topics = "shipments.returned", groupId = "shipping-service")
    public void onReturn(String shipmentId) {
        service.changeStatus(Long.parseLong(shipmentId.trim()), new StatusChange(ShipmentStatus.RETURNED, "returned"));
    }
}
