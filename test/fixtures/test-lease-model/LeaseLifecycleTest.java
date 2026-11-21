package demo;

import java.lang.reflect.Proxy;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.*;
import org.springframework.test.context.TestContext;
import static org.junit.jupiter.api.Assertions.*;

/** Provider contracts: no Docker/network needed, and no application assertions changed. */
@Tag("multi-container") // Run beside the selected flow tests, after model edits; not during provider preflight.
class LeaseLifecycleTest {
    MultiContainerSupport.Binding priorBinding;
    MultiContainerSupport.Config priorConfig;
    Runnable priorClose;
    int priorCompleted;
    final AtomicInteger closed=new AtomicInteger();

    @BeforeEach void isolatePolicyState() {
        priorBinding=MultiContainerSupport.current;priorConfig=MultiContainerSupport.config;
        priorClose=MultiContainerSupport.closeContext;priorCompleted=MultiContainerSupport.completed.get();
        configure("workspace");
    }
    @AfterEach void restorePolicyState() {
        MultiContainerSupport.current=priorBinding;MultiContainerSupport.config=priorConfig;
        MultiContainerSupport.closeContext=priorClose;MultiContainerSupport.completed.set(priorCompleted);
    }
    void configure(String mode) {
        MultiContainerSupport.config=new MultiContainerSupport.Config("policyowned",mode,2,3,3,30,"unused-postgres","unused-kafka","unused-bindings");
        MultiContainerSupport.current=new MultiContainerSupport.Binding("policy-only");
        MultiContainerSupport.completed.set(0);MultiContainerSupport.closeContext=()->{};closed.set(0);
    }
    TestContext context() {
        return (TestContext)Proxy.newProxyInstance(TestContext.class.getClassLoader(),new Class<?>[]{TestContext.class},(proxy,method,args)->{
            if(method.getName().equals("getTestClass"))return LeaseLifecycleTest.class;
            if(method.getName().equals("markApplicationContextDirty")) {
                assertNotNull(MultiContainerSupport.current,"Close clients before releasing their lease");closed.incrementAndGet();return null;
            }
            if(method.getName().equals("toString"))return "lease-policy-context";
            throw new UnsupportedOperationException(method.getName());
        });
    }
    @Test void sharedProvidersKeepTheContextAndBindingUntilTheLastClass()throws Exception {
        for(String mode:new String[]{"workspace","suite-parallel"}) {
            configure(mode);var binding=MultiContainerSupport.current;var context=context();
            for(int i=1;i<3;i++) {
                LeaseAdapter.after(context);
                assertEquals(0,closed.get(),mode+": compatible classes must reuse their Spring context");
                assertSame(binding,MultiContainerSupport.current,mode+": another class still owns this binding");
            }
            LeaseAdapter.after(context);
            assertEquals(1,closed.get(),mode+": close the context once, after the final class");
            assertNull(MultiContainerSupport.current,mode+": release the finished child lease");
        }
    }
    @Test void perClassProvidersCloseClientsBeforeReleasingTheirLease()throws Exception {
        configure("per-class-parallel");LeaseAdapter.after(context());
        assertEquals(1,closed.get());assertNull(MultiContainerSupport.current);
    }
    @Test void beforePreservesTheProviderAndRegistersAForkShutdownCallback()throws Exception {
        var selected=MultiContainerSupport.config;var binding=MultiContainerSupport.current;
        LeaseAdapter.before(context());
        assertEquals(selected,MultiContainerSupport.config,"Never replace the runner-selected provider");
        assertSame(binding,MultiContainerSupport.current,"Reuse the existing provider binding");
        MultiContainerSupport.closeContext.run();
        assertEquals(1,closed.get(),"A fork that runs fewer classes still needs its Spring clients closed on shutdown");
        assertSame(binding,MultiContainerSupport.current,"Closing clients must precede child lease release");
    }
}
