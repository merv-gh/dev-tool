package com.acme.ship;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

// dictionary: ship.d_carriers
@Entity
@Table(name = "d_carriers", schema = "ship")
public class Carrier {
    @Id
    private String code;
    private String name;
    @Column(name = "max_weight_kg")
    private java.math.BigDecimal maxWeightKg;
    private boolean active;

    protected Carrier() {}

    public String getCode() { return code; }
    public String getName() { return name; }
    public java.math.BigDecimal getMaxWeightKg() { return maxWeightKg; }
    public boolean isActive() { return active; }
}
