(function () {
    const tools = window.__SD_FORGE_NEO_PROMPT_AGENT__;
    if (!tools) return;
    const { activePromptTarget, promptAgentApp } = tools;

    async function generateImageTool(args, signal) {
        const target = args.target && args.target !== "active" ? args.target : activePromptTarget();
        const gallery = promptAgentApp().querySelector(`#${target}_gallery`);
        const generateButton = promptAgentApp().querySelector(`#${target}_generate, #${target}_interrupt`);
        if (!generateButton) return { ok: false, target: target, error: `Forge generate button not found for ${target}` };
        const before = gallery ? Array.from(gallery.querySelectorAll("img")).map(function (img) { return img.src; }) : [];
        const started = Date.now();
        generateButton.click();
        const deadline = started + 300_000;
        let interrupted = false;
        while (Date.now() < deadline) {
            if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
            await new Promise(function (resolve) { setTimeout(resolve, 1_000); });
            const interrupt = promptAgentApp().querySelector(`#${target}_interrupt`);
            interrupted = Boolean(interrupt && interrupt.offsetParent !== null);
            const images = gallery ? Array.from(gallery.querySelectorAll("img")) : [];
            const fresh = images.map(function (img) { return img.src; }).filter(function (src) { return src && !before.includes(src); });
            if (!interrupted && fresh.length) {
                try {
                    const response = await fetch(fresh[0]);
                    const blob = await response.blob();
                    const data = await new Promise(function (resolve, reject) {
                        const reader = new FileReader();
                        reader.onload = function () { resolve(String(reader.result || "")); };
                        reader.onerror = function () { reject(new Error("image read failed")); };
                        reader.readAsDataURL(blob);
                    });
                    const base64 = data.includes(",") ? data.split(",", 2)[1] : "";
                    if (!base64) return { ok: false, target: target, error: "generated image could not be read" };
                    return {
                        ok: true,
                        target: target,
                        duration_ms: Date.now() - started,
                        image_mime_type: blob.type || "image/png",
                        image_base64: base64
                    };
                } catch (error) {
                    return { ok: false, target: target, error: "generated image could not be read" };
                }
            }
        }
        return { ok: false, target: target, error: interrupted ? "generation is still running after 300s" : "no new image appeared after clicking generate" };
    }

    tools.generateImageTool = generateImageTool;
})();
