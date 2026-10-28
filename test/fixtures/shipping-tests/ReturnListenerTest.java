package com.acme.ship;

import com.acme.ship.api.ShipmentStatus;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static com.acme.ship.TestData.*;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.AdditionalAnswers.returnsFirstArg;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class ReturnListenerTest {
    @Mock ShipmentRepository shipments;
    @Mock CarrierRepository carriers;
    @Mock ShipmentEvents events;
    @Mock ShipDictionaries dictionaries;

    @Test
    void theMessageIsTheShipmentId() {
        Shipment s = shipment();
        when(shipments.findById(SHIPMENT_ID)).thenReturn(Optional.of(s));
        when(shipments.save(any())).thenAnswer(returnsFirstArg());

        new ReturnListener(new ShipmentService(shipments, carriers, events, dictionaries)).onReturn(shipmentsReturnedMessage());

        assertThat(s.getStatus()).isEqualTo(ShipmentStatus.RETURNED);
    }
}
