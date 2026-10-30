package com.firefly.luma;

import android.app.Notification;
import android.content.ComponentName;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.provider.Settings;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayDeque;

/**
 * The notifications that arrive (Discord, WhatsApp…), kept in memory so Luma can sum them up for him.
 * Off until he allows it in Settings. Money, password and other private apps are never read; nothing
 * is stored on the phone or kept after the app closes.
 */
public class LumaNotes extends NotificationListenerService {
    private static final ArrayDeque<JSONObject> recent = new ArrayDeque<>();
    private static volatile boolean connected;

    @Override public void onListenerConnected() { connected = true; }
    @Override public void onListenerDisconnected() { connected = false; }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        try {
            String pkg = sbn.getPackageName();
            if (pkg == null || pkg.equals(getPackageName()) || sbn.isOngoing()) return;
            Notification n = sbn.getNotification();
            if ((n.flags & Notification.FLAG_GROUP_SUMMARY) != 0) return;
            String app = appName(pkg);
            if (LumaAccess.OFF_LIMITS.matcher((pkg + " " + app).toLowerCase()).find()) return;
            Bundle x = n.extras;
            CharSequence title = x.getCharSequence(Notification.EXTRA_TITLE), text = x.getCharSequence(Notification.EXTRA_BIG_TEXT);
            if (text == null) text = x.getCharSequence(Notification.EXTRA_TEXT);
            if (title == null && text == null) return;
            JSONObject o = new JSONObject();
            o.put("app", app);
            o.put("title", title == null ? "" : clip(title.toString(), 80));
            o.put("text", text == null ? "" : clip(text.toString(), 300));
            o.put("at", sbn.getPostTime());
            synchronized (recent) {
                recent.addLast(o);
                while (recent.size() > 60) recent.removeFirst();
            }
        } catch (Exception ignored) { }
    }

    private String appName(String pkg) {
        try {
            PackageManager pm = getPackageManager();
            return pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString();
        } catch (Exception e) { return pkg; }
    }
    private static String clip(String s, int n) { return s.length() > n ? s.substring(0, n) + "…" : s; }

    /** The notifications since `since` (ms), oldest first, as JSON. */
    static String since(long since) {
        JSONArray a = new JSONArray();
        synchronized (recent) { for (JSONObject o : recent) if (o.optLong("at") > since) a.put(o); }
        return a.toString();
    }
    static boolean allowed(Context c) {
        String on = Settings.Secure.getString(c.getContentResolver(), "enabled_notification_listeners");
        return on != null && on.contains(new ComponentName(c, LumaNotes.class).flattenToString());
    }
    static boolean live() { return connected; }
}
