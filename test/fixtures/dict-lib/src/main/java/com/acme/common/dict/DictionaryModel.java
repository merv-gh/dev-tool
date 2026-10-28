package com.acme.common.dict;

import java.util.Objects;

// A row of a dictionary table (d_*): what every service reads its reference data into
public class DictionaryModel {
    private final Long id;
    private final String code;
    private final String name;

    public DictionaryModel(Long id, String code, String name) {
        this.id = id;
        this.code = Objects.requireNonNull(code, "code");
        this.name = name;
    }

    public Long getId() { return id; }
    public String getCode() { return code; }
    public String getName() { return name; }
}
