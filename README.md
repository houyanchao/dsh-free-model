# Open Model

为 DSH 提供免费模型，让 DSH 直接使用你的 ChatGPT 套餐额度。

## 安装

在终端运行以下命令，从 npm 安装插件并启动 DeepSeek Harness。

```bash
dsh plugin --profile web add dsh-open-model
dsh web
```

升级时运行以下命令。

```bash
dsh plugin --profile web update dsh-open-model
```

通过源码运行 DSH 且终端提示 `command not found: dsh` 时，请在 DSH 源码仓库根目录执行上述命令，并将开头的 `dsh` 换成 `pnpm dsh`，例如 `pnpm dsh plugin --profile web add dsh-open-model`。

如果已安装旧包 `@houyanchao/dsh-free-model`，请先运行 `dsh plugin --profile web remove @houyanchao/dsh-free-model`，再安装新包。已有对话的模型标识和本地模型开关设置会沿用。

## 管理模型

在左侧打开「OpenModel」，选择「免费模型」或「ChatGPT」。插件先读取 `models.json`，只按配置顺序展示其中的模型，再向所选来源核对可用性。

- **免费模型** 可直接使用 Kilo 目录中仍然免费的模型，无需账号或 API Key。使用时，对话会发送给 Kilo，匿名额度取决于 Kilo。模型下架、过期、改为收费或目录暂时无法核对时，对应模型会保留在管理页并置灰。
- **ChatGPT** 使用已有套餐的额度。未登录时，详情页只显示登录入口。请在本机 macOS 或 Windows 版 DSH 中点「使用 ChatGPT 登录」，在浏览器完成登录后返回 DSH。登录后可以查看配置的模型，授权使用套餐额度后即可开启可用模型。套餐未提供或暂时无法核对的模型会置灰。切换账号后按新账号的套餐重新核对。

按名称或模型 ID 搜索，或用筛选框查看「已开启」「已隐藏」或「不可用」的模型。可用模型默认开启，只有可用且已开启的模型会出现在对话的模型选择器中。关闭开关会隐藏该模型，已有对话保留原先选定的模型。Kilo 按 DSH profile 保存开关，ChatGPT 按账号分别保存。

在对话输入框打开「网页搜索」，模型就可以按需搜索。这个选择按对话保存，在「OpenModel (ChatGPT 套餐)」和「OpenModel (免费模型)」之间切换时会沿用。ChatGPT 可以使用套餐自带的搜索，免费模型需要支持工具调用，且当前 DSH 会话有可用的搜索服务。关闭网页搜索后，仍可通过 DSH 的网页读取工具打开你提供的链接。

在对话框选中「OpenModel (免费模型)」分组下的模型后，再点一次模型按钮。支持调节的模型会显示「推理等级」，可以选择该模型开放的档位或思考开关。

在「免费模型」标签页点「测速」会从当前 DSH 的网络出口，给通过目录核对的每个模型发一条固定的文本测试请求。收到正常文本回复时标为「可用」，测试失败时标为「不可用」并显示原因。请求耗时以毫秒显示，超过时限则显示「超时」。标签反映该次检测的结果，显示开关仍可单独控制。检测请求计入 [Kilo 匿名请求额度](https://kilo.ai/docs/gateway/authentication#anonymous-access)。

插件会检查 npm 的 `latest` 版本。新版比当前安装版本新且已发布满 24 小时后，侧栏的「OpenModel」入口旁会显示「更新」，管理页顶部也会显示「有新版本」。点「查看更新」可打开插件详情。

## 开发

使用 Node.js 22.19+（22.x）或 24+，在项目目录安装依赖、构建并运行测试。

```sh
npm ci
npm run build
npm test
```

本地调试时，构建完成后可将项目链接到目标 DSH 环境。

```sh
dsh plugin --profile web add "link:/absolute/path/to/dsh-open-model"
```

Kilo 沿用 Provider ID `dsh-free-model-kilo`。内置 ChatGPT 使用 `dsh-open-model-chatgpt`，可与独立插件 `dsh-use-chatgpt` 并存。Open Model 的账号记录保存在当前 DSH 主目录的 `dsh-open-model/chatgpt/` 下。

宿主与客户端入口生成在 `dist/`。在 macOS 上构建需要 Xcode 命令行工具，构建会同时生成兼容 Apple Silicon 和 Intel 的钥匙串辅助程序。制作供 macOS 和 Windows 共用的 npm 包时，请在 macOS 上运行 `npm pack`。

### 维护模型清单

插件根目录的 [models.json](models.json) 是一个对象，每个顶层键都是适配器标识。`kilo` 对应 Kilo 免费模型，`chatgpt` 对应 ChatGPT 套餐。为已有来源添加模型时，编辑该键下的 `models` 数组。要接入新的提供方，还需在插件中实现并注册与新键对应的适配器。

| 来源字段 | 用途 |
| --- | --- |
| `name` | 对话模型选择器中的分组名，例如 `OpenModel (免费模型)`。 |
| `models` | 该来源的模型列表。添加、删除或移动条目即可调整候选模型及其展示顺序。 |

修改这份 JSON 后，重启 DSH 即可载入新配置。管理页的「刷新」会按已载入的配置重新核对提供方目录。

| 模型字段 | 用途 |
| --- | --- |
| `id` | 必填，使用提供方的模型 ID，同一来源内唯一。 |
| `name` | 可选，覆盖模型显示名称。 |
| `inputModalities` | 允许的输入类型。可填 `["text"]` 或 `["text", "image"]`。 |
| `reasoningEfforts` | 允许用户选择的推理档位 ID。填空数组可关闭档位选择。 |
| `webSearch` | 布尔值。设为 `false` 可关闭该模型的网页搜索。设为 `true` 时仍需满足相应来源的搜索条件。 |
| `contextWindow`、`maxCompletionTokens` | 正整数，分别限制上下文窗口和单次最大输出的 token 数。 |

能力字段均可省略。提供方声明了输入类型或推理档位时，插件只开放配置和提供方都支持的选项。提供方和配置都给出 token 上限时，使用较小值。如果为 Kilo 模型指定了输出上限，插件会核对该模型能否接受输出长度参数，或其自身的上限是否已满足配置。两项都无法确认时，该模型会置灰。

## 许可证

Copyright © 2026 houyanchao。作者编写的插件代码采用 [GPL-3.0-or-later](LICENSE) 许可证。

ChatGPT 登录和对话代码移植自 `dsh-use-chatgpt` 的独立实现，通过 OpenAI JavaScript SDK 调用 Responses API。插件保留了原项目随附的 DevKit 许可证，第三方依赖沿用各自的许可证。[第三方声明](notices/THIRD_PARTY_NOTICES.md) · [DevKit 许可证](notices/LICENSE)

用户使用自己的 ChatGPT 套餐。这项登录接入功能须免费向用户提供。登录按钮中的 ChatGPT 标识使用 OpenAI 提供的品牌素材。[Sign in with ChatGPT 条款](https://openai.com/policies/sign-in-with-chatgpt-terms/) · [OpenAI 品牌指南](https://openai.com/brand/)
