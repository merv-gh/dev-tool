package com.acme.ship;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.dao.DataIntegrityViolationException;

import static com.acme.ship.TestData.*;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

// against the real schema with its dictionaries (dt-schema/ship.sql)
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
class ShipmentRepositoryTest {
    @Autowired ShipmentRepository shipments;
    @Autowired CarrierRepository carriers;

    @Test
    void aShipmentFromTestDataIsAValidRow() {
        shipments.saveAndFlush(with(shipment(), "id", null));
        assertThat(shipments.findByOrderId(ORDER_ID)).get().extracting(Shipment::getCarrierCode).isEqualTo("DHL");
    }

    @Test
    void theDictionaryIsLoaded() {
        assertThat(carriers.findByActiveTrue()).extracting(Carrier::getCode).containsExactlyInAnyOrder("DHL", "UPS");
    }

    @Test
    void aCountryOutsideTheDictionaryIsRejected() {
        assertThatThrownBy(() -> shipments.saveAndFlush(with(with(shipment(), "id", null), "country", "XX"))).isInstanceOf(DataIntegrityViolationException.class);
    }
}
