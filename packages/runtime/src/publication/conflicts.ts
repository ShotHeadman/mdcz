export class PublicationConflictError extends Error {
  constructor(
    readonly sourcePath: string,
    readonly targetPath: string,
    readonly reason = "目标位置已存在影片",
  ) {
    super(`${reason}。\n源文件：${sourcePath}\n目标文件：${targetPath}`);
    this.name = "PublicationConflictError";
  }
}
