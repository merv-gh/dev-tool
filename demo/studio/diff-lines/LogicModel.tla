---- MODULE LogicModel ----
EXTENDS Naturals
VARIABLES pc, last
vars == <<pc, last>>
Nodes == {"start", "trim-head", "trim-tail", "matrix", "keep", "remove", "add", "fallback", "finish"}
Actions == {"edge0", "edge1", "edge2", "edge3", "edge4", "edge5", "edge6", "edge7", "edge8", "edge9", "edge10", "edge11", "edge12", "edge13", "edge14", "edge15", "edge16", "edge17"}
Initial == /\ pc = "start"
           /\ last = ""
Step0 == /\ pc = "start"
           /\ pc' = "trim-head"
           /\ last' = "edge0"
Step1 == /\ pc = "trim-head"
           /\ pc' = "matrix"
           /\ last' = "edge1"
Step2 == /\ pc = "matrix"
           /\ pc' = "finish"
           /\ last' = "edge2"
Step3 == /\ pc = "start"
           /\ pc' = "matrix"
           /\ last' = "edge3"
Step4 == /\ pc = "matrix"
           /\ pc' = "remove"
           /\ last' = "edge4"
Step5 == /\ pc = "remove"
           /\ pc' = "add"
           /\ last' = "edge5"
Step6 == /\ pc = "add"
           /\ pc' = "finish"
           /\ last' = "edge6"
Step7 == /\ pc = "add"
           /\ pc' = "add"
           /\ last' = "edge7"
Step8 == /\ pc = "matrix"
           /\ pc' = "add"
           /\ last' = "edge8"
Step9 == /\ pc = "start"
           /\ pc' = "trim-tail"
           /\ last' = "edge9"
Step10 == /\ pc = "trim-tail"
           /\ pc' = "matrix"
           /\ last' = "edge10"
Step11 == /\ pc = "remove"
           /\ pc' = "remove"
           /\ last' = "edge11"
Step12 == /\ pc = "remove"
           /\ pc' = "finish"
           /\ last' = "edge12"
Step13 == /\ pc = "trim-head"
           /\ pc' = "trim-head"
           /\ last' = "edge13"
Step14 == /\ pc = "remove"
           /\ pc' = "keep"
           /\ last' = "edge14"
Step15 == /\ pc = "keep"
           /\ pc' = "add"
           /\ last' = "edge15"
Step16 == /\ pc = "start"
           /\ pc' = "fallback"
           /\ last' = "edge16"
Step17 == /\ pc = "fallback"
           /\ pc' = "finish"
           /\ last' = "edge17"
Finish == /\ pc \in {"finish"}
          /\ UNCHANGED vars
Next == Step0 \/ Step1 \/ Step2 \/ Step3 \/ Step4 \/ Step5 \/ Step6 \/ Step7 \/ Step8 \/ Step9 \/ Step10 \/ Step11 \/ Step12 \/ Step13 \/ Step14 \/ Step15 \/ Step16 \/ Step17 \/ Finish
TypeOK == /\ pc \in Nodes
          /\ last \in (Actions \cup {""})
Safe == pc \notin {}
Spec == Initial /\ [][Next]_vars
====
