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
    if (object(payload.context) && hasMarker(payload.context)) return true;
    return [payload.messages, payload.input].some((messages) => Array.isArray(messages) && messages.some((message) =>
      object(message) && (message.role === "system" || message.role === "developer")
      && (contains(message.content) || (object(message.sections) && Object.values(message.sections).some(contains)))));
  }

  function patch(payload: unknown, text?: string, position: "first" | "last" = "first"): { payload: unknown; supported: boolean } {
    let supported = false;
    let counting = position === "last";
    let remaining = counting ? 0 : 1;
    function replace(value: string): string {
      return value.replace(pattern, (match) => {
        if (counting) { remaining++; return match; }
        supported = true;
        if (--remaining !== 0 || text === undefined) return "";
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
      if (object(value.context)) result.context = walk(value.context);
      // Codex splits its policy between instructions and input developer items.
      // Visit all system fields and replace the owned block only once.
      for (const field of ["messages", "input"]) {
        if (!Array.isArray(value[field])) continue;
        result[field] = value[field].flatMap((message) => {
          if (!object(message) || (message.role !== "system" && message.role !== "developer")) return [message];
          const clean = content(message.content);
          const sections = object(message.sections)
            ? Object.fromEntries(Object.entries(message.sections).map(([key, value]) => [key, content(value)])) : undefined;
          if (contains(message.content) && (clean === "" || (Array.isArray(clean) && !clean.length))
            && !sections && !message.toolsAdded && !message.toolsRemoved) return [];
          return [{ ...message, content: clean, ...(sections ? { sections } : {}) }];
        });
      }
      return result;
    }
    // Pi replays section updates in order; the final marker must carry the rule.
    // Other hosts retain the first insertion to avoid duplicate developer blocks.
    if (counting) { walk(payload); counting = false; }
    const replacement = walk(payload);
    return { payload: replacement, supported };
  }
  return { block, patch, hasMarker };
}
