package com.acme.ship;

import com.acme.ship.api.CreateShipment;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(ShipmentController.class)
class ShipmentControllerValidationTest {
    @Autowired
    MockMvc mvc;

    @MockBean
    ShipmentService service;

    @ParameterizedTest(name = "{0}")
    @MethodSource("com.acme.ship.TestData#createShipmentCases")
    void create(String name, CreateShipment body, boolean valid) throws Exception {
        when(service.create(any())).thenReturn(TestData.shipment());
        mvc.perform(post("/shipments").contentType(MediaType.APPLICATION_JSON).content(TestData.json(body)))
            .andExpect(valid ? status().isCreated() : status().isBadRequest());
    }
}
