# beibagu · 面试背题（IntelliJ IDEA 插件）

在 IntelliJ IDEA 里背程序员面试题：简答练习、艾宾浩斯间隔复习、题库管理、DeepSeek 详解/打分。

## 功能

- 内置 Java 面试核心题库（可按分类筛选）
- 练习 / 错题强化 / 艾宾浩斯复习（7 档质量 ↔ 7 档间隔）
- 导入 / 导出题库 JSON
- DeepSeek 详解、打分（Chrome CDP 自动填入并发送）
- 进度本地持久化

## 安装

1. 下载 Releases 中的 `beibagu-*.zip`（或自行打包）
2. IDEA → **Settings → Plugins → 齿轮 → Install Plugin from Disk…**
3. 选择 zip → 重启 IDEA
4. 右侧工具窗口 **面试背题**，或快捷键 `Ctrl+Alt+B`，或菜单 **Tools → 打开面试背题**

兼容 IDEA 2024.1+（含 2026.1 / build 261）。

## 本地开发 / 打包

需要 **JDK 17+**：

```powershell
cd beibagu
.\gradlew.bat buildPlugin
```

产物：`build/distributions/beibagu-<version>.zip`

## 题库说明

内置题库整理自「二哥的 Java 进阶之路 / 面渣逆袭」等公开面试资料，仅供个人学习。商业使用请自行确认版权。

导入格式示例：

```json
{
  "meta": { "title": "我的题库", "questionCount": 1 },
  "questions": [
    {
      "id": "demo-1",
      "question": "什么是 Java？",
      "answer": "……",
      "categories": ["Java SE / Java 概述"]
    }
  ]
}
```

## 数据目录

学习进度与自定义题库存于 IDEA 配置目录下的 `shiroha-quiz/`（与 Cursor 版数据不互通）。

## License

[MIT](./LICENSE)
