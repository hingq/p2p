# P2P Chat CLI 使用说明

## 简介

这个项目的 CLI 不是传统的“子命令 + 参数”工具，而是一个在终端中运行的交互式聊天界面（TUI）。

启动后，你会看到：

- 顶部状态区：显示本机 peer ID、监听地址、当前会话和状态信息
- 左侧会话区：显示当前已有会话
- 右侧消息区：显示当前会话消息
- 底部输入区：显示快捷键提示和当前输入内容

## 运行前提

- 已安装 Node.js 和 npm
- 在交互式终端中运行
- 已在项目根目录安装依赖

如果不是在交互式 TTY 中运行，程序会直接报错：

```text
Terminal UI requires an interactive TTY.
```

## 安装依赖

在项目根目录执行：

```bash
./install.sh
```

如果你已经装过依赖，也可以直接启动。

## 启动 CLI

在项目根目录执行：

```bash
npm --workspace backend run chat:tui
```

启动成功后，界面会初始化本地节点，并在状态栏中显示当前 peer ID 和监听地址。

## 基本操作

### 1. 连接到其他节点

按 `Ctrl+O` 进入连接模式，然后输入目标节点的 multiaddr，回车确认。

示例：

```text
/ip4/127.0.0.1/tcp/15002/ws/p2p/12D3KooWremote
```

连接成功后，程序会自动创建对应会话并切回消息输入模式。

### 2. 切换会话

使用 `Up` 和 `Down` 在左侧会话列表中切换当前会话。

### 3. 发送消息

确保当前处于消息输入模式，在底部直接输入内容后按回车发送。

如果当前没有选中会话，程序会提示：

```text
Select a conversation first.
```

如果消息为空，程序会提示：

```text
Message cannot be empty.
```

### 4. 刷新数据

按 `Ctrl+R` 手动刷新会话和 peer 信息。

### 5. 退出程序

按 `Ctrl+Q` 退出。

也可以使用终端常见的中断键 `Ctrl+C` 退出。

## 快捷键

| 按键 | 作用 |
| --- | --- |
| `Ctrl+O` | 进入连接模式 |
| `Ctrl+R` | 刷新数据 |
| `Ctrl+Q` | 退出程序 |
| `Tab` | 在连接输入和消息输入之间切换 |
| `Esc` | 取消连接模式并清空连接输入 |
| `Up` / `Down` | 切换当前会话 |
| `Enter` | 提交当前输入 |
| `Backspace` | 删除当前输入中的最后一个字符 |

## 环境变量

CLI 支持以下环境变量：

### `CHAT_DATA_DIR`

用于指定本地数据目录。

默认值：

```text
./.data
```

示例：

```bash
CHAT_DATA_DIR=./tmp/chat-data npm --workspace backend run chat:tui
```

### `CHAT_P2P_LISTEN`

用于指定 libp2p 的监听地址。

默认值：

```text
/ip4/127.0.0.1/tcp/0/ws
```

可以使用逗号分隔多个监听地址。

示例：

```bash
CHAT_P2P_LISTEN=/ip4/127.0.0.1/tcp/15002/ws npm --workspace backend run chat:tui
```

多地址示例：

```bash
CHAT_P2P_LISTEN=/ip4/127.0.0.1/tcp/15002/ws,/ip4/127.0.0.1/tcp/15003/ws npm --workspace backend run chat:tui
```

## 最小使用示例

下面是本地开两个终端互联测试的最小流程。

### 终端 A

```bash
CHAT_P2P_LISTEN=/ip4/127.0.0.1/tcp/15002/ws npm --workspace backend run chat:tui
```

记下界面顶部显示的 peer ID，拼成完整 multiaddr，格式如下：

```text
/ip4/127.0.0.1/tcp/15002/ws/p2p/<终端A的peerId>
```

### 终端 B

```bash
CHAT_P2P_LISTEN=/ip4/127.0.0.1/tcp/15003/ws npm --workspace backend run chat:tui
```

然后：

1. 按 `Ctrl+O`
2. 输入终端 A 的 multiaddr
3. 按回车连接
4. 直接输入消息并回车发送

连接成功后，终端 A 会收到新消息提示。

## 常见问题

### 为什么启动后不能立刻发消息？

因为需要先有一个会话。最常见的做法是先通过 `Ctrl+O` 连接到另一个节点，连接成功后会自动创建会话。

### 为什么输入 `q`、`r`、`c` 不会触发退出或刷新？

只有按下组合键 `Ctrl+Q`、`Ctrl+R`、`Ctrl+O` 才会触发对应动作。单独输入这些字母时，它们会被当作普通文本写入输入框。

### 为什么连接时报 `Multiaddr is required.`？

因为连接模式下直接回车了，但还没有输入目标节点地址。

### 为什么要在交互式终端里运行？

这个 CLI 依赖终端按键事件、raw mode 和全屏界面渲染，所以不能在非交互环境中正常工作。
