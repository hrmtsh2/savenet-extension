// runs before either of the content scripts (since it was declared before either in manifest)
(() => {

    // ns - shothand for namespace. saves us from writing window.__savenet all the time.
    // if window.__savenet doesn't exist (the '|| {}' part), it first creates it, and simultaneously assigns the same object in memory to ns
    const ns = (window.__savenet = window.__savenet || {});
    
    // canonical post signature (platform-agnostic) in which data will be exchanged b/w client extension and web server
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

    // share post with background.js
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

    // how common.js communicates with the window of the open webpage (which sent message using postMessage())
    window.addEventListener("message", (event) => {
        if (event.source !== window) return;
        const data = event.data;
        if (!data || data.source !== "savenet-network-monitor") return;
        window.dispatchEvent(new CustomEvent("savenet:network-candidate", { detail: data }));
    });
})();