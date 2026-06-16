# 调度器实现目标与 Agent 执行提示词

状态：Draft v0.1
用途：把本项目交给 coding agent 端到端实现时使用的目标定义、任务边界和可复制提示词。
主要语言：中文；API、CLI、错误码、类型名、文件路径等技术关键词保留英文。

## 1. 目标一句话

把 Agent CLI Runtime 做成一个开源级、本地优先的 coding-agent 调度器：用户提交一个目标，runtime 能让本地 Agent 生成子任务、排队执行、流式回放、显式取消、记录证据，并通过统一 API 调用 Codex CLI、Claude Code、OpenCode 等本地 Agent CLI。

## 2. 产品目标

MVP 要完成两个层次：

1. **Run Scheduler**：从 OpenDesign 的 run lifecycle 中抽取最小可复用能力，管理单次 agent process run。
2. **Goal Scheduler**：在 Run Scheduler 之上新增项目自己的薄层，把一个高层目标拆成 tasks，并按依赖、并发限制和权限边界调度本地 agent CLI 执行。

最终用户心智：

```ts
const runtime = createAgentRuntime();

const goal = await runtime.createGoal({
  cwd: "/path/to/repo",
  objective: "实现 Codex / Claude / OpenCode 三个 adapter 的 MVP",
  defaultAgentId: "codex",
  permissionPolicy: "workspace-write",
});

for await (const event of goal.events) {
  // goal_started, task_created, run_started, text_delta, task_finished, goal_finished...
}
```

## 3. OpenDesign 抽取边界

OpenDesign 参考代码在本地开发 checkout：

```text
.reference/open-design
```

只把它当参考来源，不把 `.reference/` 发布到开源仓库或 npm package。

优先参考：

- `.reference/open-design/specs/current/run.md`
- `.reference/open-design/specs/current/runtime-adapter.md`
- `.reference/open-design/apps/daemon/src/runs.ts`
- `.reference/open-design/apps/daemon/src/run-result.ts`
- `.reference/open-design/apps/daemon/src/runtimes/types.ts`
- `.reference/open-design/apps/daemon/src/runtimes/detection.ts`
- `.reference/open-design/apps/daemon/src/runtimes/executables.ts`
- `.reference/open-design/apps/daemon/src/runtimes/invocation.ts`
- `.reference/open-design/apps/daemon/src/runtimes/launch.ts`
- `.reference/open-design/apps/daemon/src/runtimes/defs/codex.ts`
- `.reference/open-design/apps/daemon/src/runtimes/defs/claude.ts`
- `.reference/open-design/apps/daemon/src/runtimes/defs/opencode.ts`
- `.reference/open-design/apps/daemon/src/json-event-stream.ts`
- `.reference/open-design/apps/daemon/src/claude-stream.ts`

可抽取的设计：

- run 状态机：`queued`、`running`、`succeeded`、`failed`、`canceled`。
- event replay：单调递增 event id、内存 ring buffer、可选 JSONL log。
- cancel 语义：先 adapter/RPC abort，再 `SIGTERM`，最后 `SIGKILL`。
- process group cleanup。
- run close classification 和 fallback error code。
- probe 使用 neutral temp cwd。
- adapter definition 负责 argv / prompt transport / parser，core runner 负责 lifecycle。
- detection 故障隔离。

不要搬的部分：

- OpenDesign web routes、Express server、SSE HTTP implementation。
- project / conversation / assistantMessage 的 UI 绑定模型。
- media、plugin、design-system、artifact、MCP marketplace、telemetry。
- OpenDesign 特有 env、analytics、database schema、branding。
- 为 web headless 场景写死的 permission bypass。

Apache-2.0 合规要求：

- 可以复用设计和少量必要代码，但必须保留 attribution。
- 如果复制或改写 OpenDesign 文件的大段实现，必须在文件头或 `NOTICE` 中记录来源。
- 优先做“针对本项目 API 的 clean-room style reimplementation”，只在 parser 或 platform edge case 必要时借鉴代码结构。

## 4. MVP 架构

建议模块：

```text
src/
  index.ts
  core/
    ids.ts
    events.ts
    diagnostics.ts
    redaction.ts
    async-queue.ts
  runs/
    run-types.ts
    run-store.ts
    run-scheduler.ts
    process-runner.ts
    prompt-transport.ts
    run-result.ts
  goals/
    goal-types.ts
    task-graph.ts
    goal-store.ts
    goal-scheduler.ts
    planner-prompts.ts
  adapters/
    adapter-types.ts
    registry.ts
    codex.ts
    claude.ts
    opencode.ts
  detection/
    executable-resolution.ts
    detect.ts
    invocation.ts
    env.ts
  parsers/
    line-buffer.ts
    codex-json.ts
    claude-stream-json.ts
    opencode-json.ts
  cli/
    main.ts
tests/
  fake-clis/
  fixtures/
```

核心对象：

- `AgentRuntime`：public library facade。
- `RunScheduler`：管理一次 agent process run。
- `GoalScheduler`：管理 goal -> tasks -> runs。
- `AdapterRegistry`：注册 Codex / Claude / OpenCode adapter。
- `RunStore`：保存 run status 和 replayable events。
- `GoalStore`：保存 goal、task graph、task status、task evidence。
- `ProcessRunner`：封装 `spawn()`、stdin、stdout/stderr、signals。
- `StreamParser`：把各 CLI 输出转成 `AgentEvent`。

## 5. 事件模型

保留 run-level events，同时新增 goal-level events：

```ts
type SchedulerEvent =
  | { type: "goal_started"; goalId: string; objective: string }
  | { type: "task_created"; goalId: string; task: ScheduledTask }
  | { type: "task_started"; goalId: string; taskId: string; runId: string }
  | { type: "run_event"; goalId?: string; taskId?: string; runId: string; event: AgentEvent }
  | { type: "task_finished"; goalId: string; taskId: string; result: RunResult }
  | { type: "goal_finished"; goalId: string; result: RunResult }
  | { type: "scheduler_error"; code: RuntimeErrorCode; message: string; retryable?: boolean };
```

`AgentEvent` 保持小而稳定：

```ts
type AgentEvent =
  | { type: "run_started"; runId: string; agentId: string; cwd: string; timestamp: number }
  | { type: "status"; label: string; detail?: string; timestamp: number }
  | { type: "text_delta"; text: string; timestamp: number }
  | { type: "thinking_delta"; text: string; timestamp: number }
  | { type: "tool_call"; id: string; name: string; input?: unknown; timestamp: number }
  | { type: "tool_result"; id: string; output?: unknown; isError?: boolean; timestamp: number }
  | { type: "usage"; usage: RuntimeUsage; costUsd?: number; timestamp: number }
  | { type: "error"; code: RuntimeErrorCode; message: string; retryable?: boolean; timestamp: number }
  | { type: "run_finished"; result: RunResult; exitCode?: number | null; signal?: string | null; timestamp: number };
```

## 6. 子任务模型

```ts
type ScheduledTask = {
  id: string;
  title: string;
  objective: string;
  status: "pending" | "running" | "succeeded" | "failed" | "canceled" | "blocked";
  dependencies: string[];
  agentId?: string;
  cwd: string;
  permissionPolicy: PermissionPolicy;
  allowedFiles?: string[];
  validationCommands?: string[];
  evidence?: TaskEvidence;
};
```

MVP 调度规则：

- 默认串行执行。
- 只有 `dependencies` 全部 succeeded 的 task 才能执行。
- `parallel: true` 先不做；后续再加并发。
- 任一 task failed 时 goal failed，除非 caller 明确设置 `continueOnFailure`。
- cancel goal 时取消当前 run，并把未开始 task 标记为 canceled。
- task 的 prompt 必须自包含，不依赖聊天上下文。

## 7. 让 Agent 自动创建子任务的策略

MVP 不需要复杂规划器。用一次 planner run 生成 JSON task graph：

1. `GoalScheduler.createGoal()` 创建 goal。
2. 用 `defaultAgentId` 启动一次 planner run。
3. planner prompt 要求 agent 输出严格 JSON。
4. runtime parse JSON，validate task graph。
5. 对每个 task 调用 `RunScheduler.startRun()`。
6. 汇总 evidence 和 run result。

Planner output schema：

```ts
type PlannerOutput = {
  tasks: Array<{
    id: string;
    title: string;
    objective: string;
    dependencies: string[];
    allowedFiles?: string[];
    validationCommands?: string[];
    agentId?: string;
  }>;
};
```

Planner prompt 必须要求：

- task 数量少而清晰，优先 4-8 个。
- task 必须可独立执行。
- 每个 task 有验证命令。
- 不允许生成需要外部 secret 的 task。
- 不允许修改 `.reference/`。
- 不允许直接复制 OpenDesign 大段业务代码。

## 8. 可直接交给实现 Agent 的总提示词

下面这段可以直接粘给 Codex / Claude Code / OpenCode 这类 coding agent。

```text
你是 Agent CLI Runtime 项目的实现 Agent。请在当前仓库内端到端实现一个开源级、本地优先的 coding-agent scheduler MVP。

项目目标：
实现一个 TypeScript/Node.js library-first runtime。用户提交一个高层 objective 后，runtime 能：
1. 调用本地 Codex CLI / Claude Code / OpenCode 中的一个 agent 生成子任务 JSON task graph；
2. 校验 task graph；
3. 按依赖顺序调度每个 task；
4. 每个 task 通过统一 RunScheduler 启动本地 agent CLI；
5. 将 stdout / structured stream 解析成统一 events；
6. 支持 run / goal cancel、timeout、diagnostics、event replay；
7. 记录每个 task 的 result、validation commands、evidence summary；
8. 暴露 library API，并提供一个薄 CLI wrapper。

必须先阅读：
- AGENTS.md
- README.md
- README.zh-CN.md
- docs/ssot.md
- docs/scheduler-agent-goal.md
- .reference/open-design/specs/current/run.md
- .reference/open-design/specs/current/runtime-adapter.md
- .reference/open-design/apps/daemon/src/runs.ts
- .reference/open-design/apps/daemon/src/run-result.ts
- .reference/open-design/apps/daemon/src/runtimes/types.ts
- .reference/open-design/apps/daemon/src/runtimes/detection.ts
- .reference/open-design/apps/daemon/src/runtimes/executables.ts
- .reference/open-design/apps/daemon/src/runtimes/invocation.ts
- .reference/open-design/apps/daemon/src/runtimes/defs/codex.ts
- .reference/open-design/apps/daemon/src/runtimes/defs/claude.ts
- .reference/open-design/apps/daemon/src/runtimes/defs/opencode.ts
- .reference/open-design/apps/daemon/src/json-event-stream.ts
- .reference/open-design/apps/daemon/src/claude-stream.ts

开源与版权边界：
- 项目采用 Apache-2.0。
- .reference/ 只是本地参考 checkout，不进入发布包。
- 不要把 OpenDesign daemon / web / plugin / media / telemetry / database 业务整块搬进来。
- 优先按本项目 API clean-room style 重新实现。
- 如果确实复制或改写 OpenDesign 的非平凡代码片段，必须保留来源注释和 attribution。

实现边界：
- 只实现 library-first MVP + thin CLI。
- 不做 web UI。
- 不做 cloud API fallback。
- 不做自研 LLM provider router。
- 不做 plugin marketplace。
- 不做 OpenDesign artifact/design-system/media/MCP 业务。
- 不做 silent permission escalation。

必须实现的 public API：
- createAgentRuntime(options?)
- runtime.detect(options?)
- runtime.detectStream(options?)
- runtime.run(request)
- runtime.createGoal(request)
- runtime.cancelRun(runId)
- runtime.cancelGoal(goalId)

必须支持的 adapters：
- codex
- claude
- opencode

必须实现的核心模块：
- src/core/events.ts
- src/core/diagnostics.ts
- src/core/redaction.ts
- src/runs/run-types.ts
- src/runs/run-store.ts
- src/runs/run-scheduler.ts
- src/runs/process-runner.ts
- src/runs/prompt-transport.ts
- src/runs/run-result.ts
- src/goals/goal-types.ts
- src/goals/task-graph.ts
- src/goals/goal-store.ts
- src/goals/goal-scheduler.ts
- src/goals/planner-prompts.ts
- src/adapters/adapter-types.ts
- src/adapters/registry.ts
- src/adapters/codex.ts
- src/adapters/claude.ts
- src/adapters/opencode.ts
- src/detection/executable-resolution.ts
- src/detection/detect.ts
- src/detection/invocation.ts
- src/detection/env.ts
- src/parsers/line-buffer.ts
- src/parsers/codex-json.ts
- src/parsers/claude-stream-json.ts
- src/parsers/opencode-json.ts
- src/cli/main.ts
- src/index.ts

必须添加项目骨架：
- package.json
- tsconfig.json
- vitest.config.ts 或 node:test 配置
- src tests
- README 中如有 API 变化要同步更新

测试要求：
先写 fake CLI tests，再实现。
至少覆盖：
1. executable resolution order；
2. detection 单 adapter 失败不影响其他 adapter；
3. metadata probe 使用 temp cwd；
4. long prompt 通过 stdin；
5. RunScheduler success；
6. RunScheduler structured stdout error with exit code 0；
7. RunScheduler cancel；
8. RunScheduler timeout；
9. GoalScheduler planner JSON -> task graph；
10. GoalScheduler dependency order；
11. task failed -> goal failed；
12. redaction 不泄露 token/env secret。

验证命令：
- npm test
- npm run typecheck
- npm run lint（如果项目配置了 lint）
- node ./dist/cli/main.js agents --json（build 后如可行）
- node ./dist/cli/main.js doctor --json（build 后如可行）

实现策略：
1. 先创建最小 TypeScript package skeleton。
2. 先实现 types、event queue、run-store、fake process runner tests。
3. 再实现 real ProcessRunner 和 RunScheduler。
4. 再实现 adapter registry / detection。
5. 再实现 codex / claude / opencode adapters。
6. 再实现 parsers。
7. 再实现 GoalScheduler 和 planner prompt。
8. 最后实现 CLI wrapper。
9. 每完成一个阶段运行相关测试。

Definition of Done：
- 所有测试通过。
- typecheck 通过。
- README / README.zh-CN / docs/ssot.md 与实际 API 不冲突。
- 没有把 .reference/ 纳入发布文件。
- 没有新增 secret、token、真实用户路径到测试 fixture。
- agent run 和 goal run 都可以用 fake CLI 端到端验证。

停止条件：
- 如果某个真实 CLI 的 flag 与参考不一致，不要猜；用 fake adapter 先完成核心 runtime，并把真实 CLI 兼容性标为待验证。
- 如果需要复制 OpenDesign 大段代码，先停下来记录来源、原因和替代方案。
- 如果测试需要真实 Codex / Claude / OpenCode 登录态，不要把它设为必需；真实 CLI smoke 只能作为 optional。

请你先在仓库中创建任务清单，然后按任务逐步实现。每一步都要保持 diff 小、测试先行、失败可诊断。
```

## 9. 推荐子任务拆分

实现 Agent 可以直接按下面拆：

1. **T001 Project Skeleton**
   - 初始化 `package.json`、`tsconfig.json`、test runner。
   - 添加 `src/index.ts` 空 facade。
   - 验证：`npm test`、`npm run typecheck`。

2. **T002 Core Types And Event Queue**
   - 定义 `AgentEvent`、`SchedulerEvent`、`RunResult`、`RuntimeDiagnostic`。
   - 实现 async event queue。
   - 验证：event ordering、iterator close。

3. **T003 Run Store**
   - 从 OpenDesign `runs.ts` 抽象 run status、event replay、waiters、cleanup。
   - 不引入 HTTP/SSE。
   - 验证：append/replay/terminal cleanup。

4. **T004 Process Runner**
   - 封装 `spawn()`、stdin、stdout/stderr、cancel、timeout、process group。
   - 验证：fake CLI success/error/cancel/timeout。

5. **T005 Adapter Registry And Detection**
   - 实现 executable resolution、temp cwd probe、fault isolation。
   - 验证：一个 adapter probe 抛错不影响其他 adapter。

6. **T006 MVP Adapters**
   - Codex / Claude / OpenCode `buildArgs`、prompt transport、env cleanup。
   - 验证：argv snapshots。

7. **T007 Stream Parsers**
   - Codex JSON、Claude stream-json、OpenCode JSON、line buffer。
   - 验证：fixtures -> AgentEvent。

8. **T008 Run Scheduler Integration**
   - 串联 adapter、process runner、parser、run store。
   - 验证：fake CLI end-to-end。

9. **T009 Goal Scheduler**
   - planner prompt、planner JSON parse、task graph validation、串行调度。
   - 验证：goal -> tasks -> runs -> goal_finished。

10. **T010 CLI Wrapper**
    - `agents`、`run`、`goal`、`doctor`。
    - 验证：CLI JSON output snapshot。

11. **T011 Docs Sync**
    - README、README.zh-CN、SSOT 与实际 API 同步。
    - 验证：链接和命令无明显错误。

## 10. 最小可接受 MVP

如果时间有限，MVP 最小边界是：

- fake CLI 可完整跑通 goal -> tasks -> runs。
- Codex / Claude / OpenCode adapter 至少完成 detection 和 argv builder tests。
- 真 CLI smoke 标记为 optional。
- 无 web UI、无 persistence to disk，run event replay 先用 memory ring buffer。
- `createGoal()` 先只支持 serial tasks。

## 11. 高风险点

- 真实 CLI flags 变化快：用 capability probing 和 optional smoke test 降低风险。
- 权限默认值危险：library 默认 `agent-default`，CLI 明确提示 `workspace-write`。
- parser 容易跟 CLI schema 脱节：fixture tests 必须成为一等公民。
- long prompt 不能走 argv：stdin-first 是硬约束。
- `.reference/` 不能进发布包：`.gitignore` 和 package files 都要排除。
- planner 输出 JSON 可能不合法：必须 strict parse + schema validation + repair/failed path。
- task 自动拆分可能过度：MVP 限制 4-8 个任务，默认串行。
