# SeMa Headless Chat UX — 设计方案

> 状态：**阶段 1～4 已落地** — Chat + 流式 + 审批 UI + 模型/Key 设置；Terminal 仍为 PTY  
> 日期：2026-10-08  
> 范围：产品形态与架构；argv / 接入以 `src-tauri/src/headless/` 与下表为准  
>
> **已实现**：headless Chat、流式 `chat:chunk`、审批模式 auto/ask + `chat:permission`、设置页（鉴权/模型/Key 配置代理）、§5.5 接入表实测稿。  
> **后续可选**：各 CLI ask 模式协议差异打磨、流式 JSON 解析更准、PTY 高级模式去留。

## 1. 背景与问题

SeMa 当前是 **多 AI CLI 的 PTY 套壳**（xterm.js + portable-pty）：用户直接面对各 CLI 的 Ink/TUI。

### 1.1 套壳带来的交互成本

- 光标、IME、滚动、选区、快捷键与各家 TUI 冲突，需持续兼容
- 续聊 / 会话 id / 产物依赖磁盘旁路探测，脆弱且难理解
- 工具审批、`/clear`、菜单等行为因 CLI 而异，壳层难以统一
- Win / Mac 的 PATH、spawn、shim 成本堆在「显示终端」这条路上
- 多分栏 = 多个窄终端，认知与操作成本高

**结论**：再打磨壳，主要是「少炸一点」；交互上限受 PTY/TUI 形态约束，难以变成真正友好的产品体验。

### 1.2 目标约束（讨论结论）

| 约束 | 含义 |
|------|------|
| **可以看不见终端** | 主路径用户面对 SeMa 自己的 Chat UI，而不是 xterm |
| **不接 SDK** | 不引入各厂商 / 各 CLI 的 SDK 或云 API 接入层（配置多、维护重） |
| **仍用本机 CLI** | 继续探测并调用已安装、已登录（或可配置）的本地可执行文件 |
| **全量兼容当前 AI CLI** | Chat / Headless 必须覆盖现有目录中的全部 AI 工具，而非只做某一个 |

一句话：**CLI 当引擎，SeMa 当交互面；通道用 headless/pipe；按 `cliId` 适配器覆盖全部已支持 AI CLI；不嵌 TUI，不接 SDK。**

### 1.3 必须覆盖的工具（与当前 `cli_detect` CATALOG 对齐）

下列 **AI CLI 均在范围内**，须具备 Headless Chat 适配路径（能力深浅可不同，但产品上不能「只支持其中一个」）：

| `cliId` | 标签 | 说明 |
|---------|------|------|
| `claude` | Claude Code | 必须支持 |
| `opencode` | OpenCode | 必须支持（文中配置示例常用它，**仅为举例**） |
| `kimi` | Kimi Code | 必须支持 |
| `cursor` | Cursor Agent | 必须支持 |
| `codex` | Codex | 必须支持 |
| `gemini` | Gemini | 必须支持 |
| `pi` | Pi | 必须支持 |

**不在 Chat 主路径内（保持现状语义）**：

| `cliId` | 标签 | 说明 |
|---------|------|------|
| `terminal` | Terminal | 系统 shell（Win `cmd` / Mac `$SHELL`）；无 AI 会话 / 无续聊 / 无产物。Chat 方案**不要求**把它改成气泡对话；若保留入口，仍可为真正的终端，或外置系统终端。 |

目录增减时：本方案的「全量列表」随 `cli_detect` CATALOG 更新；新增 AI CLI 须同步补适配器与接入表，不得只接 SDK 或只做单工具特例。

---

## 2. 路线对比

| 路线 | 做法 | 友好度 | 配置负担 | 说明 |
|------|------|--------|----------|------|
| A. 继续 PTY 套壳 | 修兼容、打磨 chrome | 低 | 低 | 当前路径；交互上限低 |
| B. **Headless + Chat UI** | 非交互参数 spawn CLI，抓输出渲染气泡 | 高 | 低 | **推荐**；满足「无终端 + 不接 SDK + 全 CLI」 |
| C. SDK / API | 直接调 Agent API | 最高 | 高 | 明确不做（当前约束） |
| D. 双模 | 默认 Chat；必要时外置/短暂 TTY | 高 | 中 | 作单工具能力缺口的兜底，非主路径 |
| E. IDE 插件 | 做进 VS Code / Cursor | — | — | 另一产品形态，本文不展开 |

### 2.1 推荐架构（逻辑）

```
用户输入（SeMa 聊天气泡 / 输入框）
  → 按 cliId 选择适配器
  → 组装该 CLI 的 headless argv（prompt / session / model / trust …）
  → 后台 spawn 本机 CLI（非交互）
  → 适配器解析 stdout/stderr（优先流式，否则整段）
  → 统一渲染：回复、工具卡片、产物、审批（若有）
  → 会话映射由 SeMa 持久化（cliSessionId 等）
```

共享层（所有 AI CLI 共用）：

- Chat UI、会话列表、未读/状态、产物面板骨架
- 探测：保留现有 `where` / `which` 等
- 统一「消息 / 工具调用 / 审批请求」前端模型

差异层（**每个 `cliId` 一个适配器**，禁止一套 argv 通吃）：

- headless 启动参数、流式/整段输出解析
- 续聊参数与 session 发现（可复用/演进现有 `resume/`）
- 模型/厂商列举与切换
- 信任/审批：自动 flag 或结构化协议
- 可选：把 Key/厂商写入**该 CLI 自己的**配置文件（配置代理，非 SDK）

---

## 3. 产品形态

### 3.1 主界面

- **项目（cwd）→ 选 CLI（上表全部 AI CLI）→ 会话列表 → 聊天气泡 + 输入框 + 产物**
- 不再以「分栏终端墙」为主路径
- 多任务：会话 tab / 卡片，而不是 N 个窄 xterm
- 顶栏 / 会话级：当前 `cliId`、厂商/模型（该 CLI 支持时）、运行状态

### 3.2 与当前能力的对应

| 当前（PTY） | Headless Chat |
|-------------|---------------|
| 栏内 xterm | 聊天气泡 + 流式/整段回复 |
| ↻ 续聊 | 会话列表 + 各 CLI 的 session / continue 等价参数 |
| 活跃脉冲 / 未读 | 会话级状态与通知（可沿用角标思路） |
| 栏内产物条 | 产物面板（文档 / 链接）；按 CLI 解析策略演进 |
| 同组多分栏 | 弱化或取消；需要并行时用多会话 |
| 多 CLI 切换 | 仍按目录选择引擎；交互面统一为 Chat |

### 3.3 明确降级 / 不做（主路径）

- **不**把各 CLI 的 Ink 交互式菜单原样嵌进 SeMa
- **不**以应用内 xterm 为 AI CLI 的默认交互
- 某一 CLI 某项能力暂时缺失：该能力降级或外置终端，**不影响**其他已适配 CLI 的 Chat 主路径
- 禁止「只做好一个 CLI、其余继续纯套壳」作为终态；分期落地时须有明确的全量达标计划

---

## 4. 交互能力边界

### 4.1 交互式菜单 vs 工具审批

| | CLI 原生 Ink 菜单（选文件、箭头菜单等） | 工具审批（允许跑命令 / 改文件） |
|--|------------------------------------------|--------------------------------|
| 纯 Headless | **基本不能**原样展示（无 TTY 则跳过或失败） | **可以有**，但 UI 由 SeMa 提供 |
| 含义 | 用 SeMa 控件替代，或该步降级 | 不等于「没有审批」 |

对**每一个** AI CLI 单独评估；不要用某一个（如 OpenCode）的能力代表全体。

### 4.2 审批三档（每 CLI 选档）

1. **自动批准**  
   启动即带信任类 flag（例如现有 Kimi `--yolo`；其他 CLI 用各自等价项）。无确认；实现简单，风险在用户侧。

2. **结构化协议（推荐，若该 CLI 支持）**  
   CLI 以 JSON/事件流声明「拟执行的工具」→ SeMa 显示允许/拒绝 → 经 stdin 或约定通道回写。

3. **混合兜底**  
   仅当该 CLI 必须 TTY 时短暂外置终端。作例外，不作默认。

**产品默认倾向**：有协议则走 2；无协议则对该 `cliId` 明确选 1 或标注能力限制——避免假装还能弹出 Ink 菜单。

### 4.3 流式与多轮

- 流式：按 CLI 输出能力；可先整段，再迭代流式
- 多轮：各 CLI 自己的 `--session` / `--continue` 等；SeMa 存映射，不接 SDK 会话服务
- **强制**：维护「每 CLI 一行」的接入表，禁止假设参数与输出格式通用

---

## 5. 厂商 / 模型 / Key（全 CLI；OpenCode 仅作举例）

### 5.1 原则

- **切换模型 / 厂商** ≠ 接 SDK；= SeMa 选择器 + 该 CLI 的 flag 或配置文件
- **在 SeMa 里填 Key** ≠ 接云厂商 SDK；= **配置代理**：写入**该引擎**已有配置（若该引擎以文件/环境变量管 Key）
- **授权登录（OAuth / `login`）** ≠ 接 SDK、≠ 在 SeMa 里嵌登录页；= 触发该 CLI 自己的登录流程，令牌仍存在 CLI 侧（见 §5.6）
- OpenCode、Claude Code、Cursor、Pi、Kimi、Codex、Gemini **同等对待**：各自适配，文档里点名某一工具只为举例

### 5.0 鉴权方式分型（先分清再做 UI）

| 类型 | 典型做法 | SeMa 怎么接 | 举例（示意，以接入表实测为准） |
|------|----------|-------------|------------------------------|
| **A. API Key / 配置文件** | 用户填 Key，写入引擎配置 | 配置代理表单（§5.3） | 部分 OpenCode 厂商、部分自建模型 |
| **B. 授权登录（浏览器 OAuth）** | CLI `login` → 打开系统浏览器 → 用户点允许 → CLI 本地存 token | 「登录」按钮触发 CLI login；**不**在 SeMa 内嵌 OAuth、不接官方 SDK | **Cursor Agent**、Claude Code 等常见账号登录 |
| **C. 仅 CLI 内交互登录** | 必须在 TTY 里完成、无稳定 `login`/浏览器通道 | 外置系统终端跑登录，或引导用户先在终端登录一次 | 个别引擎降级路径 |
| **D. 工作区信任（非账号）** | 启动 flag 跳过「是否信任此目录」 | 沿用/演进现有 `trust_args`（如 Cursor `--trust`） | 与账号登录 **不是同一件事** |

同一 `cliId` 可能同时有 B + D（先登录账号，再每次 spawn 带 trust），或 A 与 B 二选一（按厂商）。

### 5.2 模型与厂商切换（统一 UX，分 CLI 实现）

SeMa 提供统一的「模型 / 厂商」选择器 UI；背后按 `cliId` 分支：

1. **参数注入（首选）**  
   该 CLI 若支持 `--model` / `--provider` 等：会话或顶栏下拉 → 下次请求 argv 带上。

2. **写该 CLI 的配置文件**  
   无稳定 flag 时，写入其默认 model 配置。注意会话级 vs 全局默认、以及与 CLI 自身改配置的冲突。

3. **会话级记忆（体验优选）**  
   SeMa 持久化「本会话 + 本 cliId 使用的 provider/model」，只影响该会话后续请求。

4. **能力缺失**  
   若某 CLI 无法在 headless 下切换模型：选择器对该引擎禁用或只读显示「使用 CLI 默认」，并在接入表标注——**不**因此取消该 CLI 的 Chat 支持。

**列表来源**：读该 CLI 本机已配置/已可用列表，或调用其列举命令；**禁止**写死跨引擎通用模型名列表。

### 5.3 在 SeMa 中配置厂商与 Key（配置代理模式）

**可以做**，且符合「不接 SDK」；模式对所有「用本地配置管 Key」的引擎通用：

```
SeMa 设置页（按当前引擎 / cliId 切换表单）
  → 写入该 CLI 官方配置路径或其所认环境（Win / Mac 分别处理）
  → 之后 headless 启动该 CLI 直接使用
```

| | SeMa 写「该 CLI」配置 | 接各厂商 SDK |
|--|----------------------|--------------|
| SeMa 职责 | 按 cliId 的表单 + 读写配置 | API、协议、流式、工具调用… |
| Key 存放 | 落在该 CLI 惯用位置（推荐） | SeMa / SDK 自管 |
| 消息执行 | 仍 spawn 该 CLI | SeMa 直连 HTTP |
| 维护 | 跟随各 CLI 各自 schema | 爆炸式增长 |

**建议**：

- 设置 UI 按引擎分页或下拉（Claude / OpenCode / Kimi / Cursor / Codex / Gemini / Pi），字段与路径各适配器声明
- 打开时先读该引擎现有配置，支持编辑与追加，避免双配置互相覆盖
- 保留「打开该 CLI 配置目录」兜底
- 若某引擎属 **B/C 授权登录**（无文件 Key 或不宜由 SeMa 写 Key）：设置页以「登录 / 退出 / 状态」为主（§5.6），仍算「支持该 CLI」，而不是缺席
- 安全：Key 经 SeMa UI/内存；落盘与明文风险按平台与引擎惯例处理；**OAuth token 不由 SeMa 存储**，只触发 CLI 登录

**反例**：不要做成「一个万能多厂商网关」共用一套 Key 字段打给所有 CLI；必须按 `cliId` 隔离。

### 5.4 续聊与换模型

部分 CLI 将模型绑在 session 上。换模型可能是「同会话更新」或「需新开一轮」——**每个 cliId** 在接入表写清，并在 UI 上给出明确反馈。

### 5.5 接入表（2026-10-08 本机 `--help` / 命令实测稿）

实现代码：`headless/argv.rs`、`models.rs`、`config.rs`、`auth.rs`、`permission.rs`。未安装的引擎（kimi/codex/gemini）按公开 CLI 文档 + 既有 resume/trust 约定填写，标「待本机复测」。

| cliId | headless 入口 | 流式 | session/续聊 | 列模型 | 切模型 | 审批档 | 鉴权类型 | 登录/探测 | 配置代理（Key） | 工作区 trust | Win/Mac 差异 | 备注 |
|-------|---------------|------|--------------|--------|--------|--------|----------|-----------|-----------------|--------------|--------------|------|
| claude | `-p --verbose --output-format stream-json --include-partial-messages`；auto 加 `--dangerously-skip-permissions`；auto 时 stdin=`null` | `stream_event`→`content_block_delta` → `chat:chunk` | `--resume` / `-c`；resume/ 模块 | **无 `--list-models`**：读 `~/.claude/settings.json` env 映射 + 别名 sonnet/opus/haiku/fable | `--model` | auto=档1；ask=`--permission-prompts host` + stdin 档2 | B OAuth | `auth login` / `auth status` | 否（账号） | 无 | CREATE_NO_WINDOW（Win） | 无 partials 则整段到齐才显示 |
| opencode | `run --format json`；auto 加 `--auto` | JSONL 尽力抽 text | `-s` / `-c`；resume DB | `opencode models` | `-m provider/model` | auto=档1；ask=去掉 `--auto`（无稳定 host 协议） | A+B | `auth login` / `auth list` | **是**：`~/.config/opencode/opencode.json` provider.options | 无 | 配置路径 POSIX vs Win home | Key 脱敏展示 |
| kimi | `-p`；auto 靠 `trust_args --yolo` | 纯文本 chunk（可能整段缓冲） | `--session` / `--continue` | 无稳定列命令 | `--model`（若支持） | 档1（yolo）；ask 去掉 yolo | A/环境变量偏多 | 无稳定 login | 打开 `~/.kimi-code` | 无 | 待本机复测 | 本机未装 |
| cursor | `-p --output-format stream-json --stream-partial-output`；auto 加 `--force` | stream-json + partial | `--resume` / `--continue` | `cursor-agent models` | `--model` | auto=档1；ask=去掉 `--force` | **B** | `login` / `status` | 否 | `--trust` | 同左 | 账号 ≠ trust |
| codex | `exec`；可选 resume 子命令 | 纯文本/缓冲 | resume 约定见 resume/ | `--help` 弱 | `--model` | 档1 为主 | B 偏多 | `login`（若有） | 打开 `~/.codex` | 无 | 待本机复测 | 本机未装 |
| gemini | `-p`；auto `--yolo` | 纯文本 chunk | `--continue`（版本相关） | 弱 | `-m` | 档1；ask 去 yolo | B 偏多 | `auth` | 打开 `~/.gemini` | `--skip-trust` | 待本机复测 | 本机未装 |
| pi | `-p`；auto `--approve` | 纯文本 chunk | `--session` / `--continue` | `--list-models` 表 | `--model` / settings 默认 | 档1；ask 去 approve | A（env Key） | 无 | settings 默认模型；Key 靠环境变量 | `--approve` 项目信任 | 同左 | 设置页可写 defaultProvider/Model |
| terminal | N/A | — | — | — | — | — | — | — | — | — | shell 路径 | 非 Chat |

「支持」最低条线：Chat 发消息可见回复 + 能续则续 + 鉴权可引导。Ask 审批以 Claude host 协议为主；其它引擎 Ask 仅去掉自动批准 flag，可能需改回 Auto。

### 5.6 授权登录（以 Cursor 为例；模式适用于 Claude 等）

Headless Chat **不**在 SeMa 内嵌 Cursor/Claude 的登录页，也 **不**接其账号 SDK。账号态仍归各 CLI；SeMa 只负责发现「未登录」并帮用户跑完官方登录。

#### 推荐流程（类型 B：浏览器 OAuth）

```
用户选用 Cursor（或首次对该引擎发消息）
  → 适配器探测：已登录？
       是 → 正常 headless 发消息（可同时带 --trust 等）
       否 → Chat/设置页展示「需要登录」+「登录」按钮
            → SeMa spawn：`cursor-agent login`（或接入表中的等价命令）
            → CLI 打开系统浏览器完成 OAuth
            → 用户回到 SeMa →「我已完成」或轮询探测成功
            → token 留在 Cursor CLI 本地；SeMa 不保存账号密码/token
            → 重试原消息
```

#### 产品要点

1. **登录入口**  
   - 设置页：按引擎显示「未登录 / 已登录」、登录、退出（若 CLI 有 `logout`）  
   - Chat：发送失败且识别为未授权时，内联引导登录，避免只报一串 stderr  

2. **如何跑 login**（按优先级）  
   - **首选**：后台/短进程执行该 CLI 的 `login`（多数会自己调系统浏览器，**不需要**应用内 xterm）  
   - **次选**：`open_external` 打开 CLI 给出的鉴权 URL（若命令只打印 URL）  
   - **降级（类型 C）**：`open_path` / 系统终端执行登录命令，用户在外置终端完成后再回 SeMa  

3. **已登录探测**  
   - 优先用 CLI 提供的 `status` / `whoami` / 退出码约定；否则根据 headless 失败输出的稳定文案/码做适配器级识别  
   - 探测逻辑按 `cliId` 写死在适配器，禁止跨引擎共用一套字符串  

4. **与「工作区信任」分离（Cursor）**  
   - **账号登录**：用不用 Cursor 账号（OAuth）  
   - **`--trust`**：跳过「是否信任当前项目目录」类提示（现有 `trust_args`）  
   - 两者都可能阻塞 headless，但 UI 文案与按钮必须分开：「登录账号」vs「已处理目录信任」  

5. **Win / Mac**  
   - 浏览器应走系统默认浏览器；GUI 应用 PATH 仍须能找到 `cursor-agent` / `cursor`（沿用现有探测与 Mac PATH  enrichment）  
   - 登录命令的 spawn 方式与日常 headless 一致（Win shim/`cmd` 规则不套到 Mac）  

6. **不做**  
   - 不在 WebView 里加载第三方登录页去「伪集成」  
   - 不把 Cursor/Claude token 抄进 SeMa prefs  
   - 不要求用户为 SeMa 再配一套与 CLI 无关的 API Key（除非该引擎本身是类型 A）  

#### 其他引擎

- Claude Code 等若同样是 `login` + 浏览器：同一套「登录按钮 → spawn login → 探测」模板，仅命令与探测不同。  
- 以 Key 为主的引擎（类型 A）走 §5.3，设置页不出现假的「OAuth 登录」。  
- 每个引擎在接入表填：**鉴权类型、登录命令、退出命令、已登录探测、失败特征、是否与 trust flag 并存**。

---

## 6. 平台要求（沿用 SeMa 既有原则）

- **Windows 与 macOS 行为默认一致**；差异用平台分支隔离（配置路径、spawn、PATH 等）
- 每个 CLI 的 headless argv、配置路径、列举命令必须双端核对
- 禁止用「全局改默认」只修单边；单测按平台与 `cliId` 分支

（细节见根目录 `AGENTS.md`。）

---

## 7. 分阶段建议（未排期）

分期是**交付顺序**，不是最终只支持一部分 CLI。

| 阶段 | 内容 | 备注 |
|------|------|------|
| 0. 调研 | **对上表全部 AI CLI** 实测 headless / 输出 / session / model / 审批 / 配置路径，填满 §5.5 接入表 | 无能力项标降级策略，不删出名单 |
| 1. Chat 骨架 | 统一 Chat UI + 适配器接口；先打通 ≥1 个 CLI 验证管道 | 骨架须按多 cliId 设计，避免写死单引擎 |
| 2. 全量 MVP | 七个 AI CLI 均达「最低条线」（发消息 + 可见回复；能续则续） | Terminal 仍非 Chat |
| 3. 模型与鉴权 | 各 CLI 的选择器；Key 配置代理（A）或 login/浏览器引导（B/C）；与 trust 分离 | 按接入表，缺则降级 UI |
| 4. 审批与流式 | 有协议走 SeMa 审批；能流式则流式 | 按 CLI 增强 |
| 5. 旧 PTY | 评估 AI CLI 的 PTY 是否留作高级模式或退役；Terminal 另议 | 产品决策另定 |

---

## 8. 非目标（本稿）

- 不实现具体代码与 argv 定稿
- 不引入各厂商 / 各 CLI 官方 SDK 作为主路径
- 不在 SeMa 内复刻完整 Ink 菜单系统
- 不把 Terminal 改造成 AI 聊天气泡（除非产品另立需求）
- 不将 transcript 长期存进 SeMa 作为「第二套对话主库」（Chat 展示历史策略另定，并符合现有产品习惯）

---

## 9. 待决问题

1. 全量 MVP 的交付顺序（建议按接入表「易→难」，但范围仍是七个 AI CLI）？
2. 无结构化审批时，各 CLI 默认自动批准还是限制工具？
3. AI CLI 的 PTY 套壳是否长期保留为「高级模式」？
4. Chat 历史：仅依赖各 CLI session 回放，还是 SeMa 自存展示用摘要？
5. 各 CLI 鉴权类型（A Key / B 浏览器 login / C 外置终端）与具体命令、探测方式——调研谁先补齐？
6. 登录中 UI：仅「等待用户点完成」，还是轮询 `status` 自动关闭引导？

---

## 10. 一句话摘要

**主路径改为 Headless Chat：看不见终端、不接 SDK；七个现有 AI CLI 按 `cliId` 适配器驱动；鉴权分 Key 配置代理与官方 `login`/浏览器 OAuth（如 Cursor），token 留在 CLI 侧；SeMa 统一 Chat UI / 会话 / 模型选择与登录引导；审批用 SeMa UI 或按引擎自动批准；目录信任（如 `--trust`）与账号登录分开；Terminal 非 Chat；文中点名某一 CLI 仅为举例。**
