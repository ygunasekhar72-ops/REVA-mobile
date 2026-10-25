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

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.util.ArrayList;
import java.util.List;

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

        // Real shell bridge for the terminal: commands run in the app's own
        // sandbox. The page sends a pre-tokenized argv array (JSON); commands
        // are exec'd directly — there is no shell string anywhere to inject.
        web.addJavascriptInterface(new Shell(), "REVAShell");

        web.loadUrl("file:///android_asset/index.html");
    }

    /** Runs one command given as a JSON argv array (never a shell string) and
     *  calls back with its output. Tokenization happens in the page; the
     *  command is exec'd directly, so there is no shell to inject into. */
    private class Shell {
        @JavascriptInterface
        public void execArgv(final String argvJson, final String callback) {
            new Thread(new Runnable() {
                public void run() {
                    String out;
                    try {
                        org.json.JSONArray arr = new org.json.JSONArray(argvJson);
                        List<String> argvList = new ArrayList<>();
                        for (int i = 0; i < arr.length(); i++) argvList.add(arr.getString(i));
                        if (argvList.isEmpty()) argvList.add("true");
                        StringBuilder sb = new StringBuilder();
                        Process p = Runtime.getRuntime().exec(argvList.toArray(new String[0]));
                        BufferedReader r = new BufferedReader(new InputStreamReader(p.getInputStream()));
                        String l;
                        while ((l = r.readLine()) != null) sb.append(l).append('\n');
                        BufferedReader e = new BufferedReader(new InputStreamReader(p.getErrorStream()));
                        while ((l = e.readLine()) != null) sb.append(l).append('\n');
                        p.waitFor();
                        out = sb.toString();
                    } catch (Exception ex) {
                        out = "error: " + ex.getMessage() + "\n";
                    }
                    if (out.length() > 200000) out = out.substring(0, 200000);
                    final String payload = out.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n").replace("\r", "");
                    final String js = callback + "('" + payload + "')";
                    web.post(new Runnable() {
                        public void run() { web.evaluateJavascript(js, null); }
                    });
                }
            }).start();
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
