package example;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.PostMapping;
@FeignClient(name="payments", url="https://payments.example.test")
public interface PaymentClient {
    @PostMapping("/authorize")
    void authorize(Order order);
}
