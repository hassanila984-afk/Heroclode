package com.firefly.luma;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;

/**
 * Luma reaching out on her own: a message as a notification, or, for something important, a call
 * (rings like an incoming call, full screen even on the lock screen; answering opens a voice call with her).
 */
final class Pings {
    static final String EXTRA_CALL = "luma_call", EXTRA_OPEN = "luma_open";
    private static int next = 100;

    private Pings() {}

    static void show(Context c, String text, boolean call) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null) return;
        if (nm.getNotificationChannel("luma_msg") == null)
            nm.createNotificationChannel(new NotificationChannel("luma_msg", "Messages from Luma", NotificationManager.IMPORTANCE_HIGH));
        if (nm.getNotificationChannel("luma_call") == null) {
            NotificationChannel ch = new NotificationChannel("luma_call", "Calls from Luma", NotificationManager.IMPORTANCE_HIGH);
            ch.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
                    new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE).build());
            ch.enableVibration(true);
            ch.setVibrationPattern(new long[]{0, 800, 600, 800, 600, 800});
            nm.createNotificationChannel(ch);
        }
        int id = call ? 77 : next++;
        Intent open = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .putExtra(call ? EXTRA_CALL : EXTRA_OPEN, text == null ? "" : text);
        PendingIntent pi = PendingIntent.getActivity(c, id, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = new Notification.Builder(c, call ? "luma_call" : "luma_msg")
                .setSmallIcon(android.R.drawable.star_on)
                .setContentTitle(call ? "Luma is calling 📞" : "Luma")
                .setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text))
                .setContentIntent(pi)
                .setAutoCancel(true);
        if (call) {
            b.setCategory(Notification.CATEGORY_CALL).setFullScreenIntent(pi, true).setTimeoutAfter(45000)
                    .addAction(new Notification.Action.Builder(null, "Answer", pi).build());
        } else b.setCategory(Notification.CATEGORY_MESSAGE);
        try { nm.notify(id, b.build()); } catch (SecurityException ignored) { }
    }

    static void cancelCall(Context c) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm != null) nm.cancel(77);
    }
}
