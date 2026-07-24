const configKey = "savenetCondfig";
const queueKey = "savenetQueue";
const logKey = "savenetCaptureLog";
const maxLog = 50;

const apiBase = "https://savenet.am1.tech";
const cognitoDomain = "https://ap-south-1gevfg0ops.auth.ap-south-1.amazoncognito.com";
const clientId = "52gkrui2tsdvgi7l27ojeh18oh";
const redirectUri = `https://kmbfnbpogmgfmlohnajkpmeicocpedof.chromiumapp.org`;
const scopes = "openid email profile"

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

function normaliseLabelIds(labelIds){
    return [...new Set((Array.isArray(labelIds) ? labelIds : []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
}

async function getActiveLabelIds(){
    const config = await getConfig();
    return normaliseLabelIds(config.activeLabelIds);
}

async function applyActiveLabels(post){
    const labelIds = Array.isArray(post.labelIds) ? normaliseLabelIds(post.labelIds) : await getActiveLabelIds();
    return { ...post, labelIds };
}

async function getAvailableLabels(){
    const config = await getConfig();
    if (!config.token) return { ok: false, error: "Not logged in", labels: [], activeLabelIds: [] };

    try {
        const response = await fetch(`${apiBase}/api/labels`, {
            headers: { Authorization: `Bearer ${config.token}` }
        });
        if (!response.ok) throw new Error(`http_${response.status}`);
        const data = await response.json();
        const labels = Array.isArray(data.labels) ? data.labels.filter((label) => Number.isInteger(label?.id) && typeof label?.name === "string") : [];
        const validIds = new Set(labels.map((label) => label.id));
        const activeLabelIds = normaliseLabelIds(config.activeLabelIds).filter((id) => validIds.has(id));
        await setConfig({ labels, activeLabelIds });
        return { ok: true, labels, activeLabelIds };
    } catch (err) {
        return {
            ok: false,
            error: err?.message || "Unable to load labels",
            labels: Array.isArray(config.labels) ? config.labels : [],
            activeLabelIds: normaliseLabelIds(config.activeLabelIds)
        };
    }
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

async function startCognitoLogout(){
    const logoutUrl = 
      `${cognitoDomain}/logout` +
      `?client_id=${clientId}` +
      `&logout_uri=${encodeURIComponent(redirectUri)}`
    return new Promise((resolve) => {
        chrome.identity.launchWebAuthFlow(
            { url: logoutUrl, interactive: false },
            () => {
                resolve(null)
            }
        )
    })
}

async function postCapture(post){
    const config = await getConfig();
    if (!config.token){
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
    const labelledPost = await applyActiveLabels(post);
    const result = await postCapture(labelledPost);

    await appendLog({
        platform: labelledPost.platform,
        postUrl: labelledPost.postUrl,
        caption: (labelledPost.caption || "").slice(0, 120),
        capturedAt: labelledPost.capturedAt,
        status: result.ok ? "sent" : result.reason === "not_logged_in" ? "not_logged_in" : "queued",
        reason: result.ok ? "" : result.reason
    });

    if (!result.ok && result.reason !== "not_logged_in"){
        const queue = await getQueue();
        queue.push(labelledPost);
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

async function getBookmarkTree() {
  return new Promise((resolve) => {
    chrome.bookmarks.getTree((tree) => resolve(tree));
  });
}

function flattenBookmarkFolders(nodes, path = "") {
  const folders = [];
  for (const node of nodes) {
    if (node.children) {
      const folderPath = path ? `${path} / ${node.title}` : (node.title || "Bookmarks");
      if (node.id !== "0") { // skip invisible root
        folders.push({ id: node.id, title: folderPath, count: countBookmarks(node) });
      }
      folders.push(...flattenBookmarkFolders(node.children, folderPath));
    }
  }
  return folders;
}

function countBookmarks(node) {
  if (!node.children) return node.url ? 1 : 0;
  return node.children.reduce((sum, child) => sum + countBookmarks(child), 0);
}

function flattenBookmarksInFolder(nodes) {
  const bookmarks = [];
  for (const node of nodes) {
    if (node.url) bookmarks.push(node);
    if (node.children) bookmarks.push(...flattenBookmarksInFolder(node.children));
  }
  return bookmarks;
}

async function importBookmarksFromFolder(folderId) {
  const [folder] = await new Promise((resolve) =>
    chrome.bookmarks.getSubTree(folderId, resolve)
  );
  const bookmarks = flattenBookmarksInFolder(folder.children || []);
  let sent = 0;
  let failed = 0;
  const labelIds = await getActiveLabelIds();

  for (const bm of bookmarks) {
    if (!bm.url || bm.url.startsWith("javascript:")) continue;
    const post = {
      platform: "browser_bookmark",
      platformPostId: null,
      postUrl: bm.url,
      caption: bm.title || "",
      authorHandle: "",
      authorName: "",
      thumbnailUrl: "",
      mediaType: "bookmark",
      capturedAt: bm.dateAdded
        ? new Date(bm.dateAdded).toISOString()
        : new Date().toISOString(),
      sourceUrl: bm.url,
      labelIds,
      raw: { title: bm.title, folderId },
    };
    const result = await handleCapture(post);
    if (result.ok) sent++;
    else failed++;
  }
  return { sent, failed, total: bookmarks.length };
}

async function importReadingList() {
  if (!chrome.readingList) {
    return { ok: false, error: "Reading List API not available in this browser" };
  }
  const entries = await chrome.readingList.query({});
  let sent = 0;
  let failed = 0;
  const labelIds = await getActiveLabelIds();

  for (const entry of entries) {
    const post = {
      platform: "reading_list",
      platformPostId: null,
      postUrl: entry.url,
      caption: entry.title || "",
      authorHandle: "",
      authorName: "",
      thumbnailUrl: "",
      mediaType: "article",
      capturedAt: entry.creationTime
        ? new Date(entry.creationTime).toISOString()
        : new Date().toISOString(),
      sourceUrl: entry.url,
      labelIds,
      raw: { title: entry.title, hasBeenRead: entry.hasBeenRead },
    };
    const result = await handleCapture(post);
    if (result.ok) sent++;
    else failed++;
  }
  return { ok: true, sent, failed, total: entries.length };
}

chrome.bookmarks.onCreated.addListener(async (id, bookmark) => {
  if (!bookmark.url) return;
  const post = {
    platform: "browser_bookmark",
    platformPostId: null,
    postUrl: bookmark.url,
    caption: bookmark.title || "",
    authorHandle: "",
    authorName: "",
    thumbnailUrl: "",
    mediaType: "bookmark",
    capturedAt: new Date().toISOString(),
    sourceUrl: bookmark.url,
    raw: { title: bookmark.title },
  };
  await handleCapture(post);
});

if (chrome.readingList?.onEntryAdded) {
  chrome.readingList.onEntryAdded.addListener(async (entry) => {
    const post = {
      platform: "reading_list",
      platformPostId: null,
      postUrl: entry.url,
      caption: entry.title || "",
      authorHandle: "",
      authorName: "",
      thumbnailUrl: "",
      mediaType: "article",
      capturedAt: new Date().toISOString(),
      sourceUrl: entry.url,
      raw: { title: entry.title },
    };
    await handleCapture(post);
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "capture_post"){
        handleCapture(msg.post).then(sendResponse);
        return true;
    }

    if (msg.type === "start_collection_import"){
        getActiveLabelIds().then((labelIds) => chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
            console.log("[SaveNet BG] sending to tab:", tab?.id, tab?.url);
            if (!tab?.id || !tab.url){
                sendResponse({ ok: false, error: "No active tab" });
                return;
            }
                const pathname = new URL(tab.url).pathname;
                const match = pathname.match(/^\/[^/]+\/saved\/([^/]+)/);
                const collectionName = match ? decodeURIComponent(match[1]).replace(/-/g, " ") : "";
                chrome.tabs.sendMessage(tab.id, { type: "start_collection_import", collectionName, labelIds }, (response) => {
                console.log("[SaveNet BG] content script response:", response, chrome.runtime.lastError?.message);
            });
            sendResponse({ ok: true });
        }))
        return true;
    }

    if (msg.type === "collection_import_progress"){
        chrome.runtime.sendMessage({ type: "collection_import_progress", count: msg.count }).catch(() => {});
        sendResponse({ ok: true });
        return true;
    }

    if (msg.type === "collection_import_complete"){
        chrome.runtime.sendMessage({ type: "collection_import_complete", count: msg.count }).catch(() => {});
        sendResponse({ ok: true });
        return true;
    }

    if (msg.type === "check_collection_page") {
        console.log("[SaveNet BG] check_collection_page received");
        chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
            console.log("[SaveNet BG] tab url:", tab?.url);
            if (!tab?.url) { 
                sendResponse({ isCollection: false });
                return;
            }
            try {
                const url = new URL(tab.url);
                if (url.hostname !== "www.instagram.com") {
                    sendResponse({ isCollection: false });
                    return;
                }
                const isCollection = /^\/[^/]+\/saved\/.+/i.test(url.pathname);
                const collectionMatch = url.pathname.match(/^\/[^/]+\/saved\/([^/]+)/);
                const rawName = collectionMatch ? collectionMatch[1] : "saved posts";
                const collectionName = rawName.replace(/-/g, " ");
                sendResponse({ isCollection, collectionName });
            } catch {
            sendResponse({ isCollection: false });
            }
        })
        return true;
    }

    if (msg.type === "start_login"){
        startOAuthFlow().then((result) => sendResponse({ ok: true, ...result })).catch((err) => sendResponse({ ok: false, error: err.message }));
        return true;
    }

    if (msg.type === "logout"){
        startCognitoLogout()
          .catch(() => {})
          .finally(() => {
            setConfig({ token: null, email: null }).then(() => {
                sendResponse({ ok: true })
            })
          })
        return true;
    }

    if (msg.type === "get_auth_state"){
        getConfig().then((config) => {
            sendResponse({ loggedIn: !!config.token, email: config.email || null });
        });
        return true;
    }

    if (msg.type === "get_labels"){
        getAvailableLabels().then(sendResponse);
        return true;
    }

    if (msg.type === "get_active_platform") {
        chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
            try {
                const hostname = new URL(tab?.url || "").hostname;
                if (hostname === "www.instagram.com") sendResponse({ name: "Instagram" });
                else if (hostname === "x.com" || hostname === "twitter.com") sendResponse({ name: "X" });
                else sendResponse({ name: null });
            } catch {
                sendResponse({ name: null });
            }
        });
        return true;
    }

    if (msg.type === "set_active_labels"){
        getAvailableLabels().then(async ({ labels }) => {
            const validIds = new Set(labels.map((label) => label.id));
            const activeLabelIds = normaliseLabelIds(msg.labelIds).filter((id) => validIds.has(id));
            await setConfig({ activeLabelIds });
            sendResponse({ ok: true, activeLabelIds });
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

    if (msg.type === "get_bookmark_folders") {
        getBookmarkTree().then((tree) => {
            const folders = flattenBookmarkFolders(tree);
            sendResponse({ ok: true, folders });
        });
        return true;
    }

    if (msg.type === "import_bookmarks") {
        importBookmarksFromFolder(msg.folderId)
            .then((result) => sendResponse({ ok: true, ...result }))
            .catch((err) => sendResponse({ ok: false, error: err.message }));
        return true;
    }

    if (msg.type === "import_reading_list") {
        importReadingList()
            .then(sendResponse)
            .catch((err) => sendResponse({ ok: false, error: err.message }));
        return true;
    }
});

chrome.runtime.onStartup.addListener(() => {
    flushQueue();
})

console.log("[Savenet] Background service worker started.");
