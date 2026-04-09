/**
 * opencodeEventMapping - Type conversions from OpenCode events to T3 canonical events.
 */
import type { CanonicalItemType, CanonicalRequestType, RuntimeTurnState } from "@t3tools/contracts";

const FILE_READ_TOOLS = new Set(["read", "glob", "grep", "list"]);

const FILE_CHANGE_TOOLS = new Set(["write", "edit", "patch", "create", "delete"]);

export function toCanonicalToolItemType(toolName: string | undefined): CanonicalItemType {
  const normalized = toolName?.trim().toLowerCase();
  if (normalized === "bash") {
    return "command_execution";
  }
  if (FILE_CHANGE_TOOLS.has(normalized ?? "")) {
    return "file_change";
  }
  if (normalized === "task") {
    return "collab_agent_tool_call";
  }
  if (["websearch", "webfetch", "codesearch"].includes(normalized ?? "")) {
    return "web_search";
  }
  return "dynamic_tool_call";
}

export function buildOpenCodeDiffSummary(
  diffs: ReadonlyArray<{
    readonly file: string;
    readonly before?: string;
    readonly after?: string;
    readonly patch?: string;
    readonly additions?: number;
    readonly deletions?: number;
    readonly status?: "added" | "deleted" | "modified";
  }>,
): string {
  return diffs
    .map((diff) => {
      const file = diff.file;
      const status = diff.status ?? "modified";
      const fromFile = diff.before ?? file;
      const toFile = diff.after ?? file;

      if (diff.patch) {
        return diff.patch;
      }

      return [
        `diff --git a/${file} b/${file}`,
        `--- a/${fromFile}`,
        `+++ b/${toFile}`,
        `@@ ${status} +${diff.additions ?? 0} -${diff.deletions ?? 0} @@`,
      ].join("\n");
    })
    .join("\n\n");
}

export function toCanonicalRequestType(permission: {
  readonly type?: string;
  readonly command?: string;
}): CanonicalRequestType {
  const type = permission.type?.toLowerCase() ?? "";
  const command = permission.command?.toLowerCase() ?? "";

  if (command.includes("bash") || command.includes("run")) {
    return "command_execution";
  }
  if (FILE_CHANGE_TOOLS.has(type) || FILE_CHANGE_TOOLS.has(command)) {
    return "file_change";
  }
  if (FILE_READ_TOOLS.has(type) || FILE_READ_TOOLS.has(command)) {
    return "file_read";
  }
  return "command";
}

export function toRuntimeTurnState(message: {
  readonly error?: { readonly name?: string };
}): RuntimeTurnState {
  if (!message.error) {
    return "completed";
  }
  const errorName = message.error.name ?? "";
  if (errorName === "MessageAbortedError") {
    return "interrupted";
  }
  if (errorName.includes("Abort")) {
    return "interrupted";
  }
  return "failed";
}

export function toOpenCodeModel(
  modelSelection: { readonly provider: string; readonly model: string },
  _options?: { readonly effort?: string },
): string {
  let model = modelSelection.model;
  const provider = modelSelection.provider;

  if (provider === "opencode") {
    if (!model.includes("/")) {
      model = `anthropic/${model}`;
    }
  }

  return model;
}

export function toOpenCodePermissionRules(
  runtimeMode: "approval-required" | "full-access",
): ReadonlyArray<{
  readonly type: string;
  readonly pattern: string;
  readonly disposition: "allow" | "deny";
}> {
  if (runtimeMode === "full-access") {
    return [
      { type: "command", pattern: ".*", disposition: "allow" },
      { type: "file-read", pattern: ".*", disposition: "allow" },
      { type: "file-change", pattern: ".*", disposition: "allow" },
    ];
  }

  return [
    { type: "command", pattern: "^$", disposition: "deny" },
    { type: "file-read", pattern: ".*", disposition: "allow" },
    { type: "file-change", pattern: "^$", disposition: "deny" },
  ];
}
