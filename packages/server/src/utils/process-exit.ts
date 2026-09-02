/**
 * Exit discipline (ADR 0130 R2).
 *
 * A process that may have run ONNX inference never hard-exits on a normal
 * path: `process.exit()` runs C `exit()` while the runtime's thread pool is
 * still alive, and onnxruntime-node 1.21 aborts on a destroyed mutex. Setting
 * the exit code and letting the event loop drain releases everything in
 * order. The sanctioned `process.exit` sites are the daemon's forced-drain
 * fallback and uncaught-exception handler, and the bridge (which never loads
 * the runtime) — see ADR 0130 R4/R6.
 */
export function requestExit(code: number): void {
  process.exitCode = code;
}
