import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export type Mode = "always" | "once";
export type Binding = { prompt: string; mode: Mode; file?: never } | { file: string; mode: Mode; prompt?: never };
export interface Config { version: 1; bindings: Record<string, Binding> }
export const STATE_TYPE = "model-system-prompts-state";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function loadConfig(file: string): Config {
  if (!existsSync(file)) return { version: 1, bindings: {} };
  const raw: unknown = JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  if (!isObject(raw) || raw.version !== 1 || !isObject(raw.bindings)) {
    throw new Error(`配置格式无效：${file}（需要 version: 1 和 bindings 对象）`);
  }
  const bindings: Record<string, Binding> = {};
  for (const [key, value] of Object.entries(raw.bindings)) {
    if (!/^[^/]+\/.+/.test(key) || !isObject(value)
      || !((typeof value.prompt === "string" && !!value.prompt.trim() && value.file === undefined)
        || (typeof value.file === "string" && !!value.file.trim() && value.prompt === undefined))
      || (value.mode !== "always" && value.mode !== "once")) {
      throw new Error(`模型绑定无效：${key}（prompt 不能为空，mode 只能为 always 或 once）`);
    }
    bindings[key] = typeof value.prompt === "string" ? { prompt: value.prompt, mode: value.mode }
      : { file: value.file as string, mode: value.mode };
  }
  return { version: 1, bindings };
}

export function saveBinding(file: string, key: string, binding: Binding | null): void {
  const config = loadConfig(file);
  if (binding) config.bindings[key] = binding;
  else delete config.bindings[key];
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify(config, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    renameSync(temp, file);
  } finally {
    rmSync(temp, { force: true });
  }
}

/** Accept a whole path, including spaces. Do not interpret backslashes as shell escapes. */
export function resolvePromptPath(input: string, baseDir: string): string {
  let file = input.trim();
  if (file.startsWith('"') || file.startsWith("'")) {
    if (file.length < 2 || file.at(-1) !== file[0]) throw new Error("文件路径的引号未闭合");
    file = file.slice(1, -1);
  }
  if (!file.trim()) throw new Error("请提供提示词文件路径");
  if (file === "~") file = homedir();
  else if (file.startsWith("~/") || file.startsWith("~\\")) file = join(homedir(), file.slice(2));
  return resolve(baseDir, file);
}

function canonical(file: string): string {
  const full = existsSync(file) ? realpathSync(file) : resolve(file);
  return process.platform === "win32" ? full.toLowerCase() : full;
}

export function readPrompt(file: string, agentDir: string, cwd: string): string {
  const actual = canonical(file);
  const nativeFiles = [join(agentDir, "APPEND_SYSTEM.md"), join(cwd, ".pi", "APPEND_SYSTEM.md")];
  if (nativeFiles.some((native) => canonical(native) === actual)) {
    throw new Error("该 APPEND_SYSTEM.md 会被 Pi 原生自动加载。请使用独立子目录中的文件，避免重复注入或首轮模式失效。");
  }
  if (!statSync(file).isFile()) throw new Error(`不是普通文件：${file}`);
  const content = readFileSync(file, "utf8").replace(/^\uFEFF/, "").trim();
  if (!content) throw new Error(`提示词文件为空：${file}`);
  return content;
}

/** Custom entries are stored in the session but never sent to the model. */
export function isConsumed(entries: readonly unknown[], model: string): boolean {
  let consumed = false;
  for (const entry of entries) {
    if (!isObject(entry) || entry.type !== "custom" || entry.customType !== STATE_TYPE || !isObject(entry.data)) continue;
    if (entry.data.version === 1 && entry.data.model === model && typeof entry.data.consumed === "boolean") {
      consumed = entry.data.consumed;
    }
  }
  return consumed;
}
