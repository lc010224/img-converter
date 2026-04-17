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

const pathTargets = {
  source: document.getElementById('sourcePathDisplay'),
  output: document.getElementById('outputPathDisplay'),
  watchSource: document.getElementById('watchSourceDisplay'),
  watchOutput: document.getElementById('watchOutputDisplay'),
};

const appState = {
  activePicker: null,
  selectedModalPath: '/data',
  currentModalPath: '/data',
  expanded: new Set(['/data']),
  treeData: {},
};

function setActiveTab(tab) {
  navItems.forEach((item) => item.classList.toggle('is-active', item.dataset.tab === tab));
  panels.forEach((panel) => panel.classList.toggle('is-active', panel.dataset.panel === tab));

  const titles = {
    convert: '图片转换',
    watch: '自动监听',
    studio: '视觉与策略',
  };
  pageTitle.textContent = titles[tab] || '图片转换';
}

async function checkHealth() {
  try {
    const response = await fetch(`${apiBase}/health`);
    if (!response.ok) {
      throw new Error('health check failed');
    }
    const data = await response.json();
    statusBanner.textContent = `服务在线 · 数据根目录 ${data.data_root} · cwebp ${data.cwebp ? '已安装' : '缺失'} · inotifywait ${data.inotifywait ? '已安装' : '缺失'}`;
    statusBanner.className = 'status-banner ok';
  } catch (error) {
    statusBanner.textContent = '服务不可达，请检查容器是否正常运行';
    statusBanner.className = 'status-banner error';
  }
}

function collectFormats() {
  return Array.from(document.querySelectorAll('input[name="inputFormats"]:checked')).map((item) => item.value);
}

function pathDepth(path) {
  if (path === '/data') {
    return 0;
  }
  return path.replace('/data/', '').split('/').length;
}

function pathName(path) {
  if (path === '/data') {
    return 'data';
  }
  const parts = path.split('/');
  return parts[parts.length - 1] || 'data';
}

async function fetchFolders(path) {
  const response = await fetch(`${apiBase}/folders?path=${encodeURIComponent(path)}`);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.detail || '读取目录失败');
  }
  return data;
}

async function ensureNodeLoaded(path) {
  if (appState.treeData[path]) {
    return appState.treeData[path];
  }

  const data = await fetchFolders(path);
  appState.treeData[path] = data;
  return data;
}

function flattenVisibleNodes(path = '/data', bucket = []) {
  const data = appState.treeData[path];
  if (!data) {
    return bucket;
  }

  (data.directories || []).forEach((directory) => {
    bucket.push(directory.path);
    if (appState.expanded.has(directory.path)) {
      flattenVisibleNodes(directory.path, bucket);
    }
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

  modalTree.innerHTML = visibleNodes.map((path) => {
    const depth = pathDepth(path);
    const expanded = appState.expanded.has(path);
    const selected = appState.selectedModalPath === path;

    return `
      <div class="modal-tree-row ${selected ? 'modal-tree-row--selected' : ''}" style="--depth:${depth}">
        <button type="button" class="modal-folder-btn ${expanded ? 'is-open' : ''}" data-modal-mode="toggle" data-path="${path}" aria-label="展开目录">
          <span>📁</span>
        </button>
        <button type="button" class="modal-path-btn ${selected ? 'is-selected' : ''}" data-modal-mode="select" data-path="${path}">
          <span class="modal-path-name">${pathName(path)}</span>
        </button>
      </div>
    `;
  }).join('');
}

async function initializeModalTree() {
  modalTree.innerHTML = '<div class="modal-empty">正在读取目录...</div>';
  await ensureNodeLoaded('/data');
  renderModalTree();
}

async function openFolderModal(pickerKey) {
  appState.activePicker = pickerKey;
  appState.selectedModalPath = pathTargets[pickerKey].value || '/data';
  appState.currentModalPath = '/data';
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
  if (!appState.activePicker) {
    return;
  }
  pathTargets[appState.activePicker].value = appState.selectedModalPath;
  closeFolderModal();
}

navItems.forEach((item) => {
  item.addEventListener('click', () => setActiveTab(item.dataset.tab));
});

document.addEventListener('click', async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const openPicker = target.closest('[data-open-picker]');
  if (openPicker instanceof HTMLElement) {
    await openFolderModal(openPicker.dataset.openPicker);
    return;
  }

  if (target.dataset.closeModal === 'true' || target.dataset.cancelModal === 'true') {
    closeFolderModal();
    return;
  }

  if (target === folderModal) {
    closeFolderModal();
    return;
  }

  const modalAction = target.closest('[data-modal-mode]');
  if (modalAction instanceof HTMLElement) {
    const mode = modalAction.dataset.modalMode;
    const path = modalAction.dataset.path;
    if (!path) {
      return;
    }

    if (mode === 'toggle') {
      await toggleNode(path);
      return;
    }

    if (mode === 'select') {
      selectNode(path);
      return;
    }
  }
});

modalConfirmBtn.addEventListener('click', commitSelectedPath);

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const inputFormats = collectFormats();
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
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.detail || '转换失败');
    }

    resultBox.textContent = JSON.stringify(data, null, 2);
  } catch (error) {
    resultBox.textContent = `执行失败：${error.message}`;
  }
});

setActiveTab('convert');
checkHealth();
