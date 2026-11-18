# beibagu · 面试背题（Cursor / VS Code 插件）

在编辑器中间背程序员面试题：简答练习、艾宾浩斯间隔复习、题库管理、DeepSeek 详解/打分。

## 安装到 Cursor

```powershell
cd d:\huaxin\beibagu-vscode
.\install-to-cursor.ps1
```

然后命令面板执行 **Reload Window**。

或打包 VSIX：

```powershell
npm run package
```

产物：`beibagu-0.1.59.vsix`，用 **Install from VSIX…** 安装。

## 打开方式

- 左侧活动栏 **面试背题**
- `Ctrl+Alt+B` / `F9`
- 命令面板：`beibagu: 打开背题面板`

## 数据目录

- `%APPDATA%\Cursor\User\globalStorage\huaxin.beibagu\quiz-state.json`
- `%APPDATA%\Cursor\User\globalStorage\huaxin.beibagu\custom-questions.json`

从旧版 `huaxin.shiroha-quiz-cursor` 升级时，会自动尝试拷贝进度。
