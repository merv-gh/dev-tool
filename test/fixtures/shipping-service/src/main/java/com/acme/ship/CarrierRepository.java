package com.acme.ship;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CarrierRepository extends JpaRepository<Carrier, String> {
    List<Carrier> findByActiveTrue();
}
