// ===== State =====
let sessions = JSON.parse(localStorage.getItem("gsd-sessions") || "[]");
let currentSession = null;
let streaming = false;

// ===== DOM =====
const $ = (s) => document.querySelector(s);
const homeScreen = $("#home-screen");
const settingsScreen = $("#settings-screen");
const chatScreen = $("#chat-screen");
const projectList = $("#project-list");
const messagesEl = $("#messages");
const typingEl = $("#typing");
const userInput = $("#user-input");
const sendBtn = $("#send-btn");
const toast = $("#toast");

// ===== Navigation =====
function showScreen(screen) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  screen.classList.add("active");
}

// ===== Toast =====
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2000);
}

// ===== Settings =====
function getApiKey() {
  return localStorage.getItem("gsd-api-key") || "";
}
function getModel() {
  return localStorage.getItem("gsd-model") || "claude-sonnet-4-6-20250514";
}

$("#open-settings").addEventListener("click", () => {
  $("#api-key-input").value = getApiKey();
  $("#model-select").value = getModel();
  showScreen(settingsScreen);
});

$("#settings-back").addEventListener("click", () => showScreen(homeScreen));

$("#save-settings").addEventListener("click", () => {
  const key = $("#api-key-input").value.trim();
  const model = $("#model-select").value;
  if (key) localStorage.setItem("gsd-api-key", key);
  localStorage.setItem("gsd-model", model);
  showToast("Settings saved");
  showScreen(homeScreen);
});

// ===== Home Screen =====
function renderHome() {
  if (sessions.length === 0) {
    projectList.innerHTML = `
      <div class="empty-state">
        <span class="icon">📋</span>
        <p>No projects yet.<br>Tap + to start planning.</p>
      </div>`;
    return;
  }
  projectList.innerHTML = sessions
    .map(
      (s, i) => `
    <div class="project-card" data-index="${i}">
      <button class="delete-btn" data-delete="${i}">&times;</button>
      <h3>${escapeHtml(s.name || "Untitled Project")}</h3>
      <div class="card-desc">${escapeHtml(s.description || "No description yet")}</div>
      <div class="card-meta">
        <span>${s.messages.filter((m) => m.role === "user").length} messages</span>
        <span>${timeAgo(s.updatedAt)}</span>
      </div>
    </div>`
    )
    .join("");

  projectList.querySelectorAll(".project-card").forEach((card) => {
    card.addEventListener("click", (e) => {
      if (e.target.closest(".delete-btn")) return;
      openSession(parseInt(card.dataset.index));
    });
  });

  projectList.querySelectorAll(".delete-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.delete);
      if (confirm("Delete this project?")) {
        sessions.splice(idx, 1);
        saveSessions();
        renderHome();
      }
    });
  });
}

// ===== Session Management =====
function createSession() {
  const session = {
    id: Date.now().toString(36),
    name: "",
    description: "",
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    gsdFiles: null,
  };
  sessions.unshift(session);
  saveSessions();
  return session;
}

function openSession(index) {
  if (!getApiKey()) {
    showToast("Set your API key in Settings first");
    $("#api-key-input").value = "";
    showScreen(settingsScreen);
    return;
  }
  currentSession = sessions[index];
  $("#chat-title").textContent = currentSession.name || "New Project";
  renderMessages();
  showScreen(chatScreen);
  if (currentSession.messages.length === 0) {
    sendInitialGreeting();
  }
  setTimeout(() => scrollToBottom(), 100);
}

function saveSessions() {
  localStorage.setItem("gsd-sessions", JSON.stringify(sessions));
}

// ===== Messages =====
function renderMessages() {
  const msgs = currentSession.messages
    .map((m) => {
      if (m.role === "user") {
        return `<div class="message user">${escapeHtml(m.content)}</div>`;
      }
      return `<div class="message assistant">${renderMarkdown(m.content)}${m.gsdFiles ? renderDownloadCard(m.gsdFiles) : ""}</div>`;
    })
    .join("");
  messagesEl.innerHTML = msgs + `<div class="typing" id="typing"><span></span><span></span><span></span></div>`;
}

function addMessage(role, content, gsdFiles) {
  const msg = { role, content };
  if (gsdFiles) msg.gsdFiles = gsdFiles;
  currentSession.messages.push(msg);
  currentSession.updatedAt = Date.now();

  if (role === "user" && !currentSession.name && currentSession.messages.filter((m) => m.role === "user").length === 1) {
    currentSession.name = content.slice(0, 50) + (content.length > 50 ? "..." : "");
    $("#chat-title").textContent = currentSession.name;
  }

  if (role === "assistant" && !currentSession.description) {
    const firstUserMsg = currentSession.messages.find((m) => m.role === "user");
    if (firstUserMsg) currentSession.description = firstUserMsg.content.slice(0, 100);
  }

  saveSessions();
}

function appendAssistantChunk(chunk) {
  const msgs = currentSession.messages;
  const last = msgs[msgs.length - 1];
  if (last && last.role === "assistant") {
    last.content += chunk;
  }
}

function renderDownloadCard(files) {
  const fileNames = Object.keys(files).map((f) => `  ${f}`).join("\n");
  return `
    <div class="download-card">
      <h4>GSD Planning Files Ready</h4>
      <div class="file-list">${escapeHtml(fileNames)}</div>
      <button onclick="downloadGsdFiles()">Download .zip</button>
    </div>`;
}

// ===== Streaming Chat =====
async function sendMessage(text) {
  if (streaming || !text.trim()) return;
  streaming = true;
  sendBtn.disabled = true;

  addMessage("user", text.trim());
  renderMessages();
  scrollToBottom();

  // Show typing
  const typingIndicator = document.getElementById("typing");
  typingIndicator.classList.add("visible");
  scrollToBottom();

  // Build messages for API (only user and assistant roles)
  const apiMessages = currentSession.messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role, content: m.content }));

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: apiMessages,
        apiKey: getApiKey(),
        model: getModel(),
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Unknown error" }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    // Add empty assistant message to accumulate into
    addMessage("assistant", "");
    typingIndicator.classList.remove("visible");

    // Stream the response
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "[DONE]") continue;
          try {
            const event = JSON.parse(data);
            if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
              appendAssistantChunk(event.delta.text);
              updateLastMessage();
              scrollToBottom();
            }
          } catch {}
        }
      }
    }

    // Check for GSD files in the final message
    const lastMsg = currentSession.messages[currentSession.messages.length - 1];
    const gsdFiles = extractGsdFiles(lastMsg.content);
    if (gsdFiles) {
      lastMsg.gsdFiles = gsdFiles;
      currentSession.gsdFiles = gsdFiles;
    }

    saveSessions();
    renderMessages();
    scrollToBottom();
  } catch (err) {
    typingIndicator.classList.remove("visible");
    // Remove the empty assistant message if error
    const lastMsg = currentSession.messages[currentSession.messages.length - 1];
    if (lastMsg && lastMsg.role === "assistant" && !lastMsg.content) {
      currentSession.messages.pop();
    }
    showToast(`Error: ${err.message}`);
    renderMessages();
  }

  streaming = false;
  sendBtn.disabled = !userInput.value.trim();
}

function updateLastMessage() {
  const lastMsg = currentSession.messages[currentSession.messages.length - 1];
  if (!lastMsg || lastMsg.role !== "assistant") return;
  const msgEls = messagesEl.querySelectorAll(".message.assistant");
  const lastEl = msgEls[msgEls.length - 1];
  if (lastEl) {
    lastEl.innerHTML = renderMarkdown(lastMsg.content);
  }
}

async function sendInitialGreeting() {
  streaming = true;
  sendBtn.disabled = true;
  const typingIndicator = document.getElementById("typing");
  typingIndicator.classList.add("visible");
  scrollToBottom();

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "Hi, I want to plan a new project." }],
        apiKey: getApiKey(),
        model: getModel(),
      }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    addMessage("assistant", "");
    typingIndicator.classList.remove("visible");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "[DONE]") continue;
          try {
            const event = JSON.parse(data);
            if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
              appendAssistantChunk(event.delta.text);
              updateLastMessage();
              scrollToBottom();
            }
          } catch {}
        }
      }
    }

    saveSessions();
    renderMessages();
    scrollToBottom();
  } catch (err) {
    typingIndicator.classList.remove("visible");
    const lastMsg = currentSession.messages[currentSession.messages.length - 1];
    if (lastMsg && lastMsg.role === "assistant" && !lastMsg.content) {
      currentSession.messages.pop();
    }
    showToast(`Error: ${err.message}`);
  }

  streaming = false;
  sendBtn.disabled = !userInput.value.trim();
}

// ===== File Extraction =====
function extractGsdFiles(text) {
  const regex = /```json:gsd-files\s*\n([\s\S]*?)\n```/;
  const match = text.match(regex);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]);
    return parsed.files || null;
  } catch {
    return null;
  }
}

// ===== Download =====
window.downloadGsdFiles = async function () {
  const files = currentSession?.gsdFiles;
  if (!files) {
    showToast("No files to download");
    return;
  }

  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) {
    zip.file(path, content);
  }

  const blob = await zip.generateAsync({ type: "blob" });
  const name = (currentSession.name || "project").replace(/[^a-z0-9]/gi, "-").toLowerCase();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}-gsd-plan.zip`;
  a.click();
  URL.revokeObjectURL(url);
  showToast("Downloaded!");
};

// ===== Generate Button =====
$("#generate-btn").addEventListener("click", () => {
  if (streaming) return;
  userInput.value = "Please generate the GSD planning files now.";
  sendMessage(userInput.value);
  userInput.value = "";
  autoResizeInput();
});

// ===== Input Handling =====
userInput.addEventListener("input", () => {
  sendBtn.disabled = !userInput.value.trim() || streaming;
  autoResizeInput();
});

userInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    if (!sendBtn.disabled) {
      sendMessage(userInput.value);
      userInput.value = "";
      autoResizeInput();
    }
  }
});

sendBtn.addEventListener("click", () => {
  if (!sendBtn.disabled) {
    sendMessage(userInput.value);
    userInput.value = "";
    autoResizeInput();
  }
});

function autoResizeInput() {
  userInput.style.height = "auto";
  userInput.style.height = Math.min(userInput.scrollHeight, 120) + "px";
}

// ===== Navigation =====
$("#new-project-btn").addEventListener("click", () => {
  if (!getApiKey()) {
    showToast("Set your API key first");
    showScreen(settingsScreen);
    return;
  }
  createSession();
  openSession(0);
});

$("#chat-back").addEventListener("click", () => {
  currentSession = null;
  renderHome();
  showScreen(homeScreen);
});

// ===== Helpers =====
function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function renderMarkdown(text) {
  // Strip out the JSON:gsd-files block for display
  let clean = text.replace(/```json:gsd-files\s*\n[\s\S]*?\n```/g, "");

  // Basic markdown rendering
  return clean
    .split("\n\n")
    .map((block) => {
      block = block.trim();
      if (!block) return "";

      // Headers
      if (block.startsWith("### ")) return `<h3>${inlineFormat(block.slice(4))}</h3>`;
      if (block.startsWith("## ")) return `<h3>${inlineFormat(block.slice(3))}</h3>`;

      // Unordered lists
      if (/^[-*] /.test(block)) {
        const items = block.split(/\n/).map((l) => `<li>${inlineFormat(l.replace(/^[-*] /, ""))}</li>`).join("");
        return `<ul>${items}</ul>`;
      }

      // Ordered lists
      if (/^\d+\. /.test(block)) {
        const items = block.split(/\n/).map((l) => `<li>${inlineFormat(l.replace(/^\d+\. /, ""))}</li>`).join("");
        return `<ol>${items}</ol>`;
      }

      // Paragraphs
      return `<p>${inlineFormat(block.replace(/\n/g, "<br>"))}</p>`;
    })
    .join("");
}

function inlineFormat(text) {
  return text
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ===== Init =====
renderHome();
