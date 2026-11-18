package com.huaxin.shirohaquiz

import com.google.gson.JsonObject
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.PathManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.ui.jcef.JBCefBrowserBase
import com.intellij.ui.jcef.JBCefJSQuery
import org.cef.browser.CefBrowser
import org.cef.browser.CefFrame
import org.cef.handler.CefLoadHandlerAdapter
import java.awt.BorderLayout
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import javax.swing.JComponent
import javax.swing.JPanel
import kotlin.io.path.createDirectories
import kotlin.io.path.exists

class QuizBrowserPanel(project: Project) : Disposable {
  private val service = QuizService(project)
  private val browser: JBCefBrowser = JBCefBrowser()
  private val root = JPanel(BorderLayout())
  private val jsQuery: JBCefJSQuery
  private val webRoot: Path

  val component: JComponent get() = root

  init {
    webRoot = prepareWebRoot()
    jsQuery = JBCefJSQuery.create(browser as JBCefBrowserBase)
    jsQuery.addHandler { request ->
      service.handleMessage(
        request,
        reply = { msg -> postToWeb(msg) },
        reloadUi = { reload() }
      )
      JBCefJSQuery.Response("ok")
    }
    Disposer.register(this, browser)

    browser.jbCefClient.addLoadHandler(object : CefLoadHandlerAdapter() {
      override fun onLoadEnd(browser: CefBrowser?, frame: CefFrame?, httpStatusCode: Int) {
        if (frame?.isMain != true) return
        injectBridge()
        postToWeb(service.buildStatePayload())
      }
    }, browser.cefBrowser)

    root.add(browser.component, BorderLayout.CENTER)
    reload()
  }

  fun reload() {
    browser.loadURL(webRoot.resolve("index.html").toUri().toString())
  }

  private fun injectBridge() {
    val script = """
      window.__SHIROHA_IDEA_POST__ = function(json) {
        ${jsQuery.inject("json")}
      };
      window.__SHIROHA_BRIDGE_READY__ = true;
    """.trimIndent()
    browser.cefBrowser.executeJavaScript(script, browser.cefBrowser.url, 0)
  }

  private fun postToWeb(msg: JsonObject) {
    val json = msg.toString()
    val script =
      "try{ var __d = $json;" +
        " if(window.__SHIROHA_IDEA_ON_HOST__) window.__SHIROHA_IDEA_ON_HOST__(__d);" +
        " window.dispatchEvent(new MessageEvent('message',{data:__d}));" +
        " }catch(e){console.error(e);}"
    browser.cefBrowser.executeJavaScript(script, browser.cefBrowser.url, 0)
  }

  private fun prepareWebRoot(): Path {
    val dir = Path.of(PathManager.getSystemPath(), "shiroha-quiz-webview").createDirectories()
    listOf("index.html", "webview.js", "webview.css", "questions.json", "icon.svg").forEach { name ->
      val res = javaClass.getResourceAsStream("/webview/$name") ?: return@forEach
      res.use { input ->
        Files.copy(input, dir.resolve(name), StandardCopyOption.REPLACE_EXISTING)
      }
    }
    if (!dir.resolve("index.html").exists()) {
      throw IllegalStateException("webview/index.html missing in plugin resources")
    }
    return dir
  }

  override fun dispose() {
    // browser disposed via Disposer
  }
}
