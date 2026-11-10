package demo;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.assertEquals;
class QuoteTest {
    @Test void priorityPrice() {
        Quote.QuoteBuilder builder = Quote.builder().subtotal(20);
        assertEquals(20, builder.build().getSubtotal());
        assertEquals(30, builder.build().total(true));
    }
}
