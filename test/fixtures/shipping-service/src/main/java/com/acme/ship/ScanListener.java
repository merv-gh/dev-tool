package com.acme.ship;

import com.acme.ship.events.ParcelScanned;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

// scans come as JSON text: read into ParcelScanned here
@Component
public class ScanListener {
    private final ShipmentService service;
    private final ObjectMapper mapper;

    public ScanListener(ShipmentService service, ObjectMapper mapper) {
        this.service = service;
        this.mapper = mapper;
    }

    @KafkaListener(topics = "parcels.scanned", groupId = "shipping-service")
    public void onScan(String payload) throws Exception {
        service.scanned(mapper.readValue(payload, ParcelScanned.class));
    }
}
