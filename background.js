const defaultConfig = {
    apiBaseUrl: "",
    authToken: ""
};

// keys for chrome.storage.local
const configKey = "savenetCondfig"; // backend config for the user
const queueKey = "savenetQueue"; // retry queue for tracking backend request retries
const logKey = "savenetCaptureLog"; // capture history log
const maxLog = 50;

async function getConfig(){
    const result = await chrome.storage.local.get(configKey);
    return { ...defaultConfig, ...(result[configKey] || {}) };
}

async function setConfig(partial){
    const current = await getConfig();
    const next = { ...current, ...partial };
    await chrome.storage.local.set({ [configKey]: next });
    return next;
}

async function getQueue(){
    const result = await chrome.storage.local.get(queueKey);
    return result[queueKey] || [];
}

async function setQueue(queue){
    await chrome.storage.local.set({ [queueKey]: queue });
}

async function appendLog(entry){
    const result = await chrome.storage.local.get(logKey);
    const log = result[logKey] || [];
    log.unshift(entry);
    if (log.length > maxLog) log.length = maxLog;
    await chrome.storage.local.set({ [logKey]: log });
}

async function postCapture(post){
    const config = await getConfig();
    if (!config.apiBaseUrl){
        return { ok: false, reason: "not_configured" };
    }

    try {
        const response = await fetch(
            `${config.apiBaseUrl.replace(/\/+$/, "")}/api/posts/capture`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(config.authToken ? { Authorization: `Bearer ${config.authToken}` } : {})
                },
                body: JSON.stringify(post)
            }
        );

        if (!response.ok){
            return { ok: false, reason: `http_${response.status}` };
        }

        return { ok: true };
    } catch (err){
        return { ok: false, reason: err?.message || "network_error" };
    }
}

async function handleCapture(post){
    const result = await postCapture(post);

    await appendLog({
        pltform: post.platform,
        postUrl: post.postUrl,
        caption: (post.caption || "").slice(0, 120),
        capturedAt: post.capturedAt,
        status: result.ok ? "sent" : "queued",
        reason: result.ok ? "" : result.reason
    });

    if (!result.ok){
        const queue = await getQueue();
        queue.push(post);
        await setQueue(queue);
    }

    return result;
}

async function flushQueue(){
    const queue = await getQueue();
    if (queue.length === 0) return { flushed: 0, remaining: 0 };
    const remaining = [];
    let flushed = 0;
    for (const post of queue){
        const result = await postCapture(post);
        if (result.ok){
            flushed += 1;
            await appendLog({
                platform: post.platform,
                platformPostId: post.platformPostId,
                postUrl: post.postUrl,
                caption: (post.caption || "").slice(0, 120),
                capturedAt: post.capturedAt,
                status: "sent"
            })
        } else {
            remaining.push(post);
        }
    }

    await setQueue(remaining);
    return { flushed, remaining: remaining.length };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "capture_post"){
        handleCapture(msg.post).then(sendResponse);
        return true;
    }

    if (msg.type === "getConfig"){
        getConfig().then(sendResponse);
        return true;
    }

    if (msg.type === "set_config"){
        setConfig(msg.config).then(sendResponse);
        return true;
    }

    if (msg.type === "get_capture_log"){
        chrome.storage.local.get(logKey).then((result) => {
            sendResponse({ log: result[logKey] || []})
        });
        return true;
    }

    if (msg.type === "get_queue_size"){
        getQueue().then((queue) => sendResponse({ size: queue.length }));
        return true;
    }

    if (msg.type === "flush_queue"){
        flushQueue().then(sendResponse);
        return true;
    }

    if (msg.type === "clear_log"){
        chrome.storage.local.set({ [logKey]: [] }).then(() => { sendResponse({ ok: true }); })        
        return true;
    }
});

chrome.runtime.onStartup.addListener(() => {
    flushQueue();
})

console.log("[Savenet] Background service worker started.");