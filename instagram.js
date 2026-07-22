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

    // failed various approaches so gave up.
    // however since it works for tweets, so the field is going to be passed nevertheless into the canonical post object.
    function findThumbnail(scope) {
        "";
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
        // only the first link is author attribution
        const firstLink = clone.querySelector('a[role="link"]');
        firstLink?.remove();
        // the others are hashtags that are critical as the post author uses hashtags for the same purpose our user will
        // visibility/searching
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
            thumbnailUrl: findThumbnail(scope),
            mediaType: permalink.startsWith("/reel/") ? "reel" : "post",
            raw: { permalink, scopeText }
        });
        sendCapture(post);
        log("Captured save: ", post.postUrl);
    }

    document.addEventListener("click", (evet) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const saveEl = target.closest(saveSelector);
        if (!saveEl) return;
        handleSaveClick(saveEl);
    }, true);

    let collectionImportActive = false;
    let collectionImportCount = 0;

    function extractPostFromMedia(media){
        const code = media.code || media.shortcode;
        if (!code) return null;
        const caption = media.caption?.text || "";
        const username = media.user?.username || "";
        const isVerified = media.user?.is_verified || false;
        const fullName = media.user?.full_name || "";
        const mediaType = media.media_type;
        const candidates = media.image_versions2?.candidates || [];
        const thumbnailUrl = candidates[1]?.url || candidates[0]?.url || "";
        const locationName = media.location?.name || "";
        const captionText = normaliseText((isVerified ? "" : "") + caption) // strip the 'verified' prefix

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

    // window.addEventListener("savenet:network-candidate", (event) => {
    //     const detail = event.detail;
    //     if (detail.type === "saved-posts-response"){
    //         const items = detail.data?.items || [];
    //         let captured = 0;

    //         for (const item of items){
    //             const media = item.media || item;
    //             const post = extractPostFromMedia(media);
    //             if (!post) continue;
    //             sendCapture(post);
    //             captured++;
    //             collectionImportCount++;
    //         }

    //         if (captured > 0){
    //             log(`Collection import: captured ${captured} posts (${collectionImportCount} total so far)`);
    //             // notify popup of progress
    //             chrome.runtime.sendMessage({
    //                 type: "collection_import_progress",
    //                 count: collectionImportCount
    //             });
    //         }

    //         // scroll and check for more posts
    //         const moreAvailable = detail.data?.moreAvailable; // this flag already in data to prevent needless scrolling
    //         const nextMaxId = detail.data?.next_max_id;
    //         if(collectionImportActive && (moreAvailable || nextMaxId)){
    //             setTimeout(() => {
    //                 log("Collection import: scrolling to load more...");
    //                 window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
    //             }, 1500);
    //         } else if(collectionImportActive){
    //             collectionImportActive = false;
    //             log(`Collection import complete. Total captured: ${collectionImportCount}`);
    //             chrome.runtime.sendMessage({
    //                 type: "collection_import_complete",
    //                 count: collectionImportCount
    //             });
    //             collectionImportCount = 0;
    //         }
    //         return;
    //     }

    //     log("Network candidate (Instagram): ", event.detail.method, event.detail.url);
    // });    

    async function importCollectionViaApi(){
        console.log("[instagram.js] Starting collection API import...");        
        // extract collection ID from URL
        const urlMatch = window.location.pathname.match(/\/saved\/[^/]+\/(\d+)\/?$/);
        const collectionId = urlMatch ? urlMatch[1] : null;        
        // get CSRF token from cookies
        const csrfToken = document.cookie
            .split("; ")
            .find((c) => c.startsWith("csrftoken="))
            ?.split("=")?.[1] || "";
        // get app ID from Instagram's page variables
        const appId = window.__additionalData?.["app_id"] 
            || document.querySelector("meta[property='al:ios:app_store_id']")?.content
            || "936619743392459"; // IG's public app ID

        let maxId = null;
        let totalCaptured = 0;
        let hasMore = true;
        let pageCount = 0;

        while (hasMore && pageCount < 50) { // cap at 50 pages (1050 posts) to avoid infinite loops
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

            for (const item of items) {
                const media = item.media || item;
                const post = extractPostFromMedia(media);
                if (!post) continue;
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
                // delay between requests to avoid rate limiting smh
                await new Promise((r) => setTimeout(r, 1000));
            }

            } catch (err) {
            log("Collection API error:", err.message);
            break;
            }
        }

        collectionImportActive = false;
        log(`Collection import complete. Total: ${totalCaptured}`);
        chrome.runtime.sendMessage({
            type: "collection_import_complete",
            count: totalCaptured,
        });
    }

    chrome.runtime.onMessage.addListener((msg) => {
        console.log("[SaveNet] instagram.js received message:", msg.type);
        if (msg.type === "start_collection_import") {
            collectionImportActive = true;
            collectionImportCount = 0;
            importCollectionViaApi();
        }
    });

    log("Instagram capture adapter loaded.");
})();