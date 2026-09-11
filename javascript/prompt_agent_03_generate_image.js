(function () {
    const tools = window.__SD_FORGE_NEO_PROMPT_AGENT__;
    if (!tools) return;
    const { activePromptTarget, promptAgentApp } = tools;

    async function generateImageTool(args, signal) {
        const target = args.target && args.target !== "active" ? args.target : activePromptTarget();
        const gallery = promptAgentApp().querySelector(`#${target}_gallery`);
        const generateButton = promptAgentApp().querySelector(`#${target}_generate`);
        if (!generateButton) return { ok: false, target: target, error: `Forge generate button not found for ${target}` };
        const before = gallery ? Array.from(gallery.querySelectorAll("img")).map(function (img) { return img.src; }) : [];
        const started = Date.now();
        const deadline = started + 300_000;
        const sleep = function () { return new Promise(function (resolve) { setTimeout(resolve, 1_000); }); };
        const interruptVisible = function () {
            const interrupt = promptAgentApp().querySelector(`#${target}_interrupt`);
            return Boolean(interrupt && interrupt.offsetParent !== null);
        };
        let waitedForBusy = false;
        while (interruptVisible()) {
            if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
            if (Date.now() >= deadline) return { ok: false, target: target, error: "another generation is still running; wait for it or interrupt it before retrying" };
            waitedForBusy = true;
            await sleep();
        }
        generateButton.click();
        while (Date.now() < deadline) {
            if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
            await sleep();
            const images = gallery ? Array.from(gallery.querySelectorAll("img")) : [];
            const fresh = images.map(function (img) { return img.src; }).filter(function (src) { return src && !before.includes(src); });
            if (!fresh.length || interruptVisible()) continue;
            try {
                const response = await fetch(fresh[0]);
                const blob = await response.blob();
                const data = await new Promise(function (resolve, reject) {
                    const img = new Image();
                    const url = URL.createObjectURL(blob);
                    img.onload = function () {
                        const scale = Math.min(1, 1024 / Math.max(img.naturalWidth, img.naturalHeight));
                        const canvas = document.createElement("canvas");
                        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
                        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
                        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
                        URL.revokeObjectURL(url);
                        resolve(canvas.toDataURL("image/jpeg", 0.85));
                    };
                    img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("image read failed")); };
                    img.src = url;
                });
                const base64 = data.includes(",") ? data.split(",", 2)[1] : "";
                if (!base64) return { ok: false, target: target, error: "generated image could not be read" };
                return {
                    ok: true,
                    target: target,
                    duration_ms: Date.now() - started,
                    image_mime_type: "image/jpeg",
                    image_base64: base64
                };
            } catch (error) {
                return { ok: false, target: target, error: "generated image could not be read" };
            }
        }
        return { ok: false, target: target, error: waitedForBusy ? "generation did not finish within 300s" : "no new image appeared after clicking generate" };
    }

    tools.generateImageTool = generateImageTool;

    function forgeSkillHint() {
        function controlValue(selector) {
            const root = document.querySelector(selector);
            const control = root && (root.matches("input, select, textarea") ? root : root.querySelector("input, select, textarea"));
            return control ? String(control.value ?? "").trim() : "";
        }
        const preset = controlValue("#forge_ui_preset");
        const checkpoint = controlValue("#setting_sd_model_checkpoint");
        const hay = (preset + " " + checkpoint).toLowerCase();
        return {
            ui_preset: preset || null,
            checkpoint: checkpoint || null,
            recommended_skill: hay.includes("anima") ? "anima_dit" : hay.includes("krea") ? "krea2" : null,
        };
    }

    tools.forgeSkillHint = forgeSkillHint;
})();
