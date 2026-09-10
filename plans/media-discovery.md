# 工作台扫描范围与性能优化计划

## Context

115 挂载盘选择根目录或演员目录后长时间转圈。目标是在不牺牲“只处理部分文件”的前提下，避免默认遍历整个媒体库，并减少确实需要递归时的文件系统开销。

**用户已确认**：增加“包含子目录”开关，默认关闭。保留现有扫描目录入口、视频列表、逐项勾选和确认开始；不增加第二种模式，不把文件夹等同于一部影片，不在发现文件后自动刮削。

不能据此推断多数用户的目录习惯。“放在同一个待处理目录”也可能包含影片子目录，因此保留显式递归能力。

### 已验证的代码问题（尚未在用户挂载环境测量）

1. 桌面端 `listVideoFiles → listFiles → walkDirectory` 串行递归，每目录执行 realpath/readdir；收集全部文件后才过滤扩展名。候选接口随后再串行 stat 每个视频。
2. 服务端 `listRootFiles` 串行遍历并 stat 所有普通文件；候选接口遍历结束才排除目录、过滤扩展名和黑名单，再无界 Promise.all 执行 lstat 检查文件链接。
3. 工作台路径 onChange 直接改变扫描目录并触发 effect，输入中间值也可能启动扫描；恢复默认路径同样自动扫描。请求编号只防旧结果覆盖，不会停止后台 I/O。
4. 主目录和配置的额外软链接目录独立扫描后合并；覆盖范围重叠时可能重复遍历。
5. 候选一次性返回，扫描中禁止提交；重新扫描完成后 store 无条件全选，会丢失用户取消勾选的决定。
6. 桌面端和 media-store 遍历的链接语义不完全相同；服务端候选还会排除文件符号链接。不能以性能优化为由直接删 realpath 或统一改变链接行为。

## Approach

### 1. 单一流程，显式控制深度

- 在“扫描目录”附近增加 `包含子目录`，初始值 false。刮削与维护共用工作台保持一致；独立后台媒体库扫描、工具扫描不受此默认值影响。
- 关闭：仅当前层视频；开启：递归所有后代目录，继续应用排除规则。关闭时不为判断“有没有视频”而偷偷扫描子层。
- 保留确认目录后自动发现：桌面浏览完成立即提交路径；手动输入通过失焦或 Enter 提交，避免逐字扫描；同一个已提交范围不重复扫描。路径补全的 Enter 选择与提交不抢事件。
- 保留恢复默认目录行为，但首次仅扫描当前层。开关不加入全局配置、不持久化到磁盘；当前工作台会话中保留选择，新应用会话初始关闭。
- 切换开关触发新范围扫描；范围身份包括目录、recursive、排除项、额外扫描目录、影响过滤的配置及工作台用途。配置未加载完成前不启动扫描。
- 空列表明确提示“当前目录未找到视频，可勾选“包含子目录””，不是暗示整个目录树为空。扫描提示区分“仅当前目录”与“含子目录”。
- 显示“已选择 N / 共 M 个文件”；开始按钮只提交 selectedCandidates 的文件快照，不把根目录交给执行器重新发现全部文件。

### 2. 选择与请求生命周期

- 新目录/新扫描范围沿用首次扫描默认全选，必须点击开始才处理；清晰展示选中数量。
- **同范围刷新**保留仍存在文件的勾选/未勾选状态；移除已消失文件，新出现文件默认不选，避免静默扩大处理范围。
- 修改路径草稿立即使当前提交资格失效；重新扫描期间旧列表可展示但不可提交。失败不允许提交陈旧结果。
- 保留请求编号并补齐范围校验；切换模式、路径或深度后，旧成功/失败响应均不能改变当前状态。
- 单个工作台最多一个在途候选请求；后续范围变化只保留最新待扫描意图，旧请求结束后再执行，避免多个递归扫描叠加。配置额外目录也按同一轮串行调度，不在 UI 用 Promise.all 叠加扫描并发。
- 本次不将“忽略旧响应”称为取消。已经阻塞的挂载盘调用仍可能等待；真正后端取消与流式候选协议见范围边界。

### 3. 减少 I/O，采用有界并发

- 在现有遍历实现内优化，不创建通用扫描框架，不引入第三方并发库或刮削 TaskExecutor。
- 把排除目录判断放在进入目录之前；词法路径先剪枝，必要的规范路径检查保留以防链接绕过。保留桌面端“显式选择的根目录不因同名排除项而整根被排除”的已测试行为，并让候选两端一致。
- 遍历发现普通文件时先按扩展名、主视频规则、字面量黑名单过滤，再取 size/mtime；不为候选扫描 stat 图片、NFO、字幕等已排除文件。
- 桌面端只对筛选后视频有界读取属性，避免串行 stat；服务端利用 readdir 的 Dirent 记录文件链接类型，避免候选再次全量 lstat。类型未知/链接目标所需检查保留，不声称底层挂载驱动完全没有额外元数据请求。
- 每轮扫描用固定 worker 队列限制文件系统任务，初始上限 4，目录枚举和属性读取共享预算；不得每层递归各开 4 个 Promise.all。任务释放 worker 后再调度子目录，避免递归占满 worker 等待造成死锁。
- realpath 本次保留防循环与链接语义，消除可确定的同轮重复解析；不贸然仅对链接调用 realpath。
- 额外软链接扫描目录应用同一个 recursive 值，并在范围提示中说明来自配置。仅当递归扫描已完整覆盖该目录且未被排除时移除冗余扫描；非递归父目录不能覆盖子目录。保留候选合并去重作为结果层约束。
- 保留稳定排序、rootId/relativePath、大小/时间、STRM、多分段、生成 sidecar 排除等业务契约；通用 listFiles/listRootFiles 的非候选调用不得因过滤优化漏文件。

### 4. 可诊断性与错误处理

- 在实际 I/O 调用处测量 readdir、realpath、stat/lstat 的调用数与耗时，记录扫描总耗时、目录数、候选数、跳过错误数；用本地开发日志记录慢调用开始/完成与路径，避免只在扫描结束后才能定位卡点。
- 默认仅输出汇总与慢项，不逐文件刷 UI/日志；路径仅写现有本地诊断日志，不新增遥测上传。
- UI 显示已等待时间和扫描范围；没有真实总量时不显示完成百分比，不虚构当前扫描目录。
- 根目录不可访问、I/O 故障和未知错误明确失败；遍历期间条目消失、断链和子路径权限问题按已知错误码跳过并返回警告摘要（数量及少量路径），界面明确“部分内容未能读取”。取消信号如已由既有调用方传入必须继续传播，不能被 catch 吞掉。
- 不用 Promise.race 超时伪装中断，也不自动重复重试挂载故障而放大请求。

### 范围边界 / 架构债务

- 两套遍历实现有重复，但链接语义和调用方契约不同。本次在原有模块内优化，不静默合并到新跨模块框架；后续统一需单独 RFC。
- 不新增目录树、目录作为刮削单位、边发现边执行、文件系统缓存、115 原生 API、全量列表虚拟化或全局扫描设置。
- 实时候选增量、真实进度事件及后端取消需要新的候选生命周期协议；现有服务端 taskEvents 面向持久化任务，桌面 IPC 也不是现成候选流。本次不借用持久化扫描队列承载 UI 请求。若优化后仍有长等待，再单独设计该协议；本次耗时诊断提供决策依据。

## Files to modify

### 范围与选择
- `packages/shared/mediaCandidate.ts`：recursive 进入扫描计划与身份，安全消除覆盖范围重复扫描。
- `packages/views/src/state/workbenchSetupStore.ts`：开关默认值、范围状态、同范围刷新选择保持。
- `packages/views/src/adapters/WorkbenchSetupAdapter.tsx`：提交路径、请求串行合并、范围校验、传递 recursive/警告。
- `packages/views/src/workbench/WorkbenchSetupView.tsx`：开关、路径提交、选中数、空态、耗时与警告。

### 两端协议与扫描
- `apps/desktop/src/main/ipc/payloads.ts`
- `apps/desktop/src/renderer/src/client/ipc.ts`
- `apps/desktop/src/renderer/src/components/workbench/WorkbenchSetup.tsx`
- `apps/desktop/src/main/ipc/handlers/file.ts`
- `packages/shared/serverDtos.ts`
- `apps/web/src/routes/workbench.tsx`
- `apps/server/src/services/scanQueueService.ts`
- `packages/runtime/src/scrape/utils/filesystem.ts`
- `packages/media-store/src/filesystem.ts`

候选请求使用明确的 recursive boolean，内部调用统一传值；不保留旧递归默认分支或兼容重载。已有通用遍历 API 如需改为 options 对象，同步更新所有调用方，不保留旧签名垫片。诊断/警告仅加入现有候选响应与所需遍历选项，不创建新持久化实体。

## Reuse

- `packages/shared/mediaCandidate.ts`：resolveMediaCandidateScanPlan、isHostPathWithinDirectory、normalizeComparableHostPath、mergeMediaCandidates。
- `packages/shared/mediaExtensions.ts` 及现有 isPrimaryVideoFileName / hasLiteralFilenameToken：沿用文件资格规则。
- `packages/media-store`：resolveRootFile、RootRelativePath 与现有错误映射，不重新实现路径归属。
- `packages/views/src/path/PathAutocompleteInput.tsx` 已支持 onBlur/键盘事件；工作台 PathControl 接线，无需改造其他页面的路径输入。
- `packages/runtime/src/tasks/executor.ts` 固定 worker 写法仅作实现参考，不复用带任务语义的执行器。
- 现有 Checkbox、FloatingWorkbenchBar、请求编号和旧列表刷新展示。

### 手动验收

1. 桌面和 Web：首次关闭开关，选择根目录仅列当前层；只有子目录时提供开启提示。开启后递归列出视频。
2. 只选两个视频，开始后任务确实只有这两个；同范围刷新不恢复取消勾选，新文件不自动加入选择。
3. 快速修改路径、切换范围/用途、加载配置：旧响应不覆盖新结果；没有逐字启动扫描或同工作台多轮叠加。
4. 500 个影片目录，各含视频、NFO、图片、字幕：测量非递归和递归的请求数、耗时、错误；排除大子树后不再进入该树。
5. 根不可访问、子目录无权限、文件扫描中消失、挂载慢调用：失败/警告有依据，不报假成功、假百分比或假取消。
6. 测试 STRM、多分段、外部/内部链接、循环、额外扫描根重叠及 Windows 路径，验证原文件身份与资格规则。

实施阶段运行：
- `pnpm typecheck`
- `pnpm exec vitest run --project unit --project desktop-integration --project component`（可先限定上述文件）
- `pnpm test:unit`
- `pnpm exec biome check <变更文件>`
- 合并前 `pnpm check`
