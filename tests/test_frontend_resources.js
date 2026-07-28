const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

global.window = {
    location: { origin: "http://127.0.0.1:7860" },
    setTimeout,
    __SD_FORGE_NEO_PROMPT_AGENT__: {
        assistantState: { loadedPromptSkills: {}, promptReads: {} },
        promptContextSnapshot: () => ({ context_hash: "ctx" }),
        promptFieldRootForTarget: () => ({ target: "txt2img", root: null }),
        promptAgentApp: () => ({ querySelector: () => null, querySelectorAll: () => [] }),
        readPromptTool: async () => ({}),
        positivePromptNoPhrases: () => [],
        setNativeValueIfAvailable: () => true,
        setTextboxValue: () => true,
        styleSelectorValue: () => "",
        textboxValue: () => ""
    }
};

require(path.resolve(__dirname, "../javascript/prompt_agent_02_resources.js"));
const tools = window.__SD_FORGE_NEO_PROMPT_AGENT__;

test("appendFragment is idempotent", () => {
    assert.deepEqual(tools.appendFragment("base", "__artists__"), { value: "base, __artists__", changed: true });
    assert.deepEqual(tools.appendFragment("base, __artists__", "__artists__"), { value: "base, __artists__", changed: false });
});

test("resource and skill tools are registered for agent execution", () => {
    assert.deepEqual([...tools.RESOURCE_TOOLS], [
        "search_resources",
        "inspect_resource",
        "load_skill",
        "search_danbooru_tags",
        "inspect_danbooru_tags",
        "related_danbooru_tags",
        "search_danbooru_wikis",
        "inspect_danbooru_wikis"
    ]);
    assert.ok(tools.RESOURCE_TOOLS.has("load_skill"));
    assert.ok(tools.RESOURCE_TOOLS.has("search_danbooru_tags"));
    assert.ok(tools.RESOURCE_TOOLS.has("inspect_danbooru_tags"));
    assert.ok(tools.RESOURCE_TOOLS.has("related_danbooru_tags"));
});

test("batch Danbooru search forwards all queries", async () => {
    const originalFetch = global.fetch;
    let requested;
    global.fetch = async (url) => {
        requested = url;
        return { ok: true, json: async () => ({ ok: true, items: [] }) };
    };
    try {
        await tools.searchDanbooruTagsTool({ queries: ["blue hair", "long hair"] });
    } finally {
        global.fetch = originalFetch;
    }
    const url = new URL(requested, window.location.origin);
    assert.equal(url.pathname, "/prompt-agent/api/danbooru/tags/search");
    assert.deepEqual(JSON.parse(url.searchParams.get("queries")), ["blue hair", "long hair"]);
    assert.equal(url.searchParams.get("query"), null);
});

test("Danbooru inspection requests wiki content by default and allows an explicit metadata-only opt-out", async () => {
    const originalFetch = global.fetch;
    const requested = [];
    global.fetch = async (url) => {
        requested.push(new URL(url, window.location.origin));
        return { ok: true, json: async () => ({ ok: true, items: [] }) };
    };
    try {
        await tools.inspectDanbooruTagsTool({ names: ["blue hair"] });
        await tools.inspectDanbooruTagsTool({ names: ["blue hair"], include_wiki: false });
    } finally {
        global.fetch = originalFetch;
    }
    assert.equal(requested[0].pathname, "/prompt-agent/api/danbooru/tags/inspect-batch");
    assert.equal(requested[0].searchParams.get("include_wiki"), "true");
    assert.equal(requested[1].searchParams.get("include_wiki"), "false");
});

test("Danbooru Wiki tools preserve multi-hop search and inspection inputs", async () => {
    const originalFetch = global.fetch;
    const requested = [];
    global.fetch = async (url) => {
        requested.push(new URL(url, window.location.origin));
        return { ok: true, json: async () => ({ ok: true, items: [] }) };
    };
    try {
        await tools.searchDanbooruWikisTool({ queries: ["frutiger", "tag group:visual aesthetic"], limit: 6 });
        await tools.inspectDanbooruWikisTool({ titles: ["frutiger_aero", "tag_group:visual_aesthetic"] });
    } finally {
        global.fetch = originalFetch;
    }
    assert.equal(requested[0].pathname, "/prompt-agent/api/danbooru/wikis/search");
    assert.equal(requested[0].searchParams.get("queries"), JSON.stringify(["frutiger", "tag group:visual aesthetic"]));
    assert.equal(requested[1].pathname, "/prompt-agent/api/danbooru/wikis/inspect-batch");
    assert.equal(requested[1].searchParams.get("titles"), "frutiger_aero,tag_group:visual_aesthetic");
});

test("resource mutation guard depends on the latest prompt context, not a second user confirmation", () => {
    window.__SD_FORGE_NEO_PROMPT_AGENT__.assistantState.promptReads.txt2img = { context_hash: "ctx" };
    assert.equal(tools.resourceMutationGuard({ target: "txt2img", context_hash: "ctx" }).ok, true);
});
