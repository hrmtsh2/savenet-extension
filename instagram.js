(() => {
    const { makePost, sendCapture, normaliseText, log } = window.__savenet;
    const postLinkSelector = 'a[href*="/p/"], a[href*="/reel/"]';
    const postPermalinkPattern = /^\/(p|reel)\/[^/?#]+\/?$/i
    const saveSelector = '[aria-label="Save"]';
    const categorySaveContext = {
        target: null,
        scope: null,
        expiresAt: 0,
        captured: false,
    };
    
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

    function shortcodeToMediaId(shortcode){
        const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
        let mediaId = 0n;
        for (const char of shortcode){
            const value = alphabet.indexOf(char);
            if (value < 0) return null;
            mediaId = mediaId * 64n + BigInt(value);
        }
        return mediaId.toString();
    }

    function getInstagramHeaders(){
        const csrfToken = document.cookie
            .split("; ")
            .find((cookie) => cookie.startsWith("csrftoken="))
            ?.split("=")?.[1] || "";
        const appId = window.__additionalData?.["app_id"]
            || document.querySelector("meta[property='al:ios:app_store_id']")?.content
            || "936619743392459";
        return {
            "X-CSRFToken": csrfToken,
            "X-IG-App-ID": appId,
            "X-Requested-With": "XMLHttpRequest",
            "Referer": window.location.href,
        };
    }

    async function fetchMediaByShortcode(shortcode){
        const mediaId = shortcodeToMediaId(shortcode);
        if (!mediaId) return null;

        try {
            const headers = getInstagramHeaders();
            const [response, commentsResponse] = await Promise.all([
                fetch(`/api/v1/media/${mediaId}/info/`, {
                    headers,
                    credentials: "include",
                }),
                fetch(`/api/v1/media/${mediaId}/comments/?count=10`, {
                    headers,
                    credentials: "include",
                }).catch(() => null),
            ]);
            if (!response.ok) {
                log(`Media API returned ${response.status} for ${shortcode}`);
                return null;
            }
            const data = await response.json();
            const media = data?.items?.[0] || data?.item || data?.media || null;
            if (!media || typeof media !== "object") return null;
            const commentsData = commentsResponse?.ok ? await commentsResponse.json() : null;
            const comments = (commentsData?.comments || commentsData?.items || media?.preview_comments || [])
                .map((comment) => ({
                    author: comment?.user?.username || comment?.user?.full_name || "",
                    text: normaliseText(comment?.text || comment?.content || ""),
                }))
                .filter((comment) => comment.text)
                .slice(0, 10);
            return { ...media, code: media.code || media.shortcode || shortcode, comments };
        } catch (err) {
            log("Media API error:", err?.message || err);
            return null;
        }
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

    function normaliseImageUrl(value){
        if (typeof value !== "string" || !/^https?:\/\//i.test(value)) return null;
        return value;
    }

    function addImageCandidate(candidates, value){
        const url = normaliseImageUrl(value);
        if (url && !candidates.includes(url)) candidates.push(url);
    }

    function addSrcSetCandidates(candidates, srcset){
        if (typeof srcset !== "string") return;
        srcset.split(",").forEach((entry) => addImageCandidate(candidates, entry.trim().split(/\s+/)[0]));
    }

    function extractDomImageCandidates(scope){
        const candidates = [];
        (scope || document).querySelectorAll("img").forEach((image) => {
            addImageCandidate(candidates, image.currentSrc);
            addImageCandidate(candidates, image.getAttribute("src"));
            addSrcSetCandidates(candidates, image.getAttribute("srcset"));
        });
        return candidates;
    }

    function extractMediaImageCandidates(media){
        const candidates = [];
        const addFromList = (items) => {
            if (!Array.isArray(items)) return;
            items.forEach((item) => addImageCandidate(candidates, item?.url || item?.src));
        };
        addFromList(media?.image_versions2?.candidates);
        addFromList(media?.image_versions2?.additional_candidates);
        addFromList(media?.display_resources);
        addFromList(media?.carousel_media?.flatMap((item) => item?.image_versions2?.candidates || []));
        addImageCandidate(candidates, media?.thumbnail_url);
        addImageCandidate(candidates, media?.thumbnail_src);
        addImageCandidate(candidates, media?.image_url);
        return candidates;
    }

    function extractMediaVideoUrl(media){
        const candidates = [
            ...(Array.isArray(media?.video_versions) ? media.video_versions : []),
            ...(Array.isArray(media?.video_dash_manifest) ? media.video_dash_manifest : []),
        ];
        return candidates
            .map((item) => item?.url || item?.src)
            .find((url) => normaliseImageUrl(url));
    }

    function buildPostFromDom(scope, permalink){
        const shortcode = extractShortcode(permalink);
        const imageCandidates = extractDomImageCandidates(scope);
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
            if (captionIndex !== -1) scopeText = rawScopeText.slice(captionIndex);
        }

        return makePost({
            platform: "instagram",
            platformPostId: shortcode,
            postUrl: `https://www.instagram.com${permalink}`,
            caption,
            authorHandle,
            authorName,
            thumbnailUrl: imageCandidates[0] || "",
            mediaType: permalink.startsWith("/reel/") ? "reel" : "post",
            raw: {
                permalink,
                scopeText: scopeText.slice(0, 4000),
                candidateImages: imageCandidates,
                fromDomFallback: true
            }
        });
    }

    function normaliseCategoryName(value){
        return normaliseText(value)
            .replace(/^(saved|added|removed)\s+(to|from|in)\s+/i, "")
            .replace(/^["']|["']$/g, "")
            .trim();
    }

    function categoryNameFromText(value){
        const text = normaliseText(value);
        const match = text.match(/(?:saved|added|save)\s+(?:to|in)\s+["“]?(.+?)["”]?(?:\s*$|\.)/i);
        return match ? normaliseCategoryName(match[1]) : "";
    }

    function isGenericCategoryControl(name){
        return !name
            || /^(save|saved|save to|new collection|create collection|cancel|close)$/i.test(name)
            || name.length > 120;
    }

    function categoryNameFromElement(target){
        const candidate = target.closest('[role="menuitem"], [role="option"], li, button');
        const rawName = candidate?.getAttribute("aria-label")
            || candidate?.getAttribute("title")
            || candidate?.textContent
            || target.textContent
            || "";
        const name = categoryNameFromText(rawName) || normaliseCategoryName(rawName);
        return isGenericCategoryControl(name) ? "" : name;
    }

    function recentToastCategoryName(){
        const nodes = Array.from(document.querySelectorAll('[role="alert"], [aria-live], [class*="toast" i]'));
        for (const node of nodes.reverse()){
            const name = categoryNameFromText(node.textContent || "");
            if (name && !isGenericCategoryControl(name)) return name;
        }
        return "";
    }

    function setCategorySaveContext(target){
        categorySaveContext.target = target;
        categorySaveContext.scope = findScope(target);
        categorySaveContext.expiresAt = Date.now() + 5000;
        categorySaveContext.captured = false;
    }

    async function handleSaveClick(target, categoryName = ""){
        const scope = findScope(target);
        const permalink = findPermalinkInScope(scope) || normalisePermalink(window.location.pathname);
        if (!permalink){
            log("Save clicked but could not resolve a post permalink.", target);
            return;
        }

        const shortcode = extractShortcode(permalink);
        const media = shortcode ? await fetchMediaByShortcode(shortcode) : null;
        const post = media ? extractPostFromMedia(media) : buildPostFromDom(scope, permalink);
        if (post && media) {
            const mediaCandidates = Array.isArray(post.raw?.candidateImages) ? post.raw.candidateImages : [];
            const candidateImages = [...new Set([...mediaCandidates, ...extractDomImageCandidates(scope)])];
            if (!post.thumbnailUrl && candidateImages.length) post.thumbnailUrl = candidateImages[0];
            post.raw.candidateImages = candidateImages;
            post.raw.fromMediaApi = true;
            post.raw.permalink = permalink;
        }
        if (!post) return;
        if (categoryName) {
            post.raw = { ...(post.raw || {}), collectionName: categoryName };
        }
        sendCapture(post);
        log(`Captured save via ${media ? "media API" : "DOM fallback"}:`, post.postUrl);
    }

    function captureCategorySave(categoryName){
        if (!categoryName || Date.now() > categorySaveContext.expiresAt || categorySaveContext.captured) return;
        const target = categorySaveContext.target;
        if (!(target instanceof Element)) return;
        categorySaveContext.captured = true;
        void handleSaveClick(target, categoryName);
    }

    document.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const saveEl = target.closest(saveSelector);
        if (saveEl) {
            setCategorySaveContext(saveEl);
            categorySaveContext.captured = true;
            void handleSaveClick(saveEl);
            return;
        }
        if (categorySaveContext.target && Date.now() <= categorySaveContext.expiresAt) {
            captureCategorySave(categoryNameFromElement(target) || recentToastCategoryName());
        }
    }, true);

    document.addEventListener("pointerover", (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const saveEl = target.closest(saveSelector);
        if (saveEl) setCategorySaveContext(saveEl);
    }, true);

    const toastObserver = new MutationObserver((mutations) => {
        if (!categorySaveContext.target || Date.now() > categorySaveContext.expiresAt) return;
        for (const mutation of mutations){
            for (const node of mutation.addedNodes){
                if (!(node instanceof Element)) continue;
                captureCategorySave(categoryNameFromText(node.textContent || ""));
                if (categorySaveContext.captured) return;
            }
        }
    });
    toastObserver.observe(document.body, { childList: true, subtree: true });

    function extractPostFromMedia(media){
        const code = media.code || media.shortcode;
        if (!code) return null;
        const caption = media.caption?.text || "";
        const username = media.user?.username || "";
        const fullName = media.user?.full_name || "";
        const mediaType = media.media_type;
        const candidates = extractMediaImageCandidates(media);
        const thumbnailUrl = candidates[1] || candidates[0] || "";
        const locationName = media.location?.name || "";
        const captionText = normaliseText(caption);
        const comments = Array.isArray(media.comments) ? media.comments : [];
        const commentText = comments.map((comment) => `${comment.author ? `@${comment.author}: ` : ""}${comment.text}`).join(" ");
        const videoUrl = extractMediaVideoUrl(media);

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
                scopeText: normaliseText(caption + (locationName ? ` ${locationName}`: "") + (commentText ? ` ${commentText}` : "")),
                candidateImages: candidates,
                comments,
                ...(videoUrl ? { videoUrl } : {}),
                fromCollection: true
            }
        });
    }

    async function importCollectionViaApi(collectionName, labelIds){
        console.log("[instagram.js] Starting collection API import...");        
        const urlMatch = window.location.pathname.match(/\/saved\/[^/]+\/(\d+)\/?$/);
        const collectionId = urlMatch ? urlMatch[1] : null;        

        let maxId = null;
        let totalCaptured = 0;
        let collectionTotal = null;
        let hasMore = true;
        let pageCount = 0;

        while (hasMore && pageCount < 50) {
            pageCount++;            
            const endpoint = collectionId
            ? `/api/v1/feed/collection/${collectionId}/posts/?count=21${maxId ? `&max_id=${maxId}` : ""}`
            : `/api/v1/feed/saved/posts/?num_results=21${maxId ? `&max_id=${maxId}` : ""}`;
            try {
                const response = await fetch(`https://www.instagram.com${endpoint}`, {
                    headers: getInstagramHeaders(),
                    credentials: "include",
                });

                if (!response.ok) {
                    log(`Collection API returned ${response.status} — stopping import`);
                    break;
                }

                const data = await response.json();
                const items = data?.items || [];
                const reportedTotal = Number(
                    data?.collection?.media_count ??
                    data?.collection?.count ??
                    data?.collection?.post_count ??
                    data?.total_count ??
                    data?.count
                );
                if (Number.isInteger(reportedTotal) && reportedTotal >= 0) {
                    collectionTotal = reportedTotal;
                }
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
                    post.labelIds = Array.isArray(labelIds) ? labelIds : [];
                    sendCapture(post);
                    totalCaptured++;
                }

                log(`Page ${pageCount}: captured ${items.length} posts (${totalCaptured} total)`);
                
                chrome.runtime.sendMessage({
                    type: "collection_import_progress",
                    count: totalCaptured,
                    total: collectionTotal,
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
            total: collectionTotal,
        });
    }

    chrome.runtime.onMessage.addListener((msg) => {
        console.log("[SaveNet] instagram.js received message:", msg.type);
        if (msg.type === "start_collection_import") {
            importCollectionViaApi(msg.collectionName, msg.labelIds);
        }
    });

    log("Instagram capture adapter loaded.");
})();
