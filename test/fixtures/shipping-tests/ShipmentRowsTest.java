package com.acme.ship;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.jdbc.core.JdbcTemplate;

import static org.assertj.core.api.Assertions.assertThat;

// rows inserted with plain SQL (TestData.Rows), read back through the repository
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
class ShipmentRowsTest {
    @Autowired JdbcTemplate jdbc;
    @Autowired ShipmentRepository shipments;

    @Test
    void aRowReadsBackAsAShipment() {
        long id = new TestData.Rows(jdbc).shipment();
        assertThat(shipments.findById(id)).get().extracting(Shipment::getCarrierCode, Shipment::getCountry).containsExactly("DHL", "DE");
    }

    @Test
    void rowsDoNotCollideOnUniqueColumns() {
        var rows = new TestData.Rows(jdbc);
        assertThat(rows.shipment()).isNotEqualTo(rows.shipment());
    }
}
