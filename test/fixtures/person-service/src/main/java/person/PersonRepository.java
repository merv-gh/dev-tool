package person;

import java.time.LocalDate;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import person.PersonData.*;

@Repository
public class PersonRepository {
    private final JdbcTemplate jdbc;
    public PersonRepository(JdbcTemplate jdbc) { this.jdbc = jdbc; }
    public Registry person(long personId) {
        return jdbc.queryForObject("""
            SELECT p.id, p.family_name, p.given_name, p.patronymic, p.birth_date, a.city, a.street
            FROM registry.person p
            LEFT JOIN registry.person_address a ON a.person_id = p.id
            WHERE p.id = ?
            """, (rs, row) -> new Registry(rs.getLong("id"),
                new Name(rs.getString("family_name"), rs.getString("given_name"), rs.getString("patronymic")),
                rs.getObject("birth_date", LocalDate.class), rs.getString("city"), rs.getString("street")), personId);
    }
    public List<Document> documents(long personId) {
        return jdbc.query("""
            SELECT d.id, d.last_name, d.first_name, d.middle_name, d.birth_date, d.issued_on,
                   d.effective_from, d.expires_on, s.active, s.annulled
            FROM registry.person_document d
            JOIN registry.document_state s ON s.document_id = d.id
            WHERE d.person_id = ?
            """, (rs, row) -> new Document(rs.getLong("id"),
                new Name(rs.getString("last_name"), rs.getString("first_name"), rs.getString("middle_name")),
                rs.getObject("birth_date", LocalDate.class), rs.getObject("issued_on", LocalDate.class),
                rs.getObject("effective_from", LocalDate.class), rs.getObject("expires_on", LocalDate.class),
                rs.getBoolean("active"), rs.getBoolean("annulled")), personId);
    }
}
