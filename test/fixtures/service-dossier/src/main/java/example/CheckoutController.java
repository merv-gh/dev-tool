package example;
import org.springframework.web.bind.annotation.*;
@RestController
public class CheckoutController {
    private final CheckoutService service;
    public CheckoutController(CheckoutService service) { this.service = service; }
    @PostMapping("/checkout")
    public void submit(@RequestBody Order order) { service.handle(order); }
    @GetMapping("/checkout/{id}")
    public void lookup(@PathVariable long id) { service.read(id); }
}
