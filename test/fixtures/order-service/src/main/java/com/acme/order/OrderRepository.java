package com.acme.order;

public interface OrderRepository extends JpaRepository<Order, Long> {
    @Query("delete from sales.order_audit where ts < :ts")
    void purge(Instant ts);

    @Procedure(procedureName = "sales.close_order")
    void close(Long id);
}
