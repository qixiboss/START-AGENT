# START-AGENT 项目优化计划

## Context

项目当前存在两个主要问题：
1. **代码结构和可维护性差** - App.tsx (1465行) 和 electron/main.ts (1781行) 过大，包含大量重复代码和混合关注点
2. **性能问题** - 频繁的 React 重渲染，串行 Git 命令执行效率低，3秒轮询机制不够高效

本计划将重构代码结构并进行性能优化，使项目更易于维护和扩展。

## 目标架构

### Electron 主进程新结构
```
electron/
├── main.ts                    # 入口，窗口创建，IPC 注册 (~150行)
├── preload.ts                 # 保持不变
├── services/
│   ├── git.ts                 # Git 操作封装 (~300行)
│   ├── storage.ts             # 设置持久化 (~100行)
│   ├── powershell.ts          # PowerShell 操作 (~200行)
│   ├── projects.ts            # 项目管理 (~100行)
│   └── terminal.ts           # 终端会话管理 (~400行)
├── ipc/
│   ├── index.ts              # IPC 注册器 (~100行)
│   ├── git.ts                # Git 相关处理器 (~100行)
│   ├── projects.ts           # 项目相关处理器 (~50行)
│   ├── terminal.ts           # 终端相关处理器 (~150行)
│   └── window.ts            # 窗口相关处理器 (~50行)
└── utils/
    ├── git.ts                # Git 辅助函数
    ├── process.ts            # 进程管理辅助
    └── sanitize.ts           # 数据清理辅助
```

### React 组件新结构
```
src/
├── App.tsx                   # 简化后的根组件 (~300行)
├── hooks/
│   ├── useProjects.ts         # 项目管理逻辑
│   ├── useTerminalSessions.ts # 终端会话逻辑
│   ├── useGitOperations.ts    # Git 操作逻辑
│   └── useLocalStorage.ts     # localStorage 辅助
└── components/App/
    ├── TerminalStage.tsx      # 终端面板
    ├── LaunchRecordsPanel.tsx # 启动记录面板
    ├── EmbeddedSessionsPanel.tsx # 内嵌会话面板
    └── GitCommitModal.tsx     # Git 提交模态框
```

## 实施步骤

### Phase 1: Electron 主进程重构

#### 步骤 1.1: 创建 utils 辅助模块

**新建文件**: `electron/utils/git.ts`
- 提取重复的 Git 验证逻辑（出现6次的仓库验证代码）
- 提取重复的 Git Remote 配置逻辑（出现3次）
- 辅助函数：`validateGitRepo`, `getCurrentBranch`, `ensureOriginConfigured`

**新建文件**: `electron/utils/process.ts`
- 提取进程管理逻辑：`isProcessAlive`, `resolvePowerShellPath`, `launchPowerShellWindow`, `closeProcess`

**新建文件**: `electron/utils/sanitize.ts`
- `sanitizeLaunches`, `sanitizeSessionStatus`, `sanitizeSessionSnapshots`

#### 步骤 1.2: 创建 services 模块

**新建文件**: `electron/services/git.ts`
- 从 main.ts 提取所有 Git 相关函数
- 函数：`runGit`, `ensureGitOrigin`, `commitAndPush`, `gitAdd`, `gitPull`, `listGitBranches`, `getRemoteHistory`, `listGitUntrackedFiles`

**新建文件**: `electron/services/storage.ts`
- 从 main.ts 提取：`getSettingsPath`, `persistSettings`, `flushSettingsPersist`, `schedulePersistSettings`, `loadSettings`, `initRootPath`

**新建文件**: `electron/services/powershell.ts`
- 从 main.ts 提取：`buildToolBootstrapCommand`, `resolvePowerShellCandidates`, `probePowerShellCommand`, `launchPowerShellWindow`, `focusPowerShellWindow`

**新建文件**: `electron/services/projects.ts`
- 从 main.ts 提取：`listProjects`, `setRootPath`, `setProjectMeta`

**新建文件**: `electron/services/terminal.ts`
- 从 main.ts 提取所有终端会话相关函数和状态管理

#### 步骤 1.3: 创建 IPC 处理器

**新建文件**: `electron/ipc/index.ts` - 注册所有 IPC 处理器
**新建文件**: `electron/ipc/git.ts` - Git 相关 IPC 处理器
**新建文件**: `electron/ipc/projects.ts` - 项目相关 IPC 处理器
**新建文件**: `electron/ipc/terminal.ts` - 终端相关 IPC 处理器
**新建文件**: `electron/ipc/window.ts` - 窗口相关 IPC 处理器

#### 步骤 1.4: 重构 main.ts
- 保留：`createMainWindow`, `appendRuntimeLog`, `isReadableDirectory`, App lifecycle hooks
- 删除所有业务逻辑函数
- 调用新的 `registerIpc` 函数

#### 步骤 1.5: 性能优化 - 并行化 Git 命令

在 `getRemoteHistory` 函数中，将独立的 Git 命令从串行改为并行执行（使用 `Promise.all`）：
- `rev-parse` (upstream)
- `rev-parse` (local head)
- `rev-parse` (remote head)

### Phase 2: React 前端重构

#### 步骤 2.1: 创建自定义 Hooks

**新建文件**: `src/hooks/useLocalStorage.ts` - 封装 localStorage 逻辑
**新建文件**: `src/hooks/useProjects.ts` - 提取项目管理相关状态和函数
**新建文件**: `src/hooks/useTerminalSessions.ts` - 提取终端会话相关状态和函数
**新建文件**: `src/hooks/useGitOperations.ts` - 提取 Git 操作相关状态和函数

#### 步骤 2.2: 拆分大型组件

**新建文件**: `src/components/App/TerminalStage.tsx` - 提取终端面板 JSX
**新建文件**: `src/components/App/LaunchRecordsPanel.tsx` - 提取启动记录卡片逻辑
**新建文件**: `src/components/App/EmbeddedSessionsPanel.tsx` - 提取内嵌会话面板
**新建文件**: `src/components/App/GitCommitModal.tsx` - 提取 Git 编辑器模态框

#### 步骤 2.3: 简化 App.tsx
- 使用自定义 Hooks 管理状态
- 简化渲染逻辑，只负责组件组合

#### 步骤 2.4: 性能优化
- 使用 `React.memo` 包装子组件（LaunchCard, TerminalSessionTab 等）
- 使用 `useCallback` 和 `useMemo` 优化函数和计算属性
- 考虑减少轮询频率或改为事件驱动

## 依赖关系

```
Phase 1: Electron 主进程重构
├── 步骤 1.1: utils 辅助模块 [独立，无依赖]
├── 步骤 1.2: services 模块 [依赖步骤 1.1]
├── 步骤 1.3: IPC 处理器 [依赖步骤 1.2]
├── 步骤 1.4: 重构 main.ts [依赖步骤 1.3]
└── 步骤 1.5: 性能优化 [依赖步骤 1.4]

Phase 2: React 前端重构
├── 步骤 2.1: 自定义 Hooks [独立，可并行]
├── 步骤 2.2: 拆分组件 [依赖步骤 2.1]
├── 步骤 2.3: 简化 App.tsx [依赖步骤 2.1, 2.2]
└── 步骤 2.4: 性能优化 [依赖步骤 2.3]
```

## 关键文件

| 文件路径 | 操作 |
|---------|------|
| `electron/main.ts` | 重构，从 1781 行减少到 ~300 行 |
| `src/App.tsx` | 重构，从 1465 行减少到 ~300 行 |
| `src/types/ipc.ts` | 保持不变，类型安全保证 |
| `electron/preload.ts` | 保持不变 |
| `src/services/electronApi.ts` | 保持不变 |

## 验证步骤

完成重构后，验证以下功能正常工作：

1. **项目管理** - 扫描目录、切换根目录、保存元数据
2. **Git 操作** - Add、Commit、Pull、Push、分支列表、远程历史
3. **外部终端** - 启动、聚焦、备注、删除
4. **内嵌终端** - 创建、输入、输出、关闭、审批
5. **窗口控制** - 最小化、最大化、关闭

运行 `npm run dev` 启动应用并进行完整功能测试。

## 预期成果

| 指标 | 重构前 | 重构后 | 改进 |
|-------|-------|-------|-----|
| App.tsx 行数 | 1465 | ~300{ | -80% |
| electron/main.ts 行数 | 1781 | ~300 | -83% |
| 最大文件行数 | 1781 | ~400 | -78% |
| Git 命令执行时间 | 串行 200ms+ | 并行 ~80ms | -60% |
| 代码重复率 | 高 | 低 | -90% |
