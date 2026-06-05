(function () {
  const vscode = acquireVsCodeApi();
  const preview = document.getElementById('preview');
  const title = document.getElementById('file-title');
  const sourceButton = document.getElementById('source-button');

  function scrollRatio() {
    const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    return window.scrollY / maxScroll;
  }

  function restoreScroll(ratio) {
    requestAnimationFrame(function () {
      const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      window.scrollTo(0, maxScroll * ratio);
    });
  }

  function showSource() {
    vscode.postMessage({ type: 'source' });
  }

  sourceButton.addEventListener('click', showSource);
  window.addEventListener('keydown', function (event) {
    const isToggle = event.key === '/' && (event.ctrlKey || event.metaKey);
    if (isToggle) {
      event.preventDefault();
      showSource();
    }
  });

  window.addEventListener('message', function (event) {
    const message = event.data;
    if (!message || !message.type) {
      return;
    }

    if (message.type === 'render') {
      const ratio = scrollRatio();
      title.textContent = message.title || '';
      preview.classList.remove('error');
      preview.innerHTML = message.body || '';
      restoreScroll(ratio);
      return;
    }

    if (message.type === 'error') {
      preview.classList.add('error');
      preview.textContent = message.message || 'Preview render failed.';
    }
  });
})();
