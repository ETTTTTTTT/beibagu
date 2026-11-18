package com.huaxin.shirohaquiz

import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.content.ContentFactory

class QuizToolWindowFactory : ToolWindowFactory, DumbAware {
  override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
    toolWindow.stripeTitle = "面试背题"
    toolWindow.setTitle("面试背题")
    val panel = QuizBrowserPanel(project)
    Disposer.register(toolWindow.disposable, panel)
    val content = ContentFactory.getInstance().createContent(panel.component, "", false)
    content.setDisposer(panel)
    toolWindow.contentManager.addContent(content)
  }
}
