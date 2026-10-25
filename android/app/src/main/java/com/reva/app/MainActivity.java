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

    /** Interactive shell session wired to the on-page terminal.
     *  Preferred path: busybox `script` gives the shell a REAL pty (proper
     *  Ctrl+C, colors, vim, job control) while our pipes feed it. Falls back
     *  to plain `sh -i` when busybox is absent. All exec argv are constants —
     *  user input only ever travels as bytes through the stream. */
    private class ShellStream {
        private Process proc;
        private java.io.OutputStream stdin;
        private String busybox;

        private String busyboxPath() {
            if (busybox != null) return busybox;
            try {
                File f = new File(getApplicationInfo().nativeLibraryDir, "libbusybox.so");
                busybox = (f.exists() && f.canExecute()) ? f.getAbsolutePath() : "";
            } catch (Exception e) { busybox = ""; }
            return busybox;
        }

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

        /** mksh profile: pkg installer + busybox helper on PATH */
        private void writeProfile() {
            try {
                File home = getFilesDir();
                File bin = new File(home, "bin");
                if (!bin.exists()) bin.mkdirs();
                File rc = new File(home, ".mkshrc");
                if (!rc.exists()) {
                    String nl = System.getProperty("line.separator") != null ? "" : "";
                    String bb = busyboxPath();
                    StringBuilder sb = new StringBuilder();
                    sb.append("export PATH=$HOME/bin:").append(bb.isEmpty() ? "" : new File(bb).getParent() + ":").append("/system/bin:/system/xbin:$PATH").append('\n');
                    sb.append("export TERM=xterm-256color").append('\n');
                    sb.append("export PS1='$ '").append('\n');
                    if (!bb.isEmpty()) {
                        sb.append("bb() { \"").append(bb).append("\" \"$@\"; }").append('\n');
                    }
                    sb.append("pkg() {").append('\n');
                    sb.append("  case \"$1\" in").append('\n');
                    sb.append("    i|install)").append('\n');
                    sb.append("      shift; mkdir -p $HOME/bin").append('\n');
                    sb.append("      for u in \"$@\"; do").append('\n');
                    sb.append("        n=${u##*/}").append('\n');
                    sb.append("        if bb wget -q -O $HOME/bin/$n \"$u\"; then chmod +x $HOME/bin/$n && echo \"installed: $n (run: $n)\"; else echo \"download failed: $u\"; fi").append('\n');
                    sb.append("      done;;").append('\n');
                    sb.append("    l|list) bb --list;;").append('\n');
                    sb.append("    *) echo \"pkg install <url-of-static-binary>... | pkg list\";;").append('\n');
                    sb.append("  esac").append('\n');
                    sb.append("}").append('\n');
                    java.io.FileOutputStream fos = new java.io.FileOutputStream(rc);
                    fos.write(sb.toString().getBytes());
                    fos.close();
                }
            } catch (Exception ignored) { }
        }

        @JavascriptInterface
        public synchronized void start() {
            stop();
            writeProfile();
            String bb = busyboxPath();
            try {
                if (!bb.isEmpty()) {
                    // real pty: busybox script runs `sh -i` on a pseudo-terminal
                    proc = launch(new String[]{bb, "script", "-qfc", "/system/bin/sh -i", "/dev/null"});
                }
            } catch (Exception e) {
                emit("(pty unavailable: " + e.getMessage() + " — falling back to plain sh)\n");
                proc = null;
            }
            if (proc == null) {
                try { proc = launch(new String[]{"/system/bin/sh", "-i"}); }
                catch (Exception e) { emit("shell error: " + e.getMessage() + "\n"); return; }
            }
            stdin = proc.getOutputStream();
            pump(proc.getInputStream());
            pump(proc.getErrorStream());
        }

        private Process launch(String[] argv) throws Exception {
            ProcessBuilder pb = new ProcessBuilder(argv);
            pb.directory(getFilesDir());
            pb.environment().put("HOME", getFilesDir().getAbsolutePath());
            pb.environment().put("TERM", "xterm-256color");
            pb.environment().put("ENV", new File(getFilesDir(), ".mkshrc").getAbsolutePath());
            String path = pb.environment().get("PATH");
            String bb = busyboxPath();
            pb.environment().put("PATH", new File(getFilesDir(), "bin").getAbsolutePath()
                    + (bb.isEmpty() ? "" : ":" + new File(bb).getParent())
                    + ":" + (path == null ? "/system/bin" : path));
            return pb.start();
        }

        /** Raw byte passthrough (pty mode: keystrokes go through untouched). */
        @JavascriptInterface
        public void writeRaw(final String data) {
            final java.io.OutputStream s = stdin;
            if (s == null || data == null) return;
            new Thread(new Runnable() {
                public void run() {
                    try { s.write(data.getBytes()); s.flush(); }
                    catch (Exception e) { emit("\n[shell closed — reopen the terminal]\n"); }
                }
            }).start();
        }

        /** Line helper (compat; appends newline). */
        @JavascriptInterface
        public void write(final String line) { writeRaw(line + "\n"); }

        /** Hard interrupt: kill the session and start a fresh one. */
        @JavascriptInterface
        public synchronized void interrupt() {
            stop();
            emit("\n[interrupt — shell restarted]\n");
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
