function sendMessage(msg){
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));
}

function escapeHtml(str){
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

async function refreshStatus(){
  const config = await sendMessage({ type: "get_config" });
  const { size } = await sendMessage({ type: "get_queue_size" });
  const statusEl = document.getElementById("status");

  if (!config.apiBaseUrl){
    statusEl.textContent = "Not configured. Set an API base URL to start sending captures.";
  } else {
    statusEl.textContent = `Connected to ${config.apiBaseUrl}. ${size} capture(s) queued for retrys.`;
  }

  document.getElementById("api-base-url").value = config.apiBaseUrl || "";
  document.getElementById("auth-token").value = config.authToken || "";
}

async function refreshLog(){
  const { log } = await sendMessage({ type: "get_capture_log" });
  const logEl = document.getElementById("log");

  if (!log || log.length === 0){
    logEl.innerHTML =
      '<div class="hint">No captures yet. Save a post on Instagram or bookmark a post on X.</div>';
    return;
  }

  logEl.innerHTML = log
    .map((entry) => {
      const statusClass = entry.status === "sent" ? "sent" : "queued";
      return `
        <div class="log-item">
          <span class="platform">${escapeHtml(entry.platform)}</span>
          <span class="status-tag ${statusClass}">${escapeHtml(entry.status)}</span>
          <div><a class="link" href="${escapeHtml(entry.postUrl)}" target="_blank">${escapeHtml(
            entry.postUrl
          )}</a></div>
          <div class="caption">${escapeHtml(entry.caption || "")}</div>
        </div>`;
    })
    .join("");
}

document.getElementById("save-config").addEventListener("click", async () => {
  const apiBaseUrl = document.getElementById("api-base-url").value.trim();
  const authToken = document.getElementById("auth-token").value.trim();
  await sendMessage({ type: "set_config", config: { apiBaseUrl, authToken } });
  await refreshStatus();
});

document.getElementById("flush-queue").addEventListener("click", async () => {
  const result = await sendMessage({ type: "flush_queue" });
  await refreshStatus();
  await refreshLog();
  document.getElementById("status").textContent = `Flushed ${result.flushed}, ${result.remaining} remaining.`;
});

document.getElementById("clear-log").addEventListener("click", async () => {
  await sendMessage({ type: "clear_log" });
  await refreshLog();
  document.getElementById("status").textContent = "Log cleared";
})

refreshStatus();
refreshLog();