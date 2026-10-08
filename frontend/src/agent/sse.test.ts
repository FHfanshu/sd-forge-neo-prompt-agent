import { describe, expect, it } from "vitest";
import { SseParser } from "./sse";

const event = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`;
const delta = (d: Record<string, unknown>) => event({ choices: [{ delta: d }] });

function feed(parser: SseParser, text: string, chunk = 7) {
  const out = { content: "", reasoning: "" };
  for (let i = 0; i < text.length; i += chunk) {
    const d = parser.push(text.slice(i, i + chunk));
    out.content += d.content;
    out.reasoning += d.reasoning;
  }
  const tail = parser.finish();
  out.content += tail.content;
  out.reasoning += tail.reasoning;
  return out;
}

describe("SseParser", () => {
  it("assembles content, reasoning fields, and usage across arbitrary chunk boundaries", () => {
    const parser = new SseParser();
    const text = delta({ reasoning_content: "think " }) + delta({ reasoning: "more" }) + delta({ content: "Hel" }) + delta({ content: "lo" }) +
      event({ choices: [], usage: { total_tokens: 9 } }) + "data: [DONE]\n\n";
    expect(feed(parser, text)).toEqual({ content: "Hello", reasoning: "think more" });
    expect(parser.result.usage).toEqual({ total_tokens: 9 });
    expect(parser.done).toBe(true);
  });

  it("assembles streamed tool calls by index", () => {
    const parser = new SseParser();
    const text =
      delta({ tool_calls: [{ index: 0, id: "c1", function: { name: "read_", arguments: "{\"tar" } }] }) +
      delta({ tool_calls: [{ index: 0, function: { name: "prompt", arguments: "get\":1}" } }] }) +
      delta({ tool_calls: [{ index: 1, id: "c2", function: { name: "x", arguments: "{}" } }] });
    feed(parser, text, 5);
    expect(parser.result.toolCalls).toEqual([
      { id: "c1", name: "read_prompt", arguments: "{\"target\":1}" },
      { id: "c2", name: "x", arguments: "{}" },
    ]);
  });

  it("splits inline <think> blocks into reasoning even when tags straddle chunks", () => {
    const parser = new SseParser();
    const text = delta({ content: "<thi" }) + delta({ content: "nk>plan it</th" }) + delta({ content: "ink>\nAnswer" });
    expect(feed(parser, text, 3)).toEqual({ content: "Answer", reasoning: "plan it" });
  });

  it("leaves content alone when it does not start with <think>", () => {
    const parser = new SseParser();
    expect(feed(parser, delta({ content: "<b>hi</b> <think>" }))).toEqual({ content: "<b>hi</b> <think>", reasoning: "" });
  });

  it("throws on an in-stream error event", () => {
    const parser = new SseParser();
    expect(() => parser.push(event({ error: { message: "模型服务连接中断" } }))).toThrow("模型服务连接中断");
  });
});
