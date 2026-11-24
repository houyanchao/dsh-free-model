# dsh-free-model

DeepSeek Harness 的 Kilo 免费模型插件。启用后，左侧栏会出现「免费模型」入口，原生模型选择器会显示「免费模型」分组。目录和对话请求都走 Kilo 官方匿名 API，无需登录或填写 API Key。

插件只列出 Kilo 明确标记为免费且价格为零的文本模型。模型上下线与匿名额度以 Kilo 为准，遇到限流时可以等待后重试。云端推理由 Kilo 提供，对话内容会发往 Kilo。

![DSH 免费模型管理页，显示模型可用性、检测耗时和开关](docs/images/free-models.png)

## 在自研 DSH 客户端安装

在顶部开发菜单选择「本地插件调试」→「导入本地插件…」，选择项目目录。如果插件已导入但处于关闭状态，在左侧「插件」→「已安装」中打开 `@houyanchao/dsh-free-model` 的开关。

也可用目标客户端自己的 DSH 环境链接项目目录。

```sh
dsh plugin --profile web add "link:/absolute/path/to/dsh-free-model"
```

包名为 `@houyanchao/dsh-free-model`，本地加载条目和 Provider ID 都是 `dsh-free-model-kilo`。

## 管理模型

打开左侧「免费模型」查看当前的 Kilo 免费模型。模型默认开启。关闭后，它会从新选项中消失，仍可以在管理页重新开启。开关状态按 DSH profile 保存在本机，重新启动后仍然有效。已有会话保留自己选中的模型。

点「检测可用性」会从当前 DSH 的网络出口，给每个模型发一条固定的文本测试请求。收到正常文本回复时标为「可用」，测试失败时标为「不可用」并显示原因。请求耗时以毫秒显示，超过时限则显示「超时」。标签反映该次检测的结果，显示开关仍可单独控制。检测请求计入 [Kilo 匿名请求额度](https://kilo.ai/docs/gateway/authentication#anonymous-access)。

## 开发

插件无需构建和安装额外依赖，支持文本流和模型目录声明的工具调用能力。管理页面适用于 DSH 的 Web 界面和使用它的桌面客户端。

## 许可证

Copyright © 2026 houyanchao。使用 [GPL-3.0-or-later](LICENSE) 许可证。
