package example;
import org.springframework.stereotype.Component;
import org.springframework.scheduling.annotation.Scheduled;
@Component
public class RetryJob {
    private final CheckoutService service;
    public RetryJob(CheckoutService service) { this.service = service; }
    @Scheduled(fixedDelay=60000)
    public void run() { service.read(1); }
}
