package com.acme.ship;

import com.acme.ship.api.ShipmentStatus;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static com.acme.ship.TestData.*;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.AdditionalAnswers.returnsFirstArg;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

// the scan as JSON text, from the topic's schema and last messages (scanType IN_HUB most often)
@ExtendWith(MockitoExtension.class)
class ScanListenerTest {
    @Mock ShipmentRepository shipments;
    @Mock CarrierRepository carriers;
    @Mock ShipmentEvents events;
    @Mock ShipDictionaries dictionaries;

    ScanListener listener() {
        return new ScanListener(new ShipmentService(shipments, carriers, events, dictionaries), new ObjectMapper().findAndRegisterModules());
    }

    @Test
    void aScanInAHubChangesNothing() throws Exception {
        listener().onScan(parcelsScannedMessage());
        verifyNoInteractions(shipments);
    }

    @Test
    void theLastScanDelivers() throws Exception {
        Shipment s = shipment();
        when(shipments.findById(SHIPMENT_ID)).thenReturn(Optional.of(s));
        when(shipments.save(any())).thenAnswer(returnsFirstArg());
        listener().onScan(json(with(parcelScanned(), "scanType", "DELIVERED")));
        assertThat(s.getStatus()).isEqualTo(ShipmentStatus.DELIVERED);
    }
}
