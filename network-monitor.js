// this is just a debug/monitoring script.
// if the host-specific code (instagram.js/x.js)-based tracking doesn't work
// then this will confirm the actual endpoint/mutation name to key off of

// it runs in the MAIN scope; i.e in the same scope as the webpage's window
// thus we are able to wrap the window's fetch() and XMLHttpRequest()
// to intercept and emit (to the three scripts in the content script scope) if candidate for save action

(() => {
  if (window.__savenetMonitorInstalled) return;
  window.__savenetMonitorInstalled = true;

  const keywords = ["save", "bookmark", "unsave", "favorite", "collection"];

  function isCandidate(url) {
    const lower = (url || "").toLowerCase();
    return keywords.some((kw) => lower.includes(kw));
  }

  function isSavedPostsResponse(url) {
    return (
      url.includes("/api/v1/feed/saved/") ||
      url.includes("/api/v1/feed/collection/") ||
      url.includes("saved/posts/") ||
      url.includes("saved/all/")
    );
  }

  function emit(detail) {
    window.postMessage({ source: "savenet-network-monitor", ...detail }, window.location.origin);
  }

  const originalFetch = window.fetch;
  if (originalFetch) {
    window.fetch = function (...args) {
      const result = originalFetch.apply(this, args);

      try {
        const [resource] = args;
        const url =
          typeof resource === "string"
            ? resource
            : resource instanceof Request
            ? resource.url
            : "";

        // intercept saved posts API responses
        if (isSavedPostsResponse(url)) {
          result.then(async (response) => {
            try {
              const clone = response.clone();
              const data = await clone.json();
              if (data?.items) {
                emit({
                  type: "saved-posts-response",
                  data,
                  url,
                });
              }
            } catch {
              // ignore parse errors
            }
          }).catch(() => {});
        }

        if (isCandidate(url)) {
          let bodyPreview = "";
          const [, init] = args;
          const body = init?.body;
          if (typeof body === "string") bodyPreview = body.slice(0, 2000);
          const method = (init?.method || "GET").toUpperCase();
          emit({ type: "candidate-request", url, method, bodyPreview, ts: Date.now() });
        }
      } catch {
        // shouldn't mess with the page's own XHR
      }

      return result;
    };
  }

  const OriginalXHR = window.XMLHttpRequest;
  const originalOpen = OriginalXHR.prototype.open;
  const originalSend = OriginalXHR.prototype.send;

  OriginalXHR.prototype.open = function (method, url, ...rest) {
    this.__savenetMethod = method;
    this.__savenetUrl = url;
    return originalOpen.call(this, method, url, ...rest);
  };

  OriginalXHR.prototype.send = function (body) {
    try {
      if (isCandidate(this.__savenetUrl)) {
        let bodyPreview = "";
        if (typeof body === "string") bodyPreview = body.slice(0, 2000);
        emit({
          type: "candidate-request",
          url: this.__savenetUrl,
          method: this.__savenetMethod || "GET",
          bodyPreview,
          ts: Date.now(),
        });
      }
    } catch {
      // shouldn't mess with the page's own XHR
    }

    return originalSend.call(this, body);
  };
})();