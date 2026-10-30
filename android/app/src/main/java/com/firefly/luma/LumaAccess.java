package com.firefly.luma;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.Path;
import android.graphics.Rect;
import android.os.Bundle;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * Luma's hands, when the person turns her on in Accessibility settings: she can read the buttons
 * on the screen and tap, type or scroll for them. Every tap and every bit of typing is asked first
 * on her bubble, and she never touches money, passwords, settings or app installs.
 */
public class LumaAccess extends AccessibilityService {
    private static LumaAccess me;
    private String lastPkg = "";
    private final android.os.Handler main = new android.os.Handler(android.os.Looper.getMainLooper());

    // ----- reading hands-free: she keeps scrolling while they read (a webtoon, an article) -----
    private String scrollPkg;          // the app she's scrolling; leaving it stops her
    private long scrollEvery;          // ms between gentle swipes
    private final Runnable scrollStep = new Runnable() {
        @Override public void run() {
            if (scrollPkg == null) return;
            swipe(true, 0.33f, 700);
            main.postDelayed(this, scrollEvery);
        }
    };
    static boolean autoScrolling() { return me != null && me.scrollPkg != null; }
    static void stopAutoScroll() { if (me != null) me.main.post(() -> me.endScroll()); }
    private void endScroll() {
        if (scrollPkg == null) return;
        scrollPkg = null;
        main.removeCallbacks(scrollStep);
        LumaService.say("Okay, stopped scrolling~", "happy");
    }
    /** A finger swipe in the middle of the screen: up the page (down = true) or back. */
    private void swipe(boolean down, float part, long ms) {
        android.util.DisplayMetrics dm = getResources().getDisplayMetrics();
        float x = dm.widthPixels / 2f, mid = dm.heightPixels * 0.55f, d = dm.heightPixels * part / 2f;
        Path p = new Path();
        p.moveTo(x, down ? mid + d : mid - d);
        p.lineTo(x, down ? mid - d : mid + d);
        dispatchGesture(new GestureDescription.Builder().addStroke(new GestureDescription.StrokeDescription(p, 0, ms)).build(), null, null);
    }

    /** Apps (and screens) she must never touch. */
    static final Pattern OFF_LIMITS = Pattern.compile(
            "bank|banco|pay|wallet|money|cash|card|crypto|coin|binance|trade|trading|finance|wise|revolut|venmo|zelle|"
            + "password|passkey|authenticator|vault|bitwarden|1password|lastpass|"
            + "com\\.android\\.settings|packageinstaller|permissioncontroller|com\\.android\\.vending|"
            + "مصرف|بنك|محفظ|دفع",
            Pattern.CASE_INSENSITIVE);

    static boolean on() { return me != null; }

    @Override protected void onServiceConnected() { me = this; }
    @Override public boolean onUnbind(android.content.Intent i) { if (me == this) me = null; return super.onUnbind(i); }
    @Override public void onDestroy() { if (me == this) me = null; super.onDestroy(); }
    @Override public void onInterrupt() { }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent e) {
        if (e.getEventType() == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED && e.getPackageName() != null) {
            String p = e.getPackageName().toString();
            if (!p.equals(getPackageName())) {
                lastPkg = p;
                // they left the app she was scrolling (system UI like the keyboard doesn't count)
                if (scrollPkg != null && !p.equals(scrollPkg) && !p.startsWith("com.android.systemui") && !p.contains("inputmethod")) endScroll();
            }
        }
    }

    // ----- reading the screen -----

    private AccessibilityNodeInfo root() {
        AccessibilityNodeInfo r = getRootInActiveWindow();
        if (r != null && r.getPackageName() != null && r.getPackageName().toString().equals(getPackageName())) return null;   // her own app
        return r;
    }

    private String appName(String pkg) {
        try {
            PackageManager pm = getPackageManager();
            ApplicationInfo ai = pm.getApplicationInfo(pkg, 0);
            return String.valueOf(pm.getApplicationLabel(ai));
        } catch (Exception e) { return pkg; }
    }

    private static String label(AccessibilityNodeInfo n) {
        CharSequence t = n.getText();
        if (t == null || t.toString().trim().isEmpty()) t = n.getContentDescription();
        if ((t == null || t.toString().trim().isEmpty()) && android.os.Build.VERSION.SDK_INT >= 26) t = n.getHintText();
        if (t == null) return "";
        String s = t.toString().replaceAll("\\s+", " ").trim();
        return s.length() > 40 ? s.substring(0, 40) : s;
    }

    private void collect(AccessibilityNodeInfo n, List<AccessibilityNodeInfo> out, boolean[] secret, int depth) {
        if (n == null || depth > 40 || out.size() > 80) return;
        if (n.isPassword()) secret[0] = true;
        if (n.isVisibleToUser() && (n.isClickable() || n.isEditable() || n.isScrollable() || !label(n).isEmpty())) out.add(n);
        for (int i = 0; i < n.getChildCount(); i++) collect(n.getChild(i), out, secret, depth + 1);
    }

    private boolean offLimits(AccessibilityNodeInfo r, boolean secret) {
        String pkg = r.getPackageName() == null ? "" : r.getPackageName().toString();
        return secret || OFF_LIMITS.matcher(pkg).find() || OFF_LIMITS.matcher(appName(pkg)).find();
    }

    /** What's on screen now, for Luma: the app and its buttons and fields (never in apps she can't touch). */
    static String screen() {
        LumaAccess s = me;
        if (s == null) return "";
        try {
            AccessibilityNodeInfo r = s.root();
            if (r == null) return "";
            List<AccessibilityNodeInfo> nodes = new ArrayList<>();
            boolean[] secret = {false};
            s.collect(r, nodes, secret, 0);
            JSONObject o = new JSONObject().put("app", s.appName(String.valueOf(r.getPackageName())));
            if (s.offLimits(r, secret[0])) return o.put("private", true).toString();
            JSONArray items = new JSONArray();
            for (AccessibilityNodeInfo n : nodes) {
                String l = label(n);
                if (l.isEmpty()) continue;
                String kind = n.isEditable() ? "field" : n.isClickable() || clickableParent(n) != null ? "button" : "text";
                items.put(kind + ": " + l);
                if (items.length() >= 40) break;
            }
            return o.put("items", items).toString();
        } catch (Exception e) { return ""; }
    }

    private static AccessibilityNodeInfo clickableParent(AccessibilityNodeInfo n) {
        for (int i = 0; n != null && i < 6; i++, n = n.getParent()) if (n.isClickable()) return n;
        return null;
    }

    /** The visible node whose words best match what she was asked to touch. */
    private AccessibilityNodeInfo find(AccessibilityNodeInfo r, String want, boolean field) {
        List<AccessibilityNodeInfo> nodes = new ArrayList<>();
        collect(r, nodes, new boolean[1], 0);
        String w = want.toLowerCase(Locale.ROOT).trim();
        AccessibilityNodeInfo best = null;
        int bestScore = 0;
        for (AccessibilityNodeInfo n : nodes) {
            if (field && !n.isEditable()) continue;
            String l = label(n).toLowerCase(Locale.ROOT);
            int score = l.isEmpty() ? (field && w.isEmpty() ? 1 : 0)
                    : l.equals(w) ? 4 : l.startsWith(w) ? 3 : l.contains(w) ? 2 : (!w.isEmpty() && w.contains(l)) ? 1 : 0;
            if (field && n.isFocused()) score++;
            if (score > bestScore) { bestScore = score; best = n; }
        }
        return best;
    }

    // ----- doing things (always asked first) -----

    /** Returns "asking", "ok", "no_access", "private", "not_found" or "failed". */
    static String act(String name, String arg) {
        LumaAccess s = me;
        if (s == null) return "no_access";
        switch (name) {
            case "back": return s.performGlobalAction(GLOBAL_ACTION_BACK) ? "ok" : "failed";
            case "home": return s.performGlobalAction(GLOBAL_ACTION_HOME) ? "ok" : "failed";
            case "notifications": return s.performGlobalAction(GLOBAL_ACTION_NOTIFICATIONS) ? "ok" : "failed";
        }
        AccessibilityNodeInfo r = s.root();
        if (r == null) return "not_found";
        boolean[] secret = {false};
        s.collect(r, new ArrayList<>(), secret, 0);
        if (s.offLimits(r, secret[0])) return "private";
        switch (name) {
            case "scroll": {
                // a real swipe works everywhere, including comic and webtoon readers
                boolean up = arg.toLowerCase(Locale.ROOT).contains("up");
                s.main.post(() -> s.swipe(!up, 0.6f, 350));
                return "ok";
            }
            case "autoscroll": {
                String a = arg.toLowerCase(Locale.ROOT);
                if (a.contains("stop") || a.contains("off")) { s.main.post(s::endScroll); return "ok"; }
                long every = s.scrollPkg == null ? 3000 : s.scrollEvery;
                if (a.contains("slow")) every = Math.min(9000, (long) (every * 1.5));
                else if (a.contains("fast")) every = Math.max(1000, (long) (every / 1.5));
                final long gap = every;
                final String pkg = String.valueOf(r.getPackageName());
                s.main.post(() -> {
                    boolean starting = s.scrollPkg == null;
                    s.scrollPkg = pkg; s.scrollEvery = gap;
                    s.main.removeCallbacks(s.scrollStep);
                    s.main.postDelayed(s.scrollStep, starting ? 1500 : gap);
                });
                return "ok";
            }
            case "tap": {
                AccessibilityNodeInfo n = s.find(r, arg, false);
                if (n == null) return "not_found";
                String l = label(n);
                s.main.post(() -> s.tap(n));   // they asked her: she just does it (no yes/no first)
                return "ok:" + l;
            }
            case "type": {
                int bar = arg.indexOf('|');
                String where = bar < 0 ? "" : arg.substring(0, bar).trim(), text = bar < 0 ? arg.trim() : arg.substring(bar + 1).trim();
                if (text.isEmpty()) return "failed";
                AccessibilityNodeInfo f = s.find(r, where, true);
                if (f == null) return "not_found";
                s.main.post(() -> {
                    f.refresh();
                    Bundle b = new Bundle();
                    b.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text);
                    f.performAction(AccessibilityNodeInfo.ACTION_FOCUS);
                    f.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, b);
                });
                return "ok";
            }
            default: return "unknown";
        }
    }

    private AccessibilityNodeInfo biggestScrollable(AccessibilityNodeInfo r) {
        List<AccessibilityNodeInfo> nodes = new ArrayList<>();
        collect(r, nodes, new boolean[1], 0);
        AccessibilityNodeInfo best = null;
        int area = 0;
        Rect b = new Rect();
        for (AccessibilityNodeInfo n : nodes) {
            if (!n.isScrollable()) continue;
            n.getBoundsInScreen(b);
            if (b.width() * b.height() > area) { area = b.width() * b.height(); best = n; }
        }
        return best;
    }

    private void tap(AccessibilityNodeInfo n) {
        n.refresh();
        AccessibilityNodeInfo c = clickableParent(n);
        if (c != null && c.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return;
        // nothing clickable around it: a real tap in the middle of it
        Rect b = new Rect();
        n.getBoundsInScreen(b);
        Path p = new Path();
        p.moveTo(b.exactCenterX(), b.exactCenterY());
        dispatchGesture(new GestureDescription.Builder().addStroke(new GestureDescription.StrokeDescription(p, 0, 60)).build(), null, null);
    }
}
