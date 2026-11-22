package person;

import java.time.Clock;
import java.time.LocalDate;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import person.PersonData.*;

@RestController
public class PersonController {
    private final PersonRepository repository;
    private final PersonMapper mapper;
    private final Clock clock;
    public PersonController(PersonRepository repository, PersonMapper mapper, Clock clock) {
        this.repository = repository; this.mapper = mapper; this.clock = clock;
    }
    @GetMapping("/person/{id}")
    public Response person(@PathVariable("id") long id) {
        try {
            LocalDate asOf = LocalDate.now(clock);
            Registry person = repository.person(id);
            Document selected = DocumentPolicy.choose(repository.documents(id), asOf);
            return mapper.response(person, selected, asOf);
        } catch (EmptyResultDataAccessException missing) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Person not found");
        }
    }
}
