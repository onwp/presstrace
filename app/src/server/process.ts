import { describeError, type Logger } from "./log";

interface ProcessLike {
  on(event: "unhandledRejection" | "uncaughtException", listener: (arg: unknown) => void): unknown;
}

/**
 * Last-resort handlers. A stray rejected promise is logged and the server keeps serving, since the request that
 * caused it has already been answered or timed out. An uncaught exception leaves the process in an unknown
 * state, so it is logged and the process exits; Docker restarts it.
 */
export function installProcessHandlers(proc: ProcessLike, log: Logger, exit: (code: number) => void): void {
  proc.on("unhandledRejection", (reason) => {
    log.error("Unhandled promise rejection", { reason: describeError(reason) });
  });
  proc.on("uncaughtException", (error) => {
    log.error("Uncaught exception, exiting", { reason: describeError(error) });
    exit(1);
  });
}
