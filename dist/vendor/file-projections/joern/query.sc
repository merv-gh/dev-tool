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
  var emitted = 0; var truncated = false
  def emit(value: ujson.Obj): Unit = { writer.write(ujson.write(value)); writer.newLine(); emitted += 1 }
  def ids(key: String): Set[Long] = input.obj.get(key).map(_.arr.take(100).map(_.str.toLong).toSet).getOrElse(Set.empty)
  val fromIds = ids("fromNodeIds"); val toIds = ids("toNodeIds")
  def location(n: io.shiftleft.codepropertygraph.generated.nodes.StoredNode): ujson.Obj = {
    val line = n match { case x: io.shiftleft.codepropertygraph.generated.nodes.CfgNode => x.lineNumber.getOrElse(0); case _ => 0 }
    val filename = n match { case method: io.shiftleft.codepropertygraph.generated.nodes.Method => method.filename; case cfg: io.shiftleft.codepropertygraph.generated.nodes.CfgNode => cfg.method.filename; case _ => "" }
    val clean = filename.replace('\\','/')
    val file = if(root.nonEmpty && clean.startsWith(root.stripSuffix("/")+"/")) clean.substring(root.stripSuffix("/").length+1) else if(!clean.startsWith("/")) clean else "<external>"
    ujson.Obj("file"->file,"nodeId"->n.id.toString,"label"->n.label,"code"->n.propertyOption[String]("CODE").getOrElse("").take(2000),"line"->line)
  }
  try {
    if (mode == "dataflow") {
      require(graph.metaData.overlays.exists(_ == OssDataFlow.overlayName), "Data-flow overlay is missing")
      val source = graph.all.filter(n => fromIds.contains(n.id)).collect { case n: io.shiftleft.codepropertygraph.generated.nodes.CfgNode => n }.toSeq
      val sink = graph.all.filter(n => toIds.contains(n.id)).collect { case n: io.shiftleft.codepropertygraph.generated.nodes.CfgNode => n }.toSeq
      val paths = sink.iterator.reachableByFlows(source.iterator)
      while (paths.hasNext && emitted < maxPaths && System.currentTimeMillis() < deadline) {
        val p = paths.next(); val nodes = p.elements.take(maxHops + 1).toSeq
        emit(ujson.Obj("type"->"path","kind"->"data-flow","nodes"->ujson.Arr.from(nodes.take(maxHops).map(location)),"truncated"->(nodes.size>maxHops),"proof"->ujson.Obj("status"->"static-dataflow","feasibility"->"unknown","scope"->"single-cpg")))
      }
      truncated = emitted >= maxPaths || System.currentTimeMillis() >= deadline
    } else if (mode == "controlflow") {
      val sources = graph.method.filter(m => fromIds.contains(m.id)).take(100).toSeq
      val targets = toIds
      var visited = 0
      sources.foreach { source =>
        val queue = scala.collection.mutable.Queue[(io.shiftleft.codepropertygraph.generated.nodes.CfgNode,List[io.shiftleft.codepropertygraph.generated.nodes.CfgNode])]()
        queue.enqueue((source, Nil))
        while (queue.nonEmpty && emitted < maxPaths && visited < 20000 && System.currentTimeMillis() < deadline) {
          val (node, prior) = queue.dequeue(); visited += 1; val path = prior :+ node
          if (targets.contains(node.id)) emit(ujson.Obj("type"->"path","kind"->"control-flow","nodes"->ujson.Arr.from(path.map(location)),"conditions"->ujson.Arr.from(source.controlStructure.take(100).map { control =>
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
          else if(path.size<maxHops) node.cfgNext.take(100).filter(n => !path.exists(_.id==n.id)).foreach(n => queue.enqueue((n,path)))
        }
        if(queue.nonEmpty) truncated = true
      }
    } else throw new IllegalArgumentException("Deep queries require mode=dataflow or controlflow")
    emit(ujson.Obj("type"->"summary","truncated"->truncated,"count"->emitted,"gaps"->ujson.Arr("Static graph paths do not prove feasibility or distributed invariants")))
  } finally { writer.close(); graph.close() }
}
