(() => {
    const { makePost, sendCapture, normaliseText, log } = window.__savenet;
    const postLinkSelector = 'a[href*="/p/"], a[href*="/reel/"]';
    const postPermalinkPattern = /^\/(p|reel)\/[^/?#]+\/?$/i
    const saveSelector = '[aria-label="Save"]';
    
    function normalisePermalink(href){
        if (!href) return null;
        try {
            const parsed = new URL(href, window.location.origin);
            const path = parsed.pathname.replace(/\/+$/, "") + "/";
            return postPermalinkPattern.test(path) ? path : null;
        } catch {
            return null;
        }
    }

    function extractShortcode(permalink){
        const match = permalink.match(/^\/(?:p|reel)\/([^/]+)\//);
        return match ? match[1] : null;
    }

    function parseCaptionFromJsonLd(scope){
        const scripts = Array.from((scope || document).querySelectorAll('script[type="application/ld+json"]'));
        for (const script of scripts){
            const raw = script.textContent || "";
            if (!raw.trim()) continue;
            try {
                const parsed = JSON.parse(raw);
                const nodes = Array.isArray(parsed) ? parsed : [parsed];
                for (const node of nodes){
                    const caption = node?.caption || node?.articleBody || node?.description || node?.mainEntity?.cap || node?.mainEntity?.articleBody || node?.mainEntity?.description || "";
                    const normalised = normaliseText(caption);
                    if (normalised) return normalised;
                }
            } catch {
                // ignore malformed json-ld blocks
            }
        }
        return "";
    }

    function parseCaptionFromMeta(){
        const candidates = [
            document.querySelector('meta[property="og:description"]')?.getAttribute("content") || "",
            document.querySelector('meta[name="description"')?.getAttribute("content") || ""
        ];

        for (const value of candidates){
            const normalised = normaliseText(value);
            if (normalised) return normalised;
        }

        return "";
    }

    function resolveAuthorHandle(){
        const jsonLd = document.querySelector('script[type="application/ld+json"]');
        if (!jsonLd) return "";

        try {
            const parsed = JSON.parse(jsonLd.textContent || "{}");
            const node = Array.isArray(parsed) ? parsed[0] : parsed;
            const author = node?.author?.alternateName || node?.author?.name || node?.mainEntity?.author?.alternateName || "";
            return author.replace(/^@/, "");
        } catch {
            return "";
        }
    }
    
    function findScope(el){
        return el.closest("article") || el.closest('div[role="dialog"]') || document;
    }

    function findPermalinkInScope(scope){
        const anchor = (scope || document).querySelector(postLinkSelector);
        if (!anchor) return null;
        return normalisePermalink(anchor.getAttribute("href"));
    }

    function findAuthorLink(scope){
        const root = scope || document;
        const header = root.querySelector("header") || root;
        return header.querySelector('a[role="link"][href^="/"]');
    }

    function resolveAuthorFromDom(scope){
        const link = findAuthorLink(scope);
        if (!link) return { authorHandle: "", authorName: "" };

        const href = link.getAttribute("href") || "";
        const handle = href.replace(/^\//, "").replace(/\/$/, "");
        const name = normaliseText(link.textContent || "") || handle;

        return { authorHandle: handle, authorName: name };
    }

    function findCaptionListItem(scope){
        const root = scope || document;
        const lists = root.querySelectorAll("ul");

        for (const ul of lists){
            const firstLi = ul.querySelector("li");
            if (firstLi && firstLi.querySelector('a[role="link"]')){
                return firstLi;
            }
        }

        return null;
    }

    function extractCaptionFromListItem(li){
        if (!li) return "";
        const clone = li.cloneNode(true);
        const firstLink = clone.querySelector('a[role="link"]');
        firstLink?.remove();
        clone.querySelectorAll("time, button").forEach((el) => el.remove());
        clone.querySelectorAll("br").forEach((br) => br.replaceWith(" "));
        return normaliseText(clone.textContent || "");
    }

    function handleSaveClick(target){
        const scope = findScope(target);
        const permalink = findPermalinkInScope(scope) || normalisePermalink(window.location.pathname);
        if (!permalink){
            log("Save clicked but could not resolve a post permalink.", target);
            return;
        }

        let caption = parseCaptionFromJsonLd(scope) || parseCaptionFromMeta();
        if (!caption) {
            caption = extractCaptionFromListItem(findCaptionListItem(scope));
        }
        if (!caption){
            const span = scope.querySelector("span._ap3a._aaco._aacu._aacx._aad7._aade");
            if (span){
                const clone = span.cloneNode(true);
                clone.querySelectorAll("br").forEach((br) => br.replaceWith(" "));
                caption = normaliseText(clone.textContent || "");
            }
        }
        caption = caption.replace(/^Verified/i, "").trimStart();

        let { authorHandle, authorName } = { authorHandle: "", authorName: "" };
        const jsonLdHandle = resolveAuthorHandle();
        if (jsonLdHandle){
            authorHandle = jsonLdHandle;
            authorName = jsonLdHandle;
        } else {
            ({ authorHandle, authorName } = resolveAuthorFromDom(scope));
        } 
        
        const rawScopeText = normaliseText(scope.textContent || "");
        let scopeText = rawScopeText;
        if (caption) {
            const captionIndex = rawScopeText.indexOf(caption);
            if (captionIndex !== -1) {
                scopeText = rawScopeText.slice(captionIndex);
            }
        }
        scopeText = scopeText.slice(0, 4000);

        const post = makePost({
            platform: "instagram",
            platformPostId: extractShortcode(permalink),
            postUrl: `https://www.instagram.com${permalink}`,
            caption,
            authorHandle,
            authorName,
            thumbnailUrl: "",
            mediaType: permalink.startsWith("/reel/") ? "reel" : "post",
            raw: { permalink, scopeText }
        });
        sendCapture(post);
        log("Captured save: ", post.postUrl);
    }

    document.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const saveEl = target.closest(saveSelector);
        if (!saveEl) return;
        handleSaveClick(saveEl);
    }, true);

    function extractPostFromMedia(media){
        const code = media.code || media.shortcode;
        if (!code) return null;
        const caption = media.caption?.text || "";
        const username = media.user?.username || "";
        const fullName = media.user?.full_name || "";
        const mediaType = media.media_type;
        const candidates = media.image_versions2?.candidates || [];
        const thumbnailUrl = candidates[1]?.url || candidates[0]?.url || "";
        const locationName = media.location?.name || "";
        const captionText = normaliseText(caption);

        return makePost({
            platform: "instagram",
            platformPostId: code,
            postUrl: `https://www.instagram.com/p/${code}`,
            caption: captionText,
            authorHandle: username,
            authorName: fullName,
            thumbnailUrl,
            mediaType: mediaType === 2 ? "reel" : mediaType === 8 ? "carousel" : "post",
            raw: {
                permalink: `/p/${code}`,
                scopeText: normaliseText(caption + (locationName ? ` ${locationName}`: "")),
                fromCollection: true
            }
        });
    }

    async function importCollectionViaApi(collectionName){
        console.log("[instagram.js] Starting collection API import...");        
        const urlMatch = window.location.pathname.match(/\/saved\/[^/]+\/(\d+)\/?$/);
        const collectionId = urlMatch ? urlMatch[1] : null;        
        const csrfToken = document.cookie
            .split("; ")
            .find((c) => c.startsWith("csrftoken="))
            ?.split("=")?.[1] || "";
        const appId = window.__additionalData?.["app_id"] 
            || document.querySelector("meta[property='al:ios:app_store_id']")?.content
            || "936619743392459";

        let maxId = null;
        let totalCaptured = 0;
        let hasMore = true;
        let pageCount = 0;

        while (hasMore && pageCount < 50) {
            pageCount++;            
            const endpoint = collectionId
            ? `/api/v1/feed/collection/${collectionId}/posts/?count=21${maxId ? `&max_id=${maxId}` : ""}`
            : `/api/v1/feed/saved/posts/?num_results=21${maxId ? `&max_id=${maxId}` : ""}`;
            try {
            const response = await fetch(`https://www.instagram.com${endpoint}`, {
                headers: {
                "X-CSRFToken": csrfToken,
                "X-IG-App-ID": appId,
                "X-Requested-With": "XMLHttpRequest",
                "Referer": window.location.href,
                },
                credentials: "include",
            });

            if (!response.ok) {
                log(`Collection API returned ${response.status} — stopping import`);
                break;
            }

            const data = await response.json();
            const items = data?.items || [];
            // prefer the api's human-readable name over a numeric url segment
            const apiCollectionName = data?.collection?.name || data?.collection_name || data?.collection?.collection_name;
            if (typeof apiCollectionName === "string" && apiCollectionName.trim()) {
                collectionName = apiCollectionName.trim();
            }

            for (const item of items) {
                const media = item.media || item;
                const post = extractPostFromMedia(media);
                if (!post) continue;
                if (collectionName && !/^\d+$/.test(collectionName)) post.raw.collectionName = collectionName;
                sendCapture(post);
                totalCaptured++;
            }

            log(`Page ${pageCount}: captured ${items.length} posts (${totalCaptured} total)`);
            
            chrome.runtime.sendMessage({
                type: "collection_import_progress",
                count: totalCaptured,
            });

            hasMore = data?.more_available && items.length > 0;
            maxId = data?.next_max_id || null;

            if (hasMore) {
                await new Promise((r) => setTimeout(r, 1000));
            }

            } catch (err) {
            log("Collection API error:", err.message);
            break;
            }
        }

        log(`Collection import complete. Total: ${totalCaptured}`);
        chrome.runtime.sendMessage({
            type: "collection_import_complete",
            count: totalCaptured,
        });
    }

    chrome.runtime.onMessage.addListener((msg) => {
        console.log("[SaveNet] instagram.js received message:", msg.type);
        if (msg.type === "start_collection_import") {
            importCollectionViaApi(msg.collectionName);
        }
    });

    log("Instagram capture adapter loaded.");
})();