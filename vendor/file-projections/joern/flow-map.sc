// Bounded state projection of selected retained methods. No user-supplied Scala.
import java.nio.file.{Files, Paths}
import java.nio.charset.StandardCharsets
import io.joern.joerncli.CpgBasedTool
import io.shiftleft.codepropertygraph.generated.nodes.*
import io.shiftleft.codepropertygraph.generated.neighboraccessors.Lang.*
import io.shiftleft.semanticcpg.language.*

@main def exec(cpgPath: String, out: String, request: String, root: String = ""): Unit = {
  val input = ujson.read(Files.readString(Paths.get(request), StandardCharsets.UTF_8))
  require(input("operation").str == "flowmap", "Unsupported flow map request")
  val requested = input("methodNodeIds").arr.take(40).map(_.str.toLong).toSeq
  val wanted = requested.toSet
  val maxStates = math.min(400, math.max(2, input.obj.get("maxStates").map(_.num.toInt).getOrElse(180)))
  val deadline = System.currentTimeMillis() + math.min(30000L, math.max(100L, input.obj.get("budgetMs").map(_.num.toLong).getOrElse(5000L)))
  val graph = CpgBasedTool.loadFromFile(cpgPath)
  val writer = Files.newBufferedWriter(Paths.get(out), StandardCharsets.UTF_8)
  var states = 0; var edges = 0; var truncated = false; var outputLimit = false; var outputBytes = 0L; var records = 0
  val gaps = scala.collection.mutable.ArrayBuffer[String]()
  def emit(value: ujson.Obj): Boolean = {
    val text=ujson.write(value);val size=text.getBytes(StandardCharsets.UTF_8).length+1
    if(value("type").str!="summary" && (outputLimit || outputBytes+size>3*1048576 || size>262144 || records>=950)) { truncated=true;outputLimit=true;false }
    else {writer.write(text);writer.newLine();outputBytes+=size;records+=1;true}
  }
  def code(n: StoredNode): String = n.propertyOption[String]("CODE").getOrElse("").take(1600)
  def relative(file: String): String = {
    val clean = file.replace('\\','/'); val prefix = root.stripSuffix("/") + "/"
    if (root.nonEmpty && clean.startsWith(prefix)) clean.substring(prefix.length) else if (!clean.startsWith("/")) clean else "<external>"
  }
  def mutation(c: Call): Boolean = c.name.startsWith("<operator>.assignment") || Set("<operator>.postIncrement","<operator>.preIncrement","<operator>.postDecrement","<operator>.preDecrement").contains(c.name)
  def next(n: CfgNode): Seq[CfgNode] = n._cfgOut.collect { case x: CfgNode => x }.take(101).toSeq
  def edge(from: Long, to: Long, kind: String, relation: String, extra: Seq[(String,ujson.Value)] = Seq.empty): Unit = {
    if (edges >= 500 || outputLimit || System.currentTimeMillis() > deadline) truncated = true
    else if(emit(ujson.Obj.from(Seq("type"->ujson.Str("edge"),"from"->ujson.Str(from.toString),"to"->ujson.Str(to.toString),"kind"->ujson.Str(kind),"relation"->ujson.Str(relation)) ++ extra)))edges += 1
  }
  try {
    val methods = graph.method.filter(m => wanted.contains(m.id) && !m.isExternal).take(40).toSeq.sortBy(m=>requested.indexOf(m.id))
    if (methods.size != wanted.size) gaps += "Some selected method IDs are missing or external in this retained CPG"
    for (m <- methods if states < maxStates && !outputLimit && System.currentTimeMillis() <= deadline) {
      val ast = m.ast.take(8001).toSeq
      if (ast.size > 8000) { truncated = true; gaps += s"AST scan capped at 8000 nodes for ${m.fullName}" }
      val cfg = (Seq[CfgNode](m, m.methodReturn) ++ ast.take(8000).collect { case n: CfgNode if n.method != null && n.method.id == m.id => n }).distinctBy(_.id)
      val controls = m.controlStructure.take(201).toSeq
      if (controls.size > 200) truncated = true
      val conditions = controls.take(200).flatMap(c => c.condition.take(4).map(n => n.id -> c)).toMap
      def kind(n: CfgNode): String = n match {
        case _: Method => "entry"
        case _: MethodReturn => "exit"
        case _: Return => "return"
        case c: Call if c.name == "<operator>.throw" => "throw"
        case c: ControlStructure if c.controlStructureType == "THROW" => "throw"
        case _ if conditions.contains(n.id) || next(n).size > 1 => "decision"
        case c: Call if mutation(c) => "change"
        case c: Call if !c.name.startsWith("<operator>") => "call"
        case _ => ""
      }
      val retained = cfg.filter(n => kind(n).nonEmpty).take(maxStates - states)
      if (retained.size < cfg.count(n => kind(n).nonEmpty)) truncated = true
      val byId = retained.map(n => n.id -> n).toMap
      def owner(n: CfgNode): Option[Long] = {
        if (n.method == null || n.method.id != m.id) None
        else if (byId.contains(n.id)) Some(n.id)
        else n match {
          case _: MethodParameterIn | _: MethodParameterOut => if(byId.contains(m.id))Some(m.id)else None
          case _ =>
            var current: AstNode = n; var hops = 0; var found: Option[Long] = None
            while (hops < 16 && found.isEmpty && !current.isInstanceOf[Method]) {
              val parent = current._astIn.collect { case a: AstNode => a }.take(1).toSeq.headOption
              parent match { case Some(p) => current = p; if(byId.contains(p.id))found=Some(p.id); case None => hops = 16 }
              hops += 1
            }
            found
        }
      }
      val parameters = m.parameter.filter(_.index>0).take(100).map(p => ujson.Obj("name"->p.name,"type"->p.typeFullName,"index"->p.index)).toSeq
      emit(ujson.Obj("type"->"method","nodeId"->m.id.toString,"entryState"->m.id.toString,"exitState"->m.methodReturn.id.toString,"parameters"->ujson.Arr.from(parameters)))
      for (n <- retained if !outputLimit) {
        val k = kind(n)
        val reads = n.ast.isIdentifier.take(101).map(_.name).toSeq.distinct
        val changes = n match {
          case c: Call if mutation(c) =>
            val args = c.argument.take(3).toSeq.sortBy(_.argumentIndex)
            Seq(ujson.Obj("target"->args.headOption.map(_.code).getOrElse("unknown").take(800),"expression"->(if(c.name=="<operator>.assignment")args.drop(1).headOption.map(_.code).getOrElse(code(c)) else code(c)).take(1200),"operation"->c.name,"status"->"syntax"))
          case _ => Seq.empty[ujson.Obj]
        }
        val textTruncated = n.propertyOption[String]("CODE").exists(_.length>1200) || reads.size>100 || (n match {case c: Call => c.argument.take(65).exists(_.code.length>800);case _ => false})
        if(textTruncated)gaps += "Some state expressions or identifier lists are bounded excerpts; use source locators to read the complete original file"
        val arguments = n match { case c: Call => c.argument.filter(_.argumentIndex>0).take(64).map(a=>ujson.Obj("index"->a.argumentIndex,"expression"->a.code.take(1000))).toSeq; case _ => Seq.empty[ujson.Obj] }
        if(emit(ujson.Obj("type"->"state","nodeId"->n.id.toString,"methodId"->m.id.toString,"kind"->k,"label"->n.label,"code"->(if(k=="entry")m.name else if(k=="exit")"Method exit" else code(n)),"file"->relative(m.filename),"line"->n.lineNumber.getOrElse(m.lineNumber.getOrElse(0)),"reads"->ujson.Arr.from(reads.take(100)),"changes"->ujson.Arr.from(changes),"arguments"->ujson.Arr.from(arguments),"status"->"static-candidate","textTruncated"->textTruncated)))states += 1
      }
      // Contract only expression nodes. Every retained assignment, decision, call and exit remains a state.
      for (source <- retained if !outputLimit && edges < 500 && System.currentTimeMillis() <= deadline) {
        val successors = next(source)
        if (successors.size > 100) truncated = true
        for (first <- successors.take(100)) {
          var polarity = "unknown"
          conditions.get(source.id).foreach { c =>
            val positive = c.whenTrue.ast.take(8000).id.toSet
            val negative = c.whenFalse.ast.take(8000).id.toSet
            if (positive.contains(first.id) && !negative.contains(first.id)) polarity = "true"
            else if (negative.contains(first.id) && !positive.contains(first.id)) polarity = "false"
            else if (c.controlStructureType == "IF" && negative.isEmpty && successors.exists(n=>positive.contains(n.id)) && !positive.contains(first.id)) polarity = "false"
          }
          if (polarity == "unknown") {
            // Short-circuit polarity is only assigned from the immediate AST operand
            // and an actual CFG successor into the RHS or the logical operator.
            source._astIn.collect { case c: Call if Set("<operator>.logicalOr","<operator>.logicalAnd").contains(c.name) => c }.take(1).foreach { parent =>
              val left = parent.argument.filter(_.argumentIndex==1).ast.take(8000).id.toSet
              val right = parent.argument.filter(_.argumentIndex==2).ast.take(8000).id.toSet
              if (left.contains(source.id) && right.contains(first.id)) polarity = if(parent.name=="<operator>.logicalOr")"false" else "true"
              else if (left.contains(source.id) && first.id==parent.id) polarity = if(parent.name=="<operator>.logicalOr")"true" else "false"
            }
          }
          val queue = scala.collection.mutable.Queue[(CfgNode,Int)]((first,0)); val visited = scala.collection.mutable.Set[Long]();val queued=scala.collection.mutable.Set[Long](first.id)
          while (queue.nonEmpty && visited.size < 8000 && System.currentTimeMillis() <= deadline && edges < 500) {
            val (current, via) = queue.dequeue()
            if (!visited.contains(current.id)) {
              visited += current.id
              if (byId.contains(current.id)) {
                val throwing = kind(source)=="throw"
                edge(source.id,current.id,if(throwing)"unresolved-exception" else "control","CFG",Seq("polarity"->ujson.Str(if(kind(source)=="decision")polarity else "not-applicable"),"contractedExpressions"->ujson.Num(via),"condition"->ujson.Str(if(kind(source)=="decision")code(source)else "")))
                if(throwing)gaps += s"Explicit throw at ${relative(m.filename)}:${source.lineNumber.getOrElse(0)} has a CPG continuation. It is retained as unresolved-exception, excluded from normal control flow; handler/exception routing is unverified."
              }
              else if (current.method != null && current.method.id == m.id) next(current).foreach { n =>
                if(!queued.contains(n.id)){if(queued.size>=8000)truncated=true else{queued+=n.id;queue.enqueue((n,via+1))}}
              }
            }
          }
          if (queue.nonEmpty) truncated = true
        }
      }
      val seen = scala.collection.mutable.Set[(Long,Long,String)]()
      for (n <- cfg if !outputLimit && edges < 500 && System.currentTimeMillis() <= deadline) {
        val relations = Seq("data" -> n._reachingDefOut.collect { case x: CfgNode => x }.take(201).toSeq, "control-dependency" -> n._cdgOut.collect { case x: CfgNode => x }.take(201).toSeq)
        for ((kind, targets) <- relations) {
          if(targets.size>200)truncated=true
          for (t <- targets.take(200) if edges<500 && !outputLimit && System.currentTimeMillis()<=deadline; from <- owner(n); to <- owner(t) if from != to && !seen.contains((from,to,kind))) {
            seen += ((from,to,kind)); edge(from,to,kind,if(kind=="data")"REACHING_DEF" else "CDG")
          }
        }
      }
    }
    if (System.currentTimeMillis() > deadline || states >= maxStates || edges >= 500) truncated = true
    gaps += "Reaching definitions may conservatively couple predicate operands; inspect assignments and assert values at every effect/return"
    gaps += "Implicit exceptions, external effects, concurrency and path feasibility are not exhaustively modeled"
    emit(ujson.Obj("type"->"summary","truncated"->truncated,"counts"->ujson.Obj("states"->states,"edges"->edges),"gaps"->ujson.Arr.from(gaps.distinct)))
  } finally { writer.close(); graph.close() }
}
