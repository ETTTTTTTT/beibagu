package com.huaxin.shirohaquiz

import com.google.gson.Gson
import com.google.gson.GsonBuilder
import com.google.gson.JsonArray
import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.PathManager
import com.intellij.openapi.fileChooser.FileChooser
import com.intellij.openapi.fileChooser.FileChooserDescriptorFactory
import com.intellij.openapi.fileChooser.FileSaverDescriptor
import com.intellij.openapi.fileChooser.FileChooserFactory
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.openapi.vfs.VfsUtil
import java.io.InputStreamReader
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Path
import java.time.Instant
import java.util.UUID
import kotlin.io.path.createDirectories
import kotlin.io.path.exists
import kotlin.io.path.readText
import kotlin.io.path.writeText
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * 背题数据与消息处理（对齐 Cursor 版 extension.js 的核心能力）。
 */
class QuizService(private val project: Project?) {
  private val gson: Gson = GsonBuilder().setPrettyPrinting().disableHtmlEscaping().create()
  private val storageDir: Path =
    Path.of(PathManager.getConfigPath(), "shiroha-quiz").also { it.createDirectories() }
  private val stateFile: Path = storageDir.resolve("quiz-state.json")
  private val customBankFile: Path = storageDir.resolve("custom-questions.json")

  private var progress: JsonObject = JsonObject()
  private var wrong: JsonObject = JsonObject()
  private var deleted: MutableSet<String> = linkedSetOf()
  private var lastQuestionId: String = ""

  init {
    loadPersistedState()
  }

  fun buildStatePayload(): JsonObject {
    val questions = loadActiveQuestions()
    val payload = JsonObject()
    payload.add("questions", questions)
    val visible = JsonArray()
    questions.forEach { el ->
      val id = el.asJsonObject.get("id")?.asString
      if (!id.isNullOrBlank()) visible.add(id)
    }
    payload.add("visibleIds", visible)
    payload.add("deleted", gson.toJsonTree(deleted.toList()))
    payload.add("progress", progress.deepCopy())
    payload.add("wrong", wrong.deepCopy())
    val session = JsonObject()
    session.addProperty("lastQuestionId", lastQuestionId)
    payload.add("session", session)
    payload.addProperty("updatedAt", Instant.now().toString())
    payload.addProperty("storagePath", stateFile.toAbsolutePath().toString())
    payload.add("bank", bankInfo())
    val wrap = JsonObject()
    wrap.addProperty("type", "state")
    wrap.add("payload", payload)
    return wrap
  }

  fun handleMessage(raw: String, reply: (JsonObject) -> Unit, reloadUi: () -> Unit) {
    val msg = try {
      JsonParser.parseString(raw).asJsonObject
    } catch (_: Exception) {
      return
    }
    val type = msg.get("type")?.asString ?: return
    ApplicationManager.getApplication().invokeLater {
      when (type) {
        "ready", "reload" -> reply(buildStatePayload())
        "reloadShell" -> {
          reloadUi()
        }
        "saveSession" -> {
          lastQuestionId = msg.get("lastQuestionId")?.asString?.trim().orEmpty()
          persistState()
        }
        "resetProgress" -> {
          if (confirm("确定重置学习进度？（题库会保留，理解程度与复习安排会清空）", "重置")) {
            progress = JsonObject()
            wrong = JsonObject()
            persistState()
            reply(buildStatePayload())
          }
        }
        "mark" -> {
          handleMark(msg)
          reply(buildStatePayload())
        }
        "checkpointAttempt", "saveUserAnswer", "addPitfall" -> {
          handleAttemptLike(msg, type)
          reply(buildStatePayload())
        }
        "deletePitfall", "togglePitfall", "deleteAnswerHistory" -> {
          handleHistoryEdit(msg, type)
          reply(buildStatePayload())
        }
        "upsertQuestion" -> {
          upsertQuestion(msg.getAsJsonObject("question") ?: JsonObject())
          reply(buildStatePayload())
        }
        "removeQuestion", "delete" -> {
          val id = msg.get("id")?.asString.orEmpty()
          val title = msg.get("question")?.asString.orEmpty()
          if (id.isNotBlank() && confirm("确定删除这道题？删除后不可恢复。\n\n${title.take(80)}", "删除")) {
            removeQuestionHard(id)
            reply(buildStatePayload())
          }
        }
        "deleteCategory" -> {
          val cat = msg.get("category")?.asString?.trim().orEmpty()
          if (cat.isNotBlank() && cat != "未分类") {
            if (confirm("确定删除分类「$cat」？将从题目中移除该分类，题目本身保留。", "删除分类")) {
              deleteCategory(cat)
              reply(buildStatePayload())
            }
          }
        }
        "importBank" -> {
          val mode = if (msg.get("mode")?.asString == "merge") "merge" else "replace"
          importBank(mode)
          reply(buildStatePayload())
        }
        "exportBank" -> exportBank()
        "askDeepSeek" -> openDeepSeek(msg, score = false)
        "scoreDeepSeek" -> {
          val qid = msg.get("id")?.asString.orEmpty()
          val ua = msg.get("userAnswer")?.asString.orEmpty()
          if (qid.isNotBlank() && ua.isNotBlank()) {
            handleAttemptLike(msg, "saveUserAnswer")
            reply(buildStatePayload())
          }
          openDeepSeek(msg, score = true)
        }
        "useBuiltin", "restoreQuestion" -> {
          // no-op / unsupported stubs
        }
        else -> {
          // ignore unknown
        }
      }
    }
  }

  private fun handleMark(msg: JsonObject) {
    val id = msg.get("id")?.asString ?: return
    val understanding = msg.get("understanding")?.asDouble?.roundToInt() ?: return
    val prev = progress.getAsJsonObject(id) ?: JsonObject()
    val scheduled = msg.getAsJsonObject("scheduled")?.deepCopy()
      ?: scheduleByEbbinghaus(understanding)
    scheduled.addProperty("understanding", clamp(understanding, 0, 100))
    val pitText = msg.get("pitfall")?.asString?.trim().orEmpty()
    val ans = mergeUserAnswer(prev, msg.get("userAnswer")?.asString, understanding, false, pitText)
    val pitfalls = if (pitText.isNotEmpty()) {
      appendPitfall(prev, pitText)
    } else {
      toJsonArray(normalizePitfalls(prev.get("pitfalls")))
    }
    val next = JsonObject()
    prev.entrySet().forEach { next.add(it.key, it.value) }
    scheduled.entrySet().forEach { next.add(it.key, it.value) }
    ans.entrySet().forEach { next.add(it.key, it.value) }
    next.add("pitfalls", pitfalls)
    next.addProperty("reviews", (prev.get("reviews")?.asInt ?: 0) + 1)
    next.addProperty("lastResult", if (understanding >= 80) "right" else "partial")
    progress.add(id, next)
    if (understanding < 80) {
      val w = JsonObject()
      w.addProperty("id", id)
      w.addProperty("understanding", understanding)
      w.addProperty("count", (wrong.getAsJsonObject(id)?.get("count")?.asInt ?: 0) + 1)
      w.addProperty("lastAt", scheduled.get("lastAt")?.asString ?: Instant.now().toString())
      w.add("pitfalls", pitfalls)
      wrong.add(id, w)
    } else {
      wrong.remove(id)
    }
    persistState()
  }

  private fun handleAttemptLike(msg: JsonObject, type: String) {
    val id = msg.get("id")?.asString ?: return
    val prev = progress.getAsJsonObject(id) ?: JsonObject()
    val pitText = msg.get("pitfall")?.asString?.trim()
      ?: msg.get("text")?.asString?.trim().orEmpty()
    val force = type == "checkpointAttempt" || msg.get("force")?.asBoolean == true
    val ans = mergeUserAnswer(prev, msg.get("userAnswer")?.asString, null, force, pitText)
    val pitfalls = if (pitText.isNotEmpty()) {
      appendPitfall(JsonObject().also {
        prev.entrySet().forEach { e -> it.add(e.key, e.value) }
        ans.entrySet().forEach { e -> it.add(e.key, e.value) }
      }, pitText)
    } else {
      toJsonArray(normalizePitfalls(prev.get("pitfalls")))
    }
    val next = JsonObject()
    prev.entrySet().forEach { next.add(it.key, it.value) }
    ans.entrySet().forEach { next.add(it.key, it.value) }
    next.add("pitfalls", pitfalls)
    progress.add(id, next)
    persistState()
  }

  private fun handleHistoryEdit(msg: JsonObject, type: String) {
    val id = msg.get("id")?.asString ?: return
    val prev = progress.getAsJsonObject(id) ?: JsonObject()
    when (type) {
      "deletePitfall" -> {
        val pid = msg.get("pitfallId")?.asString ?: return
        val pitfalls = normalizePitfalls(prev.get("pitfalls")).filter {
          it.asJsonObject.get("id")?.asString != pid
        }
        val arr = JsonArray()
        pitfalls.forEach { arr.add(it) }
        prev.add("pitfalls", arr)
      }
      "togglePitfall" -> {
        val pid = msg.get("pitfallId")?.asString ?: return
        val arr = JsonArray()
        normalizePitfalls(prev.get("pitfalls")).forEach { el ->
          val o = el.asJsonObject.deepCopy()
          if (o.get("id")?.asString == pid) {
            o.addProperty("resolved", !(o.get("resolved")?.asBoolean ?: false))
          }
          arr.add(o)
        }
        prev.add("pitfalls", arr)
      }
      "deleteAnswerHistory" -> {
        if (!confirm("确定删除这条答题历史？删除后不可恢复。", "删除")) return
        val answerId = msg.get("answerId")?.asString.orEmpty()
        val history = normalizeAnswerHistory(prev.get("answerHistory")).filter {
          it.asJsonObject.get("id")?.asString != answerId
        }
        val arr = JsonArray()
        history.forEach { arr.add(it) }
        prev.add("answerHistory", arr)
        val latest = history.firstOrNull()?.asJsonObject
        prev.addProperty("lastAnswer", latest?.get("text")?.asString.orEmpty())
        prev.addProperty("lastAnswerAt", latest?.get("at")?.asString.orEmpty())
      }
    }
    progress.add(id, prev)
    persistState()
  }

  private fun loadPersistedState() {
    if (!stateFile.exists()) return
    try {
      val root = JsonParser.parseString(stateFile.readText(Charsets.UTF_8)).asJsonObject
      progress = root.getAsJsonObject("progress") ?: JsonObject()
      wrong = root.getAsJsonObject("wrong") ?: JsonObject()
      deleted = linkedSetOf()
      root.getAsJsonArray("deleted")?.forEach { deleted.add(it.asString) }
      lastQuestionId = root.getAsJsonObject("session")?.get("lastQuestionId")?.asString.orEmpty()
    } catch (_: Exception) {
      progress = JsonObject()
      wrong = JsonObject()
    }
  }

  private fun persistState() {
    val root = JsonObject()
    root.addProperty("schemaVersion", 1)
    root.add("progress", progress)
    root.add("wrong", wrong)
    root.add("deleted", gson.toJsonTree(deleted.toList()))
    val session = JsonObject()
    session.addProperty("lastQuestionId", lastQuestionId)
    root.add("session", session)
    root.addProperty("updatedAt", Instant.now().toString())
    stateFile.writeText(gson.toJson(root), Charsets.UTF_8)
  }

  private fun bankInfo(): JsonObject {
    val o = JsonObject()
    if (customBankFile.exists()) {
      o.addProperty("source", "custom")
      o.addProperty("title", "自定义题库")
      o.addProperty("label", "自定义题库")
    } else {
      o.addProperty("source", "builtin")
      o.addProperty("title", "内置 Java 核心题库")
      o.addProperty("label", "内置 Java 核心题库")
    }
    return o
  }

  private fun loadBundledQuestions(): JsonArray {
    val stream = javaClass.getResourceAsStream("/webview/questions.json")
      ?: return JsonArray()
    InputStreamReader(stream, StandardCharsets.UTF_8).use { reader ->
      val raw = JsonParser.parseReader(reader).asJsonObject
      return normalizeQuestions(raw.get("questions") ?: JsonArray())
    }
  }

  private fun loadActiveQuestions(): JsonArray {
    val all = if (customBankFile.exists()) {
      try {
        val raw = JsonParser.parseString(customBankFile.readText(Charsets.UTF_8))
        val qs = when {
          raw.isJsonObject -> raw.asJsonObject.get("questions") ?: JsonArray()
          raw.isJsonArray -> raw.asJsonArray
          else -> JsonArray()
        }
        normalizeQuestions(qs)
      } catch (_: Exception) {
        loadBundledQuestions()
      }
    } else {
      loadBundledQuestions()
    }
    val out = JsonArray()
    all.forEach { el ->
      val id = el.asJsonObject.get("id")?.asString
      if (id != null && id !in deleted) out.add(el)
    }
    return out
  }

  private fun normalizeQuestions(raw: JsonElement): JsonArray {
    val list = when {
      raw.isJsonArray -> raw.asJsonArray
      else -> JsonArray()
    }
    val out = JsonArray()
    list.forEachIndexed { i, el ->
      if (!el.isJsonObject) return@forEachIndexed
      val q = el.asJsonObject
      val categories = parseCategories(q)
      val question = (q.get("question")?.asString
        ?: q.get("title")?.asString
        ?: q.get("stem")?.asString
        ?: "").trim()
      if (question.isEmpty()) return@forEachIndexed
      val answer = when {
        q.get("answer")?.isJsonArray == true ->
          q.getAsJsonArray("answer").joinToString("\n") { it.asString }
        else -> q.get("answer")?.asString
          ?: q.get("explanation")?.asString
          ?: q.get("rightAnswer")?.asString
          ?: ""
      }
      val obj = JsonObject()
      obj.addProperty("id", q.get("id")?.asString ?: q.get("qid")?.asString ?: "q-${i + 1}")
      obj.addProperty("type", q.get("type")?.asString ?: "short")
      obj.addProperty("question", question)
      obj.addProperty("answer", answer)
      obj.addProperty("analysis", q.get("analysis")?.asString ?: "")
      obj.add("categories", categories)
      obj.addProperty("category", categories.joinToString(" | ") { it.asString })
      obj.addProperty("topic", categories.firstOrNull()?.asString?.split(Regex("\\s+/\\s+"))?.firstOrNull() ?: "")
      out.add(obj)
    }
    return out
  }

  private fun parseCategories(q: JsonObject): JsonArray {
    val out = JsonArray()
    val seen = linkedSetOf<String>()
    fun push(value: String?) {
      if (value.isNullOrBlank()) return
      value.split(Regex("\\s*[,，、|]\\s*")).map { it.trim() }.filter { it.isNotEmpty() }.forEach {
        if (seen.add(it)) out.add(it)
      }
    }
    val cats = q.get("categories")
    if (cats != null && cats.isJsonArray && cats.asJsonArray.size() > 0) {
      cats.asJsonArray.forEach { push(it.asString) }
      return out
    }
    val cat = q.get("category")?.asString?.trim()
    if (!cat.isNullOrEmpty()) {
      push(cat)
      return out
    }
    push(q.get("topic")?.asString)
    return out
  }

  private fun ensureEditableBank() {
    if (customBankFile.exists()) return
    val qs = loadBundledQuestions()
    writeCustomBank(qs, "自定义编辑题库（来自内置）")
  }

  private fun writeCustomBank(questions: JsonArray, title: String) {
    val filtered = JsonArray()
    questions.forEach { el ->
      val id = el.asJsonObject.get("id")?.asString
      if (id != null && id !in deleted) filtered.add(el)
    }
    val root = JsonObject()
    val meta = JsonObject()
    meta.addProperty("title", title)
    meta.addProperty("questionCount", filtered.size())
    meta.addProperty("updatedAt", Instant.now().toString())
    root.add("meta", meta)
    root.add("questions", filtered)
    customBankFile.writeText(gson.toJson(root), Charsets.UTF_8)
  }

  private fun upsertQuestion(q: JsonObject) {
    ensureEditableBank()
    val current = loadActiveQuestions()
    val id = q.get("id")?.asString?.ifBlank { null } ?: "q-${UUID.randomUUID().toString().take(8)}"
    q.addProperty("id", id)
    val normalized = normalizeQuestions(JsonArray().also { it.add(q) })
    val item = normalized.firstOrNull()?.asJsonObject ?: return
    val next = JsonArray()
    var replaced = false
    current.forEach { el ->
      if (el.asJsonObject.get("id")?.asString == id) {
        next.add(item)
        replaced = true
      } else next.add(el)
    }
    if (!replaced) next.add(item)
    deleted.remove(id)
    writeCustomBank(next, "自定义题库")
  }

  private fun removeQuestionHard(id: String) {
    deleted.add(id)
    if (customBankFile.exists()) {
      val qs = loadActiveQuestions() // already filters deleted
      // rewrite custom without this id
      val raw = try {
        JsonParser.parseString(customBankFile.readText(Charsets.UTF_8)).asJsonObject
          .getAsJsonArray("questions") ?: JsonArray()
      } catch (_: Exception) {
        JsonArray()
      }
      val next = JsonArray()
      raw.forEach { el ->
        if (el.asJsonObject.get("id")?.asString != id) next.add(el)
      }
      writeCustomBank(normalizeQuestions(next), "自定义题库")
    }
    progress.remove(id)
    wrong.remove(id)
    persistState()
  }

  private fun deleteCategory(name: String) {
    ensureEditableBank()
    val qs = loadActiveQuestions()
    val next = JsonArray()
    qs.forEach { el ->
      val o = el.asJsonObject.deepCopy()
      val cats = JsonArray()
      (o.getAsJsonArray("categories") ?: JsonArray()).forEach { c ->
        if (c.asString != name) cats.add(c)
      }
      o.add("categories", cats)
      o.addProperty("category", cats.joinToString(" | ") { it.asString })
      o.addProperty("topic", cats.firstOrNull()?.asString?.split(Regex("\\s+/\\s+"))?.firstOrNull() ?: "")
      next.add(o)
    }
    writeCustomBank(next, "自定义题库")
  }

  private fun importBank(mode: String) {
    val descriptor = FileChooserDescriptorFactory.createSingleFileDescriptor("json")
    descriptor.title = if (mode == "merge") "导入题目（合并）" else "导入题库（替换）"
    val file = FileChooser.chooseFile(descriptor, project, null) ?: return
    val text = VfsUtil.loadText(file)
    val parsed = JsonParser.parseString(text)
    val incoming = normalizeQuestions(
      when {
        parsed.isJsonObject -> parsed.asJsonObject.get("questions") ?: JsonArray()
        parsed.isJsonArray -> parsed.asJsonArray
        else -> JsonArray()
      }
    )
    if (mode == "replace") {
      deleted.clear()
      writeCustomBank(incoming, file.nameWithoutExtension)
    } else {
      ensureEditableBank()
      val map = linkedMapOf<String, JsonObject>()
      loadActiveQuestions().forEach { el ->
        val o = el.asJsonObject
        map[o.get("id").asString] = o
      }
      incoming.forEach { el ->
        val o = el.asJsonObject
        map[o.get("id").asString] = o
        deleted.remove(o.get("id").asString)
      }
      val next = JsonArray()
      map.values.forEach { next.add(it) }
      writeCustomBank(next, "自定义题库（合并）")
    }
    persistState()
  }

  private fun exportBank() {
    val qs = loadActiveQuestions()
    val descriptor = FileSaverDescriptor("导出题库", "保存为 JSON", "json")
    val base = LocalFileSystem.getInstance().findFileByPath(System.getProperty("user.home"))
    val wrapper = FileChooserFactory.getInstance().createSaveFileDialog(descriptor, project)
      .save(base, "shiroha-quiz-bank.json") ?: return
    val root = JsonObject()
    val meta = JsonObject()
    meta.addProperty("title", bankInfo().get("title")?.asString)
    meta.addProperty("questionCount", qs.size())
    meta.addProperty("exportedAt", Instant.now().toString())
    root.add("meta", meta)
    root.add("questions", qs)
    Files.writeString(wrapper.file.toPath(), gson.toJson(root), StandardCharsets.UTF_8)
    Messages.showInfoMessage(project, "已导出 ${qs.size()} 题", "面试背题")
  }

  private fun openDeepSeek(msg: JsonObject, score: Boolean) {
    val q = msg.get("question")?.asString?.trim().orEmpty()
    if (q.isEmpty()) {
      Messages.showWarningDialog(project, "当前没有题目", "面试背题")
      return
    }
    val answer = msg.get("answer")?.asString?.trim().orEmpty()
    val analysis = msg.get("analysis")?.asString?.trim().orEmpty()
    val user = msg.get("userAnswer")?.asString?.trim().orEmpty()
    val pitfalls = formatPitfalls(msg.get("pitfalls"))

    if (score && user.isEmpty()) {
      Messages.showWarningDialog(project, "请先在答题框写下你的作答，再点 DeepSeek 打分", "面试背题")
      return
    }

    val prompt = if (score) {
      buildString {
        appendLine("你是严格但友善的资深面试官。请对我的作答打分并点评。")
        appendLine()
        appendLine("输出格式：1)总分x/100 2)分项评语 3)亮点 4)不足 5)改进版口述 6)追问演练")
        appendLine()
        appendLine("【题目】")
        appendLine(q)
        appendLine()
        appendLine("【我的作答】")
        appendLine(user)
        appendLine()
        appendLine("【题库参考（可能有误，仅供对照）】")
        appendLine(answer.ifEmpty { "（暂无参考答案，请按通用面试标准评判）" })
        if (analysis.isNotEmpty()) {
          appendLine()
          appendLine("【题库补充】")
          appendLine(analysis)
        }
        if (pitfalls.isNotEmpty()) {
          appendLine()
          appendLine(pitfalls)
        }
      }.trim()
    } else {
      buildString {
        appendLine("你是资深 Java/后端面试官。请详解下面这道面试题。")
        appendLine()
        appendLine("请按顺序：①先独立给标准答案 ②深入解析 ③点评参考答案是否最优")
        if (pitfalls.isNotEmpty()) appendLine("④针对答题错点逐条纠偏")
        appendLine()
        appendLine("【题目】")
        appendLine(q)
        appendLine()
        appendLine("【参考答案】")
        appendLine(answer.ifEmpty { "（题库暂无参考答案）" })
        if (analysis.isNotEmpty()) {
          appendLine()
          appendLine("【参考答案补充】")
          appendLine(analysis)
        }
        if (pitfalls.isNotEmpty()) {
          appendLine()
          appendLine(pitfalls)
        }
      }.trim()
    }

    val tip = if (score) "DeepSeek 打分" else "DeepSeek 详解"
    // 后台填入；成功不弹窗以免抢回 IDEA 焦点，保持 DeepSeek/Chrome 在前台
    ApplicationManager.getApplication().executeOnPooledThread {
      val result = DeepSeekAutoFill.openAndFill(prompt)
      DeepSeekAutoFill.focusChromeForeground()
      if (!result.ok) {
        ApplicationManager.getApplication().invokeLater {
          // 仅失败时用非模态气泡提示，避免 Messages 对话框把焦点抢回 IDEA
          com.intellij.notification.NotificationGroupManager.getInstance()
            .getNotificationGroup("面试背题")
            .createNotification(
              tip,
              result.message,
              com.intellij.notification.NotificationType.WARNING
            )
            .notify(project)
        }
      }
    }
  }

  private fun formatPitfalls(el: JsonElement?): String {
    if (el == null || !el.isJsonArray) return ""
    val lines = el.asJsonArray.mapNotNull { item ->
      when {
        item.isJsonObject -> item.asJsonObject.get("text")?.asString?.trim()
        item.isJsonPrimitive -> item.asString.trim()
        else -> null
      }
    }.filter { it.isNotEmpty() }
    if (lines.isEmpty()) return ""
    return buildString {
      appendLine("【我之前的答题错点】")
      lines.forEachIndexed { i, t -> appendLine("${i + 1}. $t") }
    }.trim()
  }

  private fun confirm(message: String, okText: String): Boolean {
    val r = Messages.showYesNoDialog(project, message, "面试背题", okText, "取消", null)
    return r == Messages.YES
  }

  private fun scheduleByEbbinghaus(understanding: Int): JsonObject {
    val u = clamp(understanding, 0, 100)
    val stage = qualityToStage(u)
    val days = EBBINGHAUS_DAYS[stage]
    val o = JsonObject()
    o.addProperty("understanding", u)
    o.addProperty("stage", stage)
    o.addProperty("intervalDays", days)
    o.addProperty("nextReviewAt", Instant.now().plusSeconds(days * 86400L).toString())
    o.addProperty("lastAt", Instant.now().toString())
    return o
  }

  private fun qualityToStage(u: Int): Int = when {
    u >= 95 -> 6
    u >= 85 -> 5
    u >= 70 -> 4
    u >= 55 -> 3
    u >= 40 -> 2
    u >= 25 -> 1
    else -> 0
  }

  private fun mergeUserAnswer(
    prev: JsonObject,
    userAnswer: String?,
    understanding: Int?,
    force: Boolean,
    pitfall: String? = null
  ): JsonObject {
    val text = userAnswer?.trim().orEmpty()
    val pit = pitfall?.trim().orEmpty()
    val at = Instant.now().toString()
    var history = normalizeAnswerHistory(prev.get("answerHistory")).map { it.asJsonObject.deepCopy() }.toMutableList()
    val u = understanding
    if (text.isNotEmpty() || force || pit.isNotEmpty()) {
      val same = history.firstOrNull()?.get("text")?.asString == text && text.isNotEmpty()
      if (!same || force || pit.isNotEmpty()) {
        if (same && history.isNotEmpty()) {
          val first = history[0]
          if (u != null) first.addProperty("understanding", u)
          if (pit.isNotEmpty()) first.addProperty("pitfall", pit)
          first.addProperty("at", at)
        } else {
          val entry = JsonObject()
          entry.addProperty("id", "a-" + UUID.randomUUID().toString().take(8))
          entry.addProperty("text", text.take(8000))
          entry.addProperty("at", at)
          if (u != null) entry.addProperty("understanding", u)
          if (pit.isNotEmpty()) entry.addProperty("pitfall", pit)
          history.add(0, entry)
        }
      }
    }
    history = history.take(200).toMutableList()
    val out = JsonObject()
    out.addProperty(
      "lastAnswer",
      if (text.isNotEmpty()) text.take(8000) else prev.get("lastAnswer")?.asString.orEmpty()
    )
    out.addProperty(
      "lastAnswerAt",
      if (text.isNotEmpty() || pit.isNotEmpty()) at else prev.get("lastAnswerAt")?.asString.orEmpty()
    )
    val arr = JsonArray()
    history.forEach { arr.add(it) }
    out.add("answerHistory", arr)
    return out
  }

  private fun appendPitfall(prev: JsonObject, text: String): JsonArray {
    val t = text.trim()
    val arr = JsonArray()
    val existing = normalizePitfalls(prev.get("pitfalls"))
    val dup = existing.any { it.asJsonObject.get("text")?.asString == t }
    if (!dup && t.isNotEmpty()) {
      val p = JsonObject()
      p.addProperty("id", "p-" + UUID.randomUUID().toString().take(8))
      p.addProperty("text", t)
      p.addProperty("at", Instant.now().toString())
      p.addProperty("resolved", false)
      arr.add(p)
    }
    existing.forEach { arr.add(it) }
    return arr
  }

  private fun normalizePitfalls(el: JsonElement?): List<JsonElement> {
    if (el == null || !el.isJsonArray) return emptyList()
    return el.asJsonArray.toList()
  }

  private fun normalizeAnswerHistory(el: JsonElement?): List<JsonElement> {
    if (el == null || !el.isJsonArray) return emptyList()
    return el.asJsonArray.toList()
  }

  private fun toJsonArray(list: List<JsonElement>): JsonArray {
    val arr = JsonArray()
    list.forEach { arr.add(it) }
    return arr
  }

  private fun clamp(n: Int, minV: Int, maxV: Int) = max(minV, min(maxV, n))

  companion object {
    private val EBBINGHAUS_DAYS = intArrayOf(1, 2, 4, 7, 15, 30, 60)
  }
}
