package com.firefly.luma;

import android.Manifest;
import android.animation.ValueAnimator;
import android.view.animation.OvershootInterpolator;
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
    private final Runnable hideWords = this::wordsDone;

    // ----- her life on the screen: she peeks from an edge, comes out to talk, dozes when it's quiet -----
    private TextView zz;
    private int side = 1;                   // 0 = left edge, 1 = right edge
    private long lastActivity = System.currentTimeMillis();
    private boolean asleep;
    private ValueAnimator mover;
    private android.animation.ObjectAnimator wiggle;
    private final Runnable life = new Runnable() {
        @Override public void run() {
            if (bubble != null && !appOpen && words.getVisibility() != View.VISIBLE) {
                long idle = System.currentTimeMillis() - lastActivity;
                if (idle > 8 * 60_000 && !asleep) sleep();
                else if (!asleep && idle > 2 * 60_000 && Math.random() < 0.35) curiousPeek();
            }
            main.postDelayed(this, 45_000);
        }
    };

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
    static void appVisible(boolean open) { main.post(() -> { if (me != null) { me.appOpen = open; if (open) me.lastActivity = System.currentTimeMillis(); if (me.bubble != null) { me.bubble.setVisibility(open ? View.GONE : View.VISIBLE); if (!open && me.asleep) me.wake(); } } }); }
    static void say(String text, String mood) { main.post(() -> { if (me != null) me.show(text, mood); }); }
    /** Listening started while the app is open: let the service keep the microphone if it runs. */
    /** Asks "Tap “Send”?" on her bubble; runs yes only if the person taps Yes. False when there's no bubble to ask on. */
    static boolean confirm(String question, Runnable yes) {
        if (me == null || me.bubble == null) return false;
        main.post(() -> { if (me != null) me.ask(question, yes); });
        return true;
    }

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

    // the bubble: [face] beside [her words / the reply box]; on the right edge the panel sits on her left
    private android.widget.FrameLayout faceBox;
    private LinearLayout panel;
    private LinearLayout inputRow;
    private android.widget.EditText input;
    private long lastTap;

    private void addBubble() {
        if (bubble != null) return;
        bubble = new LinearLayout(this);
        bubble.setOrientation(LinearLayout.HORIZONTAL);
        bubble.setGravity(Gravity.CENTER_VERTICAL);
        bubble.setClipChildren(false);
        bubble.setClipToPadding(false);

        // her face, with room around it for little effects (hearts, sparkles, z's)
        faceBox = new android.widget.FrameLayout(this);
        faceBox.setClipChildren(false);
        int room = dp(16);
        faceBox.setPadding(room, room, room, room / 2);
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
        faceBox.addView(face, new android.widget.FrameLayout.LayoutParams(dp(68), dp(68)));
        zz = new TextView(this);
        zz.setText("z z");
        zz.setTextColor(0xFFFFD27A);
        zz.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        zz.setVisibility(View.GONE);
        android.widget.FrameLayout.LayoutParams zp = new android.widget.FrameLayout.LayoutParams(-2, -2, Gravity.TOP | Gravity.END);
        zp.topMargin = -dp(12);
        faceBox.addView(zz, zp);

        // her words and the reply box, beside her
        panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        words = new TextView(this);
        words.setTextColor(0xFF1A1440);
        words.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        words.setMaxWidth(dp(210));
        words.setPadding(dp(12), dp(8), dp(12), dp(8));
        GradientDrawable card = new GradientDrawable();
        card.setColor(0xFFFFFFFF);
        card.setCornerRadius(dp(16));
        words.setBackground(card);
        words.setElevation(dp(6));
        words.setVisibility(View.GONE);
        panel.addView(words, new LinearLayout.LayoutParams(-2, -2));

        inputRow = new LinearLayout(this);
        inputRow.setOrientation(LinearLayout.HORIZONTAL);
        inputRow.setGravity(Gravity.CENTER_VERTICAL);
        GradientDrawable pill = new GradientDrawable();
        pill.setColor(0xF01A1342);
        pill.setCornerRadius(dp(22));
        pill.setStroke(dp(1), 0x55FFD27A);
        inputRow.setBackground(pill);
        inputRow.setPadding(dp(10), dp(2), dp(4), dp(2));
        input = new android.widget.EditText(this);
        input.setHint("Say something…");
        input.setHintTextColor(0x99C9C2EA);
        input.setTextColor(0xFFFBF7FF);
        input.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        input.setBackground(null);
        input.setSingleLine(true);
        input.setImeOptions(android.view.inputmethod.EditorInfo.IME_ACTION_SEND);
        input.setOnEditorActionListener((v, id, ev) -> { sendTyped(); return true; });
        inputRow.addView(input, new LinearLayout.LayoutParams(dp(170), -2));
        TextView go = new TextView(this);
        go.setText("➤");
        go.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        go.setTextColor(0xFF07051A);
        go.setGravity(Gravity.CENTER);
        GradientDrawable gold = new GradientDrawable();
        gold.setShape(GradientDrawable.OVAL);
        gold.setColor(0xFFFFD27A);
        go.setBackground(gold);
        go.setOnClickListener(v -> sendTyped());
        inputRow.addView(go, new LinearLayout.LayoutParams(dp(34), dp(34)));
        inputRow.setVisibility(View.GONE);
        LinearLayout.LayoutParams ip = new LinearLayout.LayoutParams(-2, -2);
        ip.topMargin = dp(6);
        panel.addView(inputRow, ip);
        panel.setVisibility(View.GONE);

        lp = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.TOP | Gravity.START;
        DisplayMetrics screen = getResources().getDisplayMetrics();
        lp.x = screen.widthPixels;
        lp.y = screen.heightPixels / 3;
        side = 1;
        arrange();
        setFace("happy");
        dragAndTap(faceBox);
        wm.addView(bubble, lp);
        if (appOpen) bubble.setVisibility(View.GONE);
        lastActivity = System.currentTimeMillis();
        main.postDelayed(this::tuck, 150);
        main.removeCallbacks(life);
        main.postDelayed(life, 45_000);
        main.removeCallbacks(wander);
        main.postDelayed(wander, 20_000);
    }

    // ----- asking before she touches anything -----
    private LinearLayout askRow;
    private Runnable askYes;
    private final Runnable askTimeout = () -> answer(false);

    private TextView chip(String text, int bg, int fg) {
        TextView c = new TextView(this);
        c.setText(text);
        c.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        c.setTextColor(fg);
        c.setGravity(Gravity.CENTER);
        c.setPadding(dp(14), dp(6), dp(14), dp(6));
        GradientDrawable d = new GradientDrawable();
        d.setColor(bg);
        d.setCornerRadius(dp(16));
        c.setBackground(d);
        c.setElevation(dp(4));
        return c;
    }

    private void ask(String question, Runnable yes) {
        if (bubble == null) return;
        if (askRow == null) {
            askRow = new LinearLayout(this);
            askRow.setOrientation(LinearLayout.HORIZONTAL);
            TextView ok = chip("✓ Yes", 0xFFFFD27A, 0xFF07051A), no = chip("✕ No", 0xF01A1342, 0xFFFBF7FF);
            ok.setOnClickListener(v -> answer(true));
            no.setOnClickListener(v -> answer(false));
            askRow.addView(ok);
            LinearLayout.LayoutParams gap = new LinearLayout.LayoutParams(-2, -2);
            gap.leftMargin = dp(8);
            askRow.addView(no, gap);
            LinearLayout.LayoutParams ap = new LinearLayout.LayoutParams(-2, -2);
            ap.topMargin = dp(6);
            panel.addView(askRow, ap);
        }
        askYes = yes;
        show(question, "thinking");
        if (MainActivity.current != null) MainActivity.current.js("window.__nativeAsk && __nativeAsk(" + org.json.JSONObject.quote(question) + ")");
        main.removeCallbacks(hideWords);   // the question stays until answered
        askRow.setVisibility(View.VISIBLE);
        main.removeCallbacks(askTimeout);
        main.postDelayed(askTimeout, 30_000);
    }

    /** A yes or no from the page (said out loud on a call). */
    static void answerAsk(boolean yes) { main.post(() -> { if (me != null && me.askYes != null) me.answer(yes); }); }

    private void answer(boolean yes) {
        main.removeCallbacks(askTimeout);
        if (MainActivity.current != null) MainActivity.current.js("window.__nativeAskDone && __nativeAskDone()");
        Runnable r = askYes;
        askYes = null;
        if (askRow != null) askRow.setVisibility(View.GONE);
        if (yes && r != null) {
            // out of the way first, so the tap lands on the app and not on her
            if (bubble != null) bubble.setVisibility(View.INVISIBLE);
            main.postDelayed(() -> {
                try { r.run(); } catch (Exception ignored) { }
                main.postDelayed(() -> { if (bubble != null && !appOpen) bubble.setVisibility(View.VISIBLE); show("Done~ ✨", "happy"); }, 400);
            }, 250);
        } else if (r != null) {
            show("Okay, I won't 🙂", "listening");
        }
    }

    private void wordsDone() {
        if (askYes != null) return;   // still waiting for a yes or no
        if (words != null) words.setVisibility(View.GONE);
        if (panel != null && inputRow.getVisibility() != View.VISIBLE) panel.setVisibility(View.GONE);
        stopWiggle();
        tuck();
    }

    /** Face and panel in the right order for the edge she's on (the panel always faces the screen). */
    private void arrange() {
        if (bubble == null) return;
        bubble.removeAllViews();
        LinearLayout.LayoutParams pp = new LinearLayout.LayoutParams(-2, -2);
        if (side == 0) { bubble.addView(faceBox); pp.leftMargin = -dp(8); bubble.addView(panel, pp); }
        else { pp.rightMargin = -dp(8); bubble.addView(panel, pp); bubble.addView(faceBox); }
        panel.setGravity(side == 0 ? Gravity.START : Gravity.END);
    }

    /** Double-tap: a small reply box opens beside her, with the keyboard. */
    private void openInput() {
        if (bubble == null) return;
        wake();
        main.removeCallbacks(hideWords);
        panel.setVisibility(View.VISIBLE);
        inputRow.setVisibility(View.VISIBLE);
        lp.flags &= ~WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE;   // the box needs the keyboard
        try { wm.updateViewLayout(bubble, lp); } catch (Exception ignored) { }
        comeOut(false);
        input.requestFocus();
        main.postDelayed(() -> {
            android.view.inputmethod.InputMethodManager im = (android.view.inputmethod.InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
            if (im != null && input != null) im.showSoftInput(input, android.view.inputmethod.InputMethodManager.SHOW_IMPLICIT);
        }, 150);
    }

    private void closeInput() {
        if (bubble == null) return;
        android.view.inputmethod.InputMethodManager im = (android.view.inputmethod.InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
        if (im != null) im.hideSoftInputFromWindow(input.getWindowToken(), 0);
        inputRow.setVisibility(View.GONE);
        if (words.getVisibility() != View.VISIBLE) panel.setVisibility(View.GONE);
        lp.flags |= WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE;
        try { wm.updateViewLayout(bubble, lp); } catch (Exception ignored) { }
    }

    private void sendTyped() {
        String t = input.getText().toString().trim();
        input.setText("");
        closeInput();
        if (t.isEmpty()) { tuck(); return; }
        show("…", "listening");
        if (MainActivity.current != null) MainActivity.current.js("window.__nativeBubbleSend && __nativeBubbleSend(" + org.json.JSONObject.quote(t) + ")");
    }

    /** Little effects around her face, by feeling. */
    private void sparkle(String mood) {
        if (faceBox == null) return;
        String fx;
        switch (mood == null ? "" : mood) {
            case "happy": fx = "💕"; break;
            case "shy": fx = "💗"; break;
            case "excited": fx = "✨"; break;
            case "pout": case "ignore": fx = "💢"; break;
            case "sad": fx = "💧"; break;
            case "thinking": fx = "💭"; break;
            default: return;
        }
        for (int k = 0; k < 3; k++) {
            final int n = k;
            main.postDelayed(() -> {
                if (faceBox == null) return;
                TextView p = new TextView(this);
                p.setText(fx);
                p.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14 + n * 2);
                android.widget.FrameLayout.LayoutParams fp = new android.widget.FrameLayout.LayoutParams(-2, -2, Gravity.TOP | (n % 2 == 0 ? Gravity.START : Gravity.END));
                fp.topMargin = dp(10 + n * 6);
                faceBox.addView(p, fp);
                p.animate().translationY(-dp(34)).translationX((n % 2 == 0 ? -1 : 1) * dp(8)).alpha(0).setDuration(1100)
                        .withEndAction(() -> { if (faceBox != null) faceBox.removeView(p); }).start();
            }, k * 180L);
        }
    }

    private void removeBubble() {
        main.removeCallbacks(hideWords);
        main.removeCallbacks(life);
        main.removeCallbacks(wander);
        if (mover != null) mover.cancel();
        bounce(false);
        stopWiggle();
        asleep = false;
        showCloseTarget(false);
        if (bubble != null) { try { wm.removeView(bubble); } catch (Exception ignored) { } }
        bubble = null; face = null; words = null; faceBox = null; panel = null; inputRow = null; input = null;
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
                    if (!moved[0] && Math.abs(dx) + Math.abs(dy) > dp(8)) { moved[0] = true; showCloseTarget(true); if (mover != null) mover.cancel(); face.setRotation(0); }
                    lastDrag = System.currentTimeMillis();   // they moved her: she stays put for a while
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
                    else if (moved[0]) snapToEdge();
                    else if (!moved[0] && bubble != null && e.getActionMasked() == MotionEvent.ACTION_UP) {
                        long now = System.currentTimeMillis();
                        if (LumaAccess.autoScrolling()) { LumaAccess.stopAutoScroll(); lastTap = 0; return true; }   // tap her to stop scrolling
                        if (now - lastTap < 350) {   // double-tap: type to her right here
                            main.removeCallbacks(openApp);
                            if (inputRow.getVisibility() == View.VISIBLE) closeInput(); else openInput();
                        } else main.postDelayed(openApp, 360);   // single tap: open Firefly
                        lastTap = now;
                    }
                    return true;
            }
            return false;
        });
    }

    private final Runnable openApp = () -> {
        if (bubble != null) startActivity(new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT));
    };

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
        boolean talking = text != null && !text.trim().isEmpty();
        if (asleep || talking) wake();
        if (mood != null && !mood.isEmpty()) {
            setFace(mood);
            hop();
            sparkle(mood);
        }
        if (talking) {
            String t = text.trim();
            words.setText(t.length() > 160 ? t.substring(0, 157) + "…" : t);
            panel.setVisibility(View.VISIBLE);
            words.setVisibility(View.VISIBLE);
            words.setAlpha(0); words.setScaleX(0.85f); words.setScaleY(0.85f);
            words.animate().alpha(1).scaleX(1).scaleY(1).setDuration(220).start();
            boolean thrilled = "excited".equals(mood);
            comeOut(thrilled);   // something exciting on screen: she scoots toward the middle
            startWiggle(t.length());
            main.removeCallbacks(hideWords);
            main.postDelayed(hideWords, Math.max(6000, t.length() * 90L));
        }
    }

    private int screenW() { return getResources().getDisplayMetrics().widthPixels; }
    private int screenH() { return getResources().getDisplayMetrics().heightPixels; }

    /** Glide the bubble to x, y. */
    private void moveTo(int x, int y, long ms) {
        if (bubble == null) return;
        if (mover != null) mover.cancel();
        final int x0 = lp.x, y0 = lp.y;
        mover = ValueAnimator.ofFloat(0, 1);
        mover.setDuration(ms);
        mover.setInterpolator(new OvershootInterpolator(0.9f));
        mover.addUpdateListener(a -> {
            if (bubble == null) return;
            float k = (float) a.getAnimatedValue();
            lp.x = (int) (x0 + (x - x0) * k); lp.y = (int) (y0 + (y - y0) * k);
            try { wm.updateViewLayout(bubble, lp); } catch (Exception ignored) { }
        });
        mover.start();
    }

    private int clampY(int y) { return Math.max(dp(40), Math.min(screenH() - dp(220), y)); }

    /** Half hidden past the edge, peeking out, as if she were behind the app. */
    private void tuck() {
        if (bubble == null || face == null) return;
        int box = dp(68) + dp(32), x = side == 0 ? -(int) (box * 0.5f) : screenW() - (int) (box * 0.5f);
        moveTo(x, clampY(lp.y), 520);
        face.animate().rotation(side == 0 ? 16 : -16).setDuration(400).start();
    }

    /** Out from behind the edge, fully on screen, to talk. */
    private void comeOut(boolean toMiddle) {
        if (bubble == null) return;
        bubble.measure(View.MeasureSpec.UNSPECIFIED, View.MeasureSpec.UNSPECIFIED);
        int w = bubble.getMeasuredWidth(), x = side == 0 ? dp(10) : screenW() - w - dp(10);
        if (toMiddle) x = (screenW() - w) / 2 + (side == 0 ? -dp(30) : dp(30));
        moveTo(x, clampY(lp.y), 380);
        face.animate().rotation(0).setDuration(250).start();
    }

    private void snapToEdge() {
        int was = side;
        side = lp.x + dp(50) < screenW() / 2 ? 0 : 1;
        if (side != was) arrange();
        if (words.getVisibility() == View.VISIBLE) comeOut(false); else tuck();
    }

    /** Every few minutes of quiet she slides out a little, looks around, and hides again. */
    private void curiousPeek() {
        if (bubble == null) return;
        int box = dp(68) + dp(32), x = side == 0 ? -dp(10) : screenW() - box + dp(10);
        moveTo(x, clampY(lp.y + (int) ((Math.random() - 0.5) * dp(160))), 600);
        face.animate().rotation(0).setDuration(300).start();
        main.postDelayed(this::tuck, 2200);
    }

    // ----- moving around the phone on her own -----
    private long lastDrag;
    private android.animation.ObjectAnimator steps;
    private final Runnable wander = new Runnable() {
        @Override public void run() {
            if (bubble != null && !appOpen && !asleep && askYes == null && words.getVisibility() != View.VISIBLE
                    && inputRow.getVisibility() != View.VISIBLE && !LumaAccess.autoScrolling()
                    && System.currentTimeMillis() - lastDrag > 60_000) {
                double r = Math.random();
                if (r < 0.4) walkAcross();
                else if (r < 0.75) strollAlongEdge();
                else curiousPeek();
            }
            main.postDelayed(this, 18_000 + (long) (Math.random() * 22_000));
        }
    };

    /** She walks across the screen to the other edge, bouncing a little with each step. */
    private void walkAcross() {
        if (bubble == null) return;
        bubble.measure(View.MeasureSpec.UNSPECIFIED, View.MeasureSpec.UNSPECIFIED);
        int w = bubble.getMeasuredWidth(), to = side == 0 ? screenW() - w - dp(6) : dp(6);
        int y = clampY(lp.y + (int) ((Math.random() - 0.5) * dp(240)));
        face.animate().rotation(0).setDuration(200).start();
        bounce(true);
        glide(to, y, 2600, () -> {
            bounce(false);
            side = side == 0 ? 1 : 0;
            arrange();
            main.postDelayed(this::tuck, 1200);
        });
    }

    /** Out a little from her edge, up or down to somewhere new, then back in hiding. */
    private void strollAlongEdge() {
        if (bubble == null) return;
        int box = dp(68) + dp(32), x = side == 0 ? -dp(6) : screenW() - box + dp(6);
        bounce(true);
        glide(x, clampY((int) (dp(80) + Math.random() * (screenH() - dp(320)))), 1800, () -> { bounce(false); main.postDelayed(this::tuck, 1500); });
    }

    private void glide(int x, int y, long ms, Runnable done) {
        if (bubble == null) return;
        if (mover != null) mover.cancel();
        final int x0 = lp.x, y0 = lp.y;
        mover = ValueAnimator.ofFloat(0, 1);
        mover.setDuration(ms);
        mover.setInterpolator(new android.view.animation.AccelerateDecelerateInterpolator());
        mover.addUpdateListener(a -> {
            if (bubble == null) return;
            float k = (float) a.getAnimatedValue();
            lp.x = (int) (x0 + (x - x0) * k); lp.y = (int) (y0 + (y - y0) * k);
            try { wm.updateViewLayout(bubble, lp); } catch (Exception ignored) { }
        });
        mover.addListener(new android.animation.AnimatorListenerAdapter() {
            boolean cancelled;
            @Override public void onAnimationCancel(android.animation.Animator a) { cancelled = true; bounce(false); }
            @Override public void onAnimationEnd(android.animation.Animator a) { if (!cancelled && done != null) done.run(); }
        });
        mover.start();
    }

    private void bounce(boolean on) {
        if (steps != null) { steps.cancel(); steps = null; }
        if (face == null) return;
        face.setTranslationY(0);
        if (!on) return;
        steps = android.animation.ObjectAnimator.ofFloat(face, "translationY", 0f, -dp(7));
        steps.setDuration(190);
        steps.setRepeatMode(ValueAnimator.REVERSE);
        steps.setRepeatCount(ValueAnimator.INFINITE);
        steps.start();
    }

    private void hop() {
        face.animate().translationY(-dp(10)).setDuration(140).withEndAction(() -> { if (face != null) face.animate().translationY(0).setDuration(180).start(); }).start();
    }

    /** A little sway while she talks. */
    private void startWiggle(int chars) {
        stopWiggle();
        wiggle = android.animation.ObjectAnimator.ofFloat(face, "rotation", -7f, 7f);
        wiggle.setDuration(280);
        wiggle.setRepeatMode(ValueAnimator.REVERSE);
        wiggle.setRepeatCount(Math.min(14, 4 + chars / 12));
        wiggle.start();
    }

    private void stopWiggle() { if (wiggle != null) wiggle.cancel(); wiggle = null; }

    private void sleep() {
        asleep = true;
        setFace("sleepy");
        zz.setVisibility(View.VISIBLE);
        zz.setAlpha(0.3f);
        zz.animate().alpha(1).translationY(-dp(6)).setDuration(1400).withEndAction(() -> { if (zz != null) zz.animate().alpha(0.3f).translationY(0).setDuration(1400).start(); }).start();
    }

    /** Back from a doze (or simply active again): a little wave-hop. */
    private void wake() {
        lastActivity = System.currentTimeMillis();
        if (!asleep) return;
        asleep = false;
        zz.setVisibility(View.GONE);
        setFace("happy");
        hop();
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
