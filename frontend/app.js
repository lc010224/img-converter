const apiBase = window.location.origin;
const form = document.getElementById('conversion-form');
const resultBox = document.getElementById('resultBox');
const statusBanner = document.getElementById('statusBanner');

const pickerState = {
  source: {
    currentPath: '/data',
    selectedPath: '/data',
    currentEl: document.getElementById('sourceCurrent'),
    selectedEl: document.getElementById('sourceSelected'),
    listEl: document.getElementById('sourceFolders'),
  },
  output: {
    currentPath: '/data',
    selectedPath: '/data',
    currentEl: document.getElementById('outputCurrent'),
    selectedEl: document.getElementById('outputSelected'),
    listEl: document.getElementById('outputFolders'),
  },
};

async function checkHealth() {
  try {
    const response = await fetch(`${apiBase}/health`);
    if (!response.ok) {
      throw new Error('health check failed');
    }
    const data = await response.json();
    statusBanner.textContent = `服务在线 · 数据根目录: ${data.data_root} · cwebp: ${data.cwebp} · inotifywait: ${data.inotifywait}`;
    statusBanner.className = 'status-banner ok';
  } catch (error) {
    statusBanner.textContent = '服务不可达，请检查容器是否正常运行';
    statusBanner.className = 'status-banner error';
  }
}

function collectFormats() {
  return Array.from(document.querySelectorAll('input[name="inputFormats"]:checked')).map((item) => item.value);
}

function renderFolderButtons(type, payload) {
  const state = pickerState[type];
  state.currentPath = payload.current_path;
  state.currentEl.textContent = `当前：${payload.current_path}`;
  state.selectedEl.textContent = state.selectedPath;

  const segments = [];
  segments.push(`
    <button type="button" class="folder-item folder-item--select ${state.selectedPath === payload.current_path ? 'is-active' : ''}" data-picker-type="${type}" data-path="${payload.current_path}" data-mode="select">
      选择当前目录
    </button>
  `);

  if (payload.parent_path) {
    segments.push(`
      <button type="button" class="folder-item folder-item--nav" data-picker-type="${type}" data-path="${payload.parent_path}" data-mode="open">
        ← 返回上级
      </button>
    `);
  }

  if (payload.directories.length) {
    payload.directories.forEach((directory) => {
      segments.push(`
        <div class="folder-row">
          <button type="button" class="folder-item folder-item--nav" data-picker-type="${type}" data-path="${directory.path}" data-mode="open">
            打开 ${directory.name}
          </button>
          <button type="button" class="folder-item folder-item--select ${state.selectedPath === directory.path ? 'is-active' : ''}" data-picker-type="${type}" data-path="${directory.path}" data-mode="select">
            选中 ${directory.name}
          </button>
        </div>
      `);
    });
  } else {
    segments.push('<div class="folder-empty">当前目录下没有子文件夹</div>');
  }

  state.listEl.innerHTML = segments.join('');
}

async function loadFolders(type, path = '/data') {
  const state = pickerState[type];
  state.listEl.innerHTML = '<div class="folder-empty">正在读取目录...</div>';

  try {
    const response = await fetch(`${apiBase}/folders?path=${encodeURIComponent(path)}`);
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.detail || '读取目录失败');
    }
    renderFolderButtons(type, data);
  } catch (error) {
    state.listEl.innerHTML = `<div class="folder-empty">${error.message}</div>`;
  }
}

function selectFolder(type, path) {
  pickerState[type].selectedPath = path;
  pickerState[type].selectedEl.textContent = path;
  loadFolders(type, pickerState[type].currentPath);
}

document.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const action = target.dataset.action;
  if (action === 'refresh-source') {
    loadFolders('source', pickerState.source.currentPath);
    return;
  }

  if (action === 'refresh-output') {
    loadFolders('output', pickerState.output.currentPath);
    return;
  }

  const pickerType = target.dataset.pickerType;
  const path = target.dataset.path;
  const mode = target.dataset.mode;

  if (!pickerType || !path || !mode) {
    return;
  }

  if (mode === 'open') {
    loadFolders(pickerType, path);
    return;
  }

  if (mode === 'select') {
    selectFolder(pickerType, path);
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

checkHealth();
loadFolders('source', '/data');
loadFolders('output', '/data');
