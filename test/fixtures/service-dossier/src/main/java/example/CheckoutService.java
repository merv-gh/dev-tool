package example;
import org.springframework.stereotype.Service;
@Service
public class CheckoutService {
    private final RefundStore store;
    private final EventPublisher publisher;
    private final PaymentClient payments;
    private final SearchWriter search;
    public CheckoutService(RefundStore store, EventPublisher publisher, PaymentClient payments, SearchWriter search) {
        this.store = store; this.publisher = publisher; this.payments = payments; this.search = search;
    }
    public void handle(Order order) {
        store.save(order);
        publisher.send(order);
        payments.authorize(order);
        search.save(order);
    }
    public void read(long id) { store.read(id); }
}
