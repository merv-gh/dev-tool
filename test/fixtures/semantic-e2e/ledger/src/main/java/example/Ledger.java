package example;

public class Ledger {
    public static int persist(int id) {
        return Storage.write(id);
    }
}
