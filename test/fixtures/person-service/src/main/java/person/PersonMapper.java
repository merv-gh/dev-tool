package person;

import java.time.LocalDate;
import org.springframework.stereotype.Component;
import person.PersonData.*;

@Component
public class PersonMapper {
    public Response response(Registry person, Document selected, LocalDate asOf) {
        Name fio = selected == null ? person.name() : selected.name();
        return new Response(person.id(), fio, fio.display(), person.birthDate(),
            selected == null ? null : selected.id(), selected == null ? null : selected.effectiveFrom(),
            new Address(person.city(), person.street()), asOf);
    }
}
