# beibagu · 面试背题（Cursor / VS Code 插件）

在编辑器中间背程序员面试题：简答练习、艾宾浩斯间隔复习、题库管理、DeepSeek 详解/打分。

## 给普通用户（推荐）

下载仓库 `releases/` 里的 `.vsix`，在 **Cursor 或 VS Code** 里：

扩展面板 → **…** → **Install from VSIX…**

不要求同时安装 Cursor 和 VS Code，装你日常用的那一个就行。

## 给开发者（源码联接）

```powershell
cd vscode
.\install-to-cursor.ps1              # 自动检测：有 Cursor / VS Code 就装进去
.\install-to-cursor.ps1 -Target vscode
.\install-to-cursor.ps1 -Target cursor
```

需要：Windows + Node.js + 至少装了 Cursor 或 VS Code 之一。  
然后在对应编辑器里 **Reload Window**。

或打包 VSIX：

```powershell
npm run package
```

产物：`beibagu-0.1.59.vsix`。

## 打开方式

- 左侧活动栏 **面试背题**
- `Ctrl+Alt+B` / `F9`
- 命令面板：`beibagu: 打开背题面板`

## 数据目录

Cursor：

- `%APPDATA%\Cursor\User\globalStorage\huaxin.beibagu\quiz-state.json`
- `%APPDATA%\Cursor\User\globalStorage\huaxin.beibagu\custom-questions.json`

VS Code：

- `%APPDATA%\Code\User\globalStorage\huaxin.beibagu\quiz-state.json`
- `%APPDATA%\Code\User\globalStorage\huaxin.beibagu\custom-questions.json`

从旧版 `huaxin.shiroha-quiz-cursor` 升级时，会自动尝试拷贝进度。
