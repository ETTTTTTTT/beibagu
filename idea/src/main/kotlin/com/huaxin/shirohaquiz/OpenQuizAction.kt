package com.huaxin.shirohaquiz

import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.wm.ToolWindowManager

class OpenQuizAction : AnAction(), DumbAware {
  override fun actionPerformed(e: AnActionEvent) {
    val project = e.project ?: return
    val tw = ToolWindowManager.getInstance(project).getToolWindow("ShirohaQuiz") ?: return
    tw.show()
    tw.activate(null, true)
  }
}
