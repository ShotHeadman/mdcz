export class PublicationConflictError extends Error {
  constructor(
    readonly sourcePath: string,
    readonly targetPath: string,
    readonly reason = "目标位置已存在影片",
  ) {
    super(`${reason}，已停止写入，请处理冲突后重新启动任务。\n源文件：${sourcePath}\n目标文件：${targetPath}`);
    this.name = "PublicationConflictError";
  }
}
