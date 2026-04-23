const SERVER_URL_KEY = "dtf_ghost_server_url";

const input = document.getElementById("serverUrl");
const btn = document.getElementById("saveBtn");
const statusEl = document.getElementById("status");
const statsEl = document.getElementById("stats");

// Загружаем сохранённый URL
chrome.storage.sync.get([SERVER_URL_KEY], (result) => {
  if (result[SERVER_URL_KEY]) {
    input.value = result[SERVER_URL_KEY];
    loadStats(result[SERVER_URL_KEY]);
  }
});

btn.addEventListener("click", async () => {
  const url = input.value.trim().replace(/\/$/, ""); // убираем слэш в конце
  if (!url) {
    showStatus("Введите URL сервера", "err");
    return;
  }

  btn.disabled = true;
  showStatus("Проверяю подключение...", "");

  try {
    const resp = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    // Сохраняем
    chrome.storage.sync.set({ [SERVER_URL_KEY]: url }, () => {
      showStatus("✓ Сохранено, сервер доступен!", "ok");
      loadStats(url);
    });
  } catch (e) {
    showStatus(`✗ Не удалось подключиться: ${e.message}`, "err");
  } finally {
    btn.disabled = false;
  }
});

async function loadStats(url) {
  try {
    const resp = await fetch(`${url}/stats`, { signal: AbortSignal.timeout(4000) });
    if (!resp.ok) return;
    const data = await resp.json();

    document.getElementById("s-posts").textContent = data.monitored_posts?.toLocaleString() ?? "—";
    document.getElementById("s-total").textContent = data.total_comments?.toLocaleString() ?? "—";
    document.getElementById("s-deleted").textContent = data.deleted_comments?.toLocaleString() ?? "—";
    statsEl.classList.add("visible");
  } catch (_) {
    // тихо
  }
}

function showStatus(msg, type) {
  statusEl.textContent = msg;
  statusEl.className = "status " + type;
}
