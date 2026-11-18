# 上架商店（IDEA / VS Code）

本地 `releases/` 安装包可以给别人用；要进商店搜索，需要你本人注册并发布。

## VS Code Marketplace

1. 打开 [创建 Publisher](https://marketplace.visualstudio.com/manage/publishers/)（微软账号登录）
2. Publisher **ID** 建议与 `vscode/package.json` 里的 `"publisher": "huaxin"` 一致（不一致就改 JSON）
3. Azure DevOps 创建 PAT：Organization = **All accessible organizations**，Scope = **Marketplace → Manage**
4. 本机发布：

```powershell
cd vscode
$env:VSCE_PAT = "<你的 Azure DevOps PAT>"
npm run publish:vscode
```

发布后在 [Manage Publishers](https://marketplace.visualstudio.com/manage) 查看审核状态。

## JetBrains Marketplace（IDEA）

1. 打开 [JetBrains Marketplace 作者页](https://plugins.jetbrains.com/author/me) 登录
2. 创建 [Permanent Token](https://plugins.jetbrains.com/author/me/tokens)
3. 本机发布：

```powershell
cd idea
$env:JETBRAINS_MARKETPLACE_TOKEN = "<你的 JetBrains Token>"
.\gradlew.bat publishPlugin
```

也可在网页上传 `idea/build/distributions/beibagu-*.zip`：  
[Upload plugin](https://plugins.jetbrains.com/plugin/upload)

首次上架通常需要人工审核（可能数小时到数天）。

## 把令牌给我代发

把下面两项发到聊天（发完建议立刻轮换）：

- `VSCE_PAT=...`
- `JETBRAINS_MARKETPLACE_TOKEN=...`

并确认 Publisher ID（默认 `huaxin`）你已创建成功。
