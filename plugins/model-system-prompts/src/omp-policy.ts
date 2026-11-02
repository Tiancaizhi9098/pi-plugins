import { randomUUID } from "node:crypto";

type RecordValue = Record<string, unknown>;
const object = (value: unknown): value is RecordValue => !!value && typeof value === "object" && !Array.isArray(value);

/** Only touch system fields. Per-instance markers cannot collide with pasted text. */
export function createPolicy() {
  const id = randomUUID();
  const begin = `<!-- model-system-prompts:${id}:begin -->`;
  const end = `<!-- model-system-prompts:${id}:end -->`;
  const pattern = new RegExp(`\\n{0,2}${begin}[\\s\\S]*?${end}`, "g");
  const block = (text: string | undefined) => text === undefined ? "" : `${begin}\n${text}\n${end}`;

  function contains(value: unknown): boolean {
    if (typeof value === "string") return value.includes(begin);
    if (Array.isArray(value)) return value.some(contains);
    return object(value) && (contains(value.text) || contains(value.parts));
  }

  function hasMarker(payload: unknown): boolean {
    if (!object(payload)) return false;
    if (contains(payload.instructions) || contains(payload.system) || contains(payload.systemInstruction) || contains(payload.prompt)) return true;
    if (object(payload.config) && contains(payload.config.systemInstruction)) return true;
    if (object(payload.request) && hasMarker(payload.request)) return true;
    return [payload.messages, payload.input].some((messages) => Array.isArray(messages) && messages.some((message) =>
      object(message) && (message.role === "system" || message.role === "developer") && contains(message.content)));
  }

  function patch(payload: unknown, text?: string): { payload: unknown; supported: boolean } {
    let supported = false;
    let inserted = false;
    function replace(value: string): string {
      return value.replace(pattern, (match) => {
        supported = true;
        if (text === undefined || inserted) return "";
        inserted = true;
        // Keep the rule in its original system position, including flattened
        // transports. Never move it after user input or into a different role.
        return match.slice(0, match.indexOf(begin)) + block(text);
      });
    }
    function content(value: unknown): unknown {
      if (typeof value === "string") return replace(value);
      if (Array.isArray(value)) return value.flatMap((part) => {
        const clean = content(part);
        return contains(part) && (clean === "" || (object(clean) && clean.text === "")) ? [] : [clean];
      });
      if (object(value) && typeof value.text === "string") return { ...value, text: replace(value.text) };
      if (object(value) && Array.isArray(value.parts)) return { ...value, parts: content(value.parts) };
      return value;
    }
    function walk(value: unknown): unknown {
      if (!object(value)) return value;
      const result = { ...value };
      // Responses/Apple, Anthropic/Bedrock, Gemini, and Devin respectively.
      for (const field of ["instructions", "system", "systemInstruction", "prompt"]) {
        if (value[field] !== undefined) result[field] = content(value[field]);
      }
      if (object(value.config) && value.config.systemInstruction !== undefined) {
        result.config = { ...value.config, systemInstruction: content(value.config.systemInstruction) };
      }
      if (object(value.request)) result.request = walk(value.request);
      // Codex splits its policy between instructions and input developer items.
      // Visit all system fields and replace the owned block only once.
      for (const field of ["messages", "input"]) {
        if (!Array.isArray(value[field])) continue;
        result[field] = value[field].flatMap((message) => {
          if (!object(message) || (message.role !== "system" && message.role !== "developer")) return [message];
          const clean = content(message.content);
          if (contains(message.content) && (clean === "" || (Array.isArray(clean) && !clean.length))) return [];
          return [{ ...message, content: clean }];
        });
      }
      return result;
    }
    const replacement = walk(payload);
    return { payload: replacement, supported };
  }
  return { block, patch, hasMarker };
}
