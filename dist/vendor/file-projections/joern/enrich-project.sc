// dt.semantic.projection/v1. Standalone Joern 4 script; writes records as they are visited.
// Adapted from file-projections' common CPG traversal approach (MIT); no running fp service required.
import java.nio.file.{Files, Paths, StandardCopyOption}
import java.nio.charset.StandardCharsets
import io.joern.joerncli.CpgBasedTool
import io.joern.x2cpg.X2Cpg
import io.joern.dataflowengineoss.layers.dataflows.{OssDataFlow, OssDataFlowOptions}
import io.shiftleft.semanticcpg.layers.LayerCreatorContext
import io.shiftleft.semanticcpg.language.*

@main def exec(cpgPath: String, enrichedPath: String, out: String, root: String = "/source", maxRecords: Int = 300000, maxBytes: Long = 134217728): Unit = {
  require(cpgPath != enrichedPath, "raw and enriched graphs must be different files")
  Files.copy(Paths.get(cpgPath), Paths.get(enrichedPath), StandardCopyOption.REPLACE_EXISTING)
  val graph = CpgBasedTool.loadFromFile(enrichedPath)
  val writer = Files.newBufferedWriter(Paths.get(out), StandardCharsets.UTF_8)
  var count = 0; var bytes = 0L; var truncated = false
  val counts = scala.collection.mutable.Map[String, Int]().withDefaultValue(0)
  def emit(value: ujson.Obj): Boolean = {
    val text = ujson.write(value)
    val size = text.getBytes(StandardCharsets.UTF_8).length + 1
    if (count >= maxRecords || bytes + size > maxBytes) { truncated = true; false }
    else { writer.write(text); writer.newLine(); count += 1; bytes += size; val kind = value("type").str; counts(kind) += 1; true }
  }
  def relative(file: String): String = {
    val clean = file.replace('\\','/')
    val prefix = root.replace('\\','/').stripSuffix("/") + "/"
    if (clean.startsWith(prefix)) clean.substring(prefix.length) else if (!clean.startsWith("/") && !clean.split('/').contains("..")) clean else "<external>"
  }
  try {
    X2Cpg.applyDefaultOverlays(graph)
    val overlays = graph.metaData.overlays.toSet
    if (!overlays.contains(OssDataFlow.overlayName)) new OssDataFlow(new OssDataFlowOptions()).run(new LayerCreatorContext(graph))
    val activeOverlays = graph.metaData.overlays.toSeq
    emit(ujson.Obj("type"->"meta", "protocol"->"dt.semantic.projection/v1", "version"->1, "language"->graph.metaData.language.headOption.getOrElse("unknown"), "overlays"->ujson.Arr.from(activeOverlays), "capabilities"->ujson.Obj("pathContext"->true,"inheritance"->true,"calls"->true,"controlFlow"->true,"dataFlow"->activeOverlays.contains(OssDataFlow.overlayName)), "limits"->ujson.Obj("records"->maxRecords,"bytes"->maxBytes)))
    val types = graph.typeDecl.filter(t => !t.isExternal)
    while(types.hasNext && !truncated) { val t=types.next(); emit(ujson.Obj("type"->"type","id"->t.id.toString,"name"->t.name,"fullName"->t.fullName,"file"->relative(t.filename),"line"->t.lineNumber.getOrElse(0),"inherits"->ujson.Arr.from(t.inheritsFromTypeFullName))) }
    val methods = graph.method.filter(m => !m.isExternal)
    while (methods.hasNext && !truncated) {
      val m = methods.next()
      val bodyHash=java.security.MessageDigest.getInstance("SHA-256")
      m.ast.take(10000).foreach(n=>bodyHash.update((n.label+":"+n.propertyOption[String]("CODE").getOrElse("")+"\n").getBytes(StandardCharsets.UTF_8)))
      val parameters = m.parameter.take(100).map(p => ujson.Obj("id"->p.id.toString,"name"->p.name,"type"->p.typeFullName,"index"->p.index)).toSeq
      emit(ujson.Obj("type"->"symbol","id"->m.id.toString,"kind"->"method","name"->m.name,"fullName"->m.fullName,"signature"->m.signature,"file"->relative(m.filename),"line"->m.lineNumber.getOrElse(0),"endLine"->m.lineNumberEnd.getOrElse(0),"isExternal"->false,"owner"->m.fullName.takeWhile(_ != ':').split('.').dropRight(1).mkString("."),"abstract"->m.modifier.modifierType.exists(_=="ABSTRACT"),"bodyDigest"->bodyHash.digest().map(b=>f"${b & 0xff}%02x").mkString,"parameters"->ujson.Arr.from(parameters),"returnId"->m.methodReturn.id.toString,"returnType"->m.methodReturn.typeFullName))
      val facts = m.ast.collect {case n: io.shiftleft.codepropertygraph.generated.nodes.CfgNode => n}.take(10001).toSeq
      if(facts.size>10000) truncated=true
      var factCount=0
      for(n <- facts.take(10000) if factCount<400 && !truncated) {
        val kind = n match {
          case c: io.shiftleft.codepropertygraph.generated.nodes.Call if c.name.startsWith("<operator>.assignment") || Set("<operator>.postIncrement","<operator>.preIncrement","<operator>.postDecrement","<operator>.preDecrement").contains(c.name) => "transformation"
          case c: io.shiftleft.codepropertygraph.generated.nodes.Call if Set("filter","map","mapToInt","mapToLong","mapToDouble","flatMap","takeWhile","dropWhile","limit","skip","sorted","distinct","peek","forEach","forEachOrdered","sum","reduce","collect","count","anyMatch","allMatch","noneMatch","findFirst","findAny").contains(c.name) => "pipeline-stage"
          case r: io.shiftleft.codepropertygraph.generated.nodes.Return => "return"
          case _ => ""
        }
        if(kind.nonEmpty) {
          val refs=n match {case c: io.shiftleft.codepropertygraph.generated.nodes.Call => c.argument.filter(_.argumentIndex>0).flatMap(_.ast).collect{case r: io.shiftleft.codepropertygraph.generated.nodes.MethodRef => r.methodFullName}.take(21).toSeq;case _ => Seq.empty[String]}
          val name=n.propertyOption[String]("NAME").getOrElse("")
          val signature=n.propertyOption[String]("METHOD_FULL_NAME").getOrElse("")
          val javaStream=signature.startsWith("java.util.stream.") || n.code.contains(".stream(") || n.code.contains(".parallelStream(")
          emit(ujson.Obj("type"->"fact","id"->n.id.toString,"method"->m.id.toString,"kind"->kind,"name"->name,"signature"->signature,"expression"->n.code.take(2000),"textTruncated"->(n.code.length>2000),"file"->relative(m.filename),"line"->n.lineNumber.getOrElse(0),"lambdaTargets"->ujson.Arr.from(refs.take(20)),"lambdaTargetsTruncated"->(refs.size>20),"javaStream"->javaStream,"status"->"source-context")); factCount+=1
        }
      }
      if(factCount>=400) truncated=true
      m.annotation.foreach { annotation =>
        val code = annotation.code
        val kind = if (code.contains("KafkaListener")) "kafka-consume" else if (code.contains("Scheduled")) "scheduled" else if (code.matches("(?s).*(RequestMapping|GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping).*")) "http-ingress" else ""
        if (kind.nonEmpty) emit(ujson.Obj("type"->"port","id"->s"annotation:${m.id}:${annotation.id}","portType"->kind,"method"->m.id.toString,"file"->relative(m.filename),"line"->m.lineNumber.getOrElse(0),"code"->code.take(2000),"certainty"->"candidate","gaps"->ujson.Arr("Deployment and transport identity require passport/configuration binding")))
      }
    }
    val calls = graph.call.filter(c => !c.name.startsWith("<operator>"))
    while (calls.hasNext && !truncated) {
      val c = calls.next()
      val targets = c.callee.filter(m => !m.isExternal).take(21).map(_.id.toString).toSeq
      val arguments = c.argument.take(64).map(a => ujson.Obj("id"->a.id.toString,"index"->a.argumentIndex,"code"->a.code.take(1000))).toSeq
      emit(ujson.Obj("type"->"call","id"->c.id.toString,"caller"->c.method.id.toString,"name"->c.name,"methodFullName"->c.methodFullName,"signature"->c.signature,"file"->relative(c.method.filename),"line"->c.lineNumber.getOrElse(0),"column"->c.columnNumber.getOrElse(0),"code"->c.code.take(2000),"dispatch"->c.dispatchType,"targets"->ujson.Arr.from(targets.take(20)),"targetsTruncated"->(targets.size>20),"arguments"->ujson.Arr.from(arguments)))
      if (Set("assert", "require", "check", "checkArgument", "requireNonNull", "assertTrue").contains(c.name)) emit(ujson.Obj("type"->"guard","id"->s"validation:${c.id}","method"->c.method.id.toString,"expression"->c.code.take(2000),"file"->relative(c.method.filename),"line"->c.lineNumber.getOrElse(0),"kind"->"validation-call","status"->"declared","coverage"->"Call presence does not establish enforcement on every path"))
      val full = c.methodFullName
      val portType = if (full.contains("KafkaTemplate") && c.name == "send") "kafka-produce" else if ((full.contains("java.sql.") || full.contains("JdbcTemplate")) && c.name.matches("execute.*|update|query.*")) (if(c.name.startsWith("query")) "db-read" else "db-write") else if ((full.contains("RestTemplate") || full.contains("WebClient") || c.name == "fetch") && c.name.matches("fetch|get.*|post.*|put.*|delete.*|exchange|retrieve")) "http-egress" else ""
      if (portType.nonEmpty) emit(ujson.Obj("type"->"port","id"->s"call:${c.id}","portType"->portType,"method"->c.method.id.toString,"call"->c.id.toString,"file"->relative(c.method.filename),"line"->c.lineNumber.getOrElse(0),"code"->c.code.take(2000),"certainty"->"candidate","gaps"->ujson.Arr("Target identity and payload mapping require passport/configuration evidence")))
    }
    val controls = graph.controlStructure
    while (controls.hasNext && !truncated) {
      val c = controls.next()
      emit(ujson.Obj("type"->"guard","id"->c.id.toString,"method"->c.method.id.toString,"expression"->c.condition.code.take(1).toSeq.headOption.getOrElse(c.code).take(2000),"file"->relative(c.method.filename),"line"->c.lineNumber.getOrElse(0),"kind"->c.controlStructureType,"status"->"unknown","coverage"->"A condition is not a universal invariant; query a specific CFG path"))
    }
    // A final record is mandatory even when the retained projection hit its budget.
    writer.write(ujson.write(ujson.Obj("type"->"summary","counts"->ujson.Obj.from(counts.toSeq.map { case (k,v) => (k,ujson.Num(v)) }),"truncated"->truncated,"bytes"->bytes,"gaps"->ujson.Arr("Dynamic dispatch, external methods and transport field mappings may remain unresolved")))); writer.newLine()
  } finally { writer.close(); graph.close() }
}
