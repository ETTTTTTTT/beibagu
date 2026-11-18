# beibagu · 面试背题（VS Code 插件）

在 VS Code 里背程序员面试题：简答练习、艾宾浩斯间隔复习、题库管理、DeepSeek 详解/打分。

## 给普通用户（推荐）

下载仓库 `releases/` 里的 `.vsix`，在 VS Code 中：

扩展面板 → **…** → **Install from VSIX…**

## 给开发者（源码联接）

```powershell
cd vscode
.\install-to-vscode.ps1
```

需要：Windows + 已安装 VS Code。  
然后在 VS Code 里 **Reload Window**。

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

- `%APPDATA%\Code\User\globalStorage\huaxin.beibagu\quiz-state.json`
- `%APPDATA%\Code\User\globalStorage\huaxin.beibagu\custom-questions.json`

## License

[MIT](../LICENSE)
