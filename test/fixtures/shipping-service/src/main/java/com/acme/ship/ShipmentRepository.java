package com.acme.ship;

import com.acme.ship.api.ShipmentStatus;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ShipmentRepository extends JpaRepository<Shipment, Long> {
    Optional<Shipment> findByOrderId(Long orderId);

    List<Shipment> findByStatusAndCountry(ShipmentStatus status, String country);
}
