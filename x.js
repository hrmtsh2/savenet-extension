(() => {
    const { makePost, sendCapture, normaliseText, log } = window.__savenet
    const tweetSelector = 'article[data-testid="tweet"]';
    const textSelector = '[data-testid="tweetText"]';

    const bookmarkSelector = '[data-testid="bookmark"]';
    function extractPermalinkAndAuthor(article){
        const links = Array.from(article.querySelectorAll('a[href*="/status/"]'));
        const timeLink = links.find((a) => a.querySelector("time")) || links[0];
        if (!timeLink) return { permalink: null, authorHandle: "", tweetId: null };
        let pathname;
        try {
            pathname = new URL(timeLink.getAttribute("href") || "", window.location.origin).pathname;
        } catch {
            pathname = timeLink.getAttribute("href") || "";
        }

        const match = pathname.match(/^\/([^/]+)\/status\/(\d+)/);
        return {
            permalink: pathname,
            authorHandle: match ? match[1] : "",
            tweetId: match ? match[2] : null
        };
    }

    function extractText(article){
        const node = article.querySelector(textSelector);
        return normaliseText(node?.innerText || node?.textContent || "");
    }

    function extractAuthorName(article){
        const nameEl = article.querySelector('[data-testid="User-Name"]');
        return normaliseText(nameEl?.querySelector("span")?.textContent || "");
    }

    function extractThumbnail(article){
        const img = article.querySelector('img[src*="pbs.twimg.com/media"]');
        if (img?.src) return img.src;
        const video = article.querySelector("video");
        if (video?.poster) return video.poster;

        return "";
    }

    function extractTimestamp(article){
        return article.querySelector("time")?.getAttribute("datetime") || "";
    }

    function handleBookmarkClick(target){
        const article = target.closest(tweetSelector);
        if (!article){
            log("Bookamark clicked but could not find and enclosing tweet article.");
            return;
        }

        const { permalink, authorHandle, tweetId } = extractPermalinkAndAuthor(article);
        if (!permalink){
            log("Bookmark clicked but could not resolve the tweet permalink.");
            return;
        }

        const post = makePost({
            platform: "x",
            platformPostId: tweetId,
            postUrl: `https://x.com${permalink}`,
            caption: extractText(article),
            authorHandle,
            authorName: extractAuthorName(article),
            thumbnailUrl: extractThumbnail(article),
            mediaType: article.querySelector("video") ? "video" : "tweet",
            raw: { permalink, tweetTimestamp: extractTimestamp(article) }
        });

        sendCapture(post);
        log("Captured bookmark: ", post.postUrl);
    }

    document.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const bookmarkEl = target.closest(bookmarkSelector);
        if (!bookmarkEl) return;

        handleBookmarkClick(bookmarkEl);
    }, true);

    window.addEventListener("savenet:network-candidate", (event) => {
        const { url, method, bodyPreview } = event.detail;
        if (/bookmark/i.test(url)){
            log("Bookmark-related request observed: ", method, url, (bodyPreview || "").slice(0, 200));
        } else {
            log("Network candidate (X): ", method, url);
        }
    });
    log("X capture adapter loaded.");
})();