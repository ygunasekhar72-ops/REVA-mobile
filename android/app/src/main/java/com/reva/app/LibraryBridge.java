package com.reva.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.provider.DocumentsContract;
import android.webkit.JavascriptInterface;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;

/**
 * Project Library — native bridge (Phase 2 M1, Android side).
 *
 * importFolder() opens the system folder picker (SAF). The picked tree is
 * copied — as real files under filesDir/library/<folder>/ — on a background
 * thread, with progress pushed to window.__revaLibProgress(json). The JS side
 * then calls collect(name) to read the whole file map into the IndexedDB
 * Library, so the agent's tools work on it exactly like a browser import.
 * The on-disk copy additionally makes the project reachable from REVA Linux
 * at /host/library/<folder>/ (the proot /host bind is filesDir).
 *
 * All storage stays inside the app's private filesDir: no runtime permissions.
 */
public class LibraryBridge {

    public static final int TREE_REQUEST = 200;
    private static final String[] SKIP_NAMES = { ".git", "node_modules", ".gradle", "__pycache__", ".DS_Store" };

    private final Activity activity;
    private final Handler main = new Handler(Looper.getMainLooper());

    public LibraryBridge(Activity activity) { this.activity = activity; }

    /* ---- JS API (all calls arrive on a WebView background thread) ---- */

    /** Open the system folder picker; result lands in onActivityResult. */
    @JavascriptInterface
    public void importFolder() {
        main.post(new Runnable() {
            @Override public void run() {
                try {
                    Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
                    i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                            | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
                    activity.startActivityForResult(i, TREE_REQUEST);
                } catch (Exception ignored) { }
            }
        });
    }

    /** Every imported project: [{name, fileCount}] as JSON. */
    @JavascriptInterface
    public String listNative() {
        File root = libraryDir();
        StringBuilder sb = new StringBuilder("[");
        File[] dirs = root.listFiles();
        if (dirs != null) {
            boolean first = true;
            for (File d : dirs) {
                if (!d.isDirectory()) continue;
                if (!first) sb.append(',');
                first = false;
                sb.append("{\"name\":").append(json(d.getName()))
                  .append(",\"fileCount\":").append(countFiles(d)).append('}');
            }
        }
        return sb.append(']').toString();
    }

    /**
     * The full file map of one project as JSON {relativePath: content}.
     * Text files decode as UTF-8; binaries become data: URLs so <img>/CSS
     * references keep working in previews.
     */
    @JavascriptInterface
    public String collect(String name) {
        if (name == null || name.isEmpty()) return "{}";
        File dir = new File(libraryDir(), name);
        if (!dir.isDirectory()) return "{}";
        StringBuilder sb = new StringBuilder("{");
        List<String> rels = new ArrayList<String>();
        collectRel(dir, "", rels);
        boolean first = true;
        for (String rel : rels) {
            File f = new File(dir, rel);
            if (!first) sb.append(',');
            first = false;
            sb.append(json(rel)).append(':').append(json(contentOf(f)));
        }
        return sb.append('}').toString();
    }

    /** Read one file (UTF-8 text). */
    @JavascriptInterface
    public String readFileText(String name, String rel) {
        if (name == null || name.isEmpty() || rel == null) return "";
        File f = new File(new File(libraryDir(), name), rel);
        if (!f.isFile()) return "";
        return contentOf(f);
    }

    /** Absolute path of the library root (== /host/library inside REVA Linux). */
    @JavascriptInterface
    public String libDir() { return libraryDir().getAbsolutePath(); }

    /** Delete one imported project (recursive). */
    @JavascriptInterface
    public boolean deleteNative(String name) {
        if (name == null || name.isEmpty()) return false;
        return deleteRec(new File(libraryDir(), name));
    }

    /* ---- SAF tree copy (background) ---- */

    void handleTreeResult(Uri treeUri) {
        if (treeUri == null) return;
        try {
            activity.getContentResolver().takePersistableUriPermission(treeUri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (Exception ignored) { }
        final Uri uri = treeUri;
        new Thread(new Runnable() {
            @Override public void run() {
                try {
                    String folder = queryName(uri);
                    if (folder == null || folder.trim().isEmpty()) folder = "Imported";
                    folder = folder.trim().replaceAll("[\\\\/:*?\"<>|]", "-");
                    File dest = new File(libraryDir(), folder);
                    dest.mkdirs();
                    List<String[]> done = new ArrayList<String[]>();
                    copyTree(uri, dest, folder, "", done);
                    emit("window.__revaLibImported && window.__revaLibImported(" + json(folder) + ")");
                } catch (final Exception e) {
                    emit("window.__revaLibError && window.__revaLibError(" + json(String.valueOf(e.getMessage())) + ")");
                }
            }
        }).start();
    }

    private void copyTree(Uri treeUri, File dest, String folder, String rel, List<String[]> done) {
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri,
                DocumentsContract.getDocumentId(treeUri));
        android.database.Cursor c = activity.getContentResolver().query(children,
                null, null, null, null);
        if (c == null) return;
        while (c.moveToNext()) {
            String docId = c.getString(0);
            String name = c.getString(1);
            String mime = c.getString(3);
            boolean isDir = DocumentsContract.Document.MIME_TYPE_DIR.equals(mime);
            if (isSkip(name)) continue;
            Uri child = DocumentsContract.buildDocumentUriUsingTree(treeUri, docId);
            String childRel = rel.isEmpty() ? name : rel + "/" + name;
            if (isDir) {
                new File(dest, childRel).mkdirs();
                copyTree(child, dest, folder, childRel, done);
            } else {
                File out = new File(dest, childRel);
                out.getParentFile().mkdirs();
                copyFile(child, out);
                done.add(new String[]{ childRel });
                progress(done.size(), childRel);
            }
        }
        c.close();
    }

    private void copyFile(Uri src, File out) {
        InputStream in = null;
        OutputStream os = null;
        try {
            in = activity.getContentResolver().openInputStream(src);
            os = new FileOutputStream(out);
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
        } catch (Exception ignored) {
        } finally {
            try { if (in != null) in.close(); } catch (Exception ignored) { }
            try { if (os != null) os.close(); } catch (Exception ignored) { }
        }
    }

    /* ---- helpers ---- */

    private File libraryDir() {
        File d = new File(activity.getFilesDir(), "library");
        if (!d.exists()) d.mkdirs();
        return d;
    }

    private String queryName(Uri uri) {
        android.database.Cursor c = activity.getContentResolver().query(uri, null, null, null, null);
        if (c == null) return null;
        try {
            if (c.moveToFirst() && c.getString(1) != null) return c.getString(1);
        } finally { c.close(); }
        return null;
    }

    private void collectRel(File dir, String rel, List<String> acc) {
        File[] kids = dir.listFiles();
        if (kids == null) return;
        for (File f : kids) {
            if (f.isDirectory()) collectRel(f, rel.isEmpty() ? f.getName() : rel + "/" + f.getName(), acc);
            else if (f.isFile()) acc.add(rel.isEmpty() ? f.getName() : rel + "/" + f.getName());
        }
    }

    private String contentOf(File f) {
        try {
            byte[] all = readAll(f);
            String n = f.getName().toLowerCase();
            boolean binary = n.endsWith(".png") || n.endsWith(".jpg") || n.endsWith(".jpeg")
                    || n.endsWith(".gif") || n.endsWith(".webp") || n.endsWith(".ico")
                    || n.endsWith(".woff") || n.endsWith(".woff2") || n.endsWith(".ttf")
                    || n.endsWith(".mp3") || n.endsWith(".mp4") || n.endsWith(".zip")
                    || n.endsWith(".pdf") || n.endsWith(".wasm");
            if (binary) return "data:application/octet-stream;base64," + Base64.getEncoder().encodeToString(all);
            return new String(all, StandardCharsets.UTF_8);
        } catch (Exception e) {
            return "";
        }
    }

    private static byte[] readAll(File f) throws Exception {
        InputStream in = new java.io.FileInputStream(f);
        try {
            java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
            return bos.toByteArray();
        } finally { in.close(); }
    }

    private int countFiles(File dir) {
        int n = 0;
        File[] kids = dir.listFiles();
        if (kids != null) for (File f : kids) n += f.isDirectory() ? countFiles(f) : 1;
        return n;
    }

    private boolean deleteRec(File f) {
        if (f == null || !f.exists()) return false;
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteRec(k);
        return f.delete();
    }

    private boolean isSkip(String name) {
        for (String s : SKIP_NAMES) if (s.equals(name)) return true;
        return name.startsWith(".");
    }

    private void progress(final int done, final String current) {
        emit("window.__revaLibProgress && window.__revaLibProgress(" + done + ","
                + json(current) + ")");
    }

    private void emit(final String js) {
        main.post(new Runnable() {
            @Override public void run() {
                if (activity instanceof MainActivity) ((MainActivity) activity).evaluate(js);
            }
        });
    }

    private static String json(String s) {
        if (s == null) return "null";
        StringBuilder sb = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '"') sb.append("\\\"");
            else if (c == '\\') sb.append("\\\\");
            else if (c == '\n') sb.append("\\n");
            else if (c == '\r') sb.append("\\r");
            else if (c == '\t') sb.append("\\t");
            else if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
            else sb.append(c);
        }
        return sb.append('"').toString();
    }
}
