import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    api: {
      updateSession: vi.fn(),
      sessions: vi.fn(),
    },
  };
});

const { api, ApiError } = await import("./api");
const { chooseModel, refreshSessions } = await import("./controller");
const { app } = await import("./state.svelte");

const session = { id: "s1", title: "t", profile_id: "p1", model: "a", created_at: 0, updated_at: 0 };

describe("session deleted elsewhere", () => {
  beforeEach(() => {
    vi.mocked(api.updateSession).mockReset();
    app.sessions = [session];
    app.sessionId = "s1";
    app.notice = "";
  });

  it("switching model still applies and falls back to a new session", async () => {
    vi.mocked(api.updateSession).mockRejectedValue(new ApiError(404, "NOT_FOUND", "会话不存在"));
    await chooseModel("p2", "b");
    expect(app.sessionId).toBeNull();
    expect([app.draftProfileId, app.draftModel]).toEqual(["p2", "b"]);
    expect(app.notice).not.toBe("");
  });

  it("other errors keep the session and show the message", async () => {
    vi.mocked(api.updateSession).mockRejectedValue(new ApiError(500, "INTERNAL", "boom"));
    await chooseModel("p2", "b");
    expect(app.sessionId).toBe("s1");
    expect(app.notice).toBe("boom");
  });

  it("refreshing the list notices the open session is gone", async () => {
    vi.mocked(api.sessions).mockResolvedValue({ sessions: [] });
    await refreshSessions();
    expect(app.sessionId).toBeNull();
  });
});
