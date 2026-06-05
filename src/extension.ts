import * as path from 'path';
import * as vscode from 'vscode';
import { createMarkdownRenderer } from './mathMarkdown';

type PreviewEntry = {
  panel: vscode.WebviewPanel;
  uri: vscode.Uri;
};

export function activate(context: vscode.ExtensionContext): void {
  const previews = new MarkdownPreviewManager(context);

  context.subscriptions.push(
    vscode.commands.registerCommand('typoraMarkdown.openPreview', async (resource?: vscode.Uri) => {
      const uri = resource ?? vscode.window.activeTextEditor?.document.uri;
      if (!uri) {
        return;
      }
      await previews.openPreview(uri, vscode.ViewColumn.Active, false);
    }),
    vscode.commands.registerCommand('typoraMarkdown.toggleMode', async (resource?: vscode.Uri) => {
      await previews.toggle(resource);
    }),
    vscode.workspace.onDidChangeTextDocument(event => {
      previews.update(event.document.uri);
    }),
    vscode.workspace.onDidSaveTextDocument(document => {
      previews.update(document.uri);
    })
  );
}

export function deactivate(): void {
  // Nothing to dispose. VS Code owns all subscriptions registered during activation.
}

class MarkdownPreviewManager {
  private readonly renderer = createMarkdownRenderer();
  private readonly previews = new Map<string, PreviewEntry>();
  private activePreviewKey: string | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  async toggle(resource?: vscode.Uri): Promise<void> {
    const activeKey = this.activePreviewKey;
    if (activeKey) {
      const activePreview = this.previews.get(activeKey);
      if (activePreview?.panel.active) {
        await this.openSource(activePreview);
        return;
      }
    }

    const activeEditor = vscode.window.activeTextEditor;
    const uri = resource ?? activeEditor?.document.uri;
    if (!uri) {
      return;
    }

    const document = await vscode.workspace.openTextDocument(uri);
    if (document.languageId !== 'markdown') {
      return;
    }

    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    await this.openPreview(uri, activeEditor?.viewColumn ?? vscode.ViewColumn.Active, true);
  }

  async openPreview(uri: vscode.Uri, viewColumn: vscode.ViewColumn = vscode.ViewColumn.Active, reveal: boolean): Promise<void> {
    const key = uri.toString();
    const existing = this.previews.get(key);

    if (existing) {
      existing.panel.reveal(viewColumn, true);
      this.activePreviewKey = key;
      await this.render(existing);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'typoraMarkdown.preview',
      `Preview: ${path.basename(uri.fsPath)}`,
      viewColumn,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.context.extensionUri, 'media'),
          vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', 'katex', 'dist')
        ]
      }
    );

    const entry: PreviewEntry = { panel, uri };
    this.previews.set(key, entry);
    this.activePreviewKey = key;

    panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'preview.svg');
    panel.webview.html = this.getWebviewHtml(panel.webview, uri);

    panel.onDidDispose(() => {
      this.previews.delete(key);
      if (this.activePreviewKey === key) {
        this.activePreviewKey = undefined;
      }
    });

    panel.onDidChangeViewState(event => {
      if (event.webviewPanel.active) {
        this.activePreviewKey = key;
      }
    });

    panel.webview.onDidReceiveMessage(async message => {
      if (message?.type === 'source') {
        await this.openSource(entry);
      }
    });

    await this.render(entry);

    if (reveal) {
      panel.reveal(viewColumn, true);
    }
  }

  update(uri: vscode.Uri): void {
    const entry = this.previews.get(uri.toString());
    if (entry) {
      void this.render(entry);
    }
  }

  private async openSource(entry: PreviewEntry): Promise<void> {
    const viewColumn = entry.panel.viewColumn ?? vscode.ViewColumn.Active;
    entry.panel.dispose();
    const document = await vscode.workspace.openTextDocument(entry.uri);
    await vscode.window.showTextDocument(document, {
      viewColumn,
      preview: false
    });
  }

  private async render(entry: PreviewEntry): Promise<void> {
    try {
      const document = await vscode.workspace.openTextDocument(entry.uri);
      const body = this.renderer.render(document.getText());
      await entry.panel.webview.postMessage({
        type: 'render',
        body,
        title: path.basename(entry.uri.fsPath)
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await entry.panel.webview.postMessage({
        type: 'error',
        message
      });
    }
  }

  private getWebviewHtml(webview: vscode.Webview, uri: vscode.Uri): string {
    const nonce = getNonce();
    const previewCss = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'preview.css'));
    const previewJs = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'preview.js'));
    const katexCss = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', 'katex', 'dist', 'katex.min.css'));
    const title = escapeHtml(path.basename(uri.fsPath));

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${katexCss}">
  <link rel="stylesheet" href="${previewCss}">
  <title>${title}</title>
</head>
<body>
  <header class="toolbar">
    <div class="file-title" id="file-title">${title}</div>
    <button id="source-button" type="button" title="Toggle source mode (Ctrl+/)">Source</button>
  </header>
  <main id="preview" class="preview" aria-live="polite"></main>
  <script nonce="${nonce}" src="${previewJs}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let i = 0; i < 32; i += 1) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
