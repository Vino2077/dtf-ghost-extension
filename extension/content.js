// ─── DTF Ghost — content script ──────────────────────────────────────────────

const SERVER_URL_KEY = "dtf_ghost_server_url";

async function getServerUrl() {
  return new Promise((resolve) => {
    chrome.storage.sync.get([SERVER_URL_KEY], (result) => resolve(result[SERVER_URL_KEY] || ""));
  });
}

function getPostId() {
  const match = window.location.pathname.match(/\/(\d+)(?:-|$)/);
  return match ? match[1] : null;
}

function getPostTitle() {
  return document.querySelector("h1")?.textContent?.trim() || "";
}

function formatDate(ts) {
  const d = new Date(ts * 1000);
  return d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function avatarUrl(uuid) {
  if (!uuid) return null;
  return `https://leonardo.osnova.io/${uuid}/-/scale_crop/40x40/center/`;
}

function escHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildDeletedComment(c) {
  const wrap = document.createElement("div");
  wrap.className = "dtf-ghost-inline";
  wrap.dataset.ghostId = c.id;

  // ФИКС СПЛЮЩИВАНИЯ: Заставляем блок игнорировать узкую колонку для аватарки
  // и растягиваться на всю ширину сетки (Grid) или флексбокса
  wrap.style.gridColumn = "1 / -1";
  wrap.style.width = "100%";
  wrap.style.flex = "1 1 100%";

  const avatarHtml = c.author_avatar
    ? `<img class="dtf-ghost-inline-avatar" src="${avatarUrl(c.author_avatar)}" alt="">`
    : `<div class="dtf-ghost-inline-avatar dtf-ghost-inline-avatar--empty"></div>`;

  const text = c.text ? escHtml(c.text).replace(/\n/g, "<br>") : "<em style='opacity:0.5'>текст недоступен</em>";

  wrap.innerHTML = `
    <div class="dtf-ghost-inline-bar"></div>
    <div class="dtf-ghost-inline-content">
      <div class="dtf-ghost-inline-header">
        ${avatarHtml}
        <span class="dtf-ghost-inline-author">${escHtml(c.author_name)}</span>
        <span class="dtf-ghost-inline-badge">👻 удалён</span>
        <span class="dtf-ghost-inline-time">${formatDate(c.date_created)}</span>
      </div>
      <div class="dtf-ghost-inline-text">${text}</div>
    </div>
  `;
  return wrap;
}

function getDeletedStubs() {
  const stubs = new Map();
  document.querySelectorAll('div[data-id]').forEach(el => {
    const id = parseInt(el.dataset.id);
    if (!id) return;
    
    if (el.classList.contains('comment--hidden')) {
      stubs.set(id, el);
      return;
    }

    const clone = el.cloneNode(true);
    clone.querySelectorAll('div[data-id]').forEach(c => c.remove());
    const text = clone.textContent || "";
    
    if (text.includes("Комментарий удал") || text.includes("Удаленный комментарий")) {
      stubs.set(id, el);
    }
  });
  return stubs;
}

function injectIntoPage(deletedComments, stubsMap) {
  let injected = 0;
  let notFound = [];

  deletedComments.forEach(c => {
    const el = stubsMap.get(parseInt(c.id));
    if (el) {
      if (el.dataset.ghostProcessed) return;
      el.dataset.ghostProcessed = "1";

      const ghost = buildDeletedComment(c);
      
      Array.from(el.children).forEach(child => {
        if (!child.querySelector('div[data-id]') && !child.hasAttribute('data-id') && !child.classList.contains('comments')) {
          child.style.display = 'none';
        }
      });

      el.prepend(ghost);
      injected++;
    } else {
      notFound.push(c);
    }
  });

  if (notFound.length > 0) injectFallbackBlock(notFound);
  console.log(`[DTF Ghost] Восстановлено: ${injected}, в запасном блоке: ${notFound.length}`);
}

function injectFallbackBlock(comments) {
  if (document.getElementById("dtf-ghost-block")) return;

  const block = document.createElement("div");
  block.id = "dtf-ghost-block";

  const header = document.createElement("div");
  header.className = "dtf-ghost-block-header";
  header.innerHTML = `
    <span>👻</span>
    <span>DTF Ghost — удалённые комментарии (${comments.length})</span>
    <button class="dtf-ghost-toggle" aria-expanded="true">скрыть</button>
  `;

  const body = document.createElement("div");
  body.className = "dtf-ghost-body";

  for (const c of comments) {
    const wrap = document.createElement("div");
    wrap.className = "dtf-ghost-comment";
    const avatarHtml = c.author_avatar ? `<img class="dtf-ghost-avatar" src="${avatarUrl(c.author_avatar)}" alt="">` : `<div class="dtf-ghost-avatar"></div>`;
    const text = c.text ? escHtml(c.text).replace(/\n/g, "<br>") : "<em>текст недоступен</em>";
    wrap.innerHTML = `
      <div class="dtf-ghost-header">
        ${avatarHtml}
        <span class="dtf-ghost-author">${escHtml(c.author_name)}</span>
      </div>
      <div class="dtf-ghost-text">${text}</div>
    `;
    body.appendChild(wrap);
  }

  header.querySelector(".dtf-ghost-toggle").addEventListener("click", (e) => {
    const expanded = e.target.getAttribute("aria-expanded") === "true";
    e.target.setAttribute("aria-expanded", String(!expanded));
    e.target.textContent = expanded ? "показать" : "скрыть";
    body.style.display = expanded ? "none" : "";
  });

  block.appendChild(header);
  block.appendChild(body);

  const target = document.querySelector('[data-type="comment"]') || document.querySelector(".comments") || document.querySelector(".content-footer");
  if (target) target.parentNode.insertBefore(block, target);
  else document.body.appendChild(block);
}

async function scrapeAndSaveComments(postId, serverUrl) {
  const comments = [];
  const stubsMap = getDeletedStubs(); 

  document.querySelectorAll('div[data-id]').forEach(node => {
    const id = parseInt(node.getAttribute('data-id'));
    if (!id || stubsMap.has(id)) return; 

    const textNode = node.querySelector('.comment__text, .markup, .text');
    let text = "";
    
    if (textNode) {
      text = textNode.innerText.trim();
    } else {
      const clone = node.cloneNode(true);
      clone.querySelectorAll('div[data-id]').forEach(c => c.remove());
      clone.querySelectorAll('.comment__header, .comment__author, .comment__footer, .comment__actions, button, svg, [data-type="reply"]').forEach(c => c.remove());
      text = clone.textContent.replace(/\s+/g, ' ').trim();
    }

    if (!text || text.length < 2) return; 

    const authorNode = node.querySelector('.comment__author, .user-name');
    const author_name = authorNode ? authorNode.innerText.trim() : "Аноним";

    let author_avatar = null;
    const imgEl = node.querySelector('.comment__avatar img, .avatar img');
    if (imgEl && imgEl.src) {
      const match = imgEl.src.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
      if (match) author_avatar = match[1];
    }

    comments.push({ id, author_name, author_avatar, text });
  });

  if (comments.length > 0) {
    try {
      await fetch(`${serverUrl}/save-comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId: parseInt(postId), comments })
      });
      console.log(`[DTF Ghost] Отправлено живых комментариев: ${comments.length}`);
    } catch (e) {}
  }
}

async function main() {
  const postId = getPostId();
  if (!postId) return;

  const serverUrl = await getServerUrl();
  if (!serverUrl) return;

  try {
    await fetch(`${serverUrl}/register/${postId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: getPostTitle() })
    });
  } catch (e) {}

  setTimeout(() => scrapeAndSaveComments(postId, serverUrl), 2000);

  setTimeout(async () => {
    const stubsMap = getDeletedStubs();
    const hiddenIds = Array.from(stubsMap.keys());

    try {
      const resp = await fetch(`${serverUrl}/get-ghosts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId: parseInt(postId), hiddenIds })
      });
      if (!resp.ok) return;
      
      const data = await resp.json();
      if (data.deleted && data.deleted.length > 0) {
        injectIntoPage(data.deleted, stubsMap);
      }
    } catch (e) {}
  }, 1500);
}

if (document.readyState === "complete") {
  main();
} else {
  window.addEventListener("load", main);
}

let lastUrl = location.href;
new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    document.getElementById("dtf-ghost-block")?.remove();
    document.querySelectorAll(".dtf-ghost-inline").forEach(el => el.remove());
    document.querySelectorAll("[data-ghost-processed]").forEach(el => {
      delete el.dataset.ghostProcessed;
    });
    setTimeout(main, 1500);
  }
}).observe(document.body, { subtree: true, childList: true });

let saveTimeout = null;
new MutationObserver((mutations) => {
  let shouldSave = false;
  for (const m of mutations) {
    if (m.addedNodes.length) {
      for (const node of m.addedNodes) {
        if (node.nodeType === 1 && (node.classList?.contains('comment') || node.querySelector('.comment') || node.hasAttribute?.('data-id'))) {
          shouldSave = true;
          break;
        }
      }
    }
    if (shouldSave) break;
  }

  if (shouldSave) {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(async () => {
      const postId = getPostId();
      const serverUrl = await getServerUrl();
      if (postId && serverUrl) {
        scrapeAndSaveComments(postId, serverUrl);
      }
    }, 1500);
  }
}).observe(document.body, { subtree: true, childList: true });