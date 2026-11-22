package person;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import javax.sql.DataSource;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

@SpringBootApplication
public class PersonApplication {
    public static void main(String[] args) { SpringApplication.run(PersonApplication.class, args); }
    @Bean DataSource dataSource() {
        return new DriverManagerDataSource(System.getenv("PERSON_JDBC_URL"),
            System.getenv("PERSON_DB_USER"), System.getenv("PERSON_DB_PASSWORD"));
    }
    @Bean JdbcTemplate jdbc(DataSource dataSource) { return new JdbcTemplate(dataSource); }
    @Bean Clock clock() {
        String date = System.getenv("PERSON_AS_OF");
        return date == null ? Clock.systemUTC() : Clock.fixed(Instant.parse(date + "T12:00:00Z"), ZoneOffset.UTC);
    }
}
