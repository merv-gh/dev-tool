package com.acme.ship;

import com.acme.common.dict.DictionaryModel;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

// the service's reference data, read with plain SQL
@Repository
public class ShipDictionaries {
    private final JdbcTemplate jdbc;

    public ShipDictionaries(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public List<ParcelTypeDictionary> parcelTypes() {
        return jdbc.query("select id, code, name from ship.d_parcel_types where active order by id",
                (rs, i) -> new ParcelTypeDictionary(rs.getLong("id"), rs.getString("code"), rs.getString("name")));
    }

    public List<DictionaryModel> countries() {
        return jdbc.query("select code, name from ship.d_countries order by code",
                (rs, i) -> new DictionaryModel(null, rs.getString("code"), rs.getString("name")));
    }
}
