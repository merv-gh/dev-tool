package com.acme.ship;

import com.acme.ship.api.Parcel;
import com.acme.ship.api.ShipmentStatus;
import com.acme.ship.api.StatusChange;
import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static com.acme.ship.TestData.*;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.AdditionalAnswers.returnsFirstArg;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class ShipmentServiceTest {
    @Mock ShipmentRepository shipments;
    @Mock CarrierRepository carriers;
    @Mock ShipmentEvents events;
    @Mock ShipDictionaries dictionaries;
    @InjectMocks ShipmentService subject;

    @Test
    void createsWithTheCarrierAndTheWeightOfTheParcels() {
        when(carriers.findById("DHL")).thenReturn(Optional.of(carrier()));
        when(dictionaries.parcelTypes()).thenReturn(activeParcelTypes());
        when(shipments.findByOrderId(ORDER_ID)).thenReturn(Optional.empty());
        when(shipments.save(any())).thenAnswer(returnsFirstArg());
        var body = with(createShipment(), "parcels", List.of(parcel(), with(parcel(), "count", 3)));

        var s = subject.create(body);

        assertThat(s.getOrderId()).isEqualTo(ORDER_ID);
        assertThat(s.getCarrierCode()).isEqualTo("DHL");
        assertThat(s.getWeightKg()).isEqualByComparingTo("4.000");
        assertThat(s.getCountry()).isEqualTo("DE");
    }

    @Test
    void tooHeavyForTheCarrier() {
        when(carriers.findById("DHL")).thenReturn(Optional.of(carrier()));
        when(dictionaries.parcelTypes()).thenReturn(activeParcelTypes());
        var heavy = with(createShipment(), "parcels", List.of(with(parcel(), "weightKg", new BigDecimal("31.501"))));
        assertThatThrownBy(() -> subject.create(heavy)).hasMessageContaining("too heavy for DHL");
        verify(shipments, never()).save(any());
    }

    @Test
    void aRetiredCarrierFromTheDictionaryIsRejected() {
        Carrier old = carriers().stream().filter(c -> !c.isActive()).findFirst().orElseThrow();
        when(carriers.findById(old.getCode())).thenReturn(Optional.of(old));
        assertThatThrownBy(() -> subject.create(with(createShipment(), "carrierCode", old.getCode()))).hasMessageContaining("no active carrier OLD");
    }

    @Test
    void anOrderIsShippedOnce() {
        when(carriers.findById("DHL")).thenReturn(Optional.of(carrier()));
        when(dictionaries.parcelTypes()).thenReturn(activeParcelTypes());
        when(shipments.findByOrderId(ORDER_ID)).thenReturn(Optional.of(shipment()));
        assertThatThrownBy(() -> subject.create(createShipment())).hasMessageContaining("order " + ORDER_ID);
    }

    @Test
    void aParcelTypeThatIsNotActiveIsRejected() {
        when(carriers.findById("DHL")).thenReturn(Optional.of(carrier()));
        when(dictionaries.parcelTypes()).thenReturn(activeParcelTypes());
        String retired = parcelTypes().stream().map(ParcelTypeDictionary::getCode).filter(c -> activeParcelTypes().stream().noneMatch(a -> a.getCode().equals(c))).findFirst().orElseThrow();
        var body = with(createShipment(), "parcels", List.of(with(parcel(), "parcelType", retired)));
        assertThatThrownBy(() -> subject.create(body)).hasMessageContaining("unknown parcel type PALLET");
    }

    @Test
    void aPaidOrderIsShippedWithTheFirstActiveCarrier() {
        when(carriers.findByActiveTrue()).thenReturn(activeCarriers());
        when(shipments.save(any())).thenAnswer(returnsFirstArg());

        var s = subject.createFor(orderPaid());

        assertThat(s.getOrderId()).isEqualTo(ORDER_ID);
        assertThat(s.getCarrierCode()).isEqualTo("DHL");
        // the order as the last messages on orders.paid have it: 2 x 0.750 kg
        assertThat(s.getWeightKg()).isEqualByComparingTo("1.5");
    }

    @Test
    void sentGetsATrackingNumberAndAnEvent() {
        when(shipments.findById(SHIPMENT_ID)).thenReturn(Optional.of(shipment()));
        when(shipments.save(any())).thenAnswer(returnsFirstArg());

        var s = subject.changeStatus(SHIPMENT_ID, with(statusChange(), "status", ShipmentStatus.SENT));

        assertThat(s.getTrackingNo()).isEqualTo("DHL-" + SHIPMENT_ID);
        verify(events).sent(s);
    }

    @Test
    void aDeliveredShipmentStaysDelivered() {
        Shipment delivered = shipment();
        delivered.setStatus(ShipmentStatus.DELIVERED);
        when(shipments.findById(SHIPMENT_ID)).thenReturn(Optional.of(delivered));
        assertThatThrownBy(() -> subject.changeStatus(SHIPMENT_ID, new StatusChange(ShipmentStatus.RETURNED, null))).isInstanceOf(IllegalStateException.class);
    }
}
