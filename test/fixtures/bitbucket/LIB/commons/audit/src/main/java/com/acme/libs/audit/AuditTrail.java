package com.acme.libs.audit;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

// Every processed request is written to audit.events.
@Component
public class AuditTrail {
    private final JdbcTemplate jdbc;

    public AuditTrail(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public void record(String what) {
        jdbc.update("insert into audit.events (what) values (?)", what);
    }
}
