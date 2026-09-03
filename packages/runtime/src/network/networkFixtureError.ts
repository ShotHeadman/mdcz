import { UnrecoverableNetworkError } from "./networkExecution";

export class NetworkFixtureReplayError extends UnrecoverableNetworkError {
  override readonly name = "NetworkFixtureReplayError";
}
