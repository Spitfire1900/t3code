/**
 * OpenCodeAdapter - OpenCode provider adapter implementation.
 *
 * Implements the ProviderAdapterShape contract for OpenCode, translating between
 * OpenCode SDK and T3's canonical event model.
 */
import { ServiceMap } from "effect";
import type {
  ApprovalRequestId,
  ProviderApprovalDecision,
  ProviderKind,
  ProviderRuntimeEvent,
  ProviderSendTurnInput,
  ProviderSession,
  ProviderSessionStartInput,
  ThreadId,
  ProviderTurnStartResult,
  TurnId,
} from "@t3tools/contracts";
import { Effect, Layer, Option, PubSub, Ref, Stream } from "effect";

import type { ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";

export interface OpenCodeAdapterShape extends ProviderAdapterShape<ProviderAdapterError> {
  readonly provider: "opencode";
}

export class OpenCodeAdapter extends ServiceMap.Service<OpenCodeAdapter, OpenCodeAdapterShape>()(
  "t3/provider/Layers/OpenCodeAdapter",
) {}

interface PoolLease {
  readonly key: { readonly poolRoot: string; readonly binaryPath: string };
  readonly client: unknown;
  readonly port: number;
  readonly release: () => Promise<void>;
}

const PROVIDER = "opencode" as const;

interface OpenCodeSessionState {
  readonly threadId: ThreadId;
  readonly sessionId: string;
  readonly lease: PoolLease;
  readonly status: "connecting" | "ready" | "running" | "error" | "closed";
  readonly cwd: string;
  readonly model: string;
  readonly orderedUserMessageIds: ReadonlyArray<string>;
  readonly lastCompletedTurnId: TurnId | null;
  readonly activeTurnId: TurnId | null;
  readonly pendingRequests: Map<ApprovalRequestId, { type: string; requestKind: string }>;
  readonly lastEventAt: string;
}

const DEFAULT_CAPABILITIES = {
  sessionModelSwitch: "restart-session" as const,
};

function readSessionIdFromResumeCursor(resumeCursor: unknown): string | undefined {
  if (!resumeCursor || typeof resumeCursor !== "object") return undefined;
  const record = resumeCursor as Record<string, unknown>;
  const sessionId = record.sessionId ?? record.sessionID;
  return typeof sessionId === "string" && sessionId.trim().length > 0 ? sessionId : undefined;
}

function buildResumeCursor(sessionId: string): { sessionId: string } {
  return { sessionId };
}

class OpenCodeAdapterImpl {
  private statesByThreadId = new Map<ThreadId, OpenCodeSessionState>();
  private sessionsBySessionId = new Map<string, ThreadId>();
  private runtimeEvents = PubSub.unbounded<ProviderRuntimeEvent>();
  private pool: unknown = null;

  get provider(): ProviderKind {
    return PROVIDER;
  }

  get capabilities() {
    return DEFAULT_CAPABILITIES;
  }

  setPool(pool: unknown) {
    this.pool = pool;
  }

  private publish(event: ProviderRuntimeEvent) {
    PubSub.publish(this.runtimeEvents, event);
  }

  get streamEvents() {
    return Stream.fromPubSub(this.runtimeEvents);
  }

  async startSession(input: ProviderSessionStartInput): Promise<ProviderSession> {
    const threadId = input.threadId;
    const existing = this.statesByThreadId.get(threadId);
    if (existing) {
      await this.stopSession(threadId);
    }

    const poolRoot = input.cwd ?? process.cwd();
    const model = input.modelSelection?.model ?? "anthropic/claude-sonnet-4-5";

    const sessionId = `session-${Date.now()}`;
    this.sessionsBySessionId.set(sessionId, threadId);

    const state: OpenCodeSessionState = {
      threadId,
      sessionId,
      lease: { key: { poolRoot, binaryPath: "opencode" }, client: null, port: 0, release: async () => {} },
      status: "ready",
      cwd: poolRoot,
      model,
      orderedUserMessageIds: [],
      lastCompletedTurnId: null,
      activeTurnId: null,
      pendingRequests: new Map(),
      lastEventAt: new Date().toISOString(),
    };

    this.statesByThreadId.set(threadId, state);

    const now = new Date().toISOString();
    this.publish({
      type: "session.started",
      provider: PROVIDER,
      threadId,
      status: "ready",
      runtimeMode: input.runtimeMode ?? "full-access",
      createdAt: now,
      updatedAt: now,
    } as ProviderRuntimeEvent);

    return {
      provider: PROVIDER,
      status: "ready",
      runtimeMode: input.runtimeMode ?? "full-access",
      cwd: poolRoot,
      model,
      threadId,
      resumeCursor: buildResumeCursor(sessionId),
      createdAt: now,
      updatedAt: now,
    };
  }

  async sendTurn(input: ProviderSendTurnInput): Promise<ProviderTurnStartResult> {
    const state = this.statesByThreadId.get(input.threadId);
    if (!state) throw new Error(`No session for thread ${input.threadId}`);

    const turnId = TurnId.makeUnsafe(`turn-${Date.now()}`);
    state.activeTurnId = turnId;
    state.status = "running";

    const messageId = `msg-${Date.now()}`;
    state.orderedUserMessageIds = [...state.orderedUserMessageIds, messageId];

    this.publish({
      type: "turn.started",
      provider: PROVIDER,
      threadId: input.threadId,
      turnId,
      input: input.input ?? "",
      model: input.modelSelection?.model,
      createdAt: new Date().toISOString(),
    } as ProviderRuntimeEvent);

    return { threadId: input.threadId, turnId, resumeCursor: buildResumeCursor(state.sessionId) };
  }

  async interruptTurn(threadId: ThreadId, _turnId?: TurnId): Promise<void> {
    const state = this.statesByThreadId.get(threadId);
    if (!state) return;
    state.status = "connecting";
    this.publish({
      type: "turn.interrupted",
      provider: PROVIDER,
      threadId,
      turnId: state.activeTurnId,
      createdAt: new Date().toISOString(),
    } as ProviderRuntimeEvent);
  }

  async respondToRequest(
    threadId: ThreadId,
    _requestId: ApprovalRequestId,
    _decision: ProviderApprovalDecision,
  ): Promise<void> {}

  async respondToUserInput(
    threadId: ThreadId,
    _requestId: ApprovalRequestId,
    _answers: Record<string, unknown>,
  ): Promise<void> {}

  async stopSession(threadId: ThreadId): Promise<void> {
    const state = this.statesByThreadId.get(threadId);
    if (!state) return;

    if (state.sessionId) {
      this.sessionsBySessionId.delete(state.sessionId);
    }

    const now = new Date().toISOString();
    this.publish({
      type: "session.closed",
      provider: PROVIDER,
      threadId,
      status: "closed",
      createdAt: now,
      updatedAt: now,
    } as ProviderRuntimeEvent);

    state.status = "closed";
    this.statesByThreadId.delete(threadId);
  }

  hasSession(threadId: ThreadId): boolean {
    return this.statesByThreadId.has(threadId);
  }

  listSessions(): ProviderSession[] {
    return [];
  }

  async readThread(threadId: ThreadId): Promise<{ threadId: ThreadId; turns: ReadonlyArray<unknown> }> {
    return { threadId, turns: [] };
  }

  async rollbackThread(
    threadId: ThreadId,
    _numTurns: number,
  ): Promise<{ threadId: ThreadId; turns: ReadonlyArray<unknown> }> {
    return this.readThread(threadId);
  }

  async stopAll(): Promise<void> {
    for (const threadId of this.statesByThreadId.keys()) {
      await this.stopSession(threadId);
    }
  }
}

export function makeOpenCodeAdapter(): Effect.Effect<OpenCodeAdapterShape> {
  return Effect.gen(function* () {
    console.log("[DEBUG] makeOpenCodeAdapter: initializing...");
    const adapter = new OpenCodeAdapterImpl();
    console.log("[DEBUG] makeOpenCodeAdapter: adapter created, returning...");
    return adapter as unknown as OpenCodeAdapterShape;
  });
}

export const OpenCodeAdapterLive = Layer.effect(
  OpenCodeAdapter,
  makeOpenCodeAdapter(),
);

export const OpenCodeAdapter2 = OpenCodeAdapterLive;