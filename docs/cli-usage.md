# P2P Chat CLI 使用说明

## 简介

这个项目的 CLI 是一个基于终端运行的交互式控制台（TUI），现在的主界面更偏“节点控制台”，而不是传统的命令行子命令工具。

启动后你会看到三个主视图：

- `Overview`：本机节点状态、监听地址、最近 peer、最近会话
- `Conversations`：会话列表、消息线程、消息输入框
- `Peers`：已知 peer 列表、地址信息、快捷操作

界面底部会持续显示状态栏和快捷键提示。

## 运行前提

- 已安装 Node.js
- 已安装 `pnpm`
- 已在项目根目录安装依赖
- 在交互式终端中运行

如果不是在交互式 TTY 中运行，程序会直接报错：

```text
Terminal UI requires an interactive TTY.
```

## 安装依赖

在项目根目录执行：

```bash
corepack enable
pnpm install
```

## 启动 CLI

在项目根目录执行：

```bash
pnpm --filter backend run chat:tui
```

启动成功后，界面会先显示启动状态；本地节点初始化完成后自动进入 `Overview`。

## 主界面说明

### `Overview`

这里是默认首页，主要用于查看节点概况和执行主动作：

- 查看本机 peer ID
- 查看监听地址
- 查看最近 peer 和最近会话
- 执行 `connect`、`refresh`、`quit`

### `Conversations`

这里用于聊天：

- 左侧是会话列表
- 右侧是当前会话的消息线程
- 底部是消息输入框

### `Peers`

这里用于查看和复用已知 peer：

- 左侧是 peer 列表
- 右侧是 peer 详情
- 下方可以执行 `open conversation` 或 `connect`

## 基本操作

### 1. 切换主视图

使用 `Left` / `Right` 在 `Overview`、`Conversations`、`Peers` 之间切换。

### 2. 打开连接框

在 `Overview` 中默认选中 `connect`，按回车即可打开连接输入框。

也可以在 `Peers` 视图中选中某个 peer 后执行 `connect`。

示例 multiaddr：

```text
/ip4/127.0.0.1/tcp/15002/ws/p2p/12D3KooWremote
```

输入后按回车连接，连接成功后会自动跳转到对应会话。

### 3. 发送消息

进入 `Conversations` 视图后：

1. 使用 `Up` / `Down` 选择会话
2. 按 `Tab` 把焦点切到消息输入框
3. 输入消息并按回车发送

如果消息为空，状态栏会提示：

```text
Message cannot be empty.
```

如果当前没有选中会话，状态栏会提示：

```text
Select a conversation first.
```

### 4. 从已知 peer 打开会话

在 `Peers` 视图中：

1. 使用 `Up` / `Down` 选择 peer
2. 按 `Tab` 切换到操作区
3. 用 `Left` / `Right` 选择动作
4. 按回车执行

### 5. 刷新数据

按 `Ctrl+R` 手动刷新 peer 和会话数据。

### 6. 退出程序

按 `Ctrl+C` 退出程序。

## 快捷键

| 按键 | 作用 |
| --- | --- |
| `Left` / `Right` | 切换主视图 |
| `Tab` | 在当前视图内切换焦点 |
| `Up` / `Down` | 移动当前列表选择 |
| `Enter` | 提交当前动作或输入 |
| `Esc` | 关闭连接框或退出输入焦点 |
| `Ctrl+R` | 刷新数据 |
| `Ctrl+C` | 退出程序 |

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
CHAT_DATA_DIR=./tmp/chat-data pnpm --filter backend run chat:tui
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
CHAT_P2P_LISTEN=/ip4/127.0.0.1/tcp/15002/ws pnpm --filter backend run chat:tui
```

多地址示例：

```bash
CHAT_P2P_LISTEN=/ip4/127.0.0.1/tcp/15002/ws,/ip4/127.0.0.1/tcp/15003/ws pnpm --filter backend run chat:tui
```

## 最小使用示例

### 终端 A

```bash
CHAT_P2P_LISTEN=/ip4/127.0.0.1/tcp/15002/ws pnpm --filter backend run chat:tui
```

记下 `Overview` 中显示的 peer ID，拼成完整 multiaddr：

```text
/ip4/127.0.0.1/tcp/15002/ws/p2p/<终端A的peerId>
```

### 终端 B

```bash
CHAT_P2P_LISTEN=/ip4/127.0.0.1/tcp/15003/ws pnpm --filter backend run chat:tui
```

然后：

1. 切到 `Overview`
2. 直接按回车打开连接框
3. 输入终端 A 的 multiaddr
4. 回车连接
5. 切到 `Conversations` 发送消息

连接成功后，终端 A 会收到新消息提示。

## 常见问题

### 为什么启动后不能立刻发消息？

因为需要先有一个会话。最常见的做法是先连接到另一个节点，连接成功后会自动创建会话。

### 为什么普通字母不会触发全局命令？

因为新的交互模型是“焦点驱动”的。普通字符只会在输入框聚焦时进入文本，不再承担全局命令职责。

### 为什么连接时报 `Multiaddr is required.`？

因为连接框中直接回车了，但还没有输入目标地址。

### 为什么要在交互式终端里运行？

这个 CLI 依赖终端输入事件和全屏交互渲染，所以不能在非交互环境中正常工作。
