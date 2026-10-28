subprojects {
    apply(plugin = "java")
    group = "com.acme.billing"
    version = "2.1.0"
    repositories {
        mavenLocal()
        mavenCentral()
    }
    configure<JavaPluginExtension> {
        sourceCompatibility = JavaVersion.VERSION_17
    }
    dependencies {
        "implementation"(platform("org.springframework.boot:spring-boot-dependencies:3.3.5"))
        "testImplementation"(platform("org.springframework.boot:spring-boot-dependencies:3.3.5"))
        "testImplementation"("org.springframework.boot:spring-boot-starter-test")
        "testRuntimeOnly"("org.junit.platform:junit-platform-launcher")
    }
    tasks.withType<Test> {
        useJUnitPlatform()
    }
}
