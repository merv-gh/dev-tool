package com.acme.ship;

import com.acme.ship.api.ServiceLevel;
import com.acme.ship.api.ShipmentStatus;
import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.OffsetDateTime;

@Entity
@Table(name = "shipments", schema = "ship")
public class Shipment {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "order_id", nullable = false)
    private Long orderId;

    @Column(name = "carrier_code", nullable = false)
    private String carrierCode;

    @Column(name = "weight_kg")
    private BigDecimal weightKg;

    private String country;

    @Enumerated(EnumType.STRING)
    private ServiceLevel level;

    @Enumerated(EnumType.STRING)
    private ShipmentStatus status = ShipmentStatus.CREATED;

    @Column(name = "tracking_no")
    private String trackingNo;

    @Column(name = "created_at", insertable = false, updatable = false)
    private OffsetDateTime createdAt;

    protected Shipment() {}

    public Shipment(Long orderId, String carrierCode, BigDecimal weightKg, String country, ServiceLevel level) {
        if (weightKg == null || weightKg.signum() <= 0) throw new IllegalArgumentException("weight must be positive");
        this.orderId = orderId;
        this.carrierCode = carrierCode;
        this.weightKg = weightKg;
        this.country = country;
        this.level = level == null ? ServiceLevel.STANDARD : level;
    }

    public Long getId() { return id; }
    public Long getOrderId() { return orderId; }
    public String getCarrierCode() { return carrierCode; }
    public BigDecimal getWeightKg() { return weightKg; }
    public String getCountry() { return country; }
    public ServiceLevel getLevel() { return level; }
    public ShipmentStatus getStatus() { return status; }
    public void setStatus(ShipmentStatus status) { this.status = status; }
    public String getTrackingNo() { return trackingNo; }
    public void setTrackingNo(String trackingNo) { this.trackingNo = trackingNo; }
    public OffsetDateTime getCreatedAt() { return createdAt; }
}
