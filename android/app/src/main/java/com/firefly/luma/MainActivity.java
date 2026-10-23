package com.firefly.luma;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.projection.MediaProjectionManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.speech.SpeechRecognizer;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

/**
 * Firefly as an Android app: the Firefly site in a WebView, plus the things a browser can't do,
 * offered to the page as window.AndroidLuma — Luma's bubble over other apps, watching the phone
 * screen, and the phone's own speech recognizer.
 */
public class MainActivity extends Activity {
    static final String SITE = "https://firefly-3t9.pages.dev/";
    static final int REQ_FILE = 1, REQ_CAPTURE = 2, REQ_MIC = 3;

    /** The open page, so the service and the recognizer can talk to it. */
    static MainActivity current;

    WebView web;
    Speech speech;
    private ValueCallback<Uri[]> fileCallback;
    private PermissionRequest pendingWebMic;
    private String pendingListenLang;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        current = this;
        speech = new Speech(this);

        web = new WebView(this);
        web.setBackgroundColor(0xFF0E0B26);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);   // the intro music starts on its own tap
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        CookieManager.getInstance().setAcceptCookie(true);   // the signed-in session

        web.addJavascriptInterface(new Bridge(), "AndroidLuma");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (Uri.parse(SITE).getHost().equals(u.getHost())) return false;
                // other links open in the phone's browser
                startActivity(new Intent(Intent.ACTION_VIEW, u));
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> {
                    for (String r : request.getResources()) {
                        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) {
                            if (hasMic()) request.grant(new String[]{r});
                            else { pendingWebMic = request; askMic(); }
                            return;
                        }
                    }
                    request.deny();
                });
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent pick = new Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).setType("image/*");
                startActivityForResult(Intent.createChooser(pick, "Picture"), REQ_FILE);
                return true;
            }
        });

        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 9);
        }
        web.loadUrl(SITE);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);   // tapping the bubble brings this screen back as it was
    }

    @Override
    protected void onResume() { super.onResume(); LumaService.appVisible(true); }

    @Override
    protected void onPause() { LumaService.appVisible(false); super.onPause(); }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else moveTaskToBack(true);   // keep Luma running instead of closing
    }

    @Override
    protected void onDestroy() {
        speech.destroy();
        if (current == this) current = null;
        web.destroy();
        super.onDestroy();
    }

    boolean hasMic() {
        return checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
    }

    void askMic() {
        requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_MIC);
    }

    /** Run a bit of JavaScript in the page (from any thread). */
    void js(String code) {
        web.post(() -> web.evaluateJavascript(code, null));
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        if (code != REQ_MIC) return;
        boolean ok = results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED;
        if (pendingWebMic != null) {
            if (ok) pendingWebMic.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
            else pendingWebMic.deny();
            pendingWebMic = null;
        }
        if (pendingListenLang != null) {
            String lang = pendingListenLang;
            pendingListenLang = null;
            if (ok) speech.start(lang);
            else speech.fail("not-allowed");
        }
    }

    @Override
    protected void onActivityResult(int code, int result, Intent data) {
        if (code == REQ_FILE) {
            if (fileCallback != null) fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
            fileCallback = null;
        } else if (code == REQ_CAPTURE) {
            if (result == RESULT_OK && data != null) {
                Intent go = new Intent(this, LumaService.class).setAction(LumaService.CAPTURE)
                        .putExtra("code", result).putExtra("data", data);
                startForegroundService(go);
            } else {
                js("window.__nativeCapture && __nativeCapture(false)");
            }
        }
    }

    /** What the page can call, as window.AndroidLuma. */
    class Bridge {
        @JavascriptInterface public boolean isApp() { return true; }

        // ----- Luma's bubble over other apps -----
        @JavascriptInterface public void bubbleShow() {
            runOnUiThread(() -> {
                if (!Settings.canDrawOverlays(MainActivity.this)) {
                    Toast.makeText(MainActivity.this, "Allow Firefly to appear on top, then tap 🫧 again", Toast.LENGTH_LONG).show();
                    startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getPackageName())));
                    return;
                }
                startForegroundService(new Intent(MainActivity.this, LumaService.class).setAction(LumaService.BUBBLE));
            });
        }
        @JavascriptInterface public void bubbleHide() {
            startService(new Intent(MainActivity.this, LumaService.class).setAction(LumaService.BUBBLE_OFF));
        }
        @JavascriptInterface public boolean bubbleOn() { return LumaService.bubbleOn(); }
        @JavascriptInterface public void bubbleSay(String text, String mood) { LumaService.say(text, mood); }

        // ----- watching the phone screen -----
        @JavascriptInterface public void startCapture() {
            runOnUiThread(() -> {
                MediaProjectionManager m = (MediaProjectionManager) getSystemService(MEDIA_PROJECTION_SERVICE);
                startActivityForResult(m.createScreenCaptureIntent(), REQ_CAPTURE);
            });
        }
        @JavascriptInterface public void stopCapture() {
            startService(new Intent(MainActivity.this, LumaService.class).setAction(LumaService.CAPTURE_OFF));
        }
        @JavascriptInterface public boolean capturing() { return LumaService.capturing(); }
        /** The screen right now, as a base64 JPEG (or "" when there is none). */
        @JavascriptInterface public String frame() { return LumaService.frame(); }
        @JavascriptInterface public String captureInfo() { return LumaService.captureInfo(); }

        // ----- the phone's speech recognizer -----
        @JavascriptInterface public boolean canListen() { return SpeechRecognizer.isRecognitionAvailable(MainActivity.this); }
        @JavascriptInterface public void listen(String lang) {
            runOnUiThread(() -> {
                if (hasMic()) { speech.start(lang); LumaService.micOn(MainActivity.this); }
                else { pendingListenLang = lang; askMic(); }
            });
        }
        @JavascriptInterface public void stopListen() { runOnUiThread(() -> speech.stop()); }
    }
}
