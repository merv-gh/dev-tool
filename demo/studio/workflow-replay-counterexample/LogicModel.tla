---- MODULE LogicModel ----
EXTENDS Naturals
VARIABLES pc, last
vars == <<pc, last>>
Nodes == {"ready", "running", "waiting", "interrupted", "uncertain", "done", "cancelled", "replayed"}
Actions == {"start", "wait", "resume-wait", "finish", "interrupt", "require-resolution", "cancel", "cancel-wait", "unsafe-replay"}
Initial == /\ pc = "ready"
           /\ last = ""
Step0 == /\ pc = "ready"
           /\ pc' = "running"
           /\ last' = "start"
Step1 == /\ pc = "running"
           /\ pc' = "waiting"
           /\ last' = "wait"
Step2 == /\ pc = "waiting"
           /\ pc' = "running"
           /\ last' = "resume-wait"
Step3 == /\ pc = "running"
           /\ pc' = "done"
           /\ last' = "finish"
Step4 == /\ pc = "running"
           /\ pc' = "interrupted"
           /\ last' = "interrupt"
Step5 == /\ pc = "interrupted"
           /\ pc' = "uncertain"
           /\ last' = "require-resolution"
Step6 == /\ pc = "running"
           /\ pc' = "cancelled"
           /\ last' = "cancel"
Step7 == /\ pc = "waiting"
           /\ pc' = "cancelled"
           /\ last' = "cancel-wait"
Step8 == /\ pc = "interrupted"
           /\ pc' = "replayed"
           /\ last' = "unsafe-replay"
Finish == /\ pc \in {"uncertain", "done", "cancelled", "replayed"}
          /\ UNCHANGED vars
Next == Step0 \/ Step1 \/ Step2 \/ Step3 \/ Step4 \/ Step5 \/ Step6 \/ Step7 \/ Step8 \/ Finish
TypeOK == /\ pc \in Nodes
          /\ last \in (Actions \cup {""})
Safe == pc \notin {"replayed"}
Spec == Initial /\ [][Next]_vars
====
