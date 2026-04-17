const apiBase = `${window.location.protocol}//${window.location.hostname}:8000`;
const form = document.getElementById('conversion-form');
const resultBox = document.getElementById('resultBox');
const statusBanner = document.getElementById('statusBanner');

async function checkHealth() {
  try {
    const response = await fetch(`${apiBase}/health`);
    if (!response.ok) {
      throw new Error('health check failed');
    }
    const data = await response.json();
    statusBanner.textContent = `后端在线 · cwebp: ${data.cwebp} · inotifywait: ${data.inotifywait}`;
    statusBanner.className = 'status-banner ok';
  } catch (error) {
    statusBanner.textContent = '后端不可达，请检查 backend 容器是否正常运行';
    statusBanner.className = 'status-banner error';
  }
}

function collectFormats() {
  return Array.from(document.querySelectorAll('input[name="inputFormats"]:checked')).map((item) => item.value);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const inputFormats = collectFormats();
  if (!inputFormats.length) {
    resultBox.textContent = '请至少选择一种需要处理的原始格式。';
    return;
  }

  const payload = {
    source_path: document.getElementById('sourcePath').value.trim(),
    output_path: document.getElementById('outputPath').value.trim(),
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
