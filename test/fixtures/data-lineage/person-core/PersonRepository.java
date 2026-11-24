package fixture;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
public interface PersonRepository extends JpaRepository<Person, Long> {
  Person findByLegalName(String name);
  @Query(value = "select legal_name from public.person where id = :id", nativeQuery = true)
  String selectName(Long id);
}
