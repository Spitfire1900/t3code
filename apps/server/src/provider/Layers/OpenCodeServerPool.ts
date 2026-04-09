/**
 * OpenCodeServerPool - Manages pooled OpenCode sidecar processes.
 *
 * Each sidecar is started via `opencode serve` and indexed by workspace root
 * plus binary path. Multiple sessions in the same project can share one sidecar.
 */
import type { OpenCodeSettings } from "@t3tools/contracts";
import { Effect, Layer, PubSub, Ref } from "effect";
import { Stream } from "effect";

const DEFAULT_PORT = 7890;
const AUTH_USERNAME = "t3code";

export interface PoolKey {
  readonly poolRoot: string;
  readonly binaryPath: string;
}

export interface PoolLease {
  readonly key: PoolKey;
  readonly client: unknown;
  readonly port: number;
  readonly release: () => Promise<void>;
}

export interface PoolEvent {
  readonly type: "acquired" | "released" | "error";
  readonly key: PoolKey;
  readonly detail?: string;
}

export interface OpenCodeServerPool {
  readonly streamEvents: Stream.Stream<PoolEvent>;
  readonly acquire: (settings: OpenCodeSettings, poolRoot: string) => Promise<PoolLease>;
  readonly stopAll: () => Promise<void>;
}
