package com.firefly.luma;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Outline;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.Looper;
import android.util.Base64;
import android.util.DisplayMetrics;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewOutlineProvider;
import android.view.WindowManager;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.ByteBuffer;

/**
 * Keeps Luma with the person while other apps are open: her round bubble on top of everything
 * (her face follows her mood, her words pop out under it), the phone screen she watches (frames
 * on request, nothing stored), and the microphone for listening. A notification is always shown
 * while any of it runs, with a Stop button.
 */
public class LumaService extends Service {
    static final String BUBBLE = "bubble", BUBBLE_OFF = "bubble_off", CAPTURE = "capture", CAPTURE_OFF = "capture_off", STOP = "stop";
    private static LumaService me;
    private static final Handler main = new Handler(Looper.getMainLooper());

    private WindowManager wm;
    private LinearLayout bubble;
    private ImageView face;
    private TextView words;
    private WindowManager.LayoutParams lp;
    private final Runnable hideWords = () -> { if (words != null) words.setVisibility(View.GONE); };

    private MediaProjection projection;
    private VirtualDisplay display;
    private ImageReader reader;
    private HandlerThread captureThread;
    private String lastFrame = "", lastError = "";
    private boolean appOpen;
    private boolean mic;

    // ----- what the page calls (through MainActivity.Bridge) -----
    static boolean bubbleOn() { return me != null && me.bubble != null; }
    static boolean capturing() { return me != null && me.projection != null; }
    static String frame() { return me == null ? "" : me.grab(); }
    /** For troubleshooting from the page: what the screen capture is doing. */
    static String captureInfo() { return me == null ? "no service" : (me.reader == null ? "not capturing" : "capturing") + (me.lastError.isEmpty() ? "" : " | " + me.lastError); }
    /** Firefly itself is on screen: the bubble steps aside (it would sit on top of the chat). */
    static void appVisible(boolean open) { main.post(() -> { if (me != null) { me.appOpen = open; if (me.bubble != null) me.bubble.setVisibility(open ? View.GONE : View.VISIBLE); } }); }
    static void say(String text, String mood) { main.post(() -> { if (me != null) me.show(text, mood); }); }
    /** Listening started while the app is open: let the service keep the microphone if it runs. */
    static void micOn(MainActivity a) { if (me != null && !me.mic) { me.mic = true; me.foreground(); } }

    @Override public IBinder onBind(Intent i) { return null; }

    @Override
    public void onCreate() {
        super.onCreate();
        me = this;
        wm = (WindowManager) getSystemService(WINDOW_SERVICE);
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel("luma", "Luma", NotificationManager.IMPORTANCE_LOW));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String a = intent == null ? null : intent.getAction();
        if (CAPTURE.equals(a)) {
            foreground(true);   // must come before the screen capture starts
            startCapture(intent.getIntExtra("code", 0), intent.getParcelableExtra("data"));
        } else {
            foreground();
            if (BUBBLE.equals(a)) addBubble();
            else if (BUBBLE_OFF.equals(a)) removeBubble();
            else if (CAPTURE_OFF.equals(a)) stopCapture(false);
            else if (STOP.equals(a)) { stopCapture(true); removeBubble(); }
        }
        stopIfIdle();
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        stopCapture(false);
        removeBubble();
        if (me == this) me = null;
        super.onDestroy();
    }

    // ----- the notification that keeps it all running -----
    private void foreground() { foreground(projection != null); }

    private void foreground(boolean withCapture) {
        int types = Build.VERSION.SDK_INT >= 34 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE : 0;
        if (withCapture) types |= ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION;
        if (mic && checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED)
            types |= ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE;
        String text = withCapture ? "Luma is watching your screen 👀" : "Luma is here 🌙";
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_IMMUTABLE);
        PendingIntent stop = PendingIntent.getService(this, 1, new Intent(this, LumaService.class).setAction(STOP), PendingIntent.FLAG_IMMUTABLE);
        Notification n = new Notification.Builder(this, "luma")
                .setSmallIcon(android.R.drawable.star_on)
                .setContentTitle("Firefly")
                .setContentText(text)
                .setContentIntent(open)
                .addAction(new Notification.Action.Builder(null, "Stop", stop).build())
                .setOngoing(true)
                .build();
        if (Build.VERSION.SDK_INT < 29) { startForeground(1, n); return; }   // no service types before Android 10
        try {
            startForeground(1, n, types);
        } catch (Exception e) {
            // a type the system won't allow right now (e.g. mic from the background): run without it
            int fallback = withCapture ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION : (Build.VERSION.SDK_INT >= 34 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE : 0);
            try { startForeground(1, n, fallback); } catch (Exception ignored) { }
        }
    }

    // ----- the bubble -----
    private int dp(float v) { return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()); }

    private void addBubble() {
        if (bubble != null) return;
        bubble = new LinearLayout(this);
        bubble.setOrientation(LinearLayout.VERTICAL);
        bubble.setGravity(Gravity.CENTER_HORIZONTAL);

        face = new ImageView(this);
        face.setScaleType(ImageView.ScaleType.CENTER_CROP);
        GradientDrawable ring = new GradientDrawable();
        ring.setShape(GradientDrawable.OVAL);
        ring.setColors(new int[]{0xFFFFD27A, 0xFFB48CFF, 0xFF7B3CFF});
        ring.setGradientType(GradientDrawable.SWEEP_GRADIENT);
        face.setBackground(ring);
        int pad = dp(3);
        face.setPadding(pad, pad, pad, pad);
        face.setClipToOutline(true);
        face.setOutlineProvider(new ViewOutlineProvider() {
            @Override public void getOutline(View v, Outline o) { o.setOval(0, 0, v.getWidth(), v.getHeight()); }
        });
        face.setElevation(dp(6));
        bubble.addView(face, new LinearLayout.LayoutParams(dp(68), dp(68)));

        words = new TextView(this);
        words.setTextColor(0xFF1A1440);
        words.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        words.setMaxWidth(dp(220));
        words.setPadding(dp(12), dp(8), dp(12), dp(8));
        GradientDrawable card = new GradientDrawable();
        card.setColor(0xFFFFFFFF);
        card.setCornerRadius(dp(16));
        words.setBackground(card);
        words.setElevation(dp(6));
        words.setVisibility(View.GONE);
        LinearLayout.LayoutParams wp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        wp.topMargin = dp(6);
        bubble.addView(words, wp);

        lp = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.TOP | Gravity.START;
        DisplayMetrics screen = getResources().getDisplayMetrics();
        lp.x = screen.widthPixels - dp(84);
        lp.y = screen.heightPixels / 3;
        setFace("happy");
        dragAndTap(bubble);
        wm.addView(bubble, lp);
        if (appOpen) bubble.setVisibility(View.GONE);
        bubble.setScaleX(0.4f); bubble.setScaleY(0.4f);
        bubble.animate().scaleX(1).scaleY(1).setDuration(260).start();
    }

    private void removeBubble() {
        main.removeCallbacks(hideWords);
        showCloseTarget(false);
        if (bubble != null) { try { wm.removeView(bubble); } catch (Exception ignored) { } }
        bubble = null; face = null; words = null;
        if (MainActivity.current != null) MainActivity.current.js("window.__nativeBubble && __nativeBubble(false)");
    }

    /** Drag to move (drop her on the ✕ at the bottom to put the bubble away); tap to open Firefly. */
    private TextView closeTarget;
    private WindowManager.LayoutParams closeLp;

    private void showCloseTarget(boolean on) {
        if (on && closeTarget == null) {
            closeTarget = new TextView(this);
            closeTarget.setText("✕");
            closeTarget.setTextColor(0xFFFFFFFF);
            closeTarget.setTextSize(TypedValue.COMPLEX_UNIT_SP, 26);
            closeTarget.setGravity(Gravity.CENTER);
            GradientDrawable c = new GradientDrawable();
            c.setShape(GradientDrawable.OVAL);
            c.setColor(0xCC1A1342);
            c.setStroke(dp(2), 0x66FFFFFF);
            closeTarget.setBackground(c);
            closeLp = new WindowManager.LayoutParams(dp(64), dp(64),
                    WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE,
                    PixelFormat.TRANSLUCENT);
            closeLp.gravity = Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL;
            closeLp.y = dp(72);
            try { wm.addView(closeTarget, closeLp); } catch (Exception e) { closeTarget = null; }
        } else if (!on && closeTarget != null) {
            try { wm.removeView(closeTarget); } catch (Exception ignored) { }
            closeTarget = null;
        }
    }

    /** Is the bubble's face over the ✕? */
    private boolean overClose(float rawX, float rawY) {
        DisplayMetrics d = getResources().getDisplayMetrics();
        float cx = d.widthPixels / 2f, cy = d.heightPixels - dp(72) - dp(32);
        return Math.hypot(rawX - cx, rawY - cy) < dp(70);
    }

    private void dragAndTap(View v) {
        final float[] start = new float[4];
        final boolean[] moved = new boolean[1];
        v.setOnTouchListener((view, e) -> {
            switch (e.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    start[0] = e.getRawX(); start[1] = e.getRawY(); start[2] = lp.x; start[3] = lp.y;
                    moved[0] = false;
                    return true;
                case MotionEvent.ACTION_MOVE:
                    float dx = e.getRawX() - start[0], dy = e.getRawY() - start[1];
                    if (!moved[0] && Math.abs(dx) + Math.abs(dy) > dp(8)) { moved[0] = true; showCloseTarget(true); }
                    lp.x = (int) (start[2] + dx); lp.y = (int) (start[3] + dy);
                    if (bubble != null) wm.updateViewLayout(bubble, lp);
                    if (closeTarget != null) {
                        boolean over = overClose(e.getRawX(), e.getRawY());
                        closeTarget.setScaleX(over ? 1.25f : 1f); closeTarget.setScaleY(over ? 1.25f : 1f);
                    }
                    return true;
                case MotionEvent.ACTION_UP:
                case MotionEvent.ACTION_CANCEL:
                    boolean drop = moved[0] && overClose(e.getRawX(), e.getRawY());
                    showCloseTarget(false);
                    if (drop) { removeBubble(); stopIfIdle(); }
                    else if (!moved[0] && bubble != null && e.getActionMasked() == MotionEvent.ACTION_UP) {
                        startActivity(new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT));
                    }
                    return true;
            }
            return false;
        });
    }

    private void stopIfIdle() {
        if (bubble == null && projection == null) { stopForeground(STOP_FOREGROUND_REMOVE); stopSelf(); }
    }

    /** Firefly was swiped away from recent apps: Luma goes with it. */
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        stopCapture(false);
        removeBubble();
        stopIfIdle();
        super.onTaskRemoved(rootIntent);
    }

    private void setFace(String mood) {
        if (face == null) return;
        String[] known = {"happy", "listening", "excited", "shy", "pout", "ignore", "sad", "sleepy"};
        String m = "listening";
        for (String k : known) if (k.equals(mood)) m = k;
        try (InputStream in = getAssets().open("luma/chibi_" + m + ".webp")) {
            face.setImageBitmap(BitmapFactory.decodeStream(in));
        } catch (Exception ignored) { }
    }

    private void show(String text, String mood) {
        if (bubble == null) return;
        if (mood != null && !mood.isEmpty()) {
            setFace(mood);
            face.animate().translationY(-dp(10)).setDuration(140).withEndAction(() -> face.animate().translationY(0).setDuration(180).start()).start();
        }
        if (text != null && !text.trim().isEmpty()) {
            String t = text.trim();
            words.setText(t.length() > 160 ? t.substring(0, 157) + "…" : t);
            words.setVisibility(View.VISIBLE);
            words.setAlpha(0); words.setScaleX(0.85f); words.setScaleY(0.85f);
            words.animate().alpha(1).scaleX(1).scaleY(1).setDuration(220).start();
            main.removeCallbacks(hideWords);
            main.postDelayed(hideWords, Math.max(6000, t.length() * 90L));
        }
    }

    // ----- watching the screen -----
    private void startCapture(int code, Intent data) {
        if (data == null || projection != null) return;
        MediaProjectionManager m = (MediaProjectionManager) getSystemService(MEDIA_PROJECTION_SERVICE);
        projection = m.getMediaProjection(code, data);
        if (projection == null) { tellPage(false); return; }
        captureThread = new HandlerThread("luma-eyes");
        captureThread.start();
        Handler h = new Handler(captureThread.getLooper());
        projection.registerCallback(new MediaProjection.Callback() {
            @Override public void onStop() { main.post(() -> stopCapture(true)); }
        }, h);
        DisplayMetrics dm = getResources().getDisplayMetrics();
        float k = Math.min(1f, 1280f / Math.max(dm.widthPixels, dm.heightPixels));
        int w = Math.max(2, (int) (dm.widthPixels * k)) & ~1, ht = Math.max(2, (int) (dm.heightPixels * k)) & ~1;
        reader = ImageReader.newInstance(w, ht, PixelFormat.RGBA_8888, 2);
        display = projection.createVirtualDisplay("luma-eyes", w, ht, dm.densityDpi,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, reader.getSurface(), null, h);
        tellPage(true);
    }

    private void stopCapture(boolean tell) {
        boolean was = projection != null;
        if (display != null) display.release();
        if (projection != null) { try { projection.stop(); } catch (Exception ignored) { } }
        if (reader != null) reader.close();
        if (captureThread != null) captureThread.quitSafely();
        display = null; projection = null; reader = null; captureThread = null; lastFrame = "";
        if (was && tell && MainActivity.current != null) MainActivity.current.js("window.__nativeCaptureEnded && __nativeCaptureEnded()");
        if (was && bubble != null) foreground(false);
    }

    private void tellPage(boolean ok) {
        if (MainActivity.current != null) MainActivity.current.js("window.__nativeCapture && __nativeCapture(" + ok + ")");
    }

    /** The latest screen as a JPEG (the last one again if nothing changed). */
    private synchronized String grab() {
        if (reader == null) return "";
        Image img = null;
        try {
            img = reader.acquireLatestImage();
            if (img == null) return lastFrame;
            Image.Plane p = img.getPlanes()[0];
            ByteBuffer buf = p.getBuffer();
            int pixel = p.getPixelStride(), row = p.getRowStride(), w = img.getWidth(), h = img.getHeight();
            Bitmap full = Bitmap.createBitmap(row / pixel, h, Bitmap.Config.ARGB_8888);
            // each row may carry padding, and the last row usually doesn't: copy into a full-size buffer
            int need = (row / pixel) * pixel * h;
            if (buf.remaining() < need) {
                ByteBuffer whole = ByteBuffer.allocate(need);
                whole.put(buf);
                whole.rewind();
                buf = whole;
            }
            full.copyPixelsFromBuffer(buf);
            Bitmap shot = Bitmap.createBitmap(full, 0, 0, w, h);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            shot.compress(Bitmap.CompressFormat.JPEG, 70, out);
            full.recycle(); shot.recycle();
            lastFrame = Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
            return lastFrame;
        } catch (Exception e) {
            lastError = String.valueOf(e);
            return lastFrame;
        } finally {
            if (img != null) img.close();
        }
    }
}
