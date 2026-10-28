package com.acme.ship;

import com.acme.ship.api.CreateShipment;
import com.acme.ship.api.StatusChange;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/shipments")
public class ShipmentController {
    private final ShipmentService service;

    public ShipmentController(ShipmentService service) {
        this.service = service;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Shipment create(@Valid @RequestBody CreateShipment body) {
        return service.create(body);
    }

    @GetMapping("/{id}")
    public Shipment get(@PathVariable Long id) {
        return service.get(id);
    }

    @PutMapping("/{id}/status")
    public Shipment status(@PathVariable Long id, @Valid @RequestBody StatusChange change) {
        return service.changeStatus(id, change);
    }
}
