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

        let { authorHandle, authorName } = { authorHandle: "", authorName: "" };
        const jsonLdHandle = resolveAuthorHandle();
        if (jsonLdHandle){
            authorHandle = jsonLdHandle;
            authorName = jsonLdHandle;
        } else {
            ({ authorHandle, authorName } = resolveAuthorFromDom(scope));
        }

        const post = makePost({
            platform: "instagram",
            platformPostId: extractShortcode(permalink),
            postUrl: `https://www.instagram.com${permalink}`,
            caption,
            authorHandle,
            authorName,
            thumbnailUrl: findThumbnail(scope),
            mediaType: permalink.startsWith("/reel/") ? "reel" : "post",
            raw: { permalink, scopeText: normaliseText(scope.textContent || "").slice(0, 4000) }
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

    window.addEventListener("savenet:network-candidate", (event) => {
        log("Network candidate (Instagram): ", event.detail.method, event.detail.url);
    });

    log("Instagram capture adapter loaded.");
})();