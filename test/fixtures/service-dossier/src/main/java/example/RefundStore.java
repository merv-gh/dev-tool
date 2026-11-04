package example;
import org.springframework.stereotype.Repository;
import org.springframework.jdbc.core.JdbcTemplate;
@Repository
public class RefundStore {
    private final JdbcTemplate jdbc;
    public RefundStore(JdbcTemplate jdbc) { this.jdbc = jdbc; }
    public void save(Order order) { jdbc.update("insert into sales.refunds (id) values (?)", order.id()); }
    public void read(long id) { jdbc.queryForList("select id from sales.refunds where id = ?", id); }
}
