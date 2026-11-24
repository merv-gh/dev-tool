package fixture;
import org.springframework.web.bind.annotation.GetMapping;
public abstract class AbstractPersonController {
  protected PersonRepository repository;
  @GetMapping("/person/{id}")
  public Person person(Long id) {
    Person person = repository.findByLegalName("Anna");
    person.setLegalName(person.getLegalName().trim());
    return person;
  }
  public void persist(Person person) {
    repository.save(person);
  }
}
