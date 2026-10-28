package com.acme.pay;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface PaymentRepository extends JpaRepository<Payment, Long> {
    List<Payment> findByCustomerIdAndStatus(Long customerId, PaymentStatus status);

    @Query(value = "select * from pay.payments where customer_id = :customerId and status = 'NEW' order by created_at", nativeQuery = true)
    List<Payment> pendingFor(@Param("customerId") Long customerId);
}
