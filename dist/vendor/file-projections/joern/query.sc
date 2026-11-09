// Bounded named deep queries over an enriched CPG. No caller-supplied Scala is evaluated.
import java.nio.file.{Files, Paths}
import java.nio.charset.StandardCharsets
import io.joern.joerncli.CpgBasedTool
import io.shiftleft.semanticcpg.language.*
import io.joern.dataflowengineoss.language.*
import io.joern.dataflowengineoss.queryengine.EngineContext
import io.joern.dataflowengineoss.layers.dataflows.OssDataFlow

@main def exec(cpgPath: String, out: String, request: String, root: String = ""): Unit = {
  val input = ujson.read(Files.readString(Paths.get(request), StandardCharsets.UTF_8))
  val operation = input.obj.get("operation").map(_.str).getOrElse("slice")
  val mode = input.obj.get("mode").map(_.str).getOrElse("dataflow")
  require(Set("slice","paths","assertions").contains(operation), "Unsupported named deep query")
  val graph = CpgBasedTool.loadFromFile(cpgPath)
  implicit val engineContext: EngineContext = EngineContext()
  val writer = Files.newBufferedWriter(Paths.get(out), StandardCharsets.UTF_8)
  val maxPaths = math.min(20, math.max(1, input.obj.get("maxPaths").map(_.num.toInt).getOrElse(8)))
  val maxHops = math.min(100, math.max(1, input.obj.get("maxHops").map(_.num.toInt).getOrElse(30)))
  val budget = math.min(30000L, math.max(100L, input.obj.get("budgetMs").map(_.num.toLong).getOrElse(5000L)))
  val deadline = System.currentTimeMillis() + budget
  var emitted = 0; var truncated = false; var rejectedReceiverPaths=0; var scannedPaths=0
  val receiverConstraints=input.obj.get("receiverConstraints")
  val excludedMethods=receiverConstraints.flatMap(_.obj.get("excludedMethodIds")).map(_.arr.map(_.str.toLong).toSet).getOrElse(Set.empty[Long])
  val gaps=scala.collection.mutable.ArrayBuffer[String]("Static graph paths do not prove feasibility or distributed invariants")
  def emit(value: ujson.Obj): Unit = { writer.write(ujson.write(value)); writer.newLine(); if(value.obj.get("type").exists(_.str=="path")) emitted += 1 }
  def ids(key: String): Set[Long] = input.obj.get(key).map(_.arr.take(100).map(_.str.toLong).toSet).getOrElse(Set.empty)
  val fromIds = ids("fromNodeIds"); val toIds = ids("toNodeIds")
  val conditionNodes = graph.controlStructure.take(10000).flatMap(_.condition.ast.take(1000).id).take(50000).toSet
  def location(n: io.shiftleft.codepropertygraph.generated.nodes.StoredNode): ujson.Obj = {
    val line = n match { case x: io.shiftleft.codepropertygraph.generated.nodes.CfgNode => x.lineNumber.getOrElse(0); case _ => 0 }
    val filename = n match { case method: io.shiftleft.codepropertygraph.generated.nodes.Method => method.filename; case cfg: io.shiftleft.codepropertygraph.generated.nodes.CfgNode => cfg.method.filename; case _ => "" }
    val clean = filename.replace('\\','/')
    val file = if(root.nonEmpty && clean.startsWith(root.stripSuffix("/")+"/")) clean.substring(root.stripSuffix("/").length+1) else if(!clean.startsWith("/")) clean else "<external>"
    ujson.Obj("file"->file,"nodeId"->n.id.toString,"label"->n.label,"code"->n.propertyOption[String]("CODE").getOrElse("").take(2000),"line"->line,"column"->n.propertyOption[Int]("COLUMN_NUMBER").getOrElse(0),"inCondition"->conditionNodes.contains(n.id))
  }
  def endpoint(key: String, selected: Set[Long]): Seq[io.shiftleft.codepropertygraph.generated.nodes.CfgNode] = {
    val requested = input.obj.get(key)
    graph.all.takeWhile { _ => if(System.currentTimeMillis()>=deadline) {truncated=true;false} else true }.collect { case n: io.shiftleft.codepropertygraph.generated.nodes.CfgNode => n }.filter { n =>
      requested match {
        case None => selected.contains(n.id)
        case Some(r) =>
          val l=location(n)
          l("file").str==r("file").str && l("line").num==r("line").num &&
            r.obj.get("column").forall(_.num==l("column").num) &&
            r.obj.get("code").forall(_.str==n.propertyOption[String]("CODE").getOrElse("")) &&
            r.obj.get("nodeLabel").forall(_.str==n.label) &&
            r.obj.get("nodeId").forall(_.str==n.id.toString)
      }
    }.take(201).toSeq
  }
  try {
    val sourceNodes=endpoint("fromLocation",fromIds); val sinkNodes=endpoint("toLocation",toIds)
    val lineAmbiguous = (input.obj.contains("fromLocation") && sourceNodes.size!=1) || (input.obj.contains("toLocation") && sinkNodes.size!=1)
    val status = if(sourceNodes.isEmpty || sinkNodes.isEmpty) "missing" else if(lineAmbiguous) "ambiguous" else "resolved"
    if(input.obj.contains("fromLocation") || input.obj.contains("toLocation")) emit(ujson.Obj("type"->"endpoints","status"->status,"from"->ujson.Arr.from(sourceNodes.take(200).map(location)),"to"->ujson.Arr.from(sinkNodes.take(200).map(location)),"truncated"->(sourceNodes.size>200 || sinkNodes.size>200 || truncated)))
    if(status!="resolved") {
      emit(ujson.Obj("type"->"summary","truncated"->truncated,"count"->0,"gaps"->ujson.Arr("Select one exact CPG expression at each line using code, column, nodeLabel or nodeId; no expression was chosen implicitly")))
    } else if (mode == "dataflow") {
      require(graph.metaData.overlays.exists(_ == OssDataFlow.overlayName), "Data-flow overlay is missing")
      val source = sourceNodes
      val sink = sinkNodes
      val paths = sink.iterator.reachableByFlows(source.iterator)
      while (paths.hasNext && emitted < maxPaths && scannedPaths<400 && System.currentTimeMillis() < deadline) {
        val p = paths.next(); val nodes = p.elements.take(maxHops + 1).toSeq; scannedPaths+=1
        val rejected=nodes.exists{ case m: io.shiftleft.codepropertygraph.generated.nodes.Method => excludedMethods.contains(m.id);case n: io.shiftleft.codepropertygraph.generated.nodes.CfgNode => excludedMethods.contains(n.method.id);case _ => false }
        if(rejected) rejectedReceiverPaths+=1
        else
        emit(ujson.Obj("type"->"path","kind"->"data-flow","nodes"->ujson.Arr.from(nodes.take(maxHops).map(location)),"truncated"->(nodes.size>maxHops),"caveats"->ujson.Arr.from(if(nodes.exists(n=>conditionNodes.contains(n.id)))Seq("Path includes predicate operands; conservative coupling can connect values that are not assigned to each other. Inspect expressions and test numeric/field equality.")else Seq.empty[String]),"proof"->ujson.Obj("status"->"static-dataflow","feasibility"->"unknown","scope"->"single-cpg")))
      }
      truncated ||= emitted >= maxPaths || scannedPaths>=400 || System.currentTimeMillis() >= deadline
      if(rejectedReceiverPaths>0)gaps += s"Excluded $rejectedReceiverPaths sibling override path(s) incompatible with the declared receiver; absence after filtering is not an exhaustive feasibility proof"
    } else if (mode == "controlflow") {
      def methodId(n: io.shiftleft.codepropertygraph.generated.nodes.CfgNode): Long = n match {case m: io.shiftleft.codepropertygraph.generated.nodes.Method => m.id;case other => other.method.id}
      val sources = sourceNodes.take(100).filter(n=>sinkNodes.exists(t=>methodId(n)==methodId(t)))
      if(sources.isEmpty) gaps += "Unsupported cross-method control flow: select endpoints within one body, or inspect the interprocedural value paths separately"
      val targets = sinkNodes.map(_.id).toSet
      var visited = 0
      sources.foreach { source =>
        val owner = source match {case m: io.shiftleft.codepropertygraph.generated.nodes.Method => m; case n => n.method}
        val queue = scala.collection.mutable.Queue[(io.shiftleft.codepropertygraph.generated.nodes.CfgNode,List[io.shiftleft.codepropertygraph.generated.nodes.CfgNode])]()
        queue.enqueue((source, Nil))
        while (queue.nonEmpty && emitted < maxPaths && visited < 20000 && System.currentTimeMillis() < deadline) {
          val (node, prior) = queue.dequeue(); visited += 1; val path = prior :+ node
          if (targets.contains(node.id)) emit(ujson.Obj("type"->"path","kind"->"control-flow","nodes"->ujson.Arr.from(path.map(location)),"conditions"->ujson.Arr.from(owner.controlStructure.take(100).filter(c=>c.condition.ast.id.exists(id=>path.exists(_.id==id)) || c.whenTrue.ast.id.exists(id=>path.exists(_.id==id)) || c.whenFalse.ast.id.exists(id=>path.exists(_.id==id))).map { control =>
            val ids = path.map(_.id).toSet
            val positiveIds = control.whenTrue.ast.id.toSet
            val negativeIds = control.whenFalse.ast.id.toSet
            val positive = positiveIds.exists(ids.contains)
            val conditionIds = control.condition.id.toSet
            val successors = control.condition.cfgNext.id.toSet
            // An if-without-else can take a false CFG edge directly to the next
            // statement. Only label that edge when both the condition transition
            // and the alternative true successor are present in this graph.
            val falseFallthrough = control.controlStructureType == "IF" && negativeIds.isEmpty &&
              successors.exists(positiveIds.contains) && path.sliding(2).exists(pair => pair.size == 2 &&
                conditionIds.contains(pair.head.id) && successors.contains(pair.last.id) && !positiveIds.contains(pair.last.id))
            val negative = negativeIds.exists(ids.contains) || falseFallthrough
            val polarity = if(positive && !negative) "true" else if(negative && !positive) "false" else "unknown"
            ujson.Obj("expression"->control.condition.code.take(1).toSeq.headOption.getOrElse(control.code).take(2000),"line"->control.lineNumber.getOrElse(0),"polarity"->polarity,"status"->(if(polarity=="unknown")"unknown" else "path_condition"),"scope"->"displayed-control-path")
          }.toSeq),"proof"->ujson.Obj("status"->"path_condition","feasibility"->"unknown","scope"->"single-method","note"->"Branch predicates require edge polarity; no universal assertion is inferred")))
          else if(path.size>=maxHops) { if(node.cfgNext.nonEmpty) truncated=true }
          else if(!(node.label=="CALL" && node.propertyOption[String]("NAME").contains("<operator>.throw")) && !(node.label=="CONTROL_STRUCTURE" && node.propertyOption[String]("CONTROL_STRUCTURE_TYPE").contains("THROW"))) {
            val next=node.cfgNext.take(101).toSeq
            if(next.size>100) truncated=true
            if(next.exists(n=>path.exists(_.id==n.id))) {truncated=true;if(!gaps.exists(_.startsWith("Loop cycles")))gaps += "Loop cycles are not unrolled. Displayed walks do not establish all iterations, zero-iteration behavior or loop exit feasibility"}
            next.take(100).filter(n => !path.exists(_.id==n.id)).foreach(n => if(queue.size<20000) queue.enqueue((n,path)) else truncated=true)
          }
        }
        if(queue.nonEmpty || visited>=20000 || System.currentTimeMillis()>=deadline || emitted>=maxPaths) truncated = true
      }
    } else throw new IllegalArgumentException("Deep queries require mode=dataflow or controlflow")
    emit(ujson.Obj("type"->"summary","truncated"->truncated,"count"->emitted,"gaps"->ujson.Arr.from(gaps)))
  } finally { writer.close(); graph.close() }
}
