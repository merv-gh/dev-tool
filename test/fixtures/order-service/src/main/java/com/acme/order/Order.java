package com.acme.order;

@Entity
@Table(name = "orders", schema = "sales")
public class Order { @Id Long id; }
