function sendMessage(msg, attempt = 0){
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (response) => {
      if (chrome.runtime.lastError){
        if (attempt < 1){
          setTimeout(() => sendMessage(msg, attempt + 1).then(resolve), 150);
          return;
        }
        resolve(undefined);
        return;
      }
      resolve(response);
    });
  });
}

function escapeHtml(str){
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

async function render(){
  const auth = (await sendMessage({ type: "get_auth_state" })) || {};
  const loggedOutEl = document.getElementById("logged-out");
  const loggedInEl = document.getElementById("logged-in");

  if (auth.loggedIn){
    loggedOutEl.style.display = "none";
    loggedInEl.style.display = "flex";
    document.getElementById("user-email").textContent = auth.email || "";
    await loadBookmarkFolders();
    await renderQueueStatus();
    await renderLog();
    await checkCollectionPage();
  } else {
    loggedOutEl.style.display = "flex";
    loggedInEl.style.display = "none";
  }
}

async function renderQueueStatus(){
  const { size } = (await sendMessage({ type: "get_queue_size" })) || {};
  const countEl = document.getElementById("queue-count");
  const flushBtn = document.getElementById("btn-flush");

  if (size > 0){
    countEl.textContent = `${size} save${size === 1 ? "" : "s"} pending retry.`;
    flushBtn.style.display = "inline-block";
  } else {
    countEl.textContent = "";
    flushBtn.style.display = "none";
  }
}

async function renderLog(){
  const { log } = (await sendMessage({ type: "get_capture_log" })) || {};
  const logEl = document.getElementById("log");
  if (!log || log.length === 0){
    logEl.innerHTML = '<div class="hint">No saves yet. Bookmark a post on Instagram or X first.</div>';
    return;
  }

  logEl.innerHTML = log.map((entry) => {
    const statusClass = entry.status === "sent" ? "sent" : entry.status === "not_logged_in" ? "not_logged_in" : "queued";
    const statusLabel = entry.status === "sent" ? "sent" : entry.status === "not_logged_in" ? "skipped" : "pending";
    return `
      <div class="log-item">
        <span class="log-platform">${escapeHtml(entry.platform)}</span>
        <span class="log-status ${statusClass}" href=${escapeHtml(statusLabel)}</span>
        <a class="log-url" href="${escapeHtml(entry.postUrl)}" target="_blank">${escapeHtml(entry.postUrl)}</a>
      </div>`;
  }).join("");
}

async function checkCollectionPage(){
  const result = (await sendMessage({ type: "check_collection_page" })) || {};
  console.log("[SaveNet popup] checkCollectionPage result:", result);
  const sectionEl = document.getElementById("collection-import-section");
  const labelEl = document.getElementById("collection-section-label");
  if (result.isCollection){
    sectionEl.style.display = "block";
    const name = result.collectionName || "saved posts";
    labelEl.textContent = `Import "${name}`;
  } else {
    sectionEl.style.display = "none";
  }
}

document.getElementById("btn-login").addEventListener("click", async () => {
  const btn = document.getElementById("btn-login");
  btn.textContent = "Logging in...";
  btn.disabled = true;
  const result = await sendMessage({ type: "start_login" });
  if (result?.ok){
    await render();
  } else {
    btn.textContent = "Log in";
    btn.disabled = false;
    const p = document.querySelector("#logged-out p");
    p.textContent = "Login failed. Please try again.";
  }
});

document.getElementById("btn-logout").addEventListener("click", async () => {
  await sendMessage({ type: "logout" });
  await render();
});

document.getElementById("btn-flush").addEventListener("click", async () => {
  const btn = document.getElementById("btn-flush");
  btn.textContent = "Retrying...";
  btn.disabled = true;
  await sendMessage({ type: "flush_queue" });
  btn.textContent = "Retry failed."
  btn.disabled = false;
  await renderQueueStatus();
  await renderLog();
});

document.getElementById("btn-clear-log").addEventListener("click", async () => {
  await sendMessage({ type: "clear_log" });
  await renderLog();
})

async function loadBookmarkFolders() {
  const select = document.getElementById("folder-select");
  const importBtn = document.getElementById("btn-import-bookmarks");
  const result = await sendMessage({ type: "get_bookmark_folders" });
  if (!result?.ok || !result.folders?.length) return;

  result.folders.forEach((folder) => {
    const opt = document.createElement("option");
    opt.value = folder.id;
    opt.textContent = `${folder.title} (${folder.count})`;
    select.appendChild(opt);
  });

  select.addEventListener("change", () => {
    importBtn.disabled = !select.value;
  });
}

document.getElementById("btn-import-bookmarks").addEventListener("click", async () => {
  const folderId = document.getElementById("folder-select").value;
  if (!folderId) return;
  const statusEl = document.getElementById("import-bookmark-status");
  const btn = document.getElementById("btn-import-bookmarks");
  btn.disabled = true;
  btn.textContent = "Importing...";
  statusEl.textContent = "";

  const result = await sendMessage({ type: "import_bookmarks", folderId });
  if (result?.ok) {
    statusEl.textContent = `Done — ${result.sent} imported, ${result.failed} failed.`;
  } else {
    statusEl.textContent = "Import failed.";
  }
  btn.textContent = "Import";
  btn.disabled = false;
  await renderLog();
});

document.getElementById("btn-import-reading-list").addEventListener("click", async () => {
  const statusEl = document.getElementById("import-reading-status");
  const btn = document.getElementById("btn-import-reading-list");
  btn.disabled = true;
  btn.textContent = "Importing...";
  statusEl.textContent = "";

  const result = await sendMessage({ type: "import_reading_list" });
  if (result?.ok) {
    statusEl.textContent = `Done — ${result.sent} imported, ${result.failed} failed.`;
  } else {
    statusEl.textContent = result?.error || "Import failed.";
  }
  btn.textContent = "Import all";
  btn.disabled = false;
  await renderLog();
});

document.getElementById("btn-import-collection").addEventListener("click", async () => {
  const btn = document.getElementById("btn-import-collection");
  const statusEl = document.getElementById("collection-import-status");
  btn.disabled = true;
  btn.textContent = "Importing...";
  statusEl.textContent = "Starting...";
  await sendMessage({ type: "start_collection_import"});
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "collection_import_progress"){
    const statusEl = document.getElementById("collection-import-status");
    const btn = document.getElementById("btn-import-collection");
    if (statusEl) statusEl.textContent = `${msg.count} posts captured so far...`;
    if (btn) btn.textContent = "Importing...";
  }
  
  if (msg.type === "collection_import_complete"){
    const statusEl = document.getElementById("collection-import-status");
    const btn = document.getElementById("btn-import-collection");
    if (statusEl) statusEl.textContent = `Done. ${msg.count} posts imported.`;
    if (btn){
      btn.textContent = "Import all posts";
      btn.disabled = false;
    }
    renderLog();
  }

  if (msg.type === "scan_progress"){
    showStatus(msg.message);
  }
})

render();