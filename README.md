# beibagu · 面试背题

<p align="center"><b>IntelliJ IDEA</b></p>
<p align="center">
  <img src="docs/idea.png" alt="IntelliJ IDEA 版" width="100%" />
</p>
<p align="center"><b>VS Code / Cursor</b></p>
<p align="center">
  <img src="docs/vscode.png" alt="VS Code / Cursor 版" width="100%" />
</p>

**程序员上班摸鱼神器：刷八股文、背面试题。**  
IDEA / Cursor / VS Code **编辑器插件**，**免费开源**。

在编辑器里直接练：简答练习 · 错题强化 · 艾宾浩斯间隔复习 · 题库导入导出 · DeepSeek 详解 / 打分

开源地址：https://gitee.com/gooooooooo/beibagu

## 下载安装包

见仓库 [`releases/`](./releases/) 目录，或 [Releases 页面](https://gitee.com/gooooooooo/beibagu/releases)：

| 平台 | 文件 | 安装方式 |
|---|---|---|
| IntelliJ IDEA | `beibagu-idea-0.1.64.zip` | Settings → Plugins → 齿轮 → **Install Plugin from Disk…** |
| Cursor / VS Code | `beibagu-vscode-0.1.59.vsix` | 扩展面板 → **Install from VSIX…** |

安装后重启 IDE。打开方式：

- IDEA：右侧工具窗口「面试背题」，或 `Ctrl+Alt+B`
- Cursor / VS Code：左侧「面试背题」，或 `Ctrl+Alt+B` / `F9`

## 仓库结构

```
beibagu/
├── idea/       # IntelliJ IDEA 插件源码（Gradle）
├── vscode/     # Cursor / VS Code 插件源码
├── releases/   # 可直接安装的打包产物
├── LICENSE     # MIT
└── README.md
```

## 功能概览

- 内置 Java 面试核心题库（可按分类筛选）
- 三种模式：练习 / 错题强化 / 艾宾浩斯复习（7 档质量 ↔ 7 档间隔）
- 导入、导出题库 JSON；本地持久化进度
- DeepSeek 详解、打分（Chrome CDP 自动写入聊天框并发送）

## 本地开发

### IDEA 插件

需要 JDK 17+：

```powershell
cd idea
.\gradlew.bat buildPlugin
```

产物：`idea/build/distributions/beibagu-*.zip`

### VS Code / Cursor 插件

普通用户装 `releases/` 里的 `.vsix` 即可（Cursor / VS Code 都行，不必装另一款编辑器）。

开发调试（把源码联接到本机扩展目录）：

```powershell
cd vscode
.\install-to-cursor.ps1              # 自动装到已安装的 Cursor 和/或 VS Code
.\install-to-cursor.ps1 -Target vscode
npm run package                      # 打出 vscode/beibagu-*.vsix
```

## 题库说明

内置题库整理自「二哥的 Java 进阶之路 / 面渣逆袭」等公开面试资料，**仅供个人学习**。商业使用请自行确认版权。

## 联系方式

- 邮箱：445446974@qq.com
- 微信：B2951057

## 打赏支持

插件免费，八股也免费，但我的咖啡和头发暂时还没开源。

如果你用它摸鱼刷题、面试前突击、甚至成功忽悠过面试官——可以考虑扫码请我喝杯咖啡，让我继续和精神状态稳定的 Bug 斗智斗勇。

不打赏也完全 OK。点个 Star、提个 Issue、顺手分享给同事，都算给我的精神股东分红。

（未成年人请先问家长；打赏自愿，概不退款，也不附赠 Offer。）

| 支付宝 · 请作者续命 | 微信 · 请作者续命 |
|:---:|:---:|
| <img src="docs/donate-alipay.jpg" alt="支付宝收款码" width="240" /> | <img src="docs/donate-wechat.jpg" alt="微信收款码" width="240" /> |

## License

[MIT](./LICENSE)
