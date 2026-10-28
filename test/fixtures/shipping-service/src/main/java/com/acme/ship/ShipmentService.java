package com.acme.ship;

import com.acme.ship.api.CreateShipment;
import com.acme.ship.api.Parcel;
import com.acme.ship.api.ShipmentStatus;
import com.acme.ship.api.StatusChange;
import com.acme.ship.events.OrderPaid;
import java.math.BigDecimal;
import java.util.NoSuchElementException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ShipmentService {
    private final ShipmentRepository shipments;
    private final CarrierRepository carriers;
    private final ShipmentEvents events;
    private final ShipDictionaries dictionaries;

    public ShipmentService(ShipmentRepository shipments, CarrierRepository carriers, ShipmentEvents events, ShipDictionaries dictionaries) {
        this.shipments = shipments;
        this.carriers = carriers;
        this.events = events;
        this.dictionaries = dictionaries;
    }

    @Transactional
    public Shipment create(CreateShipment req) {
        Carrier carrier = carriers.findById(req.carrierCode()).filter(Carrier::isActive)
                .orElseThrow(() -> new IllegalArgumentException("no active carrier " + req.carrierCode()));
        var types = dictionaries.parcelTypes().stream().map(ParcelTypeDictionary::getCode).toList();
        for (Parcel p : req.parcels()) {
            if (!types.contains(p.parcelType())) throw new IllegalArgumentException("unknown parcel type " + p.parcelType());
        }
        BigDecimal weight = req.parcels().stream().map(p -> p.weightKg().multiply(BigDecimal.valueOf(p.count()))).reduce(BigDecimal.ZERO, BigDecimal::add);
        if (carrier.getMaxWeightKg() != null && weight.compareTo(carrier.getMaxWeightKg()) > 0) {
            throw new IllegalArgumentException("too heavy for " + carrier.getCode() + ": " + weight);
        }
        if (shipments.findByOrderId(req.orderId()).isPresent()) throw new IllegalStateException("order " + req.orderId() + " is shipped already");
        return shipments.save(new Shipment(req.orderId(), carrier.getCode(), weight, req.to().country(), req.level()));
    }

    // an order paid: ship it with the first active carrier
    @Transactional
    public Shipment createFor(OrderPaid event) {
        Carrier carrier = carriers.findByActiveTrue().stream().findFirst().orElseThrow(() -> new IllegalStateException("no active carrier"));
        BigDecimal weight = event.lines().stream().map(l -> new BigDecimal(l.weightKg()).multiply(BigDecimal.valueOf(l.qty()))).reduce(BigDecimal.ZERO, BigDecimal::add);
        return shipments.save(new Shipment(event.orderId(), carrier.getCode(), weight, event.shipTo().country(), null));
    }

    @Transactional
    public Shipment changeStatus(Long id, StatusChange change) {
        Shipment s = shipments.findById(id).orElseThrow(() -> new NoSuchElementException("no shipment " + id));
        if (s.getStatus() == ShipmentStatus.DELIVERED) throw new IllegalStateException("shipment " + id + " is delivered");
        s.setStatus(change.status());
        if (change.status() == ShipmentStatus.SENT) {
            s.setTrackingNo(s.getCarrierCode() + "-" + s.getId());
            events.sent(s);
        }
        return shipments.save(s);
    }

    // a scan of a parcel: delivered at the last one
    @Transactional
    public void scanned(com.acme.ship.events.ParcelScanned scan) {
        if ("DELIVERED".equals(scan.scanType())) changeStatus(scan.shipmentId(), new StatusChange(ShipmentStatus.DELIVERED, "scanned at " + scan.hubCode()));
    }

    public Shipment get(Long id) {
        return shipments.findById(id).orElseThrow(() -> new NoSuchElementException("no shipment " + id));
    }
}
