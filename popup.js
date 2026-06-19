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
    await renderQueueStatus();
    await renderLog();
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

render();