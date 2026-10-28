package com.acme.tc;

import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;

// Sums in the database: what a Testcontainers test checks against a real Postgres.
public class Totals {
    public long sum(Connection c, long a, long b) throws SQLException {
        try (var st = c.prepareStatement("select ?::bigint + ?::bigint")) {
            st.setLong(1, a);
            st.setLong(2, b);
            try (ResultSet rs = st.executeQuery()) {
                rs.next();
                return rs.getLong(1);
            }
        }
    }
}
