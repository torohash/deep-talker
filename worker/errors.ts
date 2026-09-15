export class OperationError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "OperationError";
  }
}
