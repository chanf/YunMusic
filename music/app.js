const storageKeys = {
  authCode: "music_auth_code",
  currentTrackId: "music_current_track_id",
  currentTime: "music_current_time",
  currentTimeTrackId: "music_current_time_track_id",
  queue: "music_track_queue",
};

const state = {
  authCode: localStorage.getItem(storageKeys.authCode) || "",
  tracks: [],
  currentIndex: -1,
  isLoading: false,
};

const dom = {
  authCodeInput: document.getElementById("authCodeInput"),
  loginButton: document.getElementById("loginButton"),
  logoutButton: document.getElementById("logoutButton"),
  searchInput: document.getElementById("searchInput"),
  sortSelect: document.getElementById("sortSelect"),
  refreshButton: document.getElementById("refreshButton"),
  uploadInput: document.getElementById("uploadInput"),
  statusText: document.getElementById("statusText"),
  trackList: document.getElementById("trackList"),
  emptyState: document.getElementById("emptyState"),
  nowPlayingTitle: document.getElementById("nowPlayingTitle"),
  nowPlayingSub: document.getElementById("nowPlayingSub"),
  prevButton: document.getElementById("prevButton"),
  playPauseButton: document.getElementById("playPauseButton"),
  nextButton: document.getElementById("nextButton"),
  progressInput: document.getElementById("progressInput"),
  currentTime: document.getElementById("currentTime"),
  totalTime: document.getElementById("totalTime"),
  audioPlayer: document.getElementById("audioPlayer"),
};

function setStatus(message, isError = false) {
  dom.statusText.textContent = message;
  dom.statusText.classList.toggle("error", isError);
}

function formatTime(seconds) {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const minute = String(Math.floor(safeSeconds / 60)).padStart(2, "0");
  const second = String(safeSeconds % 60).padStart(2, "0");
  return `${minute}:${second}`;
}

function formatSize(sizeBytes) {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return "--";
  }
  const mb = sizeBytes / (1024 * 1024);
  if (mb < 1) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }
  return `${mb.toFixed(2)} MB`;
}

function toApiUrl(path, params = {}) {
  const url = new URL(path, window.location.origin);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  });
  return url;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let payload;

  try {
    payload = text ? JSON.parse(text) : {};
  } catch (_error) {
    payload = text;
  }

  if (!response.ok) {
    const message = typeof payload === "string" ? payload : payload.error || "请求失败";
    throw new Error(message);
  }

  return payload;
}

function renderTracks() {
  dom.trackList.innerHTML = "";

  if (state.tracks.length === 0) {
    dom.emptyState.classList.remove("hidden");
    return;
  }

  dom.emptyState.classList.add("hidden");

  const fragment = document.createDocumentFragment();
  state.tracks.forEach((track, index) => {
    const li = document.createElement("li");
    li.className = "track-item";
    if (index === state.currentIndex) {
      li.classList.add("active");
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = "track-button";
    button.dataset.index = String(index);

    const main = document.createElement("div");
    main.className = "track-main";

    const title = document.createElement("p");
    title.className = "track-title";
    title.textContent = track.title || track.fileName || "未命名";

    const sub = document.createElement("p");
    sub.className = "track-sub";
    const artist = track.artist ? ` · ${track.artist}` : "";
    const duration = track.duration ? ` · ${formatTime(track.duration)}` : "";
    sub.textContent = `${track.fileName || track.id}${artist}${duration}`;

    const size = document.createElement("span");
    size.className = "track-size";
    size.textContent = formatSize(track.sizeBytes);

    main.append(title, sub);
    button.append(main, size);
    li.append(button);
    fragment.append(li);
  });

  dom.trackList.append(fragment);
}

function getAuthParams() {
  return state.authCode ? { authCode: state.authCode } : {};
}

function persistQueue() {
  localStorage.setItem(storageKeys.queue, JSON.stringify(state.tracks));
}

function restoreSelectedTrack() {
  const savedTrackId = localStorage.getItem(storageKeys.currentTrackId);
  if (!savedTrackId) {
    return;
  }

  const index = state.tracks.findIndex((track) => track.id === savedTrackId);
  if (index >= 0) {
    state.currentIndex = index;
    renderTracks();
    updateNowPlayingMeta();
  }
}

function updateNowPlayingMeta() {
  const current = state.tracks[state.currentIndex];
  if (!current) {
    dom.nowPlayingTitle.textContent = "未播放";
    dom.nowPlayingSub.textContent = "请选择一首歌";
    return;
  }

  dom.nowPlayingTitle.textContent = current.title || current.fileName || "未命名";
  dom.nowPlayingSub.textContent = current.artist || current.fileName || current.id;
}

async function loadTracks({ silent = false } = {}) {
  if (state.isLoading) {
    return;
  }

  if (!silent) {
    setStatus("正在加载音乐库...");
  }

  state.isLoading = true;
  try {
    const params = {
      q: dom.searchInput.value.trim(),
      sort: dom.sortSelect.value,
      count: 200,
      ...getAuthParams(),
    };

    const apiUrl = toApiUrl("/api/music/list", params);
    const data = await requestJson(apiUrl.toString());
    state.tracks = Array.isArray(data.tracks) ? data.tracks : [];
    persistQueue();
    restoreSelectedTrack();
    renderTracks();

    if (state.tracks.length === 0) {
      setStatus("音乐库为空，先上传一首歌试试。", false);
    } else {
      setStatus(`已加载 ${state.tracks.length} 首歌曲。`, false);
    }
  } catch (error) {
    setStatus(`加载失败：${error.message}`, true);
  } finally {
    state.isLoading = false;
  }
}

function buildStreamUrl(track) {
  const url = new URL(track.streamUrl, window.location.origin);
  if (state.authCode) {
    url.searchParams.set("authCode", state.authCode);
  }
  return url.toString();
}

function playTrack(index, { autoPlay = true } = {}) {
  if (index < 0 || index >= state.tracks.length) {
    return;
  }

  state.currentIndex = index;
  const track = state.tracks[index];
  const streamUrl = buildStreamUrl(track);

  dom.audioPlayer.src = streamUrl;
  localStorage.setItem(storageKeys.currentTrackId, track.id);
  renderTracks();
  updateNowPlayingMeta();

  const savedTimeTrackId = localStorage.getItem(storageKeys.currentTimeTrackId);
  const savedTime = Number(localStorage.getItem(storageKeys.currentTime) || 0);
  if (savedTimeTrackId === track.id && Number.isFinite(savedTime)) {
    dom.audioPlayer.currentTime = savedTime;
  } else {
    dom.audioPlayer.currentTime = 0;
  }

  if (autoPlay) {
    void dom.audioPlayer.play().catch((error) => {
      setStatus(`播放失败：${error.message}`, true);
    });
  }
}

function playNext() {
  if (state.tracks.length === 0) return;
  const nextIndex = state.currentIndex >= state.tracks.length - 1 ? 0 : state.currentIndex + 1;
  playTrack(nextIndex);
}

function playPrev() {
  if (state.tracks.length === 0) return;
  const prevIndex = state.currentIndex <= 0 ? state.tracks.length - 1 : state.currentIndex - 1;
  playTrack(prevIndex);
}

async function uploadSelectedFile() {
  const file = dom.uploadInput.files?.[0];
  if (!file) {
    return;
  }

  const formData = new FormData();
  formData.append("file", file);

  setStatus(`正在上传：${file.name}`);

  try {
    const uploadUrl = toApiUrl("/api/music/upload", getAuthParams());
    await requestJson(uploadUrl.toString(), {
      method: "POST",
      body: formData,
    });
    setStatus(`上传成功：${file.name}`);
    dom.uploadInput.value = "";
    await loadTracks({ silent: true });
  } catch (error) {
    setStatus(`上传失败：${error.message}`, true);
  }
}

function bindEvents() {
  dom.loginButton.addEventListener("click", async () => {
    const authCode = dom.authCodeInput.value.trim();
    state.authCode = authCode;
    if (authCode) {
      localStorage.setItem(storageKeys.authCode, authCode);
    } else {
      localStorage.removeItem(storageKeys.authCode);
    }
    await loadTracks();
  });

  dom.logoutButton.addEventListener("click", () => {
    state.authCode = "";
    dom.authCodeInput.value = "";
    localStorage.removeItem(storageKeys.authCode);
    setStatus("已退出，本地访问码已清除。", false);
  });

  dom.refreshButton.addEventListener("click", () => {
    void loadTracks();
  });

  dom.searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      void loadTracks();
    }
  });

  dom.sortSelect.addEventListener("change", () => {
    void loadTracks({ silent: true });
  });

  dom.uploadInput.addEventListener("change", () => {
    void uploadSelectedFile();
  });

  dom.trackList.addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const button = target?.closest("button.track-button");
    if (!button) {
      return;
    }
    const index = Number(button.dataset.index);
    if (Number.isFinite(index)) {
      playTrack(index);
    }
  });

  dom.playPauseButton.addEventListener("click", () => {
    if (!dom.audioPlayer.src && state.tracks.length > 0) {
      playTrack(Math.max(0, state.currentIndex));
      return;
    }

    if (dom.audioPlayer.paused) {
      void dom.audioPlayer.play();
    } else {
      dom.audioPlayer.pause();
    }
  });

  dom.prevButton.addEventListener("click", playPrev);
  dom.nextButton.addEventListener("click", playNext);

  dom.audioPlayer.addEventListener("play", () => {
    dom.playPauseButton.textContent = "暂停";
  });

  dom.audioPlayer.addEventListener("pause", () => {
    dom.playPauseButton.textContent = "播放";
  });

  dom.audioPlayer.addEventListener("ended", () => {
    playNext();
  });

  dom.audioPlayer.addEventListener("timeupdate", () => {
    const current = dom.audioPlayer.currentTime;
    const duration = dom.audioPlayer.duration;
    if (Number.isFinite(duration) && duration > 0) {
      dom.progressInput.value = String(Math.round((current / duration) * 1000));
      dom.totalTime.textContent = formatTime(duration);
    }
    dom.currentTime.textContent = formatTime(current);
    localStorage.setItem(storageKeys.currentTime, String(current));
    const currentTrack = state.tracks[state.currentIndex];
    if (currentTrack?.id) {
      localStorage.setItem(storageKeys.currentTimeTrackId, currentTrack.id);
    }
  });

  dom.progressInput.addEventListener("input", () => {
    const duration = dom.audioPlayer.duration;
    if (!Number.isFinite(duration) || duration <= 0) {
      return;
    }
    const ratio = Number(dom.progressInput.value) / 1000;
    dom.audioPlayer.currentTime = ratio * duration;
  });

  dom.audioPlayer.addEventListener("error", () => {
    setStatus("播放出错，请检查访问码或文件可用性。", true);
  });
}

function bootstrap() {
  dom.authCodeInput.value = state.authCode;
  bindEvents();
  if (state.authCode) {
    void loadTracks();
  }
}

bootstrap();
