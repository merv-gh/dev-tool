package demo;
import lombok.Builder;
import lombok.Value;
@Value
@Builder
public class Quote {
    int subtotal;
    public int total(boolean priority) {
        if (priority) {
            return subtotal + 10;
        }
        return subtotal;
    }
}
