package com.huaxin.shirohaquiz

import com.google.gson.Gson
import com.google.gson.JsonArray
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.ide.CopyPasteManager
import java.awt.datatransfer.StringSelection
import java.io.File
import java.net.URI
import java.net.URLEncoder
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.net.http.WebSocket
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Path
import java.time.Duration
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CompletionStage
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * Chrome CDP：打开 DeepSeek 并把提示词自动写入聊天输入框（对齐 Cursor 版）。
 */
object DeepSeekAutoFill {
  private val log = Logger.getInstance(DeepSeekAutoFill::class.java)
  private const val CDP_PORT = 9333
  private val gson = Gson()
  private val http = HttpClient.newBuilder()
    .connectTimeout(Duration.ofSeconds(3))
    .build()

  data class Result(val ok: Boolean, val message: String, val len: Int = 0)

  fun openAndFill(prompt: String): Result {
    val text = prompt.trim()
    if (text.isEmpty()) return Result(false, "没有可发送的内容")

    try {
      CopyPasteManager.getInstance().setContents(StringSelection(text))
    } catch (_: Exception) {
      // ignore
    }

    val chrome = findChromePath()
      ?: return Result(false, "未找到 Google Chrome。提示词已复制，请手动打开 chat.deepseek.com 后 Ctrl+V。")

    if (!ensureChrome(chrome, "https://chat.deepseek.com/")) {
      return Result(false, "无法启动 Chrome。提示词已复制，请手动打开后 Ctrl+V。")
    }

    return try {
      val len = fillViaCdp(text, loginWaitMs = 180_000)
      focusChromeForeground()
      Result(true, "已自动填入并发送（${len} 字）。", len)
    } catch (e: Exception) {
      log.warn("DeepSeek CDP fill failed", e)
      focusChromeForeground()
      Result(
        false,
        "已打开 DeepSeek，自动填入失败：${e.message ?: e}。提示词已复制，请在输入框 Ctrl+V。"
      )
    }
  }

  /** 把 DeepSeek 所在 Chrome 窗口拉到最前，避免填入后焦点回到 IDEA */
  fun focusChromeForeground() {
    try {
      val page = pickDeepSeekPage(listPages())
      val id = page?.get("id")?.asString
      if (!id.isNullOrBlank()) {
        httpGetJson("http://127.0.0.1:$CDP_PORT/json/activate/$id", 1500)
      }
    } catch (_: Exception) {
      // ignore
    }
    if (!System.getProperty("os.name", "").lowercase().contains("win")) return
    try {
      val ps = """
        ${'$'}sh = New-Object -ComObject WScript.Shell
        foreach (${'$'}t in @('DeepSeek','Chrome','Google Chrome')) {
          if (${'$'}sh.AppActivate(${'$'}t)) { break }
        }
      """.trimIndent()
      ProcessBuilder("powershell", "-NoProfile", "-WindowStyle", "Hidden", "-Command", ps)
        .redirectError(ProcessBuilder.Redirect.DISCARD)
        .redirectOutput(ProcessBuilder.Redirect.DISCARD)
        .start()
    } catch (e: Exception) {
      log.warn("focus chrome failed", e)
    }
  }

  private fun findChromePath(): String? {
    val localApp = System.getenv("LOCALAPPDATA") ?: ""
    val pf = System.getenv("ProgramFiles") ?: "C:\\Program Files"
    val pf86 = System.getenv("ProgramFiles(x86)") ?: "C:\\Program Files (x86)"
    val candidates = listOf(
      File(localApp, "Google\\Chrome\\Application\\chrome.exe").absolutePath,
      File(pf, "Google\\Chrome\\Application\\chrome.exe").absolutePath,
      File(pf86, "Google\\Chrome\\Application\\chrome.exe").absolutePath,
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium-browser"
    )
    return candidates.firstOrNull { File(it).exists() }
  }

  private fun profileDir(): Path {
    val dir = Path.of(System.getProperty("java.io.tmpdir"), "shiroha-quiz-deepseek-chrome")
    Files.createDirectories(dir)
    return dir
  }

  private fun isCdpAlive(): Boolean = try {
    val json = httpGetJson("http://127.0.0.1:$CDP_PORT/json/version", 800)
    json.has("webSocketDebuggerUrl") || json.has("Browser")
  } catch (_: Exception) {
    false
  }

  private fun ensureChrome(chrome: String, url: String): Boolean {
    if (isCdpAlive()) {
      try {
        httpGetJson(
          "http://127.0.0.1:$CDP_PORT/json/new?${URLEncoder.encode(url, StandardCharsets.UTF_8)}",
          2000
        )
      } catch (_: Exception) {
        try {
          val page = listPages().firstOrNull {
            Regex("deepseek\\.com", RegexOption.IGNORE_CASE)
              .containsMatchIn(it.get("url")?.asString ?: "")
          }
          val id = page?.get("id")?.asString
          if (!id.isNullOrBlank()) {
            httpGetJson("http://127.0.0.1:$CDP_PORT/json/activate/$id", 1500)
          }
        } catch (_: Exception) {
          // ignore
        }
      }
      return true
    }
    return try {
      ProcessBuilder(
        chrome,
        "--remote-debugging-port=$CDP_PORT",
        "--user-data-dir=${profileDir().toAbsolutePath()}",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-popup-blocking",
        "--new-window",
        url
      ).redirectError(ProcessBuilder.Redirect.DISCARD)
        .redirectOutput(ProcessBuilder.Redirect.DISCARD)
        .start()
      true
    } catch (e: Exception) {
      log.warn("launch chrome failed", e)
      false
    }
  }

  private fun fillViaCdp(text: String, loginWaitMs: Long): Int {
    var lastErr: Exception? = null
    repeat(3) { attempt ->
      try {
        return fillViaCdpOnce(text, loginWaitMs)
      } catch (e: Exception) {
        lastErr = e
        if (!isContextDestroyed(e) || attempt == 2) throw e
        Thread.sleep(800L + attempt * 400L)
      }
    }
    throw lastErr ?: IllegalStateException("CDP fill failed")
  }

  private fun fillViaCdpOnce(text: String, loginWaitMs: Long): Int {
    var page = waitForPage(25_000)
    var session = CdpSession.connect(page.get("webSocketDebuggerUrl").asString)
    try {
      session.send("Runtime.enable")
      session.send("Page.enable")

      fun hardReconnect() {
        val pages = listPages()
        val better = pickDeepSeekPage(pages) ?: pages.firstOrNull()
          ?: throw IllegalStateException("DeepSeek 标签丢失")
        session.closeQuietly()
        page = better
        session = CdpSession.connect(better.get("webSocketDebuggerUrl").asString)
        session.send("Runtime.enable")
        session.send("Page.enable")
      }

      fun sendRobust(method: String, params: JsonObject? = null): JsonObject {
        return try {
          session.send(method, params)
        } catch (e: Exception) {
          if (!isContextDestroyed(e)) throw e
          Thread.sleep(600)
          hardReconnect()
          session.send(method, params)
        }
      }

      if (Regex("sign_in|login", RegexOption.IGNORE_CASE)
          .containsMatchIn(page.get("url")?.asString ?: "")
      ) {
        val t0 = System.currentTimeMillis()
        while (System.currentTimeMillis() - t0 < loginWaitMs) {
          Thread.sleep(1500)
          val pages = listPages()
          val better = pickDeepSeekPage(pages)
          if (better != null &&
            better.get("webSocketDebuggerUrl").asString != page.get("webSocketDebuggerUrl").asString
          ) {
            hardReconnect()
          }
          if (!Regex("sign_in|login", RegexOption.IGNORE_CASE)
              .containsMatchIn(page.get("url")?.asString ?: "")
          ) break
          try {
            val probe = sendRobust(
              "Runtime.evaluate",
              jsonObj("expression" to PICK_INPUT_JS, "returnByValue" to false)
            )
            if (probe.getAsJsonObject("result")?.has("objectId") == true) break
          } catch (_: Exception) {
            // keep waiting login
          }
        }
      }

      val waitMs = loginWaitMs.coerceIn(20_000, 120_000)
      val readyExpr = """
        (() => new Promise((resolve) => {
          const pick = () => {
            const sels = [
              'textarea#chat-input',
              'textarea[placeholder*="消息"]',
              'textarea[placeholder*="Send"]',
              'textarea[placeholder*="输入"]',
              'textarea',
              '[contenteditable="true"]',
              'div[role="textbox"]'
            ];
            for (const s of sels) {
              const el = document.querySelector(s);
              if (!el) continue;
              const r = el.getBoundingClientRect();
              if (r.width >= 40 && r.height >= 16) return el;
            }
            return null;
          };
          const t0 = Date.now();
          const tick = () => {
            if (pick()) return resolve({ ok: true, href: location.href });
            if (Date.now() - t0 > $waitMs) return resolve({ ok: false, href: location.href });
            setTimeout(tick, 400);
          };
          tick();
        }))()
      """.trimIndent()

      val ready = sendRobust(
        "Runtime.evaluate",
        jsonObj("expression" to readyExpr, "awaitPromise" to true, "returnByValue" to true)
      )
      val readyVal = ready.getAsJsonObject("result")?.getAsJsonObject("value")
      if (readyVal?.get("ok")?.asBoolean != true) {
        val href = readyVal?.get("href")?.asString ?: page.get("url")?.asString ?: ""
        if (Regex("sign_in|login", RegexOption.IGNORE_CASE).containsMatchIn(href)) {
          throw IllegalStateException("仍在登录页：请先在 DeepSeek 专用 Chrome 窗口完成登录后重试")
        }
        throw IllegalStateException("未找到 DeepSeek 输入框（$href）")
      }

      Thread.sleep(500)
      try {
        val pages = listPages()
        val better = pickDeepSeekPage(pages)
        if (better != null &&
          better.get("webSocketDebuggerUrl").asString != page.get("webSocketDebuggerUrl").asString
        ) {
          hardReconnect()
        }
      } catch (_: Exception) {
        // ignore
      }

      val fillExpr = """
        (() => {
          const text = ${gson.toJson(text)};
          const sels = [
            'textarea#chat-input',
            'textarea[placeholder*="消息"]',
            'textarea[placeholder*="Send"]',
            'textarea[placeholder*="输入"]',
            'textarea',
            '[contenteditable="true"]',
            'div[role="textbox"]'
          ];
          let el = null;
          for (const s of sels) {
            const node = document.querySelector(s);
            if (!node) continue;
            const r = node.getBoundingClientRect();
            if (r.width >= 40 && r.height >= 16) { el = node; break; }
          }
          if (!el) return { ok: false, reason: 'no-el' };
          el.focus();
          if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
            const proto = el.tagName === 'TEXTAREA'
              ? window.HTMLTextAreaElement.prototype
              : window.HTMLInputElement.prototype;
            const desc = Object.getOwnPropertyDescriptor(proto, 'value');
            if (desc && desc.set) desc.set.call(el, text);
            else el.value = text;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          } else {
            try {
              document.execCommand('selectAll', false, null);
              document.execCommand('insertText', false, text);
            } catch (_) {
              el.textContent = text;
            }
            el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
          }
          const now = (el.value != null ? String(el.value) : String(el.innerText || el.textContent || ''));
          if (!(now.length > 0)) return { ok: false, reason: 'empty' };

          const clickSend = () => {
            const btnSels = [
              'button[aria-label*="发送"]',
              'button[aria-label*="Send"]',
              'button[data-testid*="send"]',
              'div[role="button"][aria-label*="发送"]',
              'div[role="button"][aria-label*="Send"]'
            ];
            for (const s of btnSels) {
              const b = document.querySelector(s);
              if (b && !b.disabled) { b.click(); return 'btn:' + s; }
            }
            const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
            const hit = buttons.reverse().find((b) => {
              if (b.disabled) return false;
              const t = ((b.getAttribute('aria-label') || '') + ' ' + (b.textContent || '')).trim();
              const r = b.getBoundingClientRect();
              if (r.width < 20 || r.height < 20 || r.bottom < window.innerHeight * 0.5) return false;
              return /发送|Send|submit/i.test(t) || (b.querySelector('svg') && r.right > window.innerWidth * 0.7);
            });
            if (hit) { hit.click(); return 'btn:heuristic'; }
            return null;
          };

          let sent = clickSend();
          if (!sent) {
            const opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
            el.dispatchEvent(new KeyboardEvent('keydown', opts));
            el.dispatchEvent(new KeyboardEvent('keyup', opts));
            sent = 'enter';
          }
          return { ok: true, len: now.length, sent: sent };
        })()
      """.trimIndent()

      val filled = sendRobust(
        "Runtime.evaluate",
        jsonObj("expression" to fillExpr, "returnByValue" to true)
      )
      val valObj = filled.getAsJsonObject("result")?.getAsJsonObject("value")
      if (valObj?.get("ok")?.asBoolean != true) {
        throw IllegalStateException("写入输入框失败")
      }
      // 再等一拍，部分页面按钮要等 input 后才可点
      Thread.sleep(400)
      try {
        sendRobust(
          "Runtime.evaluate",
          jsonObj(
            "expression" to """
              (() => {
                const btnSels = [
                  'button[aria-label*="发送"]',
                  'button[aria-label*="Send"]',
                  'button[data-testid*="send"]',
                  'div[role="button"][aria-label*="发送"]',
                  'div[role="button"][aria-label*="Send"]'
                ];
                for (const s of btnSels) {
                  const b = document.querySelector(s);
                  if (b && !b.disabled) { b.click(); return { ok: true, via: s }; }
                }
                const el = document.querySelector('textarea#chat-input, textarea, [contenteditable="true"]');
                if (el) {
                  el.focus();
                  const opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
                  el.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ ctrlKey: true }, opts)));
                  el.dispatchEvent(new KeyboardEvent('keydown', opts));
                  return { ok: true, via: 'enter' };
                }
                return { ok: false };
              })()
            """.trimIndent(),
            "returnByValue" to true
          )
        )
      } catch (_: Exception) {
        // ignore second send attempt
      }
      try {
        sendRobust("Page.bringToFront")
      } catch (_: Exception) {
        // ignore
      }
      return valObj.get("len")?.asInt ?: 0
    } finally {
      session.closeQuietly()
    }
  }

  private fun waitForPage(timeoutMs: Long): JsonObject {
    val start = System.currentTimeMillis()
    while (System.currentTimeMillis() - start < timeoutMs) {
      try {
        val pages = listPages()
        val page = pickDeepSeekPage(pages) ?: pages.firstOrNull()
        if (page != null) return page
      } catch (_: Exception) {
        // chrome not up yet
      }
      Thread.sleep(400)
    }
    throw IllegalStateException("等待 DeepSeek 页面超时")
  }

  private fun listPages(): List<JsonObject> {
    val arr = httpGetJsonArray("http://127.0.0.1:$CDP_PORT/json/list", 2000)
    return arr.mapNotNull { el ->
      if (!el.isJsonObject) return@mapNotNull null
      val o = el.asJsonObject
      if (o.get("type")?.asString == "page" && o.has("webSocketDebuggerUrl")) o else null
    }
  }

  private fun pickDeepSeekPage(pages: List<JsonObject>): JsonObject? {
    val deep = pages.filter {
      Regex("deepseek\\.com", RegexOption.IGNORE_CASE).containsMatchIn(it.get("url")?.asString ?: "")
    }
    return deep.firstOrNull {
      !Regex("sign_in", RegexOption.IGNORE_CASE).containsMatchIn(it.get("url")?.asString ?: "")
    } ?: deep.firstOrNull()
  }

  private fun isContextDestroyed(err: Throwable): Boolean {
    val msg = err.message ?: ""
    return Regex(
      "Execution context was destroyed|Cannot find context|Inspected target navigated|session closed|WebSocket",
      RegexOption.IGNORE_CASE
    ).containsMatchIn(msg)
  }

  private const val PICK_INPUT_JS = """(() => {
  const sels = [
    'textarea#chat-input',
    'textarea[placeholder*="消息"]',
    'textarea[placeholder*="Send"]',
    'textarea[placeholder*="输入"]',
    'textarea',
    '[contenteditable="true"]',
    'div[role="textbox"]'
  ];
  for (const s of sels) {
    const el = document.querySelector(s);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 16) continue;
    return el;
  }
  return null;
})()"""

  private fun jsonObj(vararg pairs: Pair<String, Any?>): JsonObject {
    val o = JsonObject()
    pairs.forEach { (k, v) ->
      when (v) {
        null -> o.add(k, null)
        is String -> o.addProperty(k, v)
        is Number -> o.addProperty(k, v)
        is Boolean -> o.addProperty(k, v)
        is JsonObject -> o.add(k, v)
        else -> o.addProperty(k, v.toString())
      }
    }
    return o
  }

  private fun httpGetJson(url: String, timeoutMs: Long): JsonObject {
    val req = HttpRequest.newBuilder(URI.create(url))
      .timeout(Duration.ofMillis(timeoutMs))
      .GET()
      .build()
    val res = http.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8))
    return JsonParser.parseString(res.body()).asJsonObject
  }

  private fun httpGetJsonArray(url: String, timeoutMs: Long): JsonArray {
    val req = HttpRequest.newBuilder(URI.create(url))
      .timeout(Duration.ofMillis(timeoutMs))
      .GET()
      .build()
    val res = http.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8))
    return JsonParser.parseString(res.body()).asJsonArray
  }

  private class CdpSession private constructor(
    private val ws: WebSocket,
    private val pending: ConcurrentHashMap<Int, CompletableFuture<JsonObject>>,
    private val nextId: AtomicInteger
  ) {
    fun send(method: String, params: JsonObject? = null): JsonObject {
      val id = nextId.getAndIncrement()
      val fut = CompletableFuture<JsonObject>()
      pending[id] = fut
      val payload = JsonObject()
      payload.addProperty("id", id)
      payload.addProperty("method", method)
      payload.add("params", params ?: JsonObject())
      ws.sendText(payload.toString(), true)
      return try {
        fut.get(20, TimeUnit.SECONDS)
      } catch (e: Exception) {
        pending.remove(id)
        throw e
      }
    }

    fun closeQuietly() {
      try {
        ws.sendClose(WebSocket.NORMAL_CLOSURE, "bye")
      } catch (_: Exception) {
        // ignore
      }
    }

    companion object {
      fun connect(wsUrl: String): CdpSession {
        val pending = ConcurrentHashMap<Int, CompletableFuture<JsonObject>>()
        val nextId = AtomicInteger(1)
        val opened = CompletableFuture<WebSocket>()
        val buf = StringBuilder()
        val listener = object : WebSocket.Listener {
          override fun onOpen(webSocket: WebSocket) {
            opened.complete(webSocket)
            webSocket.request(1)
          }

          override fun onText(
            webSocket: WebSocket,
            data: CharSequence,
            last: Boolean
          ): CompletionStage<*>? {
            buf.append(data)
            if (last) {
              val raw = buf.toString()
              buf.setLength(0)
              try {
                val msg = JsonParser.parseString(raw).asJsonObject
                val id = msg.get("id")?.asInt
                if (id != null) {
                  val fut = pending.remove(id)
                  if (msg.has("error")) {
                    fut?.completeExceptionally(
                      IllegalStateException(msg.getAsJsonObject("error").toString())
                    )
                  } else {
                    fut?.complete(msg.getAsJsonObject("result") ?: JsonObject())
                  }
                }
              } catch (_: Exception) {
                // ignore non-json frames
              }
            }
            webSocket.request(1)
            return null
          }

          override fun onClose(
            webSocket: WebSocket,
            statusCode: Int,
            reason: String
          ): CompletionStage<*>? {
            pending.values.forEach {
              it.completeExceptionally(IllegalStateException("WebSocket closed"))
            }
            pending.clear()
            return null
          }

          override fun onError(webSocket: WebSocket, error: Throwable) {
            if (!opened.isDone) opened.completeExceptionally(error)
            pending.values.forEach { it.completeExceptionally(error) }
            pending.clear()
          }
        }
        HttpClient.newHttpClient()
          .newWebSocketBuilder()
          .connectTimeout(Duration.ofSeconds(10))
          .buildAsync(URI.create(wsUrl), listener)
        val ws = opened.get(10, TimeUnit.SECONDS)
        return CdpSession(ws, pending, nextId)
      }
    }
  }
}
