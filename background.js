// keys for chrome.storage.local
const configKey = "savenetCondfig"; // backend config for the user
const queueKey = "savenetQueue"; // retry queue for tracking backend request retries
const logKey = "savenetCaptureLog"; // capture history log
const maxLog = 50;

// final prod - vercel build, aws cognito auth
const apiBase = "https://savenet-app-build.vercel.app";
const cognitoDomain = "https://ap-south-1gevfg0ops.auth.ap-south-1.amazoncognito.com";
const clientId = "52gkrui2tsdvgi7l27ojeh18oh";
const redirectUri = `https://achceaepckifblghhnbedcladddiailp.chromiumapp.org`;
const scopes = "openid email profile"

// pkce (proof key for code exchange) helpers

function base64UrlEncode(buffer){
    return btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function generateRandomString(length = 64){
    const array = new Uint8Array(length);
    crypto.getRandomValues(array);
    return base64UrlEncode(array.buffer).slice(0, length);
}
async function sha256(plain){
    const encoder = new TextEncoder();
    const data = encoder.encode(plain);
    return crypto.subtle.digest("SHA-256", data);
}
async function generatePkcePair(){
    const verifier = generateRandomString();
    const challengeBuffer = await sha256(verifier);
    const challenge = base64UrlEncode(challengeBuffer);
    return { verifier, challenge };
}

async function getConfig(){
    const result = await chrome.storage.local.get(configKey);
    return result[configKey] || { token: null, email: null };
}

async function setConfig(partial){
    const current = await getConfig();
    await chrome.storage.local.set({ [configKey]: { ...current, ...partial } });
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

async function startOAuthFlow(){
    const { verifier, challenge } = await generatePkcePair();
    const authUrl = `${cognitoDomain}/oauth2/authorize` +
    `?response_type=code` + 
    `&client_id=${clientId}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${encodeURIComponent(scopes)}` +
    `&code_challenge=${challenge}` +
    `&code_challenge_method=S256`
    ;

    console.log("[Savenet] Auth URL:", authUrl);
    console.log("[Savenet] redirectUri:", redirectUri);

    return new Promise((resolve, reject) => {
        chrome.identity.launchWebAuthFlow(
            { url: authUrl, interactive: true },
            async (responseUrl) => {
                console.log("[SaveNet] responseUrl:", responseUrl);
                console.log("[SaveNet] lastError:", chrome.runtime.lastError?.message);
                if (chrome.runtime.lastError || !responseUrl){
                    reject(new Error(chrome.runtime.lastError?.message || "Auth cancelled"));
                    return;
                }

                const url = new URL(responseUrl);
                const code = url.searchParams.get("code");
                if (!code){
                    reject(new Error("No auth code in response"));
                    return;
                }

                // exchange code for savenet via backend
                try {
                    const response = await fetch(`${apiBase}/api/auth/extension-token`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ code, codeVerifier: verifier })
                    });

                    if (!response.ok) {
                        const errText = await response.text();
                        console.error("[Savenet] Token exchange failed: ", errText);
                        reject(new Error(`Token exchange failed: ${response.status}`));
                        return;
                    }

                    const { token, email } = await response.json();
                    await setConfig({ token, email });
                    resolve({ token, email });
                } catch (err){
                    reject(err);
                }
            }
        );
    });
}

async function postCapture(post){
    const config = await getConfig();
    if (!config.apiBaseUrl){
        return { ok: false, reason: "not_logged_in" };
    }

    try {
        const response = await fetch(`${apiBase}/api/posts/capture`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${config.token}`
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
        status: result.ok ? "sent" : result.reason === "not_logged_in" ? "not_logged_in" : "queued",
        reason: result.ok ? "" : result.reason
    });

    if (!result.ok && result.reason !== "not_logged_in"){
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
                status: "sent",
                reason: ""
            })
        } else {
            remaining.push(post);
        }
    }

    await setQueue(remaining);
    return { flushed, remaining: remaining.length };
}

let storageLock = Promise.resolve();
function withLock(fn){
    const result = storageLock.then(fn, fn);
    storageLock = result.catch(() => {});
    return result;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "capture_post"){
        handleCapture(msg.post).then(sendResponse);
        return true;
    }

    if (msg.type === "start_login"){
        startOAuthFlow().then((result) => sendResponse({ ok: true, ...result })).catch((err) => sendResponse({ ok: false, error: err.message }));
        return true;
    }

    if (msg.type === "logout"){
        setConfig({ token: null, email: null }).then(() => {
            sendResponse({ ok: true });
        });
        return true;
    }

    if (msg.type === "get_auth_state"){
        getConfig().then((config) => {
            sendResponse({ loggedIn: !!config.token, email: config.email || null });
        });
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