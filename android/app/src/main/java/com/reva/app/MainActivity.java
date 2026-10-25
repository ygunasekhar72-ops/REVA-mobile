package com.reva.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.JsResult;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;

public class MainActivity extends Activity {

    private static final int FILE_CHOOSER_REQUEST = 100;

    private WebView web;
    private ValueCallback<Uri[]> filePathCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        // The whole app is bundled locally; this lets its fetch() reach AI
        // providers (CORS would otherwise block an asset:// origin).
        s.setAllowUniversalAccessFromFileURLs(true);

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (filePathCallback != null) filePathCallback.onReceiveValue(null);
                filePathCallback = callback;
                try {
                    Intent intent = params.createIntent();
                    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST);
                } catch (Exception e) {
                    filePathCallback = null;
                    return false;
                }
                return true;
            }

            @Override
            public boolean onJsAlert(WebView view, String url, String message, final JsResult result) {
                new AlertDialog.Builder(MainActivity.this)
                        .setMessage(message)
                        .setPositiveButton("OK", new AlertDialog.OnClickListener() {
                            public void onClick(android.content.DialogInterface d, int w) { result.confirm(); }
                        })
                        .setOnCancelListener(new AlertDialog.OnCancelListener() {
                            public void onCancel(android.content.DialogInterface d) { result.cancel(); }
                        })
                        .show();
                return true;
            }

            @Override
            public boolean onJsConfirm(WebView view, String url, String message, final JsResult result) {
                new AlertDialog.Builder(MainActivity.this)
                        .setMessage(message)
                        .setPositiveButton("OK", new AlertDialog.OnClickListener() {
                            public void onClick(android.content.DialogInterface d, int w) { result.confirm(); }
                        })
                        .setNegativeButton("Cancel", new AlertDialog.OnClickListener() {
                            public void onClick(android.content.DialogInterface d, int w) { result.cancel(); }
                        })
                        .setOnCancelListener(new AlertDialog.OnCancelListener() {
                            public void onCancel(android.content.DialogInterface d) { result.cancel(); }
                        })
                        .show();
                return true;
            }
        });

        // Real terminal bridge: ONE interactive /system/bin/sh process whose
        // streams are piped to the page. Full shell semantics (pipes, redirects,
        // chaining, env) are interpreted by the shell itself — the app execs a
        // fixed argv and only ever forwards bytes, so there is no command
        // string to inject.
        web.addJavascriptInterface(new ShellStream(), "REVAShell");

        web.loadUrl("file:///android_asset/index.html");
    }

    /** Interactive shell session wired to the on-page terminal. */
    private class ShellStream {
        private Process proc;
        private java.io.OutputStream stdin;

        private void emit(String chunk) {
            final String payload = chunk.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n").replace("\r", "");
            final String js = "window.__revaTermOut && window.__revaTermOut('" + payload + "')";
            web.post(new Runnable() {
                public void run() { web.evaluateJavascript(js, null); }
            });
        }

        private void pump(final java.io.InputStream is) {
            new Thread(new Runnable() {
                public void run() {
                    byte[] b = new byte[4096];
                    int n;
                    try {
                        while ((n = is.read(b)) > 0) emit(new String(b, 0, n));
                    } catch (Exception ignored) { }
                }
            }).start();
        }

        @JavascriptInterface
        public synchronized void start() {
            stop();
            try {
                proc = Runtime.getRuntime().exec(new String[]{"/system/bin/sh", "-i"});
                stdin = proc.getOutputStream();
                pump(proc.getInputStream());
                pump(proc.getErrorStream());
            } catch (Exception e) {
                emit("shell error: " + e.getMessage() + "\n");
            }
        }

        @JavascriptInterface
        public void write(final String line) {
            final java.io.OutputStream s = stdin;
            if (s == null) return;
            new Thread(new Runnable() {
                public void run() {
                    try {
                        s.write((line + "\n").getBytes());
                        s.flush();
                    } catch (Exception e) {
                        emit("\n[shell closed — tap a key to restart via Term.open]\n");
                    }
                }
            }).start();
        }

        /** Ctrl-C equivalent: kill the current process tree and start fresh. */
        @JavascriptInterface
        public synchronized void interrupt() {
            stop();
            emit("\n^C — shell restarted (cwd/env reset)\n");
            start();
        }

        private synchronized void stop() {
            if (proc != null) {
                try { proc.destroy(); } catch (Exception ignored) { }
                proc = null;
                stdin = null;
            }
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode != FILE_CHOOSER_REQUEST) return;
        if (filePathCallback == null) return;
        Uri[] results = null;
        if (resultCode == RESULT_OK && data != null) {
            ClipData clip = data.getClipData();
            if (clip != null) {
                results = new Uri[clip.getItemCount()];
                for (int i = 0; i < clip.getItemCount(); i++) results[i] = clip.getItemAt(i).getUri();
            } else if (data.getData() != null) {
                results = new Uri[]{ data.getData() };
            }
        }
        filePathCallback.onReceiveValue(results);
        filePathCallback = null;
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }
}
