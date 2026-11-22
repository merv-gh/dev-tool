package person;

import java.time.LocalDate;

public final class PersonData {
    private PersonData() {}
    public record Name(String lastName, String firstName, String patronymic) {
        public boolean complete() { return lastName != null && !lastName.isBlank() && firstName != null && !firstName.isBlank(); }
        public String display() { return lastName + " " + firstName + (patronymic == null || patronymic.isBlank() ? "" : " " + patronymic); }
    }
    public record Registry(long id, Name name, LocalDate birthDate, String city, String street) {}
    public record Document(long id, Name name, LocalDate birthDate, LocalDate issuedOn,
                           LocalDate effectiveFrom, LocalDate expiresOn, boolean active, boolean annulled) {}
    public record Address(String city, String street) {}
    public record Response(long id, Name fio, String fullName, LocalDate birthDate,
                           Long sourceDocumentId, LocalDate effectiveFrom, Address address, LocalDate asOf) {}
}
