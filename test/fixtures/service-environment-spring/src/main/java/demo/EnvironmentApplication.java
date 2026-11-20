package demo;

import java.util.Map;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

@SpringBootApplication
@RestController
public class EnvironmentApplication {
    private final JdbcTemplate database;
    public EnvironmentApplication(JdbcTemplate database) { this.database = database; }
    public static void main(String[] args) { SpringApplication.run(EnvironmentApplication.class, args); }
    @GetMapping("/health") public Map<String, Object> health() {
        return Map.of("status", "UP", "database", database.queryForObject("select 1", Integer.class));
    }
    @PostMapping("/orders/{id}/close") public Map<String, Object> close(@PathVariable long id) {
        database.update("update orders set status = ? where id = ?", "CLOSED", id);
        return Map.of("id", id, "status", database.queryForObject("select status from orders where id = ?", String.class, id));
    }
}
