package com.acme.app;

import com.acme.libs.Greeting;

// Greets with the company library.
public class Welcome {
    public String to(String name) {
        return Greeting.hello(name).toUpperCase();
    }
}
