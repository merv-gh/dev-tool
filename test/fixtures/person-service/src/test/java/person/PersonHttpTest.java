package person;

import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class PersonHttpTest {
    @Autowired TestRestTemplate http;
    @Test void revokedNameMustNotWin() {
        Map body = http.getForObject("/person/101", Map.class);
        assertThat(body.get("fio")).isEqualTo(Map.of("lastName", "Иванова", "firstName", "Анна", "patronymic", "Петровна"));
        assertThat(body.get("sourceDocumentId")).isEqualTo(1011);
        assertThat(body.get("birthDate")).isEqualTo("1990-04-05");
    }
    @Test void noDocumentsUsesRegistry() {
        Map body = http.getForObject("/person/100", Map.class);
        assertThat(body.get("fio")).isEqualTo(Map.of("lastName", "Смирнов", "firstName", "Иван", "patronymic", "Ильич"));
        assertThat(body.get("sourceDocumentId")).isNull();
    }
    @Test void missingPersonIs404() {
        assertThat(http.getForEntity("/person/999999", String.class).getStatusCodeValue()).isEqualTo(404);
    }
}
