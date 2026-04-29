# P2P Chat CLI 使用说明

## 简介

这个 CLI 是一个命令式交互控制台。启动后会显示本机 peer ID、监听地址、最近日志和一个输入提示符：

```text
>
```

输入 `/` 开头的是命令；选择聊天对象后，直接输入普通文本并回车就是发送消息。

键入 `/` 会显示可用命令提示；继续输入会过滤提示，例如 `/co` 只显示 `/connect` 和 `/conversations`。按 `Tab` 会补全当前第一条匹配命令。

## 启动

在项目根目录执行：

```bash
pnpm --filter backend run chat:tui
```

如果不是在交互式 TTY 中运行，程序会报错：

```text
Terminal UI requires an interactive TTY.
```

## 命令

| 命令 | 作用 |
| --- | --- |
| `/help` | 显示帮助 |
| `/connect <multiaddr>` | 连接 peer，并把它设为当前聊天对象 |
| `/peers` | 列出已知 peer |
| `/conversations` | 列出会话 |
| `/chat <peerId>` | 切换当前聊天对象 |
| `/messages [peerId]` | 显示当前或指定 peer 的最近消息 |
| `/refresh` | 刷新 peer 和会话数据 |
| `/quit` 或 `/exit` | 退出 |

## 连接和聊天

示例 multiaddr：

```text
/ip4/127.0.0.1/tcp/15002/ws/p2p/12D3KooWremote
```

连接：

```text
> /connect /ip4/127.0.0.1/tcp/15002/ws/p2p/12D3KooWremote
```

连接成功后，直接输入消息：

```text
> hello from terminal
```

切换已有会话：

```text
> /chat 12D3KooWremote
```

## 环境变量

### `CHAT_DATA_DIR`

指定本地数据目录。

默认值：

```text
./.data
```

示例：

```bash
CHAT_DATA_DIR=./tmp/chat-data pnpm --filter backend run chat:tui
```

### `CHAT_P2P_LISTEN`

指定 libp2p 监听地址。

默认值：

```text
/ip4/127.0.0.1/tcp/0/ws
```

示例：

```bash
CHAT_P2P_LISTEN=/ip4/127.0.0.1/tcp/15002/ws pnpm --filter backend run chat:tui
```

多个地址用逗号分隔：

```bash
CHAT_P2P_LISTEN=/ip4/127.0.0.1/tcp/15002/ws,/ip4/127.0.0.1/tcp/15003/ws pnpm --filter backend run chat:tui
```

## 最小使用示例

终端 A：

```bash
CHAT_P2P_LISTEN=/ip4/127.0.0.1/tcp/15002/ws pnpm --filter backend run chat:tui
```

记下终端 A 显示的 peer ID，拼成完整地址：

```text
/ip4/127.0.0.1/tcp/15002/ws/p2p/<终端A的peerId>
```

终端 B：

```bash
CHAT_P2P_LISTEN=/ip4/127.0.0.1/tcp/15003/ws pnpm --filter backend run chat:tui
```

连接终端 A：

```text
> /connect /ip4/127.0.0.1/tcp/15002/ws/p2p/<终端A的peerId>
```

发送消息：

```text
> hello
```

终端 A 收到消息后，可以用 `/chat <终端B的peerId>` 切到对应会话并直接回复。
