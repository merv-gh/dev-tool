package example;

public class Orders {
    public int onOrder(int id) {
        if (id <= 0) throw new IllegalArgumentException("positive id required");
        return Ledger.persist(id);
    }
}
