package com.reva.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.JsResult;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;

import java.io.File;

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

        // Real terminal bridge. Two independently-owned sessions:
        //   REVAShell — the user's interactive PTY terminal (busybox script + sh -i)
        //   REVAAgent — the AI agent's private non-pty shell for shell_exec
        // They never share state. All exec argv are constants; user/agent input
        // only ever travels as bytes through the streams.
        web.addJavascriptInterface(new ShellStream("window.__revaTermOut", true), "REVAShell");
        web.addJavascriptInterface(new ShellStream("window.__revaAgentOut", false), "REVAAgent");

        // Prepare the shell environment at launch: busybox copy + ~/.mkshrc +
        // REVA Linux rootfs. Background thread — first-run extraction of the
        // rootfs is far too heavy for the UI thread.
        new Thread(new Runnable() {
            public void run() {
                try { new ShellStream("none", true).setupEnv(); } catch (Exception ignored) { }
            }
        }).start();

        web.loadUrl("file:///android_asset/index.html");

        // Start the background engine: the process stays alive (agent loops,
        // shells, downloads) even after the task is swiped from recents.
        try { startForegroundService(new Intent(this, EngineService.class)); } catch (Exception ignored) { }

        // Debug-only test hook: if /data/local/tmp/reva-seed.txt exists (pushed
        // via adb), evaluate it once after the page loads. Lets device E2E
        // configure the provider and drive a chat without blind UI taps. The
        // seed should self-disable via a localStorage flag; remove the file
        // with adb when done (the app cannot delete shell-owned files there).
        if ((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            final File seed = new File("/data/local/tmp/reva-seed.txt");
            if (seed.exists()) {
                web.setWebViewClient(new android.webkit.WebViewClient() {
                    @Override
                    public void onPageFinished(WebView v, String url) {
                        if (!seed.exists()) return;
                        try {
                            byte[] b = new byte[(int) seed.length()];
                            java.io.FileInputStream in = new java.io.FileInputStream(seed);
                            int n = 0;
                            while (n < b.length) { int r = in.read(b, n, b.length - n); if (r < 0) break; n += r; }
                            in.close();
                            v.evaluateJavascript(new String(b, java.nio.charset.StandardCharsets.UTF_8), null);
                        } catch (Exception ignored) { }
                    }
                });
            }
        }
    }

    /** One persistent shell session emitting output to a JS collector.
     *  pty=true (user terminal) wraps sh in busybox `script` for a real pty;
     *  pty=false (agent channel) runs a plain hidden sh for marker-protocol exec. */
    private class ShellStream {
        private final String emitTarget;
        private final boolean pty;
        private Process proc;
        private java.io.OutputStream stdin;
        private String busybox;

        ShellStream(String emitTarget, boolean pty) { this.emitTarget = emitTarget; this.pty = pty; }

        private String busyboxPath() {
            if (busybox != null) return busybox;
            try {
                File src = new File(getApplicationInfo().nativeLibraryDir, "libbusybox.so");
                if (!src.exists()) { busybox = ""; return busybox; }
                // busybox is a multicall binary: it must be NAMED "busybox" to
                // dispatch applets — exec'ing it as libbusybox.so yields
                // "applet not found". Copy once into the app's bin dir.
                File bin = new File(getFilesDir(), "bin");
                if (!bin.exists()) bin.mkdirs();
                File dst = new File(bin, "busybox");
                if (!dst.exists() || dst.length() != src.length()) {
                    java.io.FileInputStream in = new java.io.FileInputStream(src);
                    java.io.FileOutputStream outS = new java.io.FileOutputStream(dst);
                    byte[] b = new byte[65536]; int n;
                    while ((n = in.read(b)) > 0) outS.write(b, 0, n);
                    in.close(); outS.close();
                }
                dst.setExecutable(true, false);
                busybox = dst.canExecute() ? dst.getAbsolutePath() : "";
            } catch (Exception e) { busybox = ""; }
            return busybox;
        }

        private void emit(String chunk) {
            final String payload = chunk.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n").replace("\r", "");
            final String js = emitTarget + " && " + emitTarget + "('" + payload + "')";
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
        /** busybox copy + shell profile + REVA Linux rootfs — idempotent */
        void setupEnv() {
            busyboxPath();
            writeProfile();
            ensureLinux();
        }

        /** REVA Linux: extract the bundled Alpine rootfs once (pure Java, no
         *  subprocess). Terminal + agent sessions prefer it. State is shared
         *  across session instances + the launch-time setup thread: extraction
         *  runs exactly once and a session opened mid-extract waits for it. */
        private static final Object LINUX_LOCK = new Object();
        private static volatile Boolean linuxReady = null;
        /** rootfs generation: bump when shipping a new Alpine build so the
         *  marker no longer matches and extraction re-runs */
        private static final String ROOTFS_VER = "alpine-3.20.3.2";

        private String prootBin() {
            File p = new File(getApplicationInfo().nativeLibraryDir, "libproot.so");
            return p.exists() ? p.getAbsolutePath() : "";
        }

        /** bundled-rootfs dir name for this device (64-bit ABIs only) */
        private String assetAbi() {
            String a = Build.SUPPORTED_ABIS[0];
            if ("arm64-v8a".equals(a)) return "aarch64";
            if ("x86_64".equals(a)) return "x86_64";
            return null;
        }

        /** Termux's proot links "libtalloc.so.2"; AGP only packages "lib*.so",
         *  so the lib ships as libtalloc.so and is copied under the .2 name
         *  into the app bin dir, which joins LD_LIBRARY_PATH. */
        private String tallocPath() {
            try {
                File src = new File(getApplicationInfo().nativeLibraryDir, "libtalloc.so");
                if (!src.exists()) return "";
                File dst = new File(getFilesDir(), "bin/libtalloc.so.2");
                if (!dst.exists() || dst.length() != src.length()) {
                    java.io.FileInputStream in = new java.io.FileInputStream(src);
                    java.io.FileOutputStream outS = new java.io.FileOutputStream(dst);
                    byte[] b = new byte[65536]; int n;
                    while ((n = in.read(b)) > 0) outS.write(b, 0, n);
                    in.close(); outS.close();
                }
                return dst.getAbsolutePath();
            } catch (Exception e) { return ""; }
        }

        private void ensureLinux() {
            synchronized (LINUX_LOCK) {
                if (linuxReady != null) return;
                try {
                    String aabi = assetAbi();
                    File nd = new File(prootBin()).getParentFile();
                    if (aabi == null || nd == null
                            || !new File(nd, "libproot-loader.so").exists()) {
                        linuxReady = false;
                        return;
                    }
                    File root = new File(getFilesDir(), "linux");
                    File marker = new File(root, ".reva-ok-" + ROOTFS_VER);
                    if (!marker.exists()) {
                        root.mkdirs();
                        // The asset is a tar.gz stored as rootfs.bin: aapt2
                        // decompresses *.gz assets (renaming them), which would
                        // break the .tar.gz path — a non-gz name is left alone,
                        // and AssetManager.open inflates it back transparently.
                        try (java.util.zip.GZIPInputStream gz = new java.util.zip.GZIPInputStream(
                                getAssets().open("linux/" + aabi + "/rootfs.bin"))) {
                            untar(gz, root);
                        }
                        // DNS + a friendly guest profile (pkg → apk)
                        writeSmall(new File(root, "etc/resolv.conf"),
                                "nameserver 1.1.1.1\nnameserver 8.8.8.8\n");
                        File profDir = new File(root, "etc/profile.d");
                        profDir.mkdirs();
                        writeSmall(new File(profDir, "reva.sh"),
                                "export PS1='reva $ '\n" +
                                "pkg() { case \"$1\" in i|install) shift; apk add \"$@\";; u|update) apk update;; upgrade) apk upgrade;; s|search) shift; apk search \"$@\";; *) echo 'pkg install|update|upgrade|search (apk)';; esac; }\n");
                        marker.createNewFile();
                    }
                    writeShellWrapper();
                    linuxReady = true;
                } catch (Exception e) { linuxReady = false; }
            }
        }

        /** executable launcher the pty runs via SHELL= — paths baked at write time */
        private void writeShellWrapper() throws Exception {
            String nd = new File(prootBin()).getParent();
            tallocPath();
            new File(getFilesDir(), ".proot").mkdirs(); // proot's PROOT_TMP_DIR must exist before first exec
            StringBuilder sb = new StringBuilder();
            sb.append("#!/system/bin/sh\n");
            sb.append("PROOT_LOADER='").append(new File(nd, "libproot-loader.so").getAbsolutePath()).append("'\n");
            sb.append("LD_LIBRARY_PATH='").append(nd)
              .append(':').append(getFilesDir().getAbsolutePath())
              .append("/bin'\n");
            sb.append("PROOT_TMP_DIR='").append(new File(getFilesDir(), ".proot").getAbsolutePath()).append("'\n");
            sb.append("PROOT_F2FS_WORKAROUND=0\n");
            // NB: proot's OWN seccomp filter must stay ENABLED: the app's
            // zygote seccomp policy is inherited by every child and returns
            // ENOSYS to fork() before pure-ptrace translation can intercept —
            // proot's own (newer) filter runs first and wins.
            sb.append("export PROOT_LOADER LD_LIBRARY_PATH PROOT_TMP_DIR PROOT_F2FS_WORKAROUND\n");
            // NB: `apk add` installs and runs packages fine but reports a
            // cosmetic "1 error" at commit under proot (known apk/proot
            // accounting quirk); exit code 1 does not mean failure.
            sb.append("exec '").append(prootBin()).append("' -0 -r '").append(new File(getFilesDir(), "linux").getAbsolutePath())
              .append("' -b /dev -b /proc -b /sys -b '").append(getFilesDir().getAbsolutePath())
              // guest shells must NOT inherit LD_LIBRARY_PATH: Android's libz
              // shadows musl's and breaks apk (relocation errors). The inner
              // busybox sh survives it, clears it, then execs the real shell.
              .append("':/host -w /root /bin/sh -c 'unset LD_LIBRARY_PATH; exec /bin/sh -l'\n");
            File w = new File(getFilesDir(), "bin/revash");
            writeSmall(w, sb.toString());
            w.setExecutable(true, false);
        }

        private static void writeSmall(File f, String s) throws Exception {
            f.getParentFile().mkdirs();
            java.io.FileOutputStream fo = new java.io.FileOutputStream(f);
            fo.write(s.getBytes()); fo.close();
        }

        /** minimal tar reader: dirs, files, symlinks, hardlinks (as symlinks) */
        private static void untar(java.io.InputStream in, File root) throws Exception {
            byte[] hdr = new byte[512];
            java.nio.file.Path rootP = root.toPath();
            while (true) {
                int off = 0;
                while (off < 512) { int n = in.read(hdr, off, 512 - off); if (n < 0) return; off += n; }
                String name = new String(hdr, 0, 100, "UTF-8").trim();
                if (name.isEmpty()) continue;
                String prefix = new String(hdr, 345, 155, "UTF-8").trim();
                if (!prefix.isEmpty()) name = prefix + "/" + name;
                long sz = size(hdr);
                char type = (char) hdr[156];
                String link = new String(hdr, 157, 100, "UTF-8").trim();
                java.nio.file.Path p = rootP.resolve(name).normalize();
                if (!p.startsWith(rootP)) { skip(in, sz); continue; }
                if (type == '5') {
                    java.nio.file.Files.createDirectories(p);
                } else if (type == '2' || type == '1') {
                    java.nio.file.Files.createDirectories(p.getParent());
                    try { java.nio.file.Files.deleteIfExists(p); } catch (Exception ignored) { }
                    try {
                        if (type == '2') {
                            // store the link target VERBATIM: POSIX resolves
                            // relative targets against the link's own dir;
                            // resolving from the root broke e.g. lib/libz.so.1
                            java.nio.file.Files.createSymbolicLink(p, java.nio.file.Paths.get(link));
                        } else {
                            // hardlink targets are archive-root-relative
                            String hl = link.startsWith("/") ? link.substring(1) : link;
                            java.nio.file.Files.createSymbolicLink(p, rootP.resolve(hl).normalize());
                        }
                    } catch (Exception ignored) { }
                } else if (type == '0' || type == 0 || type == '7') {
                    java.nio.file.Files.createDirectories(p.getParent());
                    java.io.FileOutputStream fo = new java.io.FileOutputStream(p.toFile());
                    byte[] b = new byte[65536]; long left = sz;
                    while (left > 0) {
                        int n = in.read(b, 0, (int) Math.min(b.length, left));
                        if (n < 0) break;
                        fo.write(b, 0, n); left -= n;
                    }
                    fo.close();
                    // app-created files default to non-exec; restore the exec
                    // bit from the tar mode or proot refuses to run /bin/sh
                    if ((mode(hdr) & 0100) != 0) p.toFile().setExecutable(true, false);
                }
                if (sz > 0) skip(in, (512 - (sz % 512)) % 512);
            }
        }
        private static long size(byte[] h) {
            String s = new String(h, 124, 12, java.nio.charset.StandardCharsets.UTF_8).trim().replaceAll("[^0-7]", "");
            try { return Long.parseLong(s, 8); } catch (Exception e) { return 0; }
        }
        private static int mode(byte[] h) {
            String s = new String(h, 100, 8, java.nio.charset.StandardCharsets.UTF_8).trim().replaceAll("[^0-7]", "");
            try { return (int) Long.parseLong(s, 8); } catch (Exception e) { return 0; }
        }
        private static void skip(java.io.InputStream in, long n) throws Exception {
            long left = n; byte[] b = new byte[65536];
            while (left > 0) {
                int r = in.read(b, 0, (int) Math.min(b.length, left));
                if (r < 0) return;
                left -= r;
            }
        }

        /** argv-free entry into REVA Linux: the wrapper written by
         *  writeShellWrapper(). Sessions exec this file directly — no command
         *  strings are ever assembled. Empty when Linux isn't ready. */
        private String revashPath() {
            if (linuxReady == null || !linuxReady) return "";
            File w = new File(getFilesDir(), "bin/revash");
            return w.canExecute() ? w.getAbsolutePath() : "";
        }

        private void writeProfile() {
            try {
                File home = getFilesDir();
                File bin = new File(home, "bin");
                if (!bin.exists()) bin.mkdirs();
                File rc = new File(home, ".mkshrc");
                { // regenerate every start: cheap, idempotent, picks up fixes
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
                    // REVA Linux launcher (bundled Alpine rootfs + revash wrapper)
                    sb.append("RS=\"").append(new File(getFilesDir(), "bin/revash").getAbsolutePath()).append("\"").append('\n');
                    sb.append("lx() {").append('\n');
                    sb.append("  if [ -x \"$RS\" ]; then exec \"$RS\"; else echo 'REVA Linux not ready yet — reopen in a moment'; return 1; fi").append('\n');
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
            setupEnv();
            // Preferred: REVA Linux (proot Alpine) — real /bin/sh, apk, packages.
            // Both sessions exec the revash wrapper file directly (fixed argv,
            // direct variable arguments); the pty session wraps it in busybox
            // script for a real pseudo-terminal.
            try {
                String rs = revashPath();
                if (!rs.isEmpty() && (!pty || !busyboxPath().isEmpty())) {
                    if (pty) {
                        proc = launchLinux(new String[]{ busyboxPath(), "script", "-qfc", rs, "/dev/null" });
                    } else {
                        proc = launchLinux(new String[]{ rs });
                    }
                    stdin = proc.getOutputStream();
                    startWriter();
                    pump(proc.getInputStream());
                    pump(proc.getErrorStream());
                    if (pty) emit("\r\n\u001b[2mREVA Linux (Alpine, proot) \u2014 pkg install adds packages\u001b[0m\r\n");
                    return;
                }
            } catch (Exception e) {
                emit("(linux unavailable: " + e.getMessage() + " — host shell instead)\n");
                proc = null;
            }
            String bb = busyboxPath();
            try {
                if (pty && !bb.isEmpty()) {
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
            startWriter();
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

        /** REVA Linux launch: same env revash bakes in, set on the process so
         *  it reaches proot under busybox script too. HOME/PATH are guest
         *  paths — the rootfs is the world this process sees. */
        private Process launchLinux(String[] argv) throws Exception {
            File nd = new File(prootBin()).getParentFile();
            File tmp = new File(getFilesDir(), ".proot");
            tmp.mkdirs();
            ProcessBuilder pb = new ProcessBuilder(argv);
            pb.directory(getFilesDir());
            pb.environment().put("HOME", "/root");
            pb.environment().put("TERM", "xterm-256color");
            pb.environment().put("PATH",
                    "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin");
            pb.environment().put("PROOT_LOADER", new File(nd, "libproot-loader.so").getAbsolutePath());
            pb.environment().put("LD_LIBRARY_PATH", nd.getAbsolutePath());
            pb.environment().put("PROOT_TMP_DIR", tmp.getAbsolutePath());
            pb.environment().put("PROOT_F2FS_WORKAROUND", "0");
            return pb.start();
        }

        /** Raw byte passthrough (pty mode: keystrokes go through untouched).
         *  Writes are FUNNELED through one FIFO writer thread: the JS bridge
         *  calls writeRaw several times per exec (task, newline, marker, id,
         *  newline) and per-call threads could interleave, splitting the
         *  marker line. The bridge thread only enqueues, so a slow reader
         *  never blocks interrupt() or other bridge calls. */
        private final java.util.ArrayDeque<byte[]> writeQueue = new java.util.ArrayDeque<>();

        private void startWriter() {
            final java.util.ArrayDeque<byte[]> q = writeQueue;
            new Thread(new Runnable() {
                public void run() {
                    while (true) {
                        byte[] chunk;
                        synchronized (q) {
                            while (q.isEmpty()) {
                                try { q.wait(); } catch (Exception e) { return; }
                            }
                            chunk = q.poll();
                        }
                        if (chunk == null || chunk.length == 0) return; // poisoned by stop()
                        try { stdin.write(chunk); stdin.flush(); }
                        catch (Exception e) { emit("\n[shell closed — reopen the terminal]\n"); return; }
                    }
                }
            }).start();
        }

        @JavascriptInterface
        public void writeRaw(final String data) {
            if (data == null || stdin == null) return;
            synchronized (writeQueue) { writeQueue.add(data.getBytes()); writeQueue.notifyAll(); }
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
            synchronized (writeQueue) { writeQueue.add(new byte[0]); writeQueue.notifyAll(); } // poison pill: wake + stop the writer
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
