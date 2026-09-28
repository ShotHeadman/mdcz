export class PublicationConflictError extends Error {
  constructor(
    readonly sourcePath: string,
    readonly targetPath: string,
    readonly reason = "Destination already contains a movie",
  ) {
    super(`${reason}.\nSource: ${sourcePath}\nDestination: ${targetPath}`);
    this.name = "PublicationConflictError";
  }
}
