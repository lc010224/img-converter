const apiBase = window.location.origin;
const form = document.getElementById('conversion-form');
const resultBox = document.getElementById('resultBox');
const statusBanner = document.getElementById('statusBanner');
const pageTitle = document.getElementById('pageTitle');
const navItems = Array.from(document.querySelectorAll('.nav-item'));
const panels = Array.from(document.querySelectorAll('.panel'));
const folderModal = document.getElementById('folderModal');
const modalTree = document.getElementById('modalTree');
const modalCurrentPath = document.getElementById('modalCurrentPath');
const modalConfirmBtn = document.getElementById('modalConfirmBtn');
const localUploadTrigger = document.getElementById('localUploadTrigger');
const localFileInput = document.getElementById('localFileInput');
const localFolderInput = document.getElementById('localFolderInput');
const pickFilesBtn = document.getElementById('pickFilesBtn');
const pickFolderBtn = document.getElementById('pickFolderBtn');
const localSelectionResult = document.getElementById('localSelectionResult');
const localConvertBtn = document.getElementById('localConvertBtn');
const saveWatchBtn = document.getElementById('saveWatchBtn');
const saveToast = document.getElementById('saveToast');

const pathTargets = {
  source: document.getElementById('sourcePathDisplay'),
  output: document.getElementById('outputPathDisplay'),
  watchSource: document.getElementById('watchSourceDisplay'),
  watchOutput: document.getElementById('watchOutputDisplay'),
};

const appState = {
  activePicker: null,
  selectedModalPath: '/data',
  expanded: new Set(['/data']),
  treeData: {},
  localFiles: [],
  saveToastTimer: null,
};

function setActiveTab(tab) {
  navItems.forEach((item) => item.classList.toggle('is-active', item.dataset.tab === tab));
  panels.forEach((panel) => panel.classList.toggle('is-active', panel.dataset.panel === tab));
  pageTitle.textContent = { convert: '图片转换', watch: '自动监听', studio: '视觉与策略' }[tab] || '图片转换';
}

function showSaveToast(text = '保存成功') {
  if (!saveToast) return;
  saveToast.textContent = text;
  saveToast.classList.add('is-visible');
  saveToast.setAttribute('aria-hidden', 'false');
  if (appState.saveToastTimer) clearTimeout(appState.saveToastTimer);
  appState.saveToastTimer = window.setTimeout(() => {
    saveToast.classList.remove('is-visible');
    saveToast.setAttribute('aria-hidden', 'true');
  }, 2000);
}

async function checkHealth() {
  try {
    const response = await fetch(`${apiBase}/health`);
    if (!response.ok) throw new Error();
    const data = await response.json();
    statusBanner.textContent = `服务在线 · 数据根目录 ${data.data_root} · cwebp ${data.cwebp ? '已安装' : '缺失'} · inotifywait ${data.inotifywait ? '已安装' : '缺失'} · 自动监听 ${data.watch_running ? '运行中' : '未启动'}`;
    statusBanner.className = 'status-banner ok';
  } catch {
    statusBanner.textContent = '服务不可达，请检查容器是否正常运行';
    statusBanner.className = 'status-banner error';
  }
}

function collectFormats(name = 'inputFormats') {
  return Array.from(document.querySelectorAll(`input[name="${name}"]:checked`)).map((item) => item.value);
}

function pathDepth(path) {
  return path === '/data' ? 0 : path.replace('/data/', '').split('/').length;
}

function pathName(path) {
  if (path === '/data') return 'data';
  const parts = path.split('/');
  return parts[parts.length - 1] || 'data';
}

async function fetchFolders(path) {
  const response = await fetch(`${apiBase}/folders?path=${encodeURIComponent(path)}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.detail || '读取目录失败');
  return data;
}

async function ensureNodeLoaded(path) {
  if (appState.treeData[path]) return appState.treeData[path];
  const data = await fetchFolders(path);
  appState.treeData[path] = data;
  return data;
}

function flattenVisibleNodes(path = '/data', bucket = []) {
  const data = appState.treeData[path];
  if (!data) return bucket;
  (data.directories || []).forEach((directory) => {
    bucket.push(directory.path);
    if (appState.expanded.has(directory.path)) flattenVisibleNodes(directory.path, bucket);
  });
  return bucket;
}

function renderModalTree() {
  modalCurrentPath.textContent = appState.selectedModalPath;
  const visibleNodes = flattenVisibleNodes();
  if (!visibleNodes.length) {
    modalTree.innerHTML = '<div class="modal-empty">当前目录下没有可选子文件夹</div>';
    return;
  }
  modalTree.innerHTML = visibleNodes.map((path) => `
    <div class="modal-tree-row ${appState.selectedModalPath === path ? 'modal-tree-row--selected' : ''}" style="--depth:${pathDepth(path)}">
      <button type="button" class="modal-folder-btn ${appState.expanded.has(path) ? 'is-open' : ''}" data-modal-mode="toggle" data-path="${path}" aria-label="展开目录"><span>📁</span></button>
      <button type="button" class="modal-path-btn ${appState.selectedModalPath === path ? 'is-selected' : ''}" data-modal-mode="select" data-path="${path}"><span class="modal-path-name">${pathName(path)}</span></button>
    </div>`).join('');
}

async function initializeModalTree() {
  modalTree.innerHTML = '<div class="modal-empty">正在读取目录...</div>';
  await ensureNodeLoaded('/data');
  renderModalTree();
}

async function openFolderModal(pickerKey) {
  appState.activePicker = pickerKey;
  appState.selectedModalPath = pathTargets[pickerKey].value || '/data';
  appState.expanded = new Set(['/data']);
  appState.treeData = {};
  folderModal.classList.add('is-open');
  folderModal.setAttribute('aria-hidden', 'false');
  await initializeModalTree();
}

function closeFolderModal() {
  folderModal.classList.remove('is-open');
  folderModal.setAttribute('aria-hidden', 'true');
  appState.activePicker = null;
}

async function toggleNode(path) {
  if (appState.expanded.has(path)) {
    appState.expanded.delete(path);
    renderModalTree();
    return;
  }
  await ensureNodeLoaded(path);
  appState.expanded.add(path);
  renderModalTree();
}

function selectNode(path) {
  appState.selectedModalPath = path;
  renderModalTree();
}

function commitSelectedPath() {
  if (!appState.activePicker) return;
  pathTargets[appState.activePicker].value = appState.selectedModalPath;
  closeFolderModal();
}

function renderLocalSelection(files) {
  appState.localFiles = files;
  if (!files.length) {
    localSelectionResult.textContent = '暂未选择本地文件或文件夹';
    return;
  }
  const lines = files.slice(0, 50).map((file) => `${file.webkitRelativePath || file.name} (${Math.round(file.size / 1024)} KB)`);
  const extra = files.length > 50 ? `\n... 其余 ${files.length - 50} 个文件未展开` : '';
  localSelectionResult.textContent = `共选择 ${files.length} 个项目\n\n${lines.join('\n')}${extra}`;
}

async function saveWatchConfig() {
  const inputFormats = collectFormats('watchInputFormats');
  if (!inputFormats.length) {
    resultBox.textContent = '自动监听至少要选择一种源文件格式。';
    setActiveTab('watch');
    return;
  }
  const payload = {
    source_path: pathTargets.watchSource.value.trim(),
    output_path: pathTargets.watchOutput.value.trim(),
    target_format: document.getElementById('watchTargetFormat').value,
    quality: 82,
    interval_seconds: Number(document.getElementById('watchInterval').value || 15),
    input_formats: inputFormats,
    delete_original: document.getElementById('watchDeleteOriginal').checked,
    enabled: document.getElementById('watchEnabled').checked,
  };

  try {
    const response = await fetch(`${apiBase}/watch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || '保存失败');
    showSaveToast('保存成功');
    resultBox.textContent = JSON.stringify(data, null, 2);
    checkHealth();
  } catch (error) {
    resultBox.textContent = `保存监听配置失败：${error.message}`;
    setActiveTab('watch');
  }
}

navItems.forEach((item) => item.addEventListener('click', () => setActiveTab(item.dataset.tab)));
localUploadTrigger.addEventListener('click', () => localFileInput.click());
pickFilesBtn.addEventListener('click', () => localFileInput.click());
pickFolderBtn.addEventListener('click', () => localFolderInput.click());
localFileInput.addEventListener('change', () => renderLocalSelection(Array.from(localFileInput.files || [])));
localFolderInput.addEventListener('change', () => renderLocalSelection(Array.from(localFolderInput.files || [])));
localUploadTrigger.addEventListener('dragover', (event) => { event.preventDefault(); localUploadTrigger.classList.add('is-dragging'); });
localUploadTrigger.addEventListener('dragleave', () => localUploadTrigger.classList.remove('is-dragging'));
localUploadTrigger.addEventListener('drop', (event) => {
  event.preventDefault();
  localUploadTrigger.classList.remove('is-dragging');
  renderLocalSelection(Array.from(event.dataTransfer?.files || []));
});
localConvertBtn?.addEventListener('click', () => {
  const localFormats = collectFormats('localInputFormats');
  if (!appState.localFiles.length) {
    resultBox.textContent = '请先在“本地文件”区域选择文件或文件夹。';
    return;
  }
  resultBox.textContent = JSON.stringify({
    mode: 'local-preview',
    target_format: document.getElementById('localTargetFormat')?.value,
    quality: Number(document.getElementById('localQuality')?.value || 80),
    input_formats: localFormats,
    delete_original: document.getElementById('localDeleteOriginal')?.checked || false,
    selected_count: appState.localFiles.length,
    selected_items: appState.localFiles.slice(0, 20).map((file) => file.webkitRelativePath || file.name),
  }, null, 2);
});
saveWatchBtn?.addEventListener('click', saveWatchConfig);

document.addEventListener('click', async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const openPicker = target.closest('[data-open-picker]');
  if (openPicker instanceof HTMLElement) return openFolderModal(openPicker.dataset.openPicker);
  if (target.dataset.closeModal === 'true' || target.dataset.cancelModal === 'true' || target === folderModal) return closeFolderModal();
  const modalAction = target.closest('[data-modal-mode]');
  if (modalAction instanceof HTMLElement) {
    const path = modalAction.dataset.path;
    if (!path) return;
    if (modalAction.dataset.modalMode === 'toggle') return toggleNode(path);
    if (modalAction.dataset.modalMode === 'select') return selectNode(path);
  }
});

modalConfirmBtn.addEventListener('click', commitSelectedPath);

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const inputFormats = collectFormats('inputFormats');
  if (!inputFormats.length) {
    resultBox.textContent = '请至少选择一种需要处理的原始格式。';
    return;
  }
  const payload = {
    source_path: pathTargets.source.value.trim(),
    output_path: pathTargets.output.value.trim(),
    target_format: document.getElementById('targetFormat').value,
    quality: Number(document.getElementById('quality').value),
    input_formats: inputFormats,
    delete_original: document.getElementById('deleteOriginal').checked,
  };
  resultBox.textContent = '正在提交转换任务，请稍候...';
  try {
    const response = await fetch(`${apiBase}/convert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || '转换失败');
    resultBox.textContent = JSON.stringify(data, null, 2);
  } catch (error) {
    resultBox.textContent = `执行失败：${error.message}`;
  }
});

setActiveTab('convert');
checkHealth();
