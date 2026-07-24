(() => {
    const ns = (window.__savenet = window.__savenet || {});
    
    ns.makePost = (fields) => ({
        platform: fields.platform,
        platformPostId: fields.platformPostId || null,
        postUrl: fields.postUrl,
        caption: (fields.caption || "").trim(),
        authorHandle: fields.authorHandle || "",
        authorName: fields.authorName || "",
        thumbnailUrl: fields.thumbnailUrl || "",
        mediaType: fields.mediaType || "unknown",
        capturedAt: new Date().toISOString(),
        sourceUrl: window.location.href,
        raw: fields.raw || {}
    });

    ns.sendCapture = (post) => {
        try {
            chrome.runtime.sendMessage({ type: "capture_post", post }, (res) => {
                const err = chrome.runtime.lastError;
                if (err){
                    console.warn("[Savenet] sendMessage error: ", err.message);
                    return;
                }
                console.log("[Savenet] capture result: ", res);
            });
        } catch (err){
            console.warn("[Savenet] capture failed: ", err);
        }
    };
    
    ns.normaliseText = (value) => (value || "").replace(/\s+/g, " ").trim();
    ns.log = (...args) => console.log("[Savenet]", ...args);

})();