package com.acme.ship;

import com.acme.common.dict.DictionaryModel;

// ship.d_parcel_types
public class ParcelTypeDictionary extends DictionaryModel {
    public ParcelTypeDictionary(Long id, String code, String name) {
        super(id, code, name);
    }
}
