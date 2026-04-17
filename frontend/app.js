const apiBase = window.location.origin;
const form = document.getElementById('conversion-form');
const resultBox = document.getElementById('resultBox');
const statusBanner = document.getElementById('statusBanner');
const pageTitle = document.getElementById('pageTitle');
const navItems = Array.from(document.querySelectorAll('.nav-item'));
const panels = Array.from(document.querySelectorAll('.tab-panel'));

const pickerState = {
  source: {
    selectedPath: '/data',
    currentPath: '/data',
    expanded: new Set(['/data']),
    treeData: {},
    selectedEl: document.getElementById('sourceSelected'),
    currentEl: document.getElementById('sourceCurrent'),
    treeEl: document.getElementById('sourceTree'),
  },
  output: {
    selectedPath: '/data',
    currentPath: '/data',
    expanded: new Set(['/data']),
    treeData: {},
    selectedEl: document.getElementById('outputSelected'),
    currentEl: document.getElementById('outputCurrent'),
    treeEl: document.getElementById('outputTree'),
  },
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

function nodeDepth(path) {
  if (path === '/data') {
    return 0;
  }
  return path.replace('/data/', '').split('/').length;
}

function getNodeName(path) {
  if (path === '/data') {
    return 'data';
  }
  const parts = path.split('/');
  return parts[parts.length - 1] || 'data';
}

function isDirectChild(parentPath, childPath) {
  if (parentPath === childPath) {
    return false;
  }
  const parentDepth = nodeDepth(parentPath);
  const childDepth = nodeDepth(childPath);
  return childPath.startsWith(`${parentPath}/`) && childDepth === parentDepth + 1;
}

async function fetchFolders(path) {
  const response = await fetch(`${apiBase}/folders?path=${encodeURIComponent(path)}`);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.detail || '读取目录失败');
  }
  return data;
}

async function ensureNodeLoaded(type, path) {
  const state = pickerState[type];
  if (state.treeData[path]) {
    return state.treeData[path];
  }

  const data = await fetchFolders(path);
  state.treeData[path] = data;
  state.currentPath = data.current_path;
  return data;
}

function flattenVisibleNodes(type, path = '/data', bucket = []) {
  const state = pickerState[type];
  const data = state.treeData[path];
  if (!data) {
    return bucket;
  }

  const directories = data.directories || [];
  directories.forEach((directory) => {
    bucket.push(directory.path);
    if (state.expanded.has(directory.path)) {
      flattenVisibleNodes(type, directory.path, bucket);
    }
  });
  return bucket;
}

function renderTree(type) {
  const state = pickerState[type];
  state.selectedEl.textContent = state.selectedPath;
  state.currentEl.textContent = state.currentPath;

  const visibleNodes = flattenVisibleNodes(type);
  if (!visibleNodes.length) {
    state.treeEl.innerHTML = '<div class="tree-empty">当前目录下没有可浏览的子文件夹</div>';
    return;
  }

  state.treeEl.innerHTML = visibleNodes.map((path) => {
    const depth = nodeDepth(path);
    const expanded = state.expanded.has(path);
    const loaded = Boolean(state.treeData[path]);
    const selected = state.selectedPath === path;
    const label = getNodeName(path);

    return `
      <div class="tree-row ${selected ? 'tree-row--selected' : ''}" style="--depth:${depth}">
        <button type="button" class="tree-expand ${expanded ? 'is-open' : ''}" data-picker-type="${type}" data-mode="toggle" data-path="${path}" aria-label="展开目录">
          <span class="folder-glyph">📁</span>
        </button>
        <button type="button" class="tree-select ${selected ? 'is-selected' : ''}" data-picker-type="${type}" data-mode="select" data-path="${path}">
          <span class="tree-name">${label}</span>
          <span class="tree-path">${path}</span>
        </button>
        <span class="tree-state">${loaded ? (expanded ? '已展开' : '可展开') : '未加载'}</span>
      </div>
    `;
  }).join('');
}

async function initializeTree(type) {
  const state = pickerState[type];
  state.treeEl.innerHTML = '<div class="tree-empty">正在读取目录...</div>';
  await ensureNodeLoaded(type, '/data');
  renderTree(type);
}

async function toggleNode(type, path) {
  const state = pickerState[type];
  if (state.expanded.has(path)) {
    state.expanded.delete(path);
    state.currentPath = path;
    renderTree(type);
    return;
  }

  await ensureNodeLoaded(type, path);
  state.expanded.add(path);
  state.currentPath = path;
  renderTree(type);
}

function selectNode(type, path) {
  const state = pickerState[type];
  state.selectedPath = path;
  state.currentPath = path;
  renderTree(type);
}

async function refreshTree(type) {
  const state = pickerState[type];
  state.treeData = {};
  state.expanded = new Set(['/data']);
  state.currentPath = '/data';
  await initializeTree(type);
}

navItems.forEach((item) => {
  item.addEventListener('click', () => setActiveTab(item.dataset.tab));
});

document.addEventListener('click', async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const action = target.dataset.action;
  if (action === 'refresh-source') {
    await refreshTree('source');
    return;
  }
  if (action === 'refresh-output') {
    await refreshTree('output');
    return;
  }

  const pickerType = target.dataset.pickerType;
  const mode = target.dataset.mode;
  const path = target.dataset.path;

  if (!pickerType || !mode || !path) {
    return;
  }

  if (mode === 'toggle') {
    await toggleNode(pickerType, path);
    return;
  }

  if (mode === 'select') {
    selectNode(pickerType, path);
  }
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const inputFormats = collectFormats();
  if (!inputFormats.length) {
    resultBox.textContent = '请至少选择一种需要处理的原始格式。';
    return;
  }

  const payload = {
    source_path: pickerState.source.selectedPath,
    output_path: pickerState.output.selectedPath,
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
initializeTree('source');
initializeTree('output');
